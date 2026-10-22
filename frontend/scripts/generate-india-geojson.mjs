import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as topojson from "topojson-client";

// Source: udit-001/india-maps-data (https://github.com/udit-001/india-maps-data),
// a public state-boundary dataset for India, fetched via jsDelivr and vendored
// at scripts/data/india-states.topo.json. Real state boundaries — combined in
// the app with clearly-labelled synthetic FRA claim data, never presented as
// official government data.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sourcePath = resolve(__dirname, "data/india-states.topo.json");
const outPath = resolve(__dirname, "../public/geo/india-national.geojson");

// This runs before every `npm run dev` and build. The output only changes when
// the vendored topology or this script changes, so skip the decode/write when
// it is already newer than both. `--force` regenerates regardless.
const mtime = (path) => {
  try { return statSync(path).mtimeMs; } catch { return 0; }
};
const outputTime = mtime(outPath);
if (!process.argv.includes("--force") && outputTime > 0 && outputTime >= Math.max(mtime(sourcePath), mtime(__filename))) {
  console.log(`India state boundaries are up to date (${outPath})`);
  process.exit(0);
}

const topology = JSON.parse(readFileSync(sourcePath, "utf8"));
const geo = topojson.feature(topology, topology.objects.states);
for (const feature of geo.features) {
  feature.properties = { name: feature.properties.st_nm };
}

// Decoding the quantized topology yields ~15 significant digits per ordinate.
// 4 decimal places (~11 m) is far finer than the 480px landing-page map can
// show, and drops a large share of the file every visitor downloads.
const roundCoords = (coords) =>
  typeof coords[0] === "number" ? coords.map((n) => Math.round(n * 1e4) / 1e4) : coords.map(roundCoords);
for (const feature of geo.features) {
  if (feature.geometry?.coordinates) feature.geometry.coordinates = roundCoords(feature.geometry.coordinates);
}

writeFileSync(outPath, JSON.stringify(geo));
console.log(`Wrote ${geo.features.length} India state features to ${outPath}`);
