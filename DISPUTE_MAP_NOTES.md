# Dispute map and restored OTP verification

Phone verification was restored on 2026-09-05. The frontend switch is
`frontend/dispute-settings.json` (`otpRequired: true`). The callable function
uses `DISPUTE_OTP_REQUIRED` with a secure default of `true`. Deploy the backend
before the rebuilt frontend so an unverified form can never reach a permissive
function. Firebase Phone Auth must remain enabled.

Deployment on 2026-09-05 used `firebase.dispute-deploy.json` and the isolated
`functions/.dispute-deploy` package. The full package's unrelated WhatsApp
declarations require secrets which are not configured. The isolated package
exports only `submitDispute`; its `.env.tree-top-d61c6` now explicitly sets
`DISPUTE_OTP_REQUIRED=true`. Regenerate its compiled files after source changes.
Do not deploy a stale isolated package.

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
