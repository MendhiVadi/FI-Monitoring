# Production deployment — 2026-09-15

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
