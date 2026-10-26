# Architecture
Full ownership table: `docs/ARCHITECTURE.md`. Summary:
- `frontend/src/app` — routes, lazy loading, route guards, header/footer.
- `frontend/src/features/{auth,reporting,tickets,officer-portal,home,fra-demo,legal}` — one folder per feature; `shared/` must not import features.
- `functions/src/index.ts` — stable export surface (names and handler options are API contracts).
- `functions/src/features/{otp,disputes,tickets,whatsapp,maps}` — intake, staff callables, notifications, geocoding; `platform/` = Admin init, secrets, generated contract.
- `contracts/dispute.json` — canonical input/consent contract; `scripts/sync-contracts.mjs` copies it into `frontend/src/shared/contracts` and `functions/src/platform/contracts`. Edit the canonical file only.
- All ticket writes go through Cloud Functions on the Admin SDK; `firestore.rules` gives reads to allow-listed officers only.
- `scripts/check-architecture.mjs` enforces import boundaries and no cycles.
