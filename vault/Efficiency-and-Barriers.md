# Efficiency and practical-barrier sweep

Started 2026-10-22. Linked from [[00-Index]]. Running log of the deep scan for wasted work (renders,
reads, network calls, bundle weight) and missing practical barriers (input caps,
rate limits, timeouts, double-submit guards, cost ceilings, repo guardrails).

## Baseline before the sweep

- `npm run check:architecture`: passed (78 modules, no cycles or broken imports).
- `oxlint`: 0 errors, 7 warnings (`set-state-in-effect`, ref read in effect
  cleanup) in `useTicketDetail.ts`, `useLiveTickets.ts`, `DisputeLocationMap.tsx`.
- `tsc` frontend and functions: clean.

## Method

The code was split into seven areas with disjoint file ownership so changes
could be made in parallel without overwriting each other. Each area was scanned
and fixed, then reviewed adversarially against a pre-sweep snapshot, then the
full check suite was run.

| Area | Files |
| --- | --- |
| Edge proxy | `frontend/api/maps.js`, `frontend/vercel.json` |
| Intake backend | `functions/src/features/otp`, `disputes`, `platform`, `contracts/dispute.json` |
| Staff backend | `functions/src/features/tickets`, `whatsapp`, `maps`, `firestore.rules`, indexes |
| Staff frontend | `frontend/src/features/officer-portal`, `tickets`, `auth` |
| Public visuals | `frontend/src/features/home`, `fra-demo`, `app`, Vite config |
| Public reporting | `frontend/src/features/reporting`, `legal`, `shared` |
| Repo guardrails | `scripts/`, root `package.json`, `.gitignore`, Android manifest |

## Changes by area

### Intake backend (OTP, submitDispute, cleanup)
- Cost ceilings: `maxInstances` 10 and explicit timeouts on public callables; `purgeExpiredOtps` limited to one instance.
- 30 s per-phone OTP resend cooldown (new `issuedAt` field) so double taps don't bill a second WhatsApp message; returns `resource-exhausted` with a readable message.
- IPv6 clients are rate-limited per /64 (`addressBucket` in `otp/identity.ts`); IPv4 keys unchanged.
- `submitDispute` reads receipt, quota and grant with one `tx.getAll` (2 round trips, not 4); malformed verification tokens are rejected before hashing; storage failures return a retry-safe `unavailable`.
- Cleanup: each collection purged in its own try/catch so one failure can't leave PII collections uncleaned.

### Staff backend (tickets, WhatsApp, geocode, rules)
- `listTickets` runs page scan, exact-ID lookup and counts in parallel (5 aggregations, was 6); cursor bounds validated.
- Per-case ceiling of 500 notes (each note also messages the reporter).
- Webhook: 3 MiB body cap before HMAC, constant-time verify token, empty secret refused, sanitized challenge echo.
- Repeated STOP and unverified tickets exit early instead of re-scanning or writing delivery records.
- Geocode: control characters rejected, stored names capped at 300 chars, `no-store` on errors, `maxInstances` 5 (TTL stays 1 day, see review corrections).
- `firestore.rules`: officer list queries need `limit <= 100`; explicit deny-all catch-all. Free-text fields excluded from indexing.

### Staff frontend (portal, registry, login)
- Memoised `TicketCard`; refresh no longer unmounts the grid and loses scroll.
- Note saves skip the full registry refresh (dossier is live); triage clock runs only while a dossier is open.
- Callables created once with 30 s timeouts; search trimmed and capped at 120 chars; status reason capped at 1500.
- Login: exponential backoff after 3 failed sign-ins (client-side friction only), double-submit guard, input `maxLength`s; one shared allow-list read per sign-in.

### Edge proxy (`frontend/api/maps.js`, `vercel.json`)
- Foreign `Origin` → 403 before any upstream call; `Vary: Origin` on every response.
- Limiter map capped at 10k keys with O(1) sweep; IPv6 per /64; land-use 12/min/client and 4 concurrent Overpass queries per instance (503 + `Retry-After`).
- Upstream bodies byte-capped (Overpass 10 MB, Bhuvan 4 MB, geocode 64 KB); oversized areas → 413 "zoom in"; URLs > 2048 → 414.
- Byte-bounded LRU cache (200 entries / 32 MB); 1 h browser cache on success; `osmtogeojson` loaded lazily.
- `vercel.json`: immutable cache on hashed assets, nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy; missing assets 404 instead of SPA fallback.
- 6 new proxy tests.

### Public reporting (report flow, map)
- Draft store re-renders only the edited field; `crypto.randomUUID` fallback for plain-http LAN testing.
- Functions SDK and Leaflet map lazy-loaded (map only after OTP), behind a local error boundary so a chunk failure keeps the draft.
- OTP: 30 s resend countdown, double-tap guard, resend uses the verified number (fixes "Enter your phone number" after navigating back), pasted `+91 …`/`0…` numbers normalised.
- Map: geocode LRU (32), land-use cache reused by bbox containment, drawing capped at 1500 polygons on one canvas renderer, aborts on unmount.
- Form: submit lock, evidence-reference limits shown inline, readable error messages.

### Public visuals (globe, FRA demo, routing, Vite)
- Globe renders on demand (`frameloop="demand"`; the scroll tween and free spin request frames) instead of every frame.
- Earth texture preloaded alongside the 3D chunk; India boundary fetch deferred until the forest-map section nears the viewport.
- Vendor chunks `react-vendor` and `globe-vendor` (Rolldown `codeSplitting`) stay cached across deploys.
- `generate-india-geojson.mjs` skips work when its output is fresh (`--force` to rebuild) and rounds to 4 decimals (~94 KB output — commit it).
- After a redeploy, a stale tab's failed chunk load reloads once (`vite:preloadError`); a route-level boundary keeps the header usable on route errors.
- Speculative login-chunk prefetch skipped on Save-Data / 2G; FRA review date bounded to 2000–2100.

### Repo guardrails
- `scripts/check-secrets.mjs`: dependency-free scan of files git would commit (private keys, service-account JSON, Google API keys, Meta tokens, `.env` secrets, hard-coded credentials); never prints values; `secret-scan: allow` for reviewed false positives.
- `scripts/check-bundle-size.mjs`: gzip budget for `frontend/dist` (~20% above measured; how to raise it is in the script header).
- `npm run check` now runs `check:secrets → check:architecture → lint → build → check:bundle → test`.
- `.gitignore`: `*.log`, keystores/certs, service-account and Google config files, Android release output.
- `firebase.json`: Hosting headers match `vercel.json`; `functions/tsconfig.json` adds `noImplicitReturns` and `noFallthroughCasesInSwitch`.

### Review corrections (adversarial pass)
- Geocode cache TTL put back to 1 day for all entries to match the privacy policy (a longer TTL for found places needs a policy update first).
- `submitDispute` unexpected-error fallback returned to `internal` so reporters keep the familiar retry message; the PII-free log line stays.
- Login backoff counts only rejected-credential errors, not network or allow-list failures.
- `readableCallableError` only rewrites bare error codes; real server messages are shown as before.

### Verification (2026-10-23)
Contracts in sync; secret scan passed (210 files); architecture passed (92 modules); oxlint 0 errors, 4 warnings (was 7); `tsc` clean in both packages; Functions tests, frontend tests (incl. 10 map-proxy tests) and Firestore rules/transaction emulator tests (26/26) pass; build passes; bundle budget passed (initial 111 KB / 135 KB, total 670 KB / 800 KB gzip). A later UI review found and fixed one sweep regression: the stale-chunk reload handler also fired on failed hover prefetches, which could wipe form state.

### Deploy notes
- Deploy Functions and `firestore.rules`/`firestore.indexes.json` before the rebuilt frontend.
- After the Vercel deploy: `curl -I` a hashed `/assets/*.js` (immutable), a missing asset (404, no-store) and `/api/maps` (`Vary: Origin`); a request with `Origin: https://example.com` should get 403. A new custom domain that calls the proxy cross-origin must be added to `ALLOWED_ORIGINS` in `frontend/api/maps.js`.
- Commit the regenerated `frontend/public/geo/india-national.geojson` (~94 KB).
- Direct Firestore list queries on tickets/notes/events must use `limit <= 100`.

## Deferred (needs a product decision or shared infra)
- Per-IP limits behind carrier-grade NAT (common on Indian mobile) may block real users: 10 OTP sends/h and 5 reports/day per address.
- App Check on public callables (needs frontend App Check first).
- Content-Security-Policy: build and test in report-only mode first.
- Cross-instance limiter for the map proxy (needs a shared store).
- Cap on how many registry pages "Load older cases" can accumulate.
- Per-reporter WhatsApp throttle beyond the 500-note ceiling.
