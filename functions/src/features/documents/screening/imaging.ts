import sharp, { type Sharp } from "sharp";

export interface RawImage { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 }

// Bounds decoder memory: 6 MiB of PNG can otherwise expand to gigapixels.
export const PIXEL_LIMIT = 60_000_000;

export function openImage(input: Buffer | RawImage): Sharp {
  if (Buffer.isBuffer(input)) return sharp(input, { limitInputPixels: PIXEL_LIMIT, failOn: "error" }).rotate();
  return sharp(input.data, { raw: { width: input.width, height: input.height, channels: input.channels }, limitInputPixels: PIXEL_LIMIT });
}

export async function toRgba(input: Buffer | RawImage, maxSide: number): Promise<RawImage> {
  const { data, info } = await openImage(input)
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: 4 };
}

// Difference hash: 9x8 greyscale thumbnail, one bit per horizontal neighbour pair.
// Survives resizing and re-compression; any edit that moves content flips bits.
export async function dHash(input: Buffer | RawImage): Promise<string> {
  const pixels = await openImage(input).greyscale().resize(9, 8, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export function dHashBands(hash: string): string[] {
  return Array.from({ length: 8 }, (_, i) => `${i}:${hash.slice(i * 2, i * 2 + 2)}`);
}

export function hammingHex(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff) { count += Number(diff & 1n); diff >>= 1n; }
  return count;
}

// Laplacian variance on a fixed-size greyscale copy; low values mean few sharp edges.
export async function sharpness(input: Buffer | RawImage): Promise<number> {
  const { data } = await openImage(input)
    .greyscale()
    .resize({ width: 1000, height: 1000, fit: "inside" })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0, squares = 0;
  for (const value of data) { const v = value - 128; sum += v; squares += v * v; }
  const mean = sum / data.length;
  return squares / data.length - mean * mean;
}

export interface ElaResult { heatmap: Buffer; localised: boolean; peakRatio: number; meanError: number }

// Error level analysis: regions pasted from another source, or re-saved at a
// different quality, recompress differently from the rest of the image.
export async function errorLevelAnalysis(input: Buffer | RawImage): Promise<ElaResult> {
  const base = await openImage(input).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  const resaved = await sharp(await sharp(base.data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer())
    .removeAlpha().raw().toBuffer();
  const diff = Buffer.alloc(width * height * 3);
  const grid = 16, cellsX = Math.ceil(width / grid), cellsY = Math.ceil(height / grid);
  const cellSum = new Float64Array(cellsX * cellsY), cellCount = new Uint32Array(cellsX * cellsY);
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const error = Math.max(Math.abs(base.data[i] - resaved[i]), Math.abs(base.data[i + 1] - resaved[i + 1]), Math.abs(base.data[i + 2] - resaved[i + 2]));
      const amplified = Math.min(255, error * 15);
      diff[i] = amplified; diff[i + 1] = Math.min(255, amplified * 0.6); diff[i + 2] = Math.max(0, 80 - amplified);
      const cell = Math.floor(y / grid) * cellsX + Math.floor(x / grid);
      cellSum[cell] += error; cellCount[cell] += 1; total += error;
    }
  }
  const means = Array.from(cellSum, (sum, i) => sum / Math.max(1, cellCount[i])).sort((a, b) => a - b);
  const median = means[Math.floor(means.length / 2)] ?? 0;
  const top = means.slice(Math.floor(means.length * 0.98));
  const peak = top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
  const peakRatio = peak / (median + 0.5);
  const hot = means.filter(mean => mean > (median + 0.5) * 4 && mean > 4).length;
  const heatmap = await sharp(diff, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
  // Localised: a few cells far above the typical level, not uniformly noisy.
  return { heatmap, localised: hot > 0 && hot <= means.length * 0.06 && peakRatio > 6, peakRatio, meanError: total / (width * height) };
}

// --- JPEG structure -------------------------------------------------------------

const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const STD_CHROMA = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...Array(32).fill(99)];
// Quantisation tables are stored in zig-zag order.
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

export interface JpegStructure {
  tables: Map<number, number[]>;
  appSegments: string[];
  frames: number;
}

export function readJpegStructure(bytes: Buffer): JpegStructure {
  const tables = new Map<number, number[]>();
  const appSegments: string[] = [];
  let frames = 0;
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
    const length = bytes.readUInt16BE(i + 2);
    const body = bytes.subarray(i + 4, i + 2 + length);
    if (marker === 0xdb) {
      let p = 0;
      while (p < body.length) {
        const precision = body[p] >> 4, id = body[p] & 15;
        const values: number[] = Array.from({ length: 64 }, () => 0);
        for (let k = 0; k < 64; k++) values[ZIGZAG[k]] = precision ? body.readUInt16BE(p + 1 + k * 2) : body[p + 1 + k];
        tables.set(id, values);
        p += 1 + 64 * (precision ? 2 : 1);
      }
    } else if (marker >= 0xe0 && marker <= 0xef) {
      appSegments.push(`APP${marker - 0xe0}:${body.subarray(0, 14).toString("latin1").replace(/\0.*$/s, "")}`);
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      frames += 1;
    }
    if (marker === 0xda) break; // entropy-coded data follows
    i += 2 + length;
  }
  return { tables, appSegments, frames };
}

function ijgTable(standard: number[], quality: number): number[] {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  return standard.map(value => Math.min(255, Math.max(1, Math.floor((value * scale + 50) / 100))));
}

export interface QualityEstimate { quality: number; standard: boolean; lumaQuality: number; chromaQuality: number | null }

// Finds the IJG (libjpeg) quality whose scaled table is closest; an exact hit
// means a standard encoder, a poor fit means camera- or editor-specific tables.
export function estimateJpegQuality(tables: Map<number, number[]>): QualityEstimate | null {
  const luma = tables.get(0);
  if (!luma) return null;
  const best = (table: number[], standard: number[]) => {
    let bestQuality = 50, bestError = Infinity;
    for (let q = 1; q <= 100; q++) {
      const candidate = ijgTable(standard, q);
      const error = table.reduce((sum, value, k) => sum + Math.abs(value - candidate[k]), 0);
      if (error < bestError) { bestError = error; bestQuality = q; }
    }
    return { quality: bestQuality, error: bestError };
  };
  const lumaFit = best(luma, STD_LUMA);
  const chroma = tables.get(1);
  const chromaFit = chroma ? best(chroma, STD_CHROMA) : null;
  return {
    quality: lumaFit.quality,
    standard: lumaFit.error === 0 && (!chromaFit || chromaFit.error === 0),
    lumaQuality: lumaFit.quality,
    chromaQuality: chromaFit?.quality ?? null,
  };
}
