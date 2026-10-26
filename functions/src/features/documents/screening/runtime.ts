import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Compiled to lib/features/documents/screening, so four levels up is functions/.
export const ASSETS_DIR = resolve(__dirname, "../../../../assets");

export class StepTimeout extends Error {
  constructor(step: string) {
    super(`${step} timed out`);
    this.name = "StepTimeout";
  }
}

// A timeout cannot pre-empt synchronous WASM work, so callers also bound their
// inputs (image sizes, page counts); this only stops waiting and runs cleanup.
export async function withTimeout<T>(step: string, ms: number, work: () => Promise<T>, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* cleanup is best effort */ }
      reject(new StepTimeout(step));
    }, Math.max(1, ms));
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function packageDir(name: string): string | null {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

// Prefer an override under functions/assets, then the bundled npm data package.
export function firstExisting(...candidates: Array<string | null>): string | null {
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  return null;
}

export function assetPath(...parts: string[]): string {
  return join(ASSETS_DIR, ...parts);
}

// TypeScript's CommonJS output rewrites import() to require(), which cannot load
// ESM-only packages such as pdfjs-dist.
const nativeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
export function importEsm<T>(specifier: string): Promise<T> {
  return nativeImport(specifier) as Promise<T>;
}

export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}
