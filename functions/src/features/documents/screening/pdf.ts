import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { RawImage } from "./imaging";
import { errorName, importEsm, packageDir, StepTimeout, withTimeout } from "./runtime";

type PdfJs = any;
let pdfjs: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const dir = packageDir("pdfjs-dist");
    if (!dir) throw new Error("pdfjs-dist is not installed");
    return importEsm<PdfJs>(pathToFileURL(join(dir, "legacy", "build", "pdf.mjs")).href);
  })().catch(err => { pdfjs = null; throw err; });
  return pdfjs;
}

export interface PdfImage extends RawImage { page: number; uses: number }

export interface PdfAnalysis {
  opened: boolean;
  encrypted: boolean;
  passwordProtected: boolean;
  unlockedWithDerivedPassword: boolean;
  pageCount: number | null;
  producer: string | null;
  creator: string | null;
  creationDate: string | null;
  modDate: string | null;
  eofCount: number;
  signatureCount: number;
  // Bytes appended after the last signature's ByteRange: an edit after signing.
  bytesAfterSignature: number;
  // Linearized ("fast web view") files carry a second %%EOF without any edit.
  linearized: boolean;
  // Declared image sizes were too large to decode safely, so pages were not imaged.
  imagesSkipped: boolean;
  // Analysis was stopped part-way (time or memory); later pages were not read.
  incomplete: boolean;
  text: string;
  images: PdfImage[];
}

// pdf.js decodes every image of a page while building its operator list, so a
// small file of highly compressed images can exhaust memory. Each image, and the
// total declared across the file, is bounded before decoding starts.
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_TOTAL_IMAGE_PIXELS = 48_000_000;
const MAX_TEXT_CHARS = 20_000;

// Image dictionaries are never inside object streams, so they are visible in the
// raw file. Names may hide letters as #xx escapes, so those are decoded first.
// The largest size anywhere between "obj" and "stream" counts (padding or a
// decoy comment cannot hide the real one); indirect or missing sizes count as
// the per-image maximum.
export function declaredImagePixels(raw: string): number {
  const text = raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const size = (dict: string, names: string) => {
    const values = [...dict.matchAll(new RegExp(`/(?:${names})\\s*(\\d+(?:\\.\\d*)?)(?![\\d.]|\\s+\\d+\\s+R)`, "g"))].map(match => Number(match[1]));
    return values.length ? Math.max(...values) : null;
  };
  let total = 0;
  for (const match of text.matchAll(/\/Subtype\s*\/Image\b/g)) {
    const start = Math.max(text.lastIndexOf("obj", match.index), 0), end = text.indexOf("stream", match.index);
    const dict = text.slice(start, end > match.index ? end : match.index + 4096);
    const width = size(dict, "Width|W"), height = size(dict, "Height|H");
    const pixels = width !== null && height !== null ? width * height : MAX_IMAGE_PIXELS;
    // pdf.js skips images above maxImageSize without decoding them.
    total += Math.min(pixels, MAX_IMAGE_PIXELS);
    if (total > MAX_TOTAL_IMAGE_PIXELS) break;
  }
  return total;
}

// pdf.js decodes a DCT stream at the size in its own frame header, whatever the
// image dictionary says, so visible JPEG frames are checked too.
export function largestJpegFrame(bytes: Buffer): number {
  let largest = 0, seen = 0;
  for (let at = bytes.indexOf("\xff\xd8\xff", 0, "latin1"); at >= 0 && seen < 200; at = bytes.indexOf("\xff\xd8\xff", at + 3, "latin1"), seen++) {
    let i = at + 2;
    while (i + 9 <= bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        largest = Math.max(largest, bytes.readUInt16BE(i + 5) * bytes.readUInt16BE(i + 7));
        break;
      }
      if (marker === 0xda || marker === 0xd9) break;
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return largest;
}

// A linearized ("fast web view") file has a second %%EOF from birth. Its /L is
// the file length, so a later incremental save breaks the match (pdf.js's test).
export function isLinearized(raw: string, length: number): boolean {
  const dict = /\/Linearized\b[^>]*>>/.exec(raw.slice(0, 2048))?.[0];
  return !!dict && Number(/\/L\s+(\d+)/.exec(dict)?.[1]) === length;
}

export function countOccurrences(bytes: Buffer, needle: string): number {
  let count = 0;
  for (let at = bytes.indexOf(needle, 0, "latin1"); at >= 0; at = bytes.indexOf(needle, at + needle.length, "latin1")) count += 1;
  return count;
}

export function signatureCoverage(bytes: Buffer): { count: number; bytesAfter: number } {
  const ranges = [...bytes.toString("latin1").matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  if (!ranges.length) return { count: 0, bytesAfter: 0 };
  const covered = Math.max(...ranges.map(match => Number(match[3]) + Number(match[4])));
  // Trailing whitespace after %%EOF is harmless.
  const tail = bytes.subarray(Math.min(covered, bytes.length)).toString("latin1").replace(/\s+/g, "");
  return { count: ranges.length, bytesAfter: tail.length };
}

// e-Aadhaar PDFs are locked with the first four letters of the name (capitals)
// followed by the year of birth.
export function eAadhaarPasswords(reporterName: string | null | undefined): string[] {
  const letters = String(reporterName ?? "").normalize("NFKD").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
  if (letters.length < 1) return [];
  const thisYear = new Date().getFullYear();
  return Array.from({ length: thisYear - 1900 + 1 }, (_, i) => `${letters}${thisYear - i}`);
}

function toRaw(image: any): RawImage | null {
  if (!image?.data || !image.width || !image.height) return null;
  const pixels = image.width * image.height;
  const source: Uint8Array = image.data;
  if (image.kind === 1) {
    // 1 bit per pixel, rows padded to whole bytes.
    const out = Buffer.alloc(pixels), rowBytes = Math.ceil(image.width / 8);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      out[y * image.width + x] = source[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0;
    }
    return { data: out, width: image.width, height: image.height, channels: 1 };
  }
  const channels = image.kind === 3 ? 4 : 3;
  if (source.length < pixels * channels) return null;
  return { data: Buffer.from(source.buffer, source.byteOffset, pixels * channels), width: image.width, height: image.height, channels };
}

function objectData(objs: any, id: string, ms: number): Promise<any> {
  return withTimeout("pdf image", ms, () => new Promise(resolve => {
    try { objs.get(id, resolve); } catch { resolve(null); }
  })).catch(() => null);
}

export interface PdfOptions { reporterName?: string | null; timeoutMs: number; maxPages?: number }
type Progress = (partial: PdfAnalysis, pageImages: PdfImage[]) => void;

// Runs on the calling thread, where a timer cannot interrupt pdf.js; screening
// goes through analysePdf, which hosts this in a worker it can stop.
export async function analysePdfInThread(bytes: Buffer, options: PdfOptions, onProgress?: Progress): Promise<PdfAnalysis> {
  const raw = bytes.toString("latin1");
  const coverage = signatureCoverage(bytes);
  const result: PdfAnalysis = {
    opened: false, encrypted: /\/Encrypt\s/.test(raw), passwordProtected: false, unlockedWithDerivedPassword: false,
    pageCount: null, producer: null, creator: null, creationDate: null, modDate: null,
    eofCount: countOccurrences(bytes, "%%EOF"), signatureCount: coverage.count, bytesAfterSignature: coverage.bytesAfter,
    linearized: isLinearized(raw, bytes.length),
    imagesSkipped: declaredImagePixels(raw) > MAX_TOTAL_IMAGE_PIXELS || largestJpegFrame(bytes) > MAX_IMAGE_PIXELS, incomplete: false,
    text: "", images: [],
  };
  const lib = await loadPdfJs();
  const dir = packageDir("pdfjs-dist") ?? "";
  const candidates = eAadhaarPasswords(options.reporterName);
  const task = lib.getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false, stopAtErrors: false, maxImageSize: MAX_IMAGE_PIXELS,
    cMapUrl: join(dir, "cmaps") + "/", cMapPacked: true, standardFontDataUrl: join(dir, "standard_fonts") + "/",
  });
  let tried = 0;
  task.onPassword = (update: (password: string) => void) => {
    result.passwordProtected = true;
    if (tried < candidates.length) update(candidates[tried++]);
    else void task.destroy();
  };
  const deadline = Date.now() + options.timeoutMs;
  const left = () => Math.max(1, deadline - Date.now());
  try {
    await withTimeout("pdf", options.timeoutMs, async () => {
      const doc = await task.promise;
      result.opened = true;
      result.unlockedWithDerivedPassword = result.passwordProtected;
      result.pageCount = doc.numPages;
      const meta = await doc.getMetadata().catch(() => null);
      const info = meta?.info ?? {};
      result.producer = typeof info.Producer === "string" ? info.Producer : null;
      result.creator = typeof info.Creator === "string" ? info.Creator : null;
      result.creationDate = typeof info.CreationDate === "string" ? info.CreationDate : null;
      result.modDate = typeof info.ModDate === "string" ? info.ModDate : null;
      if (info.IsSignaturesPresent && !result.signatureCount) result.signatureCount = 1;
      const texts: string[] = [];
      const joinTexts = () => texts.join("\n").replace(/[ \t]+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
      onProgress?.({ ...result, images: [] }, []);
      for (let number = 1; number <= Math.min(doc.numPages, options.maxPages ?? 3); number++) {
        const page = await doc.getPage(number);
        const content = await page.getTextContent().catch(() => null);
        if (content) texts.push(content.items.map((item: any) => item.str ?? "").join(" ").slice(0, MAX_TEXT_CHARS));
        if (result.imagesSkipped) { page.cleanup(); onProgress?.({ ...result, text: joinTexts(), images: [] }, []); continue; }
        const ops = await page.getOperatorList();
        const seen = new Map<string, PdfImage>();
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          let image: any = null, key = "";
          if (fn === lib.OPS.paintImageXObject) {
            key = String(ops.argsArray[i][0]);
            const known = seen.get(key);
            if (known) { known.uses += 1; continue; }
            image = await objectData(key.startsWith("g_") ? page.commonObjs : page.objs, key, Math.min(3000, left()));
          } else if (fn === lib.OPS.paintInlineImageXObject) {
            key = `inline-${i}`;
            image = ops.argsArray[i][0];
          }
          const decoded = image ? toRaw(image) : null;
          if (decoded && decoded.width * decoded.height >= 2500) seen.set(key, { ...decoded, page: number, uses: 1 });
        }
        result.images.push(...seen.values());
        page.cleanup();
        onProgress?.({ ...result, text: joinTexts(), images: [] }, [...seen.values()]);
      }
      result.text = joinTexts();
      await doc.destroy();
    }, () => { void task.destroy(); });
  } catch (err) {
    void task.destroy();
    if (!result.opened && result.passwordProtected) return result;
    if (!result.opened) throw err;
  }
  return result;
}

// pdf.js runs on whichever thread calls it and never yields to timers, so a
// small file whose page content inflates to millions of operators would run
// past every deadline and exhaust memory. A worker can be stopped mid-parse,
// and its heap cap turns that blow-up into an error instead of an instance crash.
const WORKER_FILE = join(__dirname, "pdfWorker.js");
const WORKER_HEAP_MB = 512;
// The heap cap does not cover decoded stream buffers, so the process's own
// growth is watched as well; the 2 GiB instance must keep room for the rest.
const WORKER_GROWTH_BYTES = 768 * 1024 * 1024;

export type PdfWorkerMessage =
  | { type: "progress"; partial: PdfAnalysis; images: PdfImage[] }
  | { type: "done"; result: PdfAnalysis }
  | { type: "error"; name: string };

export function analysePdf(bytes: Buffer, options: PdfOptions): Promise<PdfAnalysis> {
  if (!existsSync(WORKER_FILE)) return analysePdfInThread(bytes, options);
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, { workerData: { bytes: new Uint8Array(bytes), options },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
    let partial: PdfAnalysis | null = null, settled = false;
    const images: PdfImage[] = [];
    // A document that opened keeps what was read before the stop, as in-thread.
    const stop = (failure: Error) => {
      if (partial?.opened || partial?.passwordProtected) resolve({ ...partial, images, incomplete: true });
      else reject(failure);
    };
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      void worker.terminate().catch(() => undefined);
      settle();
    };
    const timer = setTimeout(() => finish(() => stop(new StepTimeout("pdf"))), options.timeoutMs + 500);
    const baseline = process.memoryUsage.rss();
    const watchdog = setInterval(() => {
      if (process.memoryUsage.rss() - baseline > WORKER_GROWTH_BYTES) finish(() => stop(Object.assign(new Error("PDF used too much memory"), { name: "PdfTooComplex" })));
    }, 50);
    worker.on("message", (message: PdfWorkerMessage) => {
      if (message.type === "progress") {
        partial = message.partial;
        for (const image of message.images) images.push({ ...image, data: Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength) });
      } else if (message.type === "done") finish(() => resolve({ ...message.result, images }));
      else finish(() => reject(Object.assign(new Error("PDF analysis failed"), { name: message.name })));
    });
    worker.on("error", (err: Error & { code?: string }) => finish(() => stop(Object.assign(new Error("PDF analysis failed"),
      { name: err.code === "ERR_WORKER_OUT_OF_MEMORY" ? "PdfTooComplex" : errorName(err) }))));
    worker.on("exit", () => finish(() => stop(Object.assign(new Error("PDF worker stopped"), { name: "PdfTooComplex" }))));
  });
}
