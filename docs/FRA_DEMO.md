# District FRA demonstration

Route: `/fra-monitoring`. This is separate from the officer registry. All 60 claims
are synthetic; no real people, filings or parcel locations are included. Three
real historical district polygons provide geographic context.

## Record schema and methods

`features/fra-demo/claims.ts` defines ID, state, district, status (pending, approved
or rejected), ISO filing date, claimed and recorded area in hectares, and a fictional
land-record reference. The generator creates 20 records per district. The default
review date is 2026-09-16.

- Delay: pending for more than 90 whole days as of the selected date.
- Area mismatch: absolute difference divided by recorded area exceeds 20 percent.
- Invalid, future or missing dates and non-positive areas receive a data-check alert.
- Explanations quote inputs, thresholds and suggested record checks. No model
  confidence or claim entitlement is inferred.
- State progress uses all 20 records in that state's demonstration district,
  irrespective of status/alert filters. Filtered cards and rows follow those filters.

These are demonstration rules, not legal deadlines or official FRA eligibility rules.

## Geography and licence

geoBoundaries gbOpen IND ADM2, boundary ID IND-ADM2-76128533, represents 2021
boundaries. Source credits Pathways Data Pvt Ltd and lgdirectory.gov.in. The
download is pinned to release 9469f09, retrieved on 2026-09-16. Only Mandla, Pune
and Koraput were retained; source geometry was not edited. A state property was added.

The derived boundary database is distributed under ODbL 1.0. Public
`geo/fra-demo-provenance.json` includes source links, modifications and licence.
Attribute geoBoundaries and its listed providers when redistributing the subset.
OpenStreetMap tiles have separate OpenStreetMap attribution.
