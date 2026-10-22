# Land Dispute — Canonical Project Brief

This file is the single source of truth for every AI tool working in this
workspace. The canonical workspace is `C:\Users\medha\Desktop\Hackathons\Land Dispute`,
and the application source is in `frontend/`. Project memory for humans and agents
is the Obsidian vault in `vault/` (start at `vault/00-Index.md`).

Do not use `Newsletter-Platform` as context, a data source, or a destination for
this project.

## Scope

There is no fixed problem statement. Since 2026-10-22 the owner reuses this
codebase for several purposes (hackathons, demos, possible pilots), so treat it as
a reusable land-dispute reporting and staff-review platform rather than an answer
to one brief. Do not add judging criteria or a single problem statement back; a
purpose-specific brief belongs in its own note in `vault/`.

The project shifted from forest disputes to broader land disputes on 2026-09-16.
The public product name is **Land Dispute**. Its primary
flow is location-based land-grievance reporting, verified submission and staff
review/follow-up. Do not imply that submitting a report creates an official legal
filing or that the system decides ownership.

The existing Forest Rights Act (FRA) monitoring demonstration remains a supporting
land-rights example: it illustrates fragmented claim records, delayed claims and
land-record mismatches. The illustrative forest/land-use map is context, not a
property survey or a verified dispute layer. Existing Firebase/Vercel resource
names and URLs retain their historical Forest Watch identifiers.

## FRA demonstration module

Preserve these three implemented capabilities within the supporting FRA demo:

1. A WebGIS-style map showing mock FRA claim data by district.
2. An anomaly layer that flags cases such as delayed claims and mismatched land
   records, with a concise AI-generated or AI-assisted explanation.
3. A decision-support panel summarizing state-wise progress and highlighting
   where an official should investigate.

Real geographic boundaries may be combined with clearly labelled synthetic FRA
claim records. Never present synthetic claim data as official government data.

## Extended product vision

The build may exceed the minimum brief with:

- a scroll-driven globe, world, and India exploration experience;
- forest-cover and tree-density visualization;
- citizen or field-worker issue reporting;
- WhatsApp-linked ticket creation and follow-up;
- Firebase-backed live ticket monitoring;
- dataset provenance, accessibility, privacy, and fair-use information;
- richer district drill-downs, trends, prioritization, and explainable alerts.

The public landing page prioritizes land-dispute reporting and staff review;
the existing FRA demonstration remains accessible and clearly labelled.

## Status

**Land Dispute branding and scroll refinement released on 2026-09-16.**
The public landing page now prioritizes land-grievance reporting, uses a short
globe intro with synchronized motion and persistent actions, and provides a
reduced-motion fallback. See `docs/LANDING_SCROLL_PLAN.md` and `docs/DEPLOYMENT.md`.

**Review fixes and FRA demonstration released on 2026-09-16.**
See `docs/REVIEW_FIXES.md` for the issue list, verification and release limits.
The frontend, all 11 Functions and Firestore rules have been deployed; release
evidence is in `docs/DEPLOYMENT.md`. Treat data handling, authentication
and retention as production concerns. Synthetic data must never render as an
official record or as a fallback in the staff registry.

## Current implementation

`frontend/` — React, TypeScript, Vite:

- React Three Fiber globe plus world and India map scenes, lazy-loaded;
- a short, native-scroll globe intro with synchronized GSAP visual progress,
  direct reporting/skip links and reduced-motion fallback;
- placeholder world-region and Indian-state tree-density data (clearly labelled);
- officer registry backed by real records only, with paginated search, full-registry
  counts and explicit refresh; the selected dossier has a live subscription;
- staff login via Firebase Auth gated on the `officers/{uid}` allow-list, with an
  eight-hour shift expiry enforced by the client, handlers and Firestore rules;
- dispute reporting with explicit map selection, independent phone verification,
  retry-safe submission and separate notification consent;
- case-specific note drafts, revision-checked status changes, immutable change
  history, paginated notes, accessible dialogs and printable dossiers;
- `/fra-monitoring`: 60 labelled synthetic claims across three sourced district
  boundaries, filters, delay/area-mismatch alerts, explanations and state progress.
  Explanations use deterministic rules; no LLM or official claim feed is connected.

`functions/` — Firebase Cloud Functions v2, TypeScript:

- `requestDisputeOtp` / `verifyDisputeOtp` — custom database-backed OTP for
  dispute intake (see `functions/src/features/otp/service.ts`); not Firebase Phone Auth, and it
  issues no auth session. Verification is bound to the verifying client by a
  one-time token that `submitDispute` requires back;
- `submitDispute` — atomically validates/spends verification, creates the ticket,
  updates phone/IP quotas and records an idempotent retry receipt;
- `listTickets`, `updateTicketStatus`, `addTicketNote` — fresh-session,
  allow-listed officer access, with versioned edits and append-only notes/events;
- `geocodePlace` — shared cache and globally serialized Nominatim requests;
- `whatsappWebhook` — signed delivery receipts and STOP handling;
- creation/update notification triggers — opt-in checks, event deduplication,
  receipt tracking and conservative handling of uncertain sends;
- `purgeExpiredOtps` — hourly, race-safe cleanup of temporary server state.

`frontend/api/maps.js` — Vercel serverless proxy to fixed map upstreams, with an
origin allow-list and per-IP limits. Geocoding delegates to `geocodePlace` so
multiple proxy instances share the upstream rate limit.

Security model: `firestore.rules` allows ticket reads to allow-listed officers
only; all writes go through Cloud Functions on the Admin SDK. `disputeOtps`,
`otpSendLimits`, `reporterLimits`, verification grants, retry receipts, notification
state and map service state are closed to every client.

## Remaining product and release work

- Live OTP requires the Meta account/template permission and approval described in
  `docs/OTP_WHATSAPP_OPERATIONS.md`; local tests intercept message sends.
- Old open browser tabs must reload for the new submission/edit contracts.
  Keep frontend, Functions and Firestore rules coordinated in future releases.
- The FRA demonstration covers Mandla, Pune and Koraput only. Nationwide current
  boundaries, official records, trends and optional LLM explanations remain future
  integration work. See `docs/FRA_DEMO.md` for schema and provenance.
- Confirm the real service operator, support channel and case-retention policy
  before public launch. Temporary-state cleanup is implemented; case records have
  no automatic deletion period configured.
- Hosting, public routes, geocoding and signed-out access controls passed release
  checks. Live signed-in workflows, OTP/message delivery and Android still need
  their stated acceptance checks.

## Working rules for all AI tools

- Read this file before planning or editing.
- Inspect the current files before changing them and preserve unrelated work.
- Keep one AI tool as the active writer at a time; shared memory does not merge
  simultaneous file edits.
- Label mock data clearly and record the source of every real boundary dataset.
- Prefer deterministic, testable anomaly rules; use an LLM to explain evidence,
  not to invent claim facts.
- Do not claim a feature is complete until its user-visible flow is tested.
- Keep secrets out of source files and use environment variables for Firebase or
  model credentials.
- Never substitute sample or fallback records for live data in the officer
  portal. If a read fails, say so — a fabricated ticket can send an officer to
  a case that does not exist.
- Tickets carry PII (names, phone numbers, dispute narratives, precise
  coordinates). Do not widen read access, log PII, or add a retention path
  without a matching cleanup path.
- Backend regression tests: `npm --prefix functions test` and
  `npm --prefix functions run test:rules` (the latter needs Java for the
  Firestore emulator).
