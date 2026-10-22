# Land Dispute
- Purpose: reusable land-dispute reporting and staff-review platform. There is **no fixed problem statement**; the owner reuses it across hackathons, demos and possible pilots. Put any purpose-specific brief in its own note and link it from [[00-Index]].
- Public flow: pick a location on the map, verify a phone by WhatsApp OTP, submit a dispute report, get a reference. Reports are not legal filings and the system never decides ownership.
- Staff flow: allow-listed officers sign in (Firebase Auth + `officers/{uid}`, eight-hour shift), search the registry, open a live dossier, change status with a reason, add notes, print.
- Supporting module: `/fra-monitoring` FRA demo — 60 labelled synthetic claims over three sourced districts, deterministic delay/area-mismatch alerts, state progress. Synthetic data is always labelled.
- Landing: short scroll-driven R3F globe intro with reduced-motion fallback.
- Stack: React 19 + TypeScript + Vite 8, Leaflet, React Three Fiber, GSAP; Firebase Functions v2 (Node 22) + Firestore; WhatsApp Cloud API; Vercel serverless map proxy (`frontend/api/maps.js`); Capacitor Android.
- Hosting identifiers still use the historical Forest Watch name.
- Open items: live OTP needs Meta template approval; signed-in workflows, OTP delivery and Android need acceptance checks; operator, support channel and case-retention policy unconfirmed. See `PROJECT_BRIEF.md`.
