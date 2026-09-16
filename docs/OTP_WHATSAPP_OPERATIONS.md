# OTP and ticket notifications

## September 15 repair

- The production OTP endpoint had no public Cloud Run invoker binding. Anonymous
  reporter requests were rejected before callable code ran, producing `internal [0]`.
  The callable declarations now explicitly set `invoker: "public"`. This only opens
  the transport: officer authorization and single-use OTP checks remain enforced.
  Production additionally required explicitly restoring `allUsers` / `roles/run.invoker`
  on the `requestdisputeotp` and `verifydisputeotp` Cloud Run services. Both were
  rechecked without a Google identity token and returned callable validation errors.
- OTPs live in server-only `disputeOtps` as keyed hashes, with expiry, failed-attempt
  counters, verification state and delivery acceptance/failure. Each request replaces
  the previous code and proof; a code cannot be verified twice. Cleanup remains hourly.
- Every new ticket sends `request_created` to its verified reporter. Status changes
  and added staff notes send `status_update`; private note text is not forwarded.
- `whatsappDeliveries` records event IDs, ticket references and send acceptance/errors,
  without recipient numbers or message bodies. Records expire through hourly cleanup
  after 30 days. Temporary send failures retry for up to 24 hours. Concurrent/replayed
  events are deduplicated with leases. A crash after Meta accepts but before Firestore
  records acceptance can still cause a duplicate; Meta sends are not transactional.
- `accepted` means Meta accepted the send, not that the phone received it. Signed
  webhook delivery statuses appear in function logs.

## Remaining Meta dependency

The connected WhatsApp business account has approved `request_created` and
`status_update` templates but no `otp_code` authentication template. An attempt to
create it returned Meta code 10: the account lacks permission to create that template.
Account access/eligibility must be resolved in WhatsApp Manager, then create and approve:

- Name: `otp_code`; language: `en`; category: `AUTHENTICATION`.
- Body: standard authentication body with security recommendation.
- Footer: 5-minute expiry.
- Button: OTP `COPY_CODE`.

The sender supplies the fresh six-digit code in both body and copy-code button.
Do not substitute an unrelated utility template or expose stored codes in the UI.
The live account check returned `account_review_status: APPROVED` and
`business_verification_status: pending_need_more_info`. This is an external account
requirement; a code deployment does not complete business verification.

## Checks

Run `npm run check:all`. Live acceptance additionally needs a real delivered OTP,
report submission, legitimate officer sign-in, status update and WhatsApp delivery
receipt. Offline tests use synthetic numbers and never send messages.

Live browser sign-in for the existing admin account was verified after adding it to
the officer allow-list: the portal loaded eight existing tickets. Six existing
tickets have WhatsApp updates enabled; two have no phone number and cannot receive
notifications. Historical tickets were not modified or sent test messages.
The website, all nine functions and Firestore rules were deployed. Authenticated
staff mutation endpoints passed authorization and returned `NOT_FOUND` for a deliberately
nonexistent ticket. A real OTP request saved its hash, expiry and `failed` delivery
state in Firestore, then returned a readable `UNAVAILABLE` response. No successful
OTP delivery or actual ticket-update WhatsApp delivery was verified.
