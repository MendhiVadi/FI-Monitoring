# Forest Watch — Canonical Hackathon Brief

This file is the single source of truth for every AI tool working in this
workspace. The canonical workspace is `C:\Users\medha\Desktop\Existing Projects\Land Dispute`,
and the application source is in `frontend/`.

Do not use `Newsletter-Platform` as context, a data source, or a destination for
this project.

## Problem statement

Build an AI-powered decision-support system for monitoring implementation of
India's Forest Rights Act (FRA). FRA claims, approvals, and land-use records are
fragmented across states, making progress difficult to monitor and anomalies
difficult to identify.

## Minimum hackathon acceptance criteria

The demo must make these three capabilities obvious to a judge:

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

Extras support the FRA monitoring workflow; they must not replace the three
minimum acceptance criteria.

## Status

**Local review fixes and FRA demonstration implemented as of 2026-09-16.**
See `docs/REVIEW_FIXES.md` for the issue list, verification and release limits.
These source changes have not been deployed. Treat data handling, authentication
and retention as production concerns. Synthetic data must never render as an
official record or as a fallback in the staff registry.

## Current implementation

`frontend/` — React, TypeScript, Vite:

- React Three Fiber globe plus world and India map scenes, lazy-loaded;
- scroll-driven GSAP transitions;
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
- Release the frontend, Functions (including the new exports) and Firestore rules
  together. The old client and new submission/edit contracts are not interchangeable.
- The FRA demonstration covers Mandla, Pune and Koraput only. Nationwide current
  boundaries, official records, trends and optional LLM explanations remain future
  integration work. See `docs/FRA_DEMO.md` for schema and provenance.
- Confirm the real service operator, support channel and case-retention policy
  before public launch. Temporary-state cleanup is implemented; case records have
  no automatic deletion period configured.
- Complete live authentication/delivery, hosting and Android release checks.

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
