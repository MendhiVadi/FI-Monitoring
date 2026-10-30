# Wave 2 spec (2026-10-29)
Linked from [[00-Index]]. Binding contract for the wave-2 build agents: names, payloads and fields below must match exactly across backend and frontend. Builds on [[Documents-and-Screening]]. Contract (`contracts/dispute.json`, version **2026-10-29**) now has kinds `aadhaar_angle` and `selfie` (optional in both case types), `documents.replacementTtlDays: 14`, `serviceTargets {acknowledgeDays: 3, resolveDays: 30, note}` and `staffAccess [viewer, officer, admin]`.

All new public callables spread `appCheckOption()` from `functions/src/platform/appCheck.ts` (`{ enforceAppCheck: boolean }` from `defineBoolean("APP_CHECK_ENFORCE", { default: false })`), set `maxInstances`, and never log PII.

## 1. Staff access levels and identity
- `officers/{uid}` gains `access: "viewer" | "officer" | "admin"` (missing ⇒ `"officer"`), optional `displayName`. Existing `role` label stays.
- `requireOfficer(auth, min = "officer")` (tickets/authorization.ts) returns `{ uid, email, access, role, displayName }`; order viewer < officer < admin. Fresh-session rule unchanged.
- Firestore rules: raw reads of `tickets`, `tickets/*/notes`, `tickets/*/events`, `caseDocuments` require access officer or admin (viewers get none). Viewers read only through masked callables.
- Every new staff write (status event, note, document review, assignment, escalation by staff) stores `officerUid`, `officerEmail`, `officerName` (displayName or null), `officerRole`. UI shows name, else email, plus role; legacy entries keep the "Staff ·xxxx" fallback.
- `getMaskedCase({ ticketId })` (viewer+) → `{ ticket, events, notes, documents }` where ticket has: id, status, statusLabel, subject with names as initials, dispute {reporterType, otherPartyType, disputeType, state, district, village, description (phone numbers / emails / 12-digit numbers replaced by "•••"), location rounded to 2 decimals, immediateRisk}, reporterName/otherPartyName as initials ("A. R."), phone masked "+91•••••1234" or null, createdAt/updatedAt (ms), assignedName, overdue, documents summary; events/notes with actor shown as role label only; documents: [{ id, kind, side, risk, summary, review: { decision, at } | null }] — no files, no ID numbers, no extracted fields.
- `listTickets` for a viewer returns the same projection with the same masking applied to `subject`, `waFrom` (masked) and names.

## 2. Assignment
- `assignTicket({ ticketId, assigneeUid: string | null, reason?: string (≤ 300), expectedRevision: number, requestId })` → `{ revision }`. Officer may assign to self or unassign self; admin may assign anyone. Revision-checked and idempotent on requestId like `updateTicketStatus`. Ticket fields `assignedTo`, `assignedEmail`, `assignedName`, `assignedAt` (ms) — null when unassigned. Immutable event `{ type: "assignment", from, to, toEmail, reason, officer… , at, revision }`.
- `listOfficers()` (officer+) → `{ officers: [{ uid, email, displayName, role, access }] }` (≤ 200).
- `listTickets` accepts `assignee: "me" | "unassigned" | <uid>` and `overdue: true`; add the composite indexes these need.

## 3. Service targets, ageing, escalation
- `submitDispute` sets `ackDueAt = now + acknowledgeDays`, `resolveDueAt = now + resolveDays` (ms), `firstActionAt: null`, `overdue: null`.
- The first staff action (status change, note, assignment, document review) sets `firstActionAt` if null.
- Scheduled `escalateOverdueCases` (every 60 minutes, maxInstances 1, bounded batches): for non-terminal tickets, `overdue = "acknowledge"` when `firstActionAt == null && ackDueAt < now`, else `"resolve"` when `resolveDueAt < now`, else null; sets `overdueSince` (ms) on transition and writes one immutable event `{ type: "escalation", overdue, at }` per transition. Terminal tickets get `overdue: null`. Legacy tickets without due dates get them backfilled from `createdAt`.
- `listTickets` stats gain `overdue`, `waiting7`, `waiting30` (non-terminal, created more than 7 / 30 days ago).

## 4. Insights
- `getInsights()` (viewer+) → `{ generatedAt, byStatus: {id: count}, byCategory: [{ label, count }], byState: [{ state, count }] (top 10 + "Other"), byCaseType: { citizen_vs_government, person_vs_person, unknown }, ageing: { d0_7, d8_30, d31_90, d90p } (non-terminal), weeklyIntake: [{ weekStart (ms, Monday 00:00 IST), count }] (last 12 weeks), overdue: { acknowledge, resolve }, documents: { uploaded, flagged, reviewed } }`. Cached in `insightsCache/current` for 10 minutes (server-only collection). Uses count() aggregations, no unbounded scans.
- Route `/officer-portal/insights` (viewer+): cards and simple inline-SVG/CSS bar charts, no chart library; states with fewer than 3 cases are folded into "Other".

## 5. Public status lookup and document re-upload
- `getCaseStatus({ reference })` (public, maxInstances 5, 30 lookups per hour per IP bucket in `statusLookupLimits/{addrHash}`): reference is the ticket id `^[A-Za-z0-9]{20}$`. Returns `{ reference, statusId, statusLabel, filedAt, lastUpdatedAt, timeline: [{ statusLabel, at }], documentRequests: [{ requestId, kind, kindLabel, requestedAt, expiresAt }] }` — no names, phone, description, location or reasons. Unknown reference → `not-found` with a generic message.
- `reviewCaseDocument` with `reupload_requested` also creates `documentRequests/{requestId}` (requestId = the review requestId) `{ ticketId, documentId, kind, requestedAt, expiresAt = requestedAt + replacementTtlDays, fulfilledAt: null, fulfilledDocumentId: null }` and increments ticket `openDocumentRequests`.
- `uploadReplacementDocument({ reference, requestId, phone, verificationToken, fileName, contentType, dataBase64, idNumber? })` (public, same limits/quota/screening as uploads): the verification grant must be unspent, unexpired and its phone must match the ticket's `reporterUid` (`"phone-" + hashId(phone)`); guest (unverified) tickets cannot use it. The request must be open and unexpired. Creates an **attached** caseDocument with `replaces: documentId`, marks the old document `supersededBy`, fulfils the request, recomputes `ticket.documents`, decrements `openDocumentRequests`, writes event `{ type: "document_replaced", kind, requestId, documentId, at }`. Returns `{ documentId, screening: { state, userMessages } }`. The grant is checked, not spent.
- Public page `/track`: reference field → status card and timeline; open requests listed with "Verify your phone to upload" (existing `requestDisputeOtp` / `verifyDisputeOtp` flow) → upload control per request. The confirmation page and footer link to `/track`.
- WhatsApp: an opted-in, verified reporter gets the existing update template when a re-upload is requested (status text "Staff asked for a new copy of a document"). Private note text is never sent.

## 6. Screening v2
- `ScreeningDeps` gains `companion(kind: string): Promise<{ bytes: Buffer; contentType: string } | null>` — the latest non-superseded document of that kind in the same submission (or the same ticket for replacements). Backend implements it.
- New checks (ids): `pdf_signature` (CMS/PKCS#7 verified over the ByteRange; invalid → fail and risk "altered"; valid → pass with the signer's common name; absent → omitted), `copy_move` (block matching for duplicated regions; warn only; derived `copyMove` heatmap PNG), `hologram` (kind `aadhaar_angle` vs companion `aadhaar`: aligned regional colour/brightness shift; pass/warn/unavailable, never fail), `liveness` and `selfie_match` (kind `selfie`: the client stitches 3 JPEG frames side by side — straight, turn left, turn right; each frame must hold exactly one face, yaw must change across frames, frames must not be identical, descriptors must agree; `selfie_match` compares with the companion Aadhaar card face and the QR photo), `kyc` (provider interface under `screening/kyc/`, `KYC_PROVIDER` env: "none" (default, check omitted) or "mock" (deterministic, labelled "Mock verification — not a real KYC check")).
- Derived files gain `copyMove` → `case-documents/{id}/copy-move.png`; `getCaseDocumentFile` accepts variant `copyMove`.
- Selfie capture (report form, optional): `getUserMedia` camera, guided 3 poses, stitched client-side to one JPEG ≤ 1440×480, uploaded as kind `selfie`; never stored on the device. Permissions-Policy must allow `camera=(self)`. Privacy policy covers selfies (biometric data, screening only, same retention).

## 7. Limits and throttles
- Per-IP limits become params in `functions/src/platform/limits.ts` (`defineInt`) with CGNAT-friendlier defaults: OTP sends per IP bucket per hour 30 (was 10), reports per IP bucket per day 20 (was 5), uploads per IP bucket per day 150 files / 300 MiB, status lookups 30/hour. Per-phone limits unchanged.
- WhatsApp: per destination phone at most 6 notifications per hour and 20 per day (OTP excluded), tracked in server-only `notificationLimits/{phoneHash}` inside the delivery transaction; over the limit → delivery recorded as `throttled`, no send, no retry.
- Registry keeps at most 500 cases in memory; beyond that it shows "Showing the 500 most recent matches — refine your search".
- App Check (client): if `VITE_APPCHECK_SITE_KEY` is set and not in emulator mode, initialise App Check with `ReCaptchaEnterpriseProvider` (token auto-refresh) before Functions are used; in emulator mode use a debug token. Enforcement stays off until the owner sets `APP_CHECK_ENFORCE=true`.

## 8. Edge
- `Content-Security-Policy-Report-Only` on every route (vercel.json) covering what the app really loads (self, Firebase/Google API hosts, OSM tile hosts, blob:/data: images, wasm where needed). Not enforced yet.
- Vercel Firewall rate-limit rule for `/api/maps` (per IP, e.g. 120 requests/minute → 429) if the plan supports it; the in-code limiter stays.

## 9. Demo seed and harness
- `functions/scripts/seed-demo.js`: refuses to run unless the Firestore and Auth emulators are set or the project id contains "demo". Creates admin/officer/viewer test accounts (credentials defined in the script, emulator only), ~40 synthetic cases flagged `demo: true` across statuses, categories, states, dates, assignment and overdue states, plus synthetic document records; `--purge` removes `demo: true` data.
- `functions/tests/browser-gateway.js` also allows the document, status, assignment, insights and masked-case callables, uses the Storage emulator, accepts upload bodies up to 10 MB, and can load a synthetic UIDAI test key from `SYNTHETIC_UIDAI_PEM` (never a real certificate).

## 10. Later passes in this wave
- Login and officer-portal inline styles move to CSS classes built on the `global.css` tokens, with visual parity.
- Problem pack: `packs/<id>/pack.json` selected by `PACK` (default `land-dispute`) in `scripts/sync-contracts.mjs`, copied to `frontend/src/shared/site/pack.json` and `functions/src/platform/site/pack.json`: brand (name, tagline, operator, contact email, theme colours), modules (globeIntro, forestMap, fraDemo, whatsappUpdates, tracking, insights), copy (caseNoun, staffTitle), whatsapp caseNoun. Header, Footer, Home, Login, legal pages, index.html meta and WhatsApp parameters read it; routes and home sections honour module flags. Current values keep today's behaviour.

## Status — fourth run, 2026-10-30 (build complete; stopped at 61% before the security review)
- All core wave-2 wiring is **done**: screening core, which detects 9/9 synthetic copy-move forgeries with 0/7 false positives; hologram and selfie liveness/match connected to the engine; the portal registry (metric cards, assignee/overdue filters, viewer mode, 500 cap, Insights charts); the portal dossier (assignment panel, new events, viewer masking, Documents tab copy-move toggle, Replaced/Superseded tags, re-upload state); the emulator tests; and the demo seed (`npm run seed:demo` / `seed:demo:purge`, emulator-only).
- The integration pass made the backend and UI agree:
  - Masked actors are role labels only.
  - Assignee names are shown to viewers as initials, plus an extra `assigned: boolean` (a deviation from the spec for the owner to confirm).
  - Reviews store `officerName`/`officerRole` and `expiresAt`.
  - `storage.copyMove` is set when the copy-move heatmap is written.
  - Superseded documents are hidden from viewers.
- Checks:
  - functions `tsc` clean, `npm test` 106/106;
  - `npm run test:rules` (Firestore emulator) 42/42;
  - frontend `tsc -b` clean, oxlint 0 diagnostics.
- Security/PII review (2026-10-30): 3 findings, all fixed, with tests added; `npm test` 108/108.
  - Viewer masking now keeps Indic vowel signs inside a word (`\p{M}`), so Devanagari and Tamil names become proper initials and a surname mentioned alone is redacted.
  - The viewer subject is rebuilt from the dispute type plus initials, so a name cut off by the 160-character limit can't leak.
  - A PDF signature that is not CMS (e.g. legacy `adbe.x509.rsa_sha1`) reads "unsupported", not "altered".
- Not done: a browser E2E on the emulators (the staff-login CAPTCHA has to be typed by the owner), the seed run against live emulators, a check of the composite indexes in production, real-photo checks of the hologram/liveness thresholds (tuned only on synthetic data), the problem pack, the login/portal CSS migration and the Android build. Nothing is committed.

## Status — third run, 2026-10-29 (two agents, stopped at 94%)
- Backend wiring: **done**. Exports, `getInsights` (cached, count() only), the `listTickets` projection/filters/stats, first-action/identity, `firestore.rules`, indexes and `purgeExpiredOtps` cleanup are in place. `npm test` passes; `test-cases.cjs` and `test-dispute-flow.cjs` 30/30. The emulator rules/transaction tests have not been run.
- Screening core (companion, pdf_signature, copy_move tuning, kyc, review path): stopped mid-task again; its partial edits are on disk. Functions and frontend still type-check.
- Still to do: screening core, screening faces, screening wiring, portal registry, portal dossier, demo seed and the emulator tests (`wave2-wiring-wf_d27779aa-b9e.js` has their prompts; `wave2-wiring-pair.js` is the two-agent variant).

## Status — paused again 2026-10-29 at the owner's 70% usage cap (second run)
The second run (workflow `wf_d27779aa-b9e`, script under the session's `workflows/scripts/`) used 9 agents and was stopped at 64% of the 5-hour window, about 10 minutes in. Before it started, the changed files were snapshotted to `wave2-pre-resume.tgz` in the session scratchpad.
- Finished: Privacy Policy / Terms / Fair Use text (selfie, tilted Aadhaar, status lookup, re-upload, App Check, viewer masking, WhatsApp caps), the `SelfieCapture` lint fix and the `.env.example` App Check variables.
- Stopped mid-task (partial edits are on disk; nothing was reported): backend wiring (exports, rules, indexes, insights, list projection, cleanup, `test-cases.cjs`), screening core (companion, pdf_signature, copy_move tuning, kyc, review path), screening faces (`hologram.ts`, `selfie.ts`, yaw), portal registry, portal dossier and the demo seed (`seed-demo.js`). The emulator-test and screening-wiring agents never started.
- State: the functions and frontend type-check (`tsc`), and frontend oxlint shows 0 warnings. Tests were not run. Re-running the workflow script redoes the stopped agents against the files as they are now; only the legal-text agent's result is cached.
- Usage note: 7 agents running in parallel use about 5% of the 5-hour window per minute, so a run of this size needs most of a fresh window.

## Status — paused 2026-10-29 at the owner's 60% usage cap
Work is uncommitted on branch `wave-2`; `master` and production are untouched. (This first pause found a broken functions build: a duplicate `addressLimit` / argument mismatch in `disputes/service.ts`. It was fixed before the second run.)
- Done: edge (camera=(self), CSP Report-Only; firewall rule blocked — needs owner, see below), status lookup + replacement upload + due dates + CGNAT params + App Check plumbing (backend), WhatsApp throttle + re-upload notice + gateway extensions, public `/track` page + selfie capture + App Check client + routes, staff session access levels + ProtectedRoute minAccess + assignment panel + Insights page (basic) + lint fixes + 500 cap (hooks), roles/identity/assignment/masking/escalation modules (backend), PDF-signature and copy-move modules (not wired).
- Left: `index.ts` exports + `firestore.rules` + composite indexes + `getInsights` handler; screening index wiring (companion type, new check ids/weights, hologram, selfie liveness/match, kyc); copy-move tuning (2/9 detection on synthetic tests); OfficerPortal/Dossier/Documents UI wiring for the new fields; App.tsx `minAccess="viewer"` on `/officer-portal`; Privacy Policy + Terms text; `notificationLimits` cleanup in `purgeExpiredOtps`; `seed-demo.js`; test updates (`test-transactions.mjs`, `test-dispute-flow.cjs`, rules, new screening/cases tests); then styles migration, problem pack, integration, Android build, emulator E2E.
- Owner action: the Vercel Firewall rate-limit rule needs the owner (the API requires creating a firewall config; the tool call was blocked). Command: `npx vercel firewall rules add "Rate limit /api/maps per IP" --condition '{"type":"path","op":"pre","value":"/api/maps"}' --action rate_limit --rate-limit-window 60 --rate-limit-requests 120 --rate-limit-keys ip --rate-limit-action rate_limit --yes`, then `npx vercel firewall publish`.
- Vercel "Not authorized" on first deploy: CLI 59.11.7 sends a stale 8-hour token before refreshing it; run `npx vercel whoami` before deploying, use `VERCEL_TOKEN`, or upgrade the CLI.
