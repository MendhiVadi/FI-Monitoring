import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { openImage, type RawImage } from "./imaging";
import { assetPath, firstExisting, packageDir, withTimeout } from "./runtime";

// functions/assets/tessdata wins (e.g. a larger "best" model); otherwise the
// bundled @tesseract.js-data package. Never the default CDN download.
export function tessdataDir(): string | null {
  const bundled = packageDir("@tesseract.js-data/eng");
  const dir = firstExisting(
    existsSync(assetPath("tessdata", "eng.traineddata")) || existsSync(assetPath("tessdata", "eng.traineddata.gz")) ? assetPath("tessdata") : null,
    bundled ? join(bundled, "4.0.0_best_int") : null,
  );
  return dir;
}

export interface OcrResult { text: string; confidence: number }

export async function recognise(source: Buffer | RawImage, timeoutMs: number): Promise<OcrResult> {
  const langPath = tessdataDir();
  if (!langPath) throw new Error("OCR language data is missing");
  const gzip = !existsSync(join(langPath, "eng.traineddata"));
  // Upscale small scans: Tesseract wants roughly 20-30 px tall glyphs.
  const meta = await openImage(source).metadata();
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  const target = longSide < 1600 ? 1600 : Math.min(longSide, 2400);
  const prepared = await openImage(source).greyscale().normalise()
    .resize({ width: target, height: target, fit: "inside" }).png().toBuffer();
  const tesseract: typeof import("tesseract.js") = require("tesseract.js");
  let worker: Awaited<ReturnType<typeof tesseract.createWorker>> | null = null;
  const stop = () => { void worker?.terminate().catch(() => undefined); worker = null; };
  try {
    return await withTimeout("ocr", timeoutMs, async () => {
      worker = await tesseract.createWorker("eng", 1, {
        langPath, gzip, cacheMethod: "none", cachePath: dirname(langPath),
        errorHandler: () => undefined,
      });
      // The prepared PNG carries no DPI; without a hint Tesseract guesses 70.
      await worker.setParameters({ user_defined_dpi: "300" });
      const { data } = await worker.recognize(prepared);
      return { text: data.text ?? "", confidence: data.confidence ?? 0 };
    }, stop);
  } finally {
    stop();
  }
}
