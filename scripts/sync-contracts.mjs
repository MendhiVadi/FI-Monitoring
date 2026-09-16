import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'contracts/dispute.json'), 'utf8');
JSON.parse(source);
for (const file of ['frontend/src/shared/contracts/dispute.json', 'functions/src/platform/contracts/dispute.json']) {
  const target = resolve(root, file);
  mkdirSync(dirname(target), { recursive: true });
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch { /* First generation. */ }
  if (current !== source) writeFileSync(target, source);
}
