# Security
- Tickets carry PII (names, phones, narratives, precise coordinates). Never widen reads, log PII, or add retention without a cleanup path.
- Staff access: Firebase Auth + `officers/{uid}` allow-list, fails closed; eight-hour shift enforced by client, handlers and rules. Officer docs are written only by the Admin seed script.
- Intake: custom OTP (hashed, expiring, attempt-limited), one-time verification token bound to the verifying client, phone/IP quotas in the same transaction as ticket creation.
- WhatsApp webhook: `X-Hub-Signature-256` HMAC check; opt-out (STOP) persisted.
- Map proxy: fixed upstreams, origin allow-list, per-IP limits; geocoding shares one serialized Nominatim queue via `geocodePlace`.
- Secrets live in Firebase Secret Manager / Vercel env, referenced by name only. `Read-Only-Folder/` holds local credentials, is gitignored, and must never be read by tools or copied into notes.
- Abuse/cost barriers added on 2026-10-22: see [[Efficiency-and-Barriers]].
