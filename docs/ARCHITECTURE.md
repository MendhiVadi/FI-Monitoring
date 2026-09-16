# Project map

Start with `PROJECT_BRIEF.md` for product scope and this file for code ownership.
`frontend/` and `functions/` remain independent packages with their existing lockfiles.
The root package coordinates checks and contract generation; it needs no separate
dependency install. `contracts/dispute.json` is the canonical input/consent contract.
`scripts/sync-contracts.mjs` copies it into the frontend shared layer and backend
platform layer before builds. Edit the canonical contract, not its generated copies.
Commit both copies before publishing. Vercel uploads only `frontend/`; its explicit
build command uses that checked-in copy. Firebase's isolated cloud build similarly
uses `gcp-build: tsc`, after the local predeploy hook has generated the backend copy.
Test harnesses and operational scripts are excluded from the Functions upload.

## Frontend

`src/main.tsx` mounts the app. `app/App.tsx` owns routes, lazy loading and route guards;
`app/routeChunks.ts` owns preloading. `app/layout` composes the header and footer
because the header needs auth and routing. `app/global.css` is loaded once by main.

| Folder under `frontend/src` | Responsibility |
| --- | --- |
| `features/auth` | Login view, `useLogin` form/CAPTCHA behavior, session/allow-list checks, route guard, styles and clock |
| `features/reporting` | `ReportIssue` flow, `PhoneVerification`, `DisputeForm`, `Confirmation`, location picker, district options and styles |
| `features/tickets` | Data interfaces, paginated callable registry, live selected dossier, paginated notes, status presentation and deterministic triage |
| `features/officer-portal` | View in `OfficerPortal`, state/filtering/mutations in `useOfficerPortal`, presentation helpers, styles and clock |
| `features/home` | Landing page, forest map, globe, scroll animation and their data/helpers |
| `features/fra-demo` | Synthetic claims, deterministic anomaly rules, sourced district map and state progress; independent of the real ticket registry |
| `features/legal` | Policy, accessibility, contact and dataset pages |
| `shared/firebase` | Firebase app/auth singleton and separately loaded Firestore/Functions clients |
| `shared/http` | API origin resolution for browser and Android |
| `shared/contracts` | Generated input/consent contract shared with the backend |
| `shared/format`, `shared/ui` | Formatting, error boundaries, native accessible dialogs, print lifecycle and static-page wrapper |

App composition may import features and shared modules. Features may import shared
modules and explicitly related features: the portal uses auth and tickets; the ticket
list uses auth. Shared modules must not import app or feature code. Ticket data types
and decision rules stay independent of React and Firebase. Use direct file imports;
avoid barrel exports that accidentally load large features eagerly.

## Backend

`functions/src/index.ts` is the stable deployment surface. Handler options and exported
names are API contracts, even if the internal source file changes.

| Public export | Implementation under `functions/src` |
| --- | --- |
| `requestDisputeOtp`, `verifyDisputeOtp` | `features/otp/handlers.ts` |
| `submitDispute` | `features/disputes/handlers.ts` |
| `purgeExpiredOtps` | `features/otp/cleanup.ts` |
| `updateTicketStatus`, `addTicketNote` | `features/tickets/handlers.ts` |
| `listTickets` | `features/tickets/list.ts` |
| `geocodePlace` | `features/maps/geocode.ts` |
| `whatsappWebhook` | `features/whatsapp/webhook.ts` |
| `notifyWhatsAppOnTicketUpdate` | `features/whatsapp/notifications.ts` |
| `notifyWhatsAppOnTicketCreated` | `features/whatsapp/created.ts` |

Domain operations live in `disputes/service.ts` and `otp/service.ts`; keyed identities
in `otp/identity.ts`; officer checks in `tickets/authorization.ts`; canonical backend
status labels in `tickets/status.ts`; outgoing template requests in `whatsapp/client.ts`.
`whatsapp/delivery.ts` deduplicates ticket events and records acceptance, uncertain
outcomes and failures in server-only `whatsappDeliveries`, cleaned up after 30 days.
`whatsapp/receipts.ts` handles monotonic receipts and persistent opt-outs. Creation,
status changes and added staff notes notify the ticket's verified/opted-in reporter;
private note contents are not included. Transport endpoints explicitly allow public
invocation; officer authorization, OTP checks and webhook signatures run inside them.
`platform/firebase.ts` initializes Admin once. `platform/secrets.ts` defines secret
references, not secret values. Platform modules must not import features.

## Data ownership

- Intake creates the ticket, spends an independent verification grant, updates
  phone/IP quotas and writes its retry receipt in one transaction.
- Status edits use an expected revision and an immutable event with a reason.
  Notes live in `tickets/{id}/notes`; events live in `tickets/{id}/events`.
  Existing embedded notes remain readable, but new writes never grow that array.
- The registry returns at most 50 matches per scanned page (plus an exact-ID hit),
  projects summary fields and exposes a cursor when older records remain. Counts
  cover the whole registry. It refreshes explicitly; the open dossier is live.
- Report drafts stay in tab memory across route navigation, expire after 30 minutes
  without editing, and clear after success. A full reload loses the draft.
- FRA demo claims stay in their own public module. The three vendored geometries
  and ODbL provenance are under `frontend/public/geo`.

## Runtime boundaries

- `frontend/api/maps.js` stays at Vercel's expected entry path. Vite also mounts it
  at `/api/maps` for local development. `vite preview` does not run that middleware.
- Firebase hosting currently serves static frontend output with SPA rewrites; it
  does not deploy the Vercel map proxy. Verify the API origin for that hosting choice.
- `frontend/public` contains public assets; `frontend/scripts` generates geographic
  assets from the vendored input. `frontend/android` remains the Capacitor project.
- Root Firebase configuration, rules and indexes keep their existing locations.
- `functions/tests` contains offline/emulator checks. `functions/scripts` contains
  operational actions: officer provisioning and a WhatsApp template script that
  sends real messages. Those scripts are excluded from normal test commands.
- `functions/lib`, `frontend/dist`, `node_modules`, emulator logs and native build
  output are generated. Edit source, never generated output. `Read-Only-Folder`
  is not part of the active application.

## Adding or changing code

Choose the feature that owns the user action first. Keep API calls and state in that
feature's hook/service and keep reusable data contracts separate from UI. Promote
code into shared only when its responsibility is independent of a particular feature.
Keep feature-specific styles beside their view. Run `npm run check:all` at the root;
the architecture check rejects unresolved relative imports, dependency cycles and
reversed layer dependencies. Type-only and dynamic imports are included.

The portal and login views remain sizeable due to their existing detailed markup.
Their behavior and styles are now separate; further UI component extraction should
follow actual repeated sections and have visual regression coverage.
