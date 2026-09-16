# Dispute map and OTP verification

**Superseded 2026-09-07.** Phone verification no longer uses Firebase Phone
Auth. Dispute intake now runs a custom database-backed OTP (`functions/src/features/otp/service.ts`,
collection `disputeOtps`) that issues, hashes and expires its own codes and
never creates a Firebase Auth session. Firebase Phone Auth can be left disabled.

The frontend switch is still `frontend/dispute-settings.json` (`otpRequired: true`)
and the callable still reads `DISPUTE_OTP_REQUIRED`, defaulting to `true`. Deploy
the backend before the rebuilt frontend so an unverified form can never reach a
permissive function.

Verification is bound to the client that passed it: `verifyDisputeOtp` returns a
one-time `verificationToken` and `submitDispute` requires it back. Knowing a
phone number is not sufficient to submit on its behalf.

`firebase.dispute-deploy.json` and the isolated `functions/.dispute-deploy`
package were **removed on 2026-09-07**. They predated the OTP rewrite, exported
only `submitDispute`, and deploying them would have reverted the verification
flow and pruned the other live functions. Deploy from the root `firebase.json`.
The stale `functions/.dispute-deploy/` directory may still exist locally and is
safe to delete.

Required secrets: `DISPUTE_OTP_SECRET` (OTP/token HMAC), `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and
`WHATSAPP_APP_SECRET` (webhook `X-Hub-Signature-256` verification). Sending the
OTP needs an approved WhatsApp template named `otp_code` with one body parameter.

Unverified submissions are explicitly marked `phoneVerified: false`, have no
WhatsApp updates, and retain a five-per-day limit using a hash of the request IP.
This is a temporary public reporting mode; shared networks share the limit.
Staff access rules are unchanged by this work.

The form saves `dispute.location.latitude` and `longitude` as numbers, validated
on the server. Clicking the map, dragging the marker, and entering coordinates
are supported. Missing or invalid coordinates prevent submission. Failed saves
remain errors; they no longer create a fictional success message.

Base map and custom coloured polygons are OpenStreetMap data. Overpass loads a
small visible area on demand at zoom 14 or higher. Colours: farmland yellow,
parks/ponds light green, commercial/retail red, forest/wood dark green. The fill
opacity is 22% with darker outlines. Mapping coverage is incomplete and neither
parks/ponds nor classification proves ownership or legal boundaries.

Bhuvan integration uses the working national 1:250,000 WMS endpoint at
https://bhuvan-ras2.nrsc.gov.in/cgi-bin/LULC250K.exe and selects the newest
published survey (currently 2024–2025). Its original colours are separate from
custom OpenStreetMap shading. No daily statistics access token is required.

Both services are accessed through the same-origin /api/maps handler, with
bounded queries, provider identification, timeouts, response validation, caching,
and an Overpass fallback. Vite serves the same handler locally. Vercel routes
API requests before the single-page application fallback.

Sources:
- https://bhuvan.nrsc.gov.in/wiki/index.php/How_to_use_WMS_services
- https://www.openstreetmap.org/copyright
- https://overpass-api.de/
- https://leafletjs.com/reference

Backend regression checks: build `functions`, then run
`node --test scripts/test-dispute-flow.cjs` from that folder. These use an
in-memory Firestore test double and do not write live reports.

## Verification and deployment

Note: the 2026-09-05 checks below predate the OTP rewrite and describe a form
that opened *without* OTP. They are kept as a deployment record, not as a
description of current behaviour.

On 2026-09-05 both builds passed, targeted map/form lint passed, and the backend
regression checks passed. Browser checks verified coordinate entry, invalid
coordinate rejection, marker dragging, and three real land-use polygons near
Lodhi Gardens locally. The public form at
https://forest-watch-eight.vercel.app/report was published and verified to open
without OTP and accept coordinate selection. Live validation-only calls reached
the backend without authentication and rejected invalid coordinates without
writing reports. No real dispute was submitted as part of these checks.

The original Bhuvan 50K server timed out. This was repaired by using the working
250K service and a same-origin proxy. Production checks returned real Bhuvan XML
and real land-use GeoJSON, and browser checks loaded the imagery and coloured
polygons. Live DOM inspection confirmed all four custom fills, darker strokes,
and 0.22 fill opacity on real mapped areas.

A synthetic report was submitted to the live callable function and read back
with authorized database access. Coordinates 28.593, 77.22 were stored exactly;
phoneVerified and whatsappUpdates were false. The synthetic ticket was removed
after verification. Proof is in .codex/map-checks/persistence-proof.json.

Map API tests cover bounds validation, provider failover and User-Agent headers,
GeoJSON conversion, fixed upstream/CRS, and XML errors disguised as image success.
Run node --test scripts/test-map-api.mjs in frontend. Production deployment:
dpl_9G1XLr6hdBLzG3YGQ6mBpqwpsWRT.

Firebase confirmed successful deployment of the dispute function. Its CLI then
reported an unset artifact cleanup policy; this did not roll back deployment.
The existing cleanup policy was not changed.
