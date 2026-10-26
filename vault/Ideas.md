# Ideas
Candidate features from the 2026-10-22 ideation pass, ranked by (demo value + reuse across problem statements) / effort. None are built yet. Linked from [[00-Index]]; decisions go in [[Decisions]].

## Make it reusable first (platform changes)
1. **Problem pack** — replace `contracts/dispute.json` with `packs/<id>/pack.json` (schema-checked, picked with `PACK=<id>` in `scripts/sync-contracts.mjs`): options with stable ids + localized labels, statuses (labels, tones, terminal flag, transitions), categories, notification copy, enabled modules.
2. **Brand/copy layer** — `shared/brand` (name, tagline, operator, contact, logo, colours as CSS tokens) feeding Header, Footer, Login, portal header, legal pages, `index.html` meta and WhatsApp parameters; strings through a small `t()` for re-skin + translation.
3. **Module registry** — `app/modules.ts` with per-pack enable flags (globe, forest map, FRA demo, OTP, WhatsApp, insights, tracking) so routes, nav and home sections derive from config.

## Quick wins (under 2 h each)
- Statuses and categories from one contract (removes 5 duplicated lists) — 45–75 min
- Real officer identity (email/role) in history and portal header instead of raw UIDs — ~45 min
- Public case-status lookup by reference (status only, rate-limited, no PII) — 1.5–2 h
- Pack-aware demo seed + purge script (emulator / demo project only, never the real project) — 1.5–2 h
- Demo-day preflight check (`npm run demo:preflight`, read-only go/no-go table) — ~1.5 h
- Ageing metric cards (open work > 7 / > 30 days; internal targets, not legal deadlines) — 1–1.5 h
- Notification copy out of code ("Forest Rights dispute" is hard-coded in WhatsApp params) — 30–45 min
- Field-camp QR + prefilled `/report?state=&district=` link (non-PII only) — 1–1.5 h
- Installable PWA shell (static assets only, no offline PII) — 1.5–2 h
- Pre-generated LLM explanations for the 60 synthetic FRA alerts, checked against rule output — 1.5–2 h, < US$1

## Medium (about a day)
- Officer insights dashboard (status/category/state counts, ageing, weekly intake; public view state-level only with small-cell suppression)
- Case assignment and "My cases" (revision-checked, immutable assignment events)
- Role-based access: viewer (masked PII, e.g. judges) / officer / admin, optional jurisdiction scope
- Internal service targets, timers and escalation
- Nearby/duplicate report detection by geohash ("nearby", never "same parcel")
- Multilingual citizen flow (Hindi + one regional language; native review of consent text)
- Grounded LLM case summaries for officers (redacted input, per-officer cap; needs owner approval for PII to an external processor)
- Evidence/photo upload (signed URLs, Storage rules, EXIF strip) — blocked until a retention period is decided
- Admin-only audit export (masked by default, capped, logged, CSV-injection safe)
- Reporter-visible updates separate from private notes + pluggable notification channel
- Judge walkthrough mode (`?tour=1`)

## Big bets (2–6 days)
- Problem-pack platform end to end · parcel polygon sketch + overlap flags · multi-tenant workspaces · offline-first field capture · land-record adapter (mock first) · satellite before/after viewer · WhatsApp-first conversational intake

## Open questions for the owner
- Same Firebase project for demos and real reports, or a separate demo/staging project?
- Is the Meta `otp_code` template still blocked? Demos in guest mode or with a demo-number bypass on a demo project?
- May case narratives (redacted) go to an external LLM for officer summaries?
- Retention period for case records and any evidence files?
- Languages beyond English; who reviews translations of consent/legal text?
- Read-only judge/viewer login with masked PII? Jurisdiction scoping for pilots?
- Which problem types come next (urban encroachment, water/irrigation, civic grievances, non-India)?
- Keep FRA demo, globe and forest map in every deployment, or make them switchable modules?
- Monthly cost ceiling for WhatsApp, LLM and Storage?
- Keep the historical Forest Watch URLs, or a domain per pack/hackathon?
