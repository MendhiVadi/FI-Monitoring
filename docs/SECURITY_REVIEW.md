# Security review — 2026-11-04

Scope: the whole repository as deployed (Firestore and Storage rules, all Cloud
Functions, the Vercel map proxy, the React frontend, the Android shell, scripts and
docs), reviewed read-only first and then fixed on branch `claude/practical-fermi-fjlyk6`.

The platform's core controls were already sound and are unchanged: deny-by-default
rules, Admin-SDK-only writes, hashed single-use OTP codes bound to a bearer token,
constant-time comparisons, signed WhatsApp webhooks, bounded screening. No
authentication bypass, injection or cross-reporter data exposure was found.

## Findings and status

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Per-address quotas keyed on `request.rawRequest.ip`. The Functions Framework enables Express `trust proxy`, so this is the **first** `X-Forwarded-For` entry, which the caller writes; Cloud Run appends the real address after it. One scripted caller could reset the OTP send cap, the guest ticket cap and the upload quota on every request. | High | **Fixed.** `platform/network.ts` reads the trusted end of the header (`TRUSTED_PROXY_HOPS`, default 1) with socket fallback; all four public callables and `geocodePlace` use it. Tests in `functions/tests/test-network.cjs`. |
| 2 | Vulnerable dependencies (`proxy-addr` critical, `sharp`, `body-parser`, `node-forge`, `@grpc/grpc-js` high). | Medium | **Fixed** for Functions (0 high/critical). Frontend "high" entries are Node-only gRPC inside the Firebase SDK, not shipped to browsers; accepted. |
| 3 | Officer views of Aadhaar/PAN files left no audit trail (only reviews were recorded). | Medium | **Fixed.** `getCaseDocumentFile` writes `documentAccessLog/{id}` (officer, document, ticket, variant, time) before returning bytes; collection closed to clients; rules test added. |
| 4 | No Content-Security-Policy, HSTS or COOP on either host. | Low | **Fixed.** Added to `firebase.json` and `frontend/vercel.json`; verified headlessly against the built app with zero violations. |
| 5 | `geocodePlace` reachable directly with no per-caller limit; one client could hold the single shared Nominatim slot and fill `geocodeCache`. | Low | **Fixed.** 20 requests/minute per address bucket per instance (same pattern as the map proxy). |
| 6 | PDF sniff accepted `%PDF-` anywhere in the first 1 KiB, so HTML/SVG/ZIP/GIF/EXE polyglots passed as PDFs. Duplicated in two files. | Low | **Fixed.** One implementation in `documents/rules.ts`; leading junk still tolerated, but a recognisable other file type or markup before the header is refused. |
| 7 | Personal phone numbers and the WhatsApp phone-number ID committed in `functions/scripts`. | Low | **Fixed.** Removed; scripts take them from arguments / env. |
| 8 | Login "security check" CAPTCHA generated and verified in the browser: no protection, misleading UI. | Low | **Fixed.** Removed. Client backoff kept as UX only and labelled as such. |
| 9 | Untrusted-file parsing (sharp, pdf.js, exifr, tesseract, zxing, OpenJPEG) runs in the same process as the Admin SDK credentials. | Medium | **Open.** Move `uploadDisputeDocument` to its own service / least-privilege service account scoped to the documents bucket. |
| 10 | Staff access is email + password only; no MFA, no App Check; every officer sees every case; `officers.role` is not used for authorization. | Medium | **Open.** Enable Firebase Auth MFA (Identity Platform) and email-enumeration protection; add App Check to the public callables; introduce role/region scoping if the pilot needs it. |
| 11 | `idNumberFull` and raw OCR text (containing Aadhaar numbers) stored in plaintext in `caseDocuments`. | Medium (compliance) | **Open.** A deliberate mock-up decision (see `vault/Documents-and-Screening.md`), but a launch blocker: store masked + HMAC only, or encrypt with a KMS key, before any real data. |
| 12 | `documentAccessLog` has no retention schedule. | Info | **Open.** Decide retention with the case-retention policy; add to the daily purge when decided. |

## How to verify locally

```bash
npm --prefix functions test
```

```bash
npm --prefix functions run test:rules
```

```bash
npm --prefix frontend run lint && npm --prefix frontend test
```

Header check: build the frontend, serve `frontend/dist` with the headers from
`frontend/vercel.json`, and load each route in a browser with the console open; a
`securitypolicyviolation` event or a "Refused to …" line means a `connect-src`,
`img-src` or `frame-src` entry is missing.
