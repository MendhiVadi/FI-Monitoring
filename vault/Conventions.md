# Conventions
- Dev: `npm run dev` from the repo root (runs contract sync and India GeoJSON generation first).
- Full check: `npm run check` (architecture, lint, builds, tests); `npm run check:all` adds Firestore rules tests (needs Java).
- Backend tests: `npm --prefix functions test`; rules: `npm --prefix functions run test:rules`. Frontend: `npm --prefix frontend test`.
- Edit `contracts/dispute.json`, never its generated copies.
- Label synthetic data as synthetic; record the source of every real boundary dataset.
- Deterministic, testable anomaly rules; an LLM may explain evidence, never invent claim facts.
- One AI tool writes at a time; parallel agents get disjoint files.
- Deploy order: Functions and rules before the rebuilt frontend.
