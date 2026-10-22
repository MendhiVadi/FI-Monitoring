# UI / UX
2026-10-22 audit of the staff area (login + officer portal) and public pages. Full fix instructions were generated per issue; implementation status is below. Linked from [[00-Index]].

## Staff area (login + portal) — worst first
- UX-01 critical — save errors render behind the open dossier dialog, so officers never see them
- UX-02 critical — status `<select>` commits on change (one stray arrow key = permanent audit event + WhatsApp message); reason never cleared
- UX-03 high — no visible focus rings (`outline: none` everywhere); many 16–30 px touch targets
- UX-04 high — 8-hour shift ends with no warning; drafts and the open case are lost; deep link lost after re-login
- UX-05 high — no confirmation after saves, no "Saving…" state, no hint whether the reporter was notified
- UX-06 high — missing fields shown as invented values (breaks the no-fabrication rule)
- UX-07 high — registry blanks on every search keystroke
- UX-08 high — login email `aria-label` overrides the visible label; label promises "ID" but only email works
- UX-09 high — notes are permanent and notify the reporter, but the composer is a one-line input with no warning
- UX-10…13 medium — emoji password toggle with reversed logic; unlabelled CAPTCHA; signed-in officer still sees the sign-in form; recovery modal is a dead-end fake form
- UX-14…22 medium — one status has four names; metric cards look clickable and don't add up; cards carry little triage signal; unstyled pagination; unassociated labels; nested scroll in dossier; raw status keys and UIDs in history; header wraps to 3 rows at 360 px; ~600 lines of inline styles
- UX-23…25 low — government/FRA wording in generic staff UI; no print header on dossiers with PII; `/tickets` is a weaker duplicate registry

## Public pages — worst first
- PUB-01 critical — phone verification lasts 15 min but the long form comes after it; slow reporters lose verification
- PUB-02…08 high — submit disabled with no reason; old confirmation shown on return to `/report`; success message off-screen and unannounced; white-on-green buttons below contrast; one-finger map drag traps page scroll on phones; phone row cramped at 360 px; WhatsApp requirement not stated up front
- PUB-09…22 medium — legal pages say "AI" where rules are deterministic; pasted OTP with spaces truncated; map-chunk failure tells users to reload (loses draft); silent 30-min draft expiry; same title on every route; four CTA labels/styles; header overflow at 360 px; label/aria mismatch on map search; eight greens and seven radii; plain `<a>` reloads between legal pages; FRA map re-fits on every click; raw statuses/ISO dates in FRA table; reduced-motion hero is an empty panel; English-only
- PUB-23…25 low — no Open Graph/meta for link previews; hover-only forest-map details; near-invisible loading fallback

## Implementation status (2026-10-23)
Done and reviewed: UX-01–21 and UX-23–24 (frontend parts), PUB-01–21 and PUB-23–25 (PUB-01 client-side only). Not done: UX-22 full style migration (tokens exist in `global.css`; Login/portal still mostly inline), UX-25 `/tickets` retirement, PUB-22 i18n, server parts of UX-15/16/20.

Staff area
- Dossier split into `Dossier.tsx` + `DossierActions.tsx`: save errors shown next to the failing control with Retry (idempotent) and plain-language messages; one scroll area; full screen below 640 px; actions in a sticky side panel at ≥ 1024 px.
- Status change is an explicit form: pending select + required reason (counter, cleared after save) + "Update status"; Resolved/Closed need a confirm step; WhatsApp hint when the reporter opted in.
- Notes: labelled textarea, Ctrl/Cmd+Enter to submit, permanence + WhatsApp warning, paste-truncation warning.
- Success notices in a polite live region inside the dialog; per-button "Saving…" spinners.
- No invented fallbacks ("Not provided" instead); one status vocabulary + `StatusBadge` with glyphs (`tickets/ticketStatus.ts`).
- Registry keeps results visible while searching ("Updating results…"), skeleton first load, filters/search synced to the URL, clickable metric cards incl. "Closed without resolution", toolbar refresh with "Updated n min ago", proper empty/error states.
- `PortalHeader`: avatar menu below 640 px; session-expiry banner in header and dossier (≤ 15 min warning, ≤ 2 min alert); confirm before sign-out/leave with unsaved drafts.
- Print header on dossiers: reference, printed-at/by, confidentiality and not-an-official-record notice.
- Login: neutral "Staff sign-in" wording, visible label "Work email", inline per-field errors, Show/Hide password button, Caps Lock hint, labelled CAPTCHA fieldset, live backoff countdown, signed-in users see only the session card, honest account-recovery message, returns to the requested page after an expired session; submit button now mint on dark text (10.6:1).

Public
- Report flow: "Before you start" box (WhatsApp code needed, not a legal filing); verification timer with 3-min warning and re-verify that keeps the draft; Submit always enabled with a focused error summary; "Report submitted" focus + copyable reference + "Report another dispute"; draft-expiry banner; touch maps need "Move map" to pan; optional "Use my current location" (Permissions-Policy now `geolocation=(self)` on Vercel and Firebase); OTP paste with spaces; map-chunk retry keeps answers.
- Legal pages say explanations are rule-based (no AI connected); internal links use the router.
- Shell: design tokens and a global `:focus-visible` ring; per-route titles + focus/announcement on navigation; one "Report a dispute" primary CTA everywhere; header fits 360 px; delayed visible loading state; Open Graph/Twitter meta and `<noscript>`.
- Home/FRA: accessible CTA contrast; reduced-motion hero shows content over the earth image; keyboard/touch details on the forest map; FRA map no longer re-fits on every click; readable statuses and dates.

Verified 2026-10-23: full check suite green; login, report, home checked in the browser at 375 px and desktop (no horizontal scroll, no console errors). Signed-in portal flows were not exercised in a browser (needs a staff account).

## Decisions needed from the owner
- CAPTCHA on every staff sign-in, or only after failed attempts? (client-only, so it slows staff more than attackers)
- Password recovery: Firebase reset emails, or a fixed administrator contact (who)?
- At the 8-hour limit: allow renewal in place by re-entering the password, or hard stop?
- Separate internal notes vs reporter-visible updates (each note currently messages the reporter)?
- Retire `/tickets` and redirect to `/officer-portal`?
- Report flow: reorder to form → verify → submit, or extend the 15-min verification window (e.g. 45–60 min)?
- Mask reporter phones in the registry list until a case is opened (screen-shared demos)?
- Staff identified by email, display name or role in history (needs `officerEmail` stored on events/notes)?
- Light theme for outdoor field use? Languages beyond English?
- Contact page shows a personal Gmail publicly — replace with a project alias?
- SMS fallback or assisted path for people without WhatsApp?
