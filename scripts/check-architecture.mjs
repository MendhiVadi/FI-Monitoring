import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Reuse the installed compiler; the root needs no dependency installation.
const require = createRequire(resolve(root, "frontend/package.json"));
const ts = require("typescript");
const slash = (p) => p.split(sep).join("/");
const label = (p) => slash(relative(root, p));
const errors = [];
const graph = new Map();

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(p) : /\.[cm]?[jt]sx?$/.test(p) ? [p] : [];
  });
}

function moduleStrings(source) {
  const specs = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) specs.push(arg.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specs;
}

for (const directory of ["frontend/src", "functions/src"]) {
  for (const file of walk(resolve(root, directory))) {
    const from = label(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const edges = [];
    graph.set(file, edges);
    if (from.startsWith("frontend/src/") && !/^frontend\/src\/(main\.tsx$|app\/|features\/|shared\/)/.test(from)) {
      errors.push(`${from}: place code under app, features, or shared`);
    }
    if (from.startsWith("functions/src/") && !/^functions\/src\/(index\.ts$|platform\/|features\/)/.test(from)) {
      errors.push(`${from}: place code under platform or features`);
    }
    for (const spec of moduleStrings(source)) {
      if (!spec.startsWith(".")) {
        if (/features\/tickets\/(types|ticketDecisionTree)\.ts$/.test(from) && /^(react|firebase)(\/|$)/.test(spec)) {
          errors.push(`${from}: ticket data and decision rules must remain independent of React/Firebase`);
        }
        continue;
      }
      const base = resolve(dirname(file), spec);
      const target = [base, ...[".ts", ".tsx", ".js", ".json", "/index.ts", "/index.tsx"].map((ext) => base + ext)]
        .find((p) => existsSync(p) && statSync(p).isFile());
      if (!target) { errors.push(`${from}: unresolved import ${spec}`); continue; }
      const to = label(target);
      edges.push(target);
      if (from.startsWith("frontend/src/shared/") && /^frontend\/src\/(app|features)\//.test(to)) errors.push(`${from}: shared code cannot import ${to}`);
      if (from.startsWith("frontend/src/features/") && to.startsWith("frontend/src/app/")) errors.push(`${from}: features cannot import application composition`);
      if (from.startsWith("functions/src/platform/") && to.startsWith("functions/src/features/")) errors.push(`${from}: platform cannot import features`);
      if (from.startsWith("frontend/") && to.startsWith("functions/")) errors.push(`${from}: browser code cannot import server code`);
      if (from.startsWith("functions/") && to.startsWith("frontend/")) errors.push(`${from}: server code cannot import browser code`);
    }
  }
}

const visited = new Set();
const active = new Set();
function checkCycles(file, trail = []) {
  if (active.has(file)) { errors.push(`Dependency cycle: ${[...trail, file].map(label).join(" -> ")}`); return; }
  if (visited.has(file)) return;
  active.add(file);
  for (const next of graph.get(file) || []) checkCycles(next, [...trail, file]);
  active.delete(file);
  visited.add(file);
}
for (const file of graph.keys()) checkCycles(file);
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Architecture check passed: ${graph.size} source modules, no broken imports, forbidden boundaries, or dependency cycles.`);
