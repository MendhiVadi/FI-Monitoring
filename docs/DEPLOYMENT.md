# Production deployment

## Current full-stack release — efficiency/UI overhaul and document screening, 2026-10-26

- Source: branch `efficiency-ui-overhaul` at `9398ca1` (PR MendhiVadi/FI-Monitoring#1,
  not yet merged into `master`). Deployed from a clean working tree.
- Pre-deploy on that commit: `npm run check` (secret scan, architecture, lint,
  builds, bundle budget, 37 Functions + 16 frontend tests) and 34 emulator
  rules/transaction tests all passed.
- Firebase Storage: default bucket `tree-top-d61c6.firebasestorage.app` created in
  ASIA-SOUTH1 (Mumbai, next to Firestore) through the Firebase Storage API.
- Firestore rules, indexes (field-index exemptions) and the new deny-all
  `storage.rules` released. Two older composite indexes not in the file were left
  in place (no `--force`).
- Functions: 16 ACTIVE on Node 22 Gen 2 — 5 created (`uploadDisputeDocument`,
  `removeDisputeDocument`, `getCaseDocumentFile`, `reviewCaseDocument`,
  `purgeExpiredDocuments`), 11 updated. Schedulers `purgeExpiredDocuments` (every
  24 hours) and `purgeExpiredOtps` (every 60 minutes) ENABLED.
- Vercel: https://forest-watch-og7q8jtyj-medhanshkhattar05-8450s-projects.vercel.app,
  READY, production; `forest-watch-eight.vercel.app` aliases to it. The first CLI
  attempt returned "Not authorized"; an immediate retry succeeded.
- Contract/consent version is now `2026-10-23`; old tabs must reload to submit.

Live checks after release (read-only; no messages sent, no records created):

- `/`, `/report`, `/login`, `/fra-monitoring`, `/privacy-policy`, `/officer-portal`
  returned 200. Hashed assets are `immutable`; a missing asset returns 404 `no-store`;
  `nosniff`, Referrer-Policy, X-Frame-Options and Permissions-Policy
  (`geolocation=(self)`) are present.
- Map proxy: geocode 200 with `Vary: Origin`; a foreign `Origin` gets 403.
- Empty `submitDispute`, `requestDisputeOtp`, `verifyDisputeOtp`,
  `uploadDisputeDocument` and `removeDisputeDocument` calls returned 400
  `INVALID_ARGUMENT`. A well-formed PNG upload without a valid verification returned
  401 and loaded the screening engine with no load error in the function logs.
- Signed out, `listTickets`, `updateTicketStatus`, `addTicketNote`,
  `getCaseDocumentFile` and `reviewCaseDocument` returned 401 `UNAUTHENTICATED`.
- Browser: home globe renders and scroll-animates, the report page lists the
  required documents, the privacy notice shows version 2026-10-23 with "Documents
  you upload", the login page renders; no console errors.

Not verified live: OTP delivery (Meta template still pending, so no production
report or upload can complete yet), signed-in staff flows including the Documents
tab, a real document screen, and Android. The UIDAI Secure QR certificate is not
installed, so the QR signature check reports "unavailable".

## Earlier frontend release — Land Dispute scroll refinement, 2026-09-16

- Public site: https://forest-watch-eight.vercel.app (historical URL retained).
- Vercel deployment: `dpl_9ENesfQpcqYBvQY6Up4frgZjXDT9`, READY, production.
- Immutable URL: https://forest-watch-8romwn9zp-medhanshkhattar05-8450s-projects.vercel.app
- Published directly from the canonical `frontend/` checkout, then promoted
  after checking the production build. No new Git commit/push was made in this
  task; the canonical checkout's existing changes remain intact.
- Synchronized globe rotation/zoom, eliminated camera entry into the sphere and
  the blank sticky screen, retained readable report/skip actions, and shortened
  the mobile sequence. Visible web branding now reads Land Dispute.
- `.vercelignore` excludes native Android builds, generated web output and local
  files. The inspected upload contains about 2 MB of source/build inputs.
- No Functions, Firestore rules/indexes, auth contracts or hosting resource names
  changed in this release. Backend release details are recorded below.

Verification: architecture, lint, frontend/backend production builds and all 16
offline tests passed. The initial `check:all` stopped when the sandbox denied
Firebase CLI's configuration read; rerunning `npm run test:rules` with access
completed all 25 emulator tests successfully. Seven pre-existing lint warnings
and large lazy-bundle warnings remain. Vercel's production build completed in 12s.

Local browser checks covered forward/reverse scrolling, skip-intro focus and
position, the report form and return navigation, 390px/320px responsive layouts,
and reduced motion (no canvas or sticky sequence). Production browser inspection
confirmed the globe and Land Dispute content render at the opening and former
blank scroll point, with no error-level console entries during those checks.
The public homepage serves `index-DfzF_0d5.js`; report, login, FRA-demo routes,
the new scroll bundle/CSS and Earth texture return HTTP 200. Inspecting the public
alias resolves to the deployment above.

No new claim is made about physical touch-device performance, live OTP delivery,
signed-in staff mutations or the Android build. Existing release limits below
continue to apply. Refresh old browser tabs to load the new frontend.

## Earlier full-stack release — 2026-09-16

- Public site: https://forest-watch-eight.vercel.app
- GitHub: https://github.com/MendhiVadi/FI-Monitoring, `master`.
- Application commit: `14d70595c9455b37781a4223dab4ea8edad1aa19`.
- Vercel deployment: `dpl_B9AX3KmNp3fw46iyAsJ65Sk4mZXj`, READY, production.
- Immutable URL: https://forest-watch-j50mabdsm-medhanshkhattar05-8450s-projects.vercel.app
- Vite build; Vercel's build step completed in 14 seconds. Existing large lazy
  bundle warnings remain non-fatal.
- Firebase project: `tree-top-d61c6`. All 11 functions verified ACTIVE on Node 22,
  including new `listTickets` and `geocodePlace`; existing names/regions preserved.
- Firestore rules compiled and were released successfully. The hourly cleanup
  scheduler is ENABLED. Firestore indexes were not deleted or redeployed.

### Release process and checks

The full root `npm run check:all` passed: architecture, both production builds,
41 tests and lint (seven non-fatal warnings). Vercel's isolated build consumes the
generated frontend contract; Firebase uses `gcp-build: tsc` after local contract
generation. Test harnesses and operational send scripts are excluded from the
Functions upload.

The GitHub update is a normal forward commit from the existing remote `master`.
A separate local release worktree preserves the canonical checkout's dirty state
and local tool configuration. Application sources match after Git line-ending
normalization. Obsolete local database archives are absent from the new release
tree; remote commit history was preserved.

Vercel was built with production settings while the main domain stayed on the prior
release. After Functions and rules completed, the READY deployment was promoted.
The alias API confirms `forest-watch-eight.vercel.app` points to the deployment above.

Live checks after promotion:

- `/`, `/report`, `/login` and `/fra-monitoring` returned HTTP 200 and the new
  `/assets/index-CyNgSZtl.js` entry bundle.
- The district GeoJSON returned HTTP 200 with three features. The browser rendered
  the synthetic claims page, map polygons and totals without application errors.
- `/api/maps?action=geocode&q=Pune%2C%20Maharashtra` returned HTTP 200 with a valid
  point through the newly deployed shared geocoder.
- Signed-out staff requests to `listTickets`, `updateTicketStatus` and
  `addTicketNote` returned HTTP 401 `UNAUTHENTICATED`, with the expected CORS origin.
- Empty `submitDispute`, `requestDisputeOtp` and `verifyDisputeOtp` requests returned
  HTTP 400 `INVALID_ARGUMENT`. These checks did not send messages or create tickets.
- A signed-out browser opening `/officer-portal` was redirected to the login form.
- Vercel's error-level log scan for this deployment returned no entries at release
  verification time. Ongoing monitoring/log drains were not configured by this task.

Live OTP delivery remains unverified. The existing Meta eligibility/template issue
is documented in `OTP_WHATSAPP_OPERATIONS.md`; no production message, real ticket
or authenticated staff mutation was used for release checks. Android and physical
printing remain outside these live checks. Users with old tabs should reload before
submitting or editing a case.

## Previous deployment — 2026-09-15

- Frontend: https://forest-watch-eight.vercel.app
- Vercel deployment: `dpl_C8FDuUBNenDPACPbd6A4PW7CUt8M`, READY, production.
- Backend: Firebase project `tree-top-d61c6`; all eight functions verified ACTIVE
  on `nodejs22`. Existing function names and regions preserved.
- Hourly OTP cleanup scheduler verified ENABLED.
- Backend engine and Node type definitions updated to 22; package lock synchronized.
  Seven backend regressions passed under Node 22. Clean-install validation passed
  for both packages; all three map API tests passed.
- Added the missing OTP signing secret and WhatsApp app-secret binding in Secret
  Manager. The latter uses the project's existing Meta app secret. No secret values
  were stored in repository files. OTP enforcement is configured true.
- Production login/report HTTP requests returned 200 with the new build's entry
  bundle. Unauthenticated officer status-update request returned 401.

Firebase reported successful updates for every function, then exited with a warning
because Artifact Registry image cleanup policies are unset in both regions. This
did not roll back deployment. No cleanup/deletion policy was added automatically.
The older Firebase Functions SDK warning remains separate from the resolved Node 20
runtime warning. Actual OTP delivery, signed-in officer workflows and Android were
not exercised as part of this deployment. Firestore rules/indexes were not deployed.

Deploy backend from the root Firebase configuration before the frontend. On this
machine function discovery needed `FUNCTIONS_DISCOVERY_TIMEOUT=60`. Publish the
frontend from its existing `frontend/` Vercel link. Never use the stale isolated
dispute-only deployment package.
