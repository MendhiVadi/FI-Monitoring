import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as topojson from "topojson-client";

// Source: udit-001/india-maps-data (https://github.com/udit-001/india-maps-data),
// a public state-boundary dataset for India, fetched via jsDelivr and vendored
// at scripts/data/india-states.topo.json. Real state boundaries — combined in
// the app with clearly-labelled synthetic FRA claim data, never presented as
// official government data.
const __dirname = dirname(fileURLToPath(import.meta.url));
const topology = JSON.parse(readFileSync(resolve(__dirname, "data/india-states.topo.json"), "utf8"));

const geo = topojson.feature(topology, topology.objects.states);
for (const feature of geo.features) {
  feature.properties = { name: feature.properties.st_nm };
}

const outPath = resolve(__dirname, "../public/geo/india-national.geojson");
writeFileSync(outPath, JSON.stringify(geo));
console.log(`Wrote ${geo.features.length} India state features to ${outPath}`);
