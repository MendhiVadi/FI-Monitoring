# Development and debugging

## Isolated browser regression environment

Start Auth and Firestore with `firebase emulators:start --only firestore,auth --project demo-forestwatch`.
Build functions, set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, then run `node functions/tests/browser-gateway.js`.
In another terminal run `npm --prefix frontend run dev -- --mode emulator --host 127.0.0.1`.
This development-only mode uses a fixed demo project and local services. Production
builds cannot enable it.

The gateway creates a synthetic staff account and 65 cases; test credentials are
defined in its source. It executes real callable handlers, verifies local Auth
tokens, intercepts Meta sends and refuses other external server requests. Only
reserved test phone numbers are accepted. Its loopback-only test endpoint exposes
only synthetic codes. Never deploy the gateway or use it with production data.
Database-trigger notifications are tested separately. Stop the gateway and
emulators after checking the UI; do not export their data.

Run commands from this repository root. Install each existing package with
`npm --prefix frontend ci` and `npm --prefix functions ci` when dependencies are
missing. Match the backend's declared Node 22 runtime for backend work. The frontend
toolchain may require a newer local Node version; use its package engine requirements.
Keep local configuration private and use the project's existing configuration values.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite frontend and local `/api/maps` proxy |
| `npm run build` | Production frontend and backend TypeScript builds |
| `npm run lint` | Frontend lint diagnostics |
| `npm run check:architecture` | Source ownership, import resolution, dependency boundaries and cycles |
| `npm test` | Offline backend, frontend triage/FRA and map proxy tests |
| `npm run test:rules` | Firestore authorization and real transaction regressions in `demo-forestwatch` |
| `npm run check` | Architecture, lint, builds and all offline tests |
| `npm run check:all` | All checks plus rules/transaction tests; requires Firebase CLI and Java |

Frontend dev uses the configured Firebase project; it is not automatically connected
to emulators. An ordinary page load is different from submitting a report or signing
in. `test:rules` explicitly selects a demo project. The offline tests mock Admin and
use synthetic records. Neither test command sends WhatsApp messages.

## Find the failing layer

| Symptom | Start here | Next check |
| --- | --- | --- |
| Route blank, navigation or preload failure | `frontend/src/app/App.tsx`, `routeChunks.ts` | Browser console and failed chunk request; shared `ErrorPage.tsx` |
| Login/CAPTCHA problem | `features/auth/useLogin.ts`, `Login.tsx` | `staffSession.ts` Firebase auth and officer document check |
| Signed in but access refused | `features/auth/ProtectedRoute.tsx`, `staffSession.ts` | Officer allow-list and `firestore.rules`; backend `tickets/authorization.ts` |
| Phone verification or re-verification failure | `features/reporting/PhoneVerification.tsx`, `ReportIssue.tsx` | Backend `otp/handlers.ts`, `service.ts`, request error code |
| Dispute rejected | `features/reporting/DisputeForm.tsx` | Backend `disputes/handlers.ts`, `service.ts`, OTP token and rate limits |
| Map/geocoding unavailable | `features/reporting/DisputeLocationMap.tsx` | `/api/maps` response, `shared/http/apiUrl.ts`, `frontend/api/maps.js` |
| Tickets stale, empty or failed | `features/tickets/useLiveTickets.ts` | `listTickets`, cursor/filter state and refresh; `useTicketDetail.ts` owns the live dossier |
| Status/note save fails | `features/officer-portal/useOfficerPortal.ts` | Backend `tickets/handlers.ts`; session age, revision conflict, request ID and event receipt |
| Incorrect decision priority | `features/tickets/ticketDecisionTree.ts` | Actual ticket fields and evaluation date, not sample replacement data |
| WhatsApp delivery fails | Backend `whatsapp/notifications.ts`, `client.ts` | Function logs, template configuration, opt-in; webhook signature/delivery status |
| Globe/scroll issue | `features/home/ScrollExperience.tsx`, `Globe.tsx` | WebGL console and public asset requests |
| Android-only map/API problem | `shared/http/apiUrl.ts`, Capacitor configuration | API origin and device network access, then sync rebuilt frontend |

Preserve the failing request's error code and a synthetic reproduction. Avoid copying
reporter names, phones, narratives, coordinates or verification tokens into logs or
test fixtures. Never replace failed live ticket reads with mock tickets.

## Verification boundaries

Build success confirms bundling/type resolution, not real authentication or message
delivery. Seven non-fatal lint warnings concern effect state synchronization and
request-generation refs in the map and data hooks. Large lazy globe/Firebase chunks
still produce bundle warnings. The globe is excluded from reporting/login downloads
and bypassed when reduced motion is requested or WebGL is unavailable.

Before a release, manually exercise route navigation, login/denial/sign-out, report
verification and retry, map selection, officer edit conflicts/retry reconciliation,
printing and Android if
affected. Real OTP/message delivery requires an intentional test recipient and live
configuration. Do not run `functions/scripts/test-whatsapp-templates.js` as a unit test.
