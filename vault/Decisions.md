# Decisions
Format: `YYYY-MM-DD — decision — why`
- 2026-09-07 — custom database-backed OTP instead of Firebase Phone Auth — intake must not create auth sessions; codes are hashed and expire.
- 2026-09-16 — product scope widened from forest disputes to land disputes; FRA demo kept as a labelled supporting module — broader use, same data-truth rules.
- 2026-09-16 — never substitute sample records for live data in the officer portal — a fabricated ticket can send an officer to a case that does not exist.
- 2026-10-22 — drop the fixed problem statement; treat the codebase as a reusable platform — the owner uses it for multiple purposes.
- 2026-10-22 — keep project memory in this `vault/` (Obsidian) — matches the owner's other projects; `PROJECT_BRIEF.md` stays authoritative.
- 2026-10-22 — split sweeps by disjoint file ownership so parallel agents never edit the same file — shared memory does not merge simultaneous edits.
