# Software review: flaws, solutions and verification

Updated 16 September 2026 in the canonical Land Dispute checkout. The user authorized
fixes after the read-only audit. This list groups findings by root cause and includes
problems found while checking the fixes. Existing unrelated work is preserved.
The changes were published to GitHub and Vercel production on 16 September 2026,
with all 11 Firebase Functions and the Firestore rules deployed. See
[DEPLOYMENT.md](DEPLOYMENT.md) for exact release identifiers and live checks.

## Implemented fixes

| # | Flaw / edge case | Solution now in source |
| --- | --- | --- |
| 1 | A partially failed submission could spend verification or quota without saving a case. | Create the ticket, spend the proof, update quotas and write the receipt in one Firestore transaction. An aborted commit changes none of them. |
| 2 | Retrying after a lost response could create a duplicate or show failure after success. | Stable submission IDs and 24-hour receipts return the original case. Officer mutations also use request IDs and reconcile lost responses with immutable events. |
| 3 | Requesting another OTP could invalidate an already completed verification. | Keep the five-minute challenge separate from the 15-minute, single-use verification grant. Both remain hashed and bound to the phone/proof. |
| 4 | Failed OTP guesses or late delivery callbacks could corrupt newer challenge state. | Commit rejected guesses and enforce the five-attempt limit; update delivery only when the callback belongs to the current challenge. |
| 5 | Concurrent requests, guest mode or changing verified phones could bypass reporting limits. | Enforce five reports per daily window for both the verified number and the shared connection inside the transaction. Guests cannot enable notifications. |
| 6 | Client/server validation differed and malformed enum, district or location values were accepted. | Generate both sides from one contract; validate enum membership, state/district pairing, narrative/name limits, finite coordinates, explicit location confirmation and consent version server-side. |
| 7 | Phone verification was treated as permission for later messages. | Separate required privacy acknowledgement from optional WhatsApp updates, default updates off and save consent version/time. |
| 8 | Navigation, expired verification and failed requests could erase a partly completed report. | Keep a tab-memory draft across routes and re-verification; retain it on failure and clear it on success or after 30 minutes without editing. Reloading still loses the draft by design. |
| 9 | Editing a browser timestamp could extend the staff shift. | Enforce eight hours from Firebase's signed authentication time in the UI, every officer handler and Firestore rules; reject missing/future/expired times. |
| 10 | Concurrent officer edits could overwrite each other. | Require the expected revision for status changes. Conflicts preserve the newer server value and ask the officer to review it. |
| 11 | Status changes lacked a reliable reason/author/history. | Require a reason and create an immutable event with old/new status, revision, officer ID and server time. Legacy actions are explicitly identified as possibly unaudited. |
| 12 | Embedded note arrays grew indefinitely; repeated note text could collapse and drafts could leak between cases. | Append notes to a paginated subcollection with independent request IDs; preserve legacy notes read-only and key drafts, reasons and errors by case. |
| 13 | A latest-200 cap hid old cases and made statistics misleading. | Bounded server searches expose an older-page cursor; exact-ID lookup is immediate. Aggregates cover the entire registry. List responses project summary fields instead of sending notes/narratives. |
| 14 | An open dossier became stale, and token refresh could unmount it and erase edits. | Subscribe to the selected case and recent notes/events; reject stale asynchronous results and keep the authorized view mounted during same-officer token refresh. The registry has explicit refresh. |
| 15 | Automatic geocoding looked like a confirmed dispute location; changing districts could leave a stale pin. | Automatic lookup moves the view only. Require an explicit point and confirmation; clear both when state/district changes. Add keyboard selection and visible coordinates. |
| 16 | Slow location searches could replace a newer manual point, and request failures could leave confusing state. | Abort/version each request, cancel on manual selection, guard against stale results and surface timeouts/retry errors. |
| 17 | Per-instance geocoder throttling exceeded the upstream's shared rate limit. | Delegate to one Firestore-backed cache/lease across instances; reserve one request and enforce spacing after release, with timeout and crash expiry. Proxy tests cover a busy gateway. |
| 18 | Keyword triage escalated negated statements or names and displayed invented confidence. | Use structured immediate-risk answers, negation-aware narrative clues, no name/subject scanning and no uncalibrated percentages. Rules remain advisory. |
| 19 | Mentioning evidence or an old static case age implied stronger evidence/urgency than existed. | Use explicit, unverified evidence references, show gaps, refresh age calculations and label review targets as suggestions rather than legal deadlines. |
| 20 | Retried/out-of-order notification events could send duplicate or stale updates. | Deduplicate by event, check current revision and consent, expire old events and reserve sends. Uncertain transport outcomes wait for a receipt instead of being blindly resent. |
| 21 | Provider acceptance was confused with delivery and late receipts/errors could downgrade a delivered message. | Correlate provider IDs and opaque event IDs, persist monotonic receipt states, handle receipts arriving before the send response and reject success responses without an ID as uncertain. |
| 22 | STOP messages did not reliably persist across old tickets and event replays. | Verify the signed webhook, retain a hashed opt-out, propagate it across older tickets and use message time so replaying an old STOP cannot revoke a newer explicit opt-in. |
| 23 | Cleanup could delete a refreshed record or leave temporary PII/backlogs indefinitely. | Re-read expiry inside each delete transaction, process bounded batches, log remaining backlog and cover grants, receipts, caches, delivery state, limits and old duplicate profiles. New intake no longer creates duplicate contact profiles. |
| 24 | Overlay dialogs lacked consistent keyboard focus and escape behavior. | Use native dialogs with focus trapping, Escape/backdrop closing and focus restoration for dossiers and password recovery. |
| 25 | Printing was incomplete or produced many blank pages and dark backgrounds. | Print only the selected dossier, hide editing controls, use a light layout and temporarily remove the native modal top layer during printing. Restore the interactive dialog afterward. |
| 26 | The heavy globe delayed unrelated routes and had no adequate motion/renderer fallback. | Keep routes and globe code lazy; provide a static hero for reduced motion, unsupported WebGL and local rendering errors. Large globe/Firebase chunks still need future optimization. |
| 27 | Pages implied official government data, SMS identity checks, inbound WhatsApp ticket creation or legal title outcomes that were unsupported. | Correct product, policy, dataset and status wording. Distinguish phone verification, submitted grievances, illustrative data and project staff from official identity/title certification. |
| 28 | Tests relied on simplistic mocks and could miss transaction failures or accidentally invoke real delivery scripts. | Add real emulator concurrency/rules checks, offline triage/map/FRA tests and a loopback-only browser harness that intercepts Meta. Keep operational send scripts outside test discovery. |

### Missing FRA demonstration

Added `/fra-monitoring`, separate from the real ticket registry: 60 synthetic claims,
three real district geometries (Mandla, Pune and Koraput), filters, delay and area
mismatch alerts, evidence-based explanations, investigation suggestions and state
progress. Schema, thresholds, source dates and ODbL attribution are documented in
[FRA_DEMO.md](FRA_DEMO.md). These are deterministic explanations, with no connected
LLM or official claim feed. State summaries cover the three demonstration districts,
not their entire states.

## Verification

The final `npm run check:all` completed successfully on 16 September 2026:

- Architecture/import checks and both production builds passed.
- **41 tests passed:** six backend unit tests, ten frontend/map tests, and 25
  Firestore rules/transaction tests. No tests failed or were skipped.
- Lint completed with seven non-fatal warnings; the production build retained its
  large lazy globe/Firebase chunk warnings.

Browser checks used local Auth/Firestore and actual handlers with synthetic records:

- Verified a reserved test number, submitted a report and found the saved case in
  the staff registry. No WhatsApp updates were opted into for that report.
- Preserved a report across navigation; required an explicit pin; ignored a delayed
  search after manual selection; cleared the pin when changing districts.
- Loaded 50 then all 65 seeded cases and found the oldest case by exact ID.
- Saved a note and status reason, retained per-case drafts, and kept an open dossier
  and draft intact through token refresh.
- Dropped a successful note-save response deliberately: the note appeared once,
  the input cleared and no false save error appeared.
- Verified a two-page dossier PDF containing the selected case, saved note and
  audit reason, with no unrelated case or blank page; inspected the rendered page.
  The native modal was restored after printing.
- Checked recovery-dialog Escape/focus behavior, mobile dossier width, FRA district
  filters/counts and a 390px viewport without horizontal overflow.
- Checked reduced-motion home behavior and ordinary home loading. No JavaScript
  application errors were reported in the exercised flows.

The local browser harness and emulators were stopped after use; their data was not
exported. Synthetic PDF evidence is under `.codex/review/dossier-print.pdf` and the
final root check log is `.codex/review/check-all.log` (local verification artifacts).

## Remaining limits and release work

- **Live OTP and message delivery:** [OTP_WHATSAPP_OPERATIONS.md](OTP_WHATSAPP_OPERATIONS.md)
  records missing Meta permission/template approval for `otp_code`. That external
  state was not rechecked by sending a message. Live delivery needs account access,
  approval and an intentional recipient test; local success does not prove it.
- **Deployment compatibility:** the Functions, rules and Vercel frontend were
  released together. Old open clients use incompatible submission/edit contracts
  and need to reload and verify again. Public routing and place search passed live
  checks; authenticated case editing was tested locally, not against real cases.
- **History and retention:** legacy embedded notes are preserved; old actions cannot
  gain historical authors/reasons retroactively. The UI shows the latest 50 events
  and loads notes in pages of 50; printing includes loaded notes, with a warning when
  older notes remain. Case records have no automatic deletion period configured.
- **Search and scale:** cursor search remains a bounded scan, not a search index;
  broad rare-term searches can require several pages. Registry counts include all
  cases. The registry refreshes manually while the selected dossier stays live.
- **Notification uncertainty:** an unconfirmed send may remain uncertain without a
  provider receipt. This trades automatic retry for avoiding duplicate messages.
- **Data boundaries:** selected coordinates are range-checked, not proven to fall
  inside the named administrative polygon. Demo boundaries date to 2021 and cover
  only three districts; they are not cadastral or ownership evidence.
- **Remaining checks:** real CAPTCHA/password recovery/email delivery, real OTP and
  authenticated case editing, physical printing and Android were not verified in
  production. Live hosting and public route/access checks passed. This is not a
  claim that every possible software flaw has been eliminated.
- **Non-fatal diagnostics:** seven lint warnings remain around effect state/ref
  synchronization, plus large lazy globe/Firebase bundle warnings.
