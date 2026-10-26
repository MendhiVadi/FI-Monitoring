// Gzip size budget for the built frontend (run after `vite build`). Budgets sit
// about 20% above the sizes measured on 2026-10-22 so routine work passes but a
// new eager vendor import, an un-split heavy library or an oversized static
// file fails the check. Raise a budget deliberately, in review, never silently.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "frontend/dist");
const KB = 1024;
const budgets = {
  // index.html's script, modulepreloads and stylesheets: what blocks first paint.
  initialGzip: 135 * KB, // measured ~110 KB
  // Largest single lazy chunk is the three.js globe scene (~277 KB).
  chunkGzip: 335 * KB,
  totalGzip: 800 * KB, // measured ~659 KB across all JS and CSS
  // Files copied from public/ (globe texture, GeoJSON), fetched uncompressed.
  staticRaw: 512 * KB, // largest measured ~224 KB
};

if (!existsSync(resolve(dist, "index.html"))) {
  console.error("check-bundle-size: frontend/dist is missing; run the frontend build first.");
  process.exit(1);
}

const fmt = (n) => `${(n / KB).toFixed(1)} KB`;
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = resolve(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

const html = readFileSync(resolve(dist, "index.html"), "utf8");
const initialNames = new Set([...html.matchAll(/(?:src|href)="\.?\/assets\/([^"]+)"/g)].map((m) => m[1]));

const assetsDir = resolve(dist, "assets");
const chunks = (existsSync(assetsDir) ? readdirSync(assetsDir) : [])
  .filter((name) => [".js", ".css"].includes(extname(name)))
  .map((name) => ({ name, gzip: gz(resolve(assetsDir, name)) }))
  .sort((a, b) => b.gzip - a.gzip);

const failures = [];
const total = chunks.reduce((sum, c) => sum + c.gzip, 0);
const initial = chunks.filter((c) => initialNames.has(c.name)).reduce((sum, c) => sum + c.gzip, 0);
// Fail closed: if index.html stops matching (a new base path), the initial budget would pass at 0 KB.
if (!chunks.some((c) => initialNames.has(c.name) && extname(c.name) === ".js")) failures.push("index.html references no assets/*.js entry, so the initial load cannot be measured");
if (initial > budgets.initialGzip) failures.push(`initial load ${fmt(initial)} > ${fmt(budgets.initialGzip)}`);
if (total > budgets.totalGzip) failures.push(`total JS+CSS ${fmt(total)} > ${fmt(budgets.totalGzip)}`);
for (const c of chunks) {
  if (c.gzip > budgets.chunkGzip) failures.push(`chunk ${c.name} ${fmt(c.gzip)} > ${fmt(budgets.chunkGzip)}`);
}
for (const file of walk(dist)) {
  if (file.startsWith(assetsDir) || extname(file) === ".html") continue;
  const size = statSync(file).size;
  if (size > budgets.staticRaw) failures.push(`static ${file.slice(dist.length + 1)} ${fmt(size)} > ${fmt(budgets.staticRaw)}`);
}

console.log(`Bundle (gzip): initial ${fmt(initial)} / ${fmt(budgets.initialGzip)}, total ${fmt(total)} / ${fmt(budgets.totalGzip)}`);
for (const c of chunks.slice(0, 5)) console.log(`  ${fmt(c.gzip).padStart(9)}  ${c.name}${initialNames.has(c.name) ? "  (initial)" : ""}`);
if (failures.length) {
  console.error("Bundle size budget exceeded:");
  for (const f of failures) console.error(`  ${f}`);
  console.error("Lazy-load the new dependency or split the chunk; raise the budget in scripts/check-bundle-size.mjs only if the growth is intended.");
  process.exit(1);
}
console.log("Bundle size budget passed.");
