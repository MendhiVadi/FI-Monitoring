# Decisions
Format: `YYYY-MM-DD — decision — why`
- 2026-09-07 — custom database-backed OTP instead of Firebase Phone Auth — intake must not create auth sessions; codes are hashed and expire.
- 2026-09-16 — product scope widened from forest disputes to land disputes; FRA demo kept as a labelled supporting module — broader use, same data-truth rules.
- 2026-09-16 — never substitute sample records for live data in the officer portal — a fabricated ticket can send an officer to a case that does not exist.
- 2026-10-22 — drop the fixed problem statement; treat the codebase as a reusable platform — the owner uses it for multiple purposes.
- 2026-10-22 — keep project memory in this `vault/` (Obsidian) — matches the owner's other projects; `PROJECT_BRIEF.md` stays authoritative.
- 2026-10-23 — store and scan Aadhaar/PAN images and numbers — owner: the project is a mock-up; screening must catch fakes.
- 2026-10-23 — screening flags for staff, never auto-rejects; only a failed UIDAI QR signature reads "altered" — automated forensics give false positives.
- 2026-10-23 — reporters never see risk levels — a per-upload verdict is an oracle for tuning forgeries.
- 2026-10-23 — case type from the other party's type (individual → person vs person; government or "Not sure" → citizen vs government) — reuses an existing field.
- 2026-10-23 — uploaded documents deleted 90 days after a case closes; unsent uploads after 2 h — brief requires a cleanup path for retained PII.
- 2026-10-22 — split sweeps by disjoint file ownership so parallel agents never edit the same file — shared memory does not merge simultaneous edits.
