// Dependency-free secret scan over every file git would commit: tracked files
// plus untracked files that are not ignored. Ignored paths (Read-Only-Folder,
// .env files, build output) are never opened. Findings print as file:line and
// rule name only; matched values are never echoed, so CI logs stay clean.
// Suppress a reviewed false positive with "secret-scan: allow" on that line.
import { execFileSync } from "node:child_process";
import { openSync, readSync, closeSync, readFileSync, lstatSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const self = "scripts/check-secrets.mjs";
const MAX_BYTES = 5 * 1024 * 1024;
const placeholder = /test|fake|dummy|example|sample|synthetic|placeholder|local|demo|your|paste|changeme|redacted|xxxx|<|\$\{|process\.env|import\.meta/i;
// Real credentials mix letters and digits; identifiers and prose placeholders rarely do.
const looksRandom = (v) => v.length >= 20 && /[0-9]/.test(v) && /[A-Za-z]/.test(v) && !placeholder.test(v);

const contentRules = [
  { name: "private-key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { name: "service-account-json", re: /"type"\s*:\s*"service_account"|"private_key_id"\s*:\s*"[0-9a-f]{20,}"/ },
  { name: "google-api-key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "google-oauth-secret", re: /GOCSPX-[0-9A-Za-z_-]{20,}/ },
  { name: "google-refresh-token", re: /\b1\/\/0[0-9A-Za-z_-]{40,}/ },
  { name: "meta-access-token", re: /\bEAA[A-Za-z0-9]{80,}/ },
  { name: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { name: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  // .env content anywhere (a pasted .env, a PowerShell $env: line in a doc).
  {
    name: "dotenv-secret",
    re: /^\s*(?:export\s+|\$env:)?[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY)\s*=\s*["']?([^\s"'#]+)/,
    check: (m) => looksRandom(m[1]),
  },
  {
    name: "hardcoded-credential",
    re: /(?:token|secret|password|passwd|api[_-]?key|private[_-]?key)["']?\s*[:=]\s*["'`]([A-Za-z0-9_+/=.-]{20,})["'`]/i,
    check: (m) => looksRandom(m[1]),
  },
];

const fileRules = [
  { name: "keystore-file", test: (p) => /\.(?:jks|keystore|p12|pfx)$/i.test(p) },
  { name: "service-account-file", test: (p) => /(?:^|\/)(?:service-account[^/]*|[^/]*-firebase-adminsdk-[^/]*)\.json$/i.test(p) },
  { name: "dotenv-file", test: (p) => /^\.env(?:\..+)?$/.test(basename(p)) && !/\.(?:example|sample|template)$/.test(p) },
];

function candidateFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    console.error("check-secrets: git is required to list committable files.");
    process.exit(2);
  }
}

// The file's text encoding from its first 8 KB, or null for a binary file.
function textEncoding(file) {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(8192);
    const n = readSync(fd, head, 0, head.length, 0);
    // Windows PowerShell 5.1 redirects output as UTF-16 with a BOM. Its NUL
    // bytes must not read as binary, or a secret saved through `>` is skipped.
    if (n >= 2 && head[0] === 0xff && head[1] === 0xfe) return "utf16le";
    if (n >= 2 && head[0] === 0xfe && head[1] === 0xff) return "utf16be";
    return head.subarray(0, n).includes(0) ? null : "utf8";
  } finally {
    closeSync(fd);
  }
}

function readText(file, encoding) {
  const buf = readFileSync(file);
  if (encoding === "utf8") return buf.toString("utf8");
  const body = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2)));
  if (encoding === "utf16be") body.swap16();
  return body.toString("utf16le");
}

const findings = [];
let scanned = 0;
for (const rel of candidateFiles()) {
  if (rel === self) continue;
  const file = resolve(root, rel);
  let stat;
  // Staged deletions no longer exist on disk. lstat: a committed symlink stores
  // only its target path, so never follow it out of the repo or into an ignored path.
  try { stat = lstatSync(file); } catch { continue; }
  if (!stat.isFile()) continue;
  for (const rule of fileRules) if (rule.test(rel)) findings.push(`${rel}: ${rule.name}`);
  const encoding = textEncoding(file);
  if (!encoding) continue;
  // A multi-megabyte text file is unusual enough here to need a human look.
  if (stat.size > MAX_BYTES) { findings.push(`${rel}: oversized-text-file (${stat.size} bytes, not scanned)`); continue; }
  scanned++;
  const lines = readText(file, encoding).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes("secret-scan: allow")) return;
    for (const rule of contentRules) {
      const m = rule.re.exec(line);
      if (m && (!rule.check || rule.check(m))) findings.push(`${rel}:${i + 1}: ${rule.name}`);
    }
  });
}

if (findings.length) {
  console.error(`Secret scan failed (${findings.length} finding${findings.length === 1 ? "" : "s"}; values not shown):`);
  for (const f of findings) console.error(`  ${f}`);
  console.error('Move the value to an ignored .env file or Firebase secret, or mark a reviewed line "secret-scan: allow".');
  process.exit(1);
}
console.log(`Secret scan passed: ${scanned} text files checked.`);
