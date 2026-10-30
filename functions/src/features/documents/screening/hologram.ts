import { openImage } from "./imaging";
import { errorName, StepTimeout, withTimeout } from "./runtime";

export type HologramVerdict = { result: "pass" | "warn" | "unavailable"; detail: string };

export interface HologramStats {
  // Normalised cross-correlation of the aligned fine structure (text, edges, borders), -1 to 1.
  alignment: number;
  // Grid cells of the card photo that the tilted photo covers once aligned.
  cells: number;
  // Covered cells whose colour or brightness moved well beyond the photo-wide change.
  shiftedCells: number;
  // Largest group of edge-adjacent shifted cells.
  largestCluster: number;
  // Strongest residual shift of one cell, on the 0–255 scale, and the share of it
  // that is colour rather than brightness (0–1).
  peakShift: number;
  colourShare: number;
  samePicture: boolean;
}

// Both photos are compared at this long side; a hologram still spans a few cells.
const WORK = 192;
const COARSE = 4;
const MIN_SIDE = 160;
const GRID_LONG = 16, GRID_SHORT = 10;
// Coarse alignment: scale, foreshortening from the tilt, and a quarter-frame shift.
const SCALES = [0.6, 0.67, 0.74, 0.82, 0.9, 1, 1.1, 1.22, 1.35, 1.5, 1.67];
const ASPECTS = [0.88, 1, 1.13];
const SHIFT_RANGE = 0.25;
// Refinement spans half the gap between neighbouring coarse scales and aspects.
const CANDIDATES = 6;
const REFINE = [0.94, 0.97, 1, 1.03, 1.06];
const MIN_COVERAGE = 0.5;
// Each cell may slide this many pixels on its own: tilt is perspective, not a pure scale.
const LOCAL = 3;
// Unrelated photos correlate near 0; the same card, coarsely aligned, well above this.
const MIN_ALIGNMENT = 0.3;
const MIN_CELLS = (GRID_LONG * GRID_SHORT) / 2;
// Residual shifts below this are JPEG noise and leftover misalignment.
const MIN_SHIFT = 12;
const OVER_MEDIAN = 3;
// A shift over more of the card than this is lighting or a different card, not a hologram.
const MAX_SHIFTED_SHARE = 0.3;
// Glare brightens a glossy card anywhere; colour change is the hologram's own sign.
const LIGHT_WEIGHT = 0.5;

const MESSAGES = {
  unaligned: "The tilted photo could not be lined up with the card photo. Photograph the same side of the card in both, filling most of the frame.",
  small: "One of the photos is too small to compare.",
  same: "The tilted photo is the same picture as the card photo, so no hologram shift can show.",
  none: "No colour or brightness shift between the two photos: the tilt may not have caught the hologram, or the card has none.",
  widespread: "The colour changed across most of the card rather than in one place (different lighting, or not the same card).",
  faint: "Only a faint, scattered change between the two photos; no clear hologram shift.",
};

export function judgeHologramShift(stats: HologramStats | null): HologramVerdict {
  if (!stats) return { result: "unavailable", detail: MESSAGES.small };
  if (stats.samePicture) return { result: "warn", detail: MESSAGES.same };
  if (stats.alignment < MIN_ALIGNMENT || stats.cells < MIN_CELLS) return { result: "unavailable", detail: MESSAGES.unaligned };
  if (stats.shiftedCells === 0 || stats.peakShift < MIN_SHIFT) return { result: "warn", detail: MESSAGES.none };
  if (stats.shiftedCells / stats.cells > MAX_SHIFTED_SHARE) return { result: "warn", detail: MESSAGES.widespread };
  if (stats.largestCluster < 2 && stats.peakShift < MIN_SHIFT * 2) return { result: "warn", detail: MESSAGES.faint };
  const where = `${stats.shiftedCells} of ${stats.cells} areas`;
  return stats.colourShare >= 0.5
    ? { result: "pass", detail: `A localised colour shift appears in the tilted photo, as a hologram gives (${where}).` }
    : { result: "pass", detail: `A localised brightness shift appears in the tilted photo (${where}); it is mostly brightness, which glare can also cause.` };
}

// The aadhaar_angle photo is the same card tilted so the hologram or ghost image
// changes colour. Never "fail": a missing shift is as likely a poor tilt as a fake.
export async function checkHologram(angle: Buffer, card: Buffer, deadline: number): Promise<HologramVerdict> {
  if (isPdf(card)) return { result: "unavailable", detail: "The Aadhaar upload is a PDF; the tilted photo can only be compared with a photo of the card." };
  if (isPdf(angle)) return { result: "unavailable", detail: "The tilted upload is a PDF, not a photo." };
  try {
    return judgeHologramShift(await withTimeout("hologram", deadline - Date.now(), () => measureHologram(angle, card, deadline)));
  } catch (err) {
    if (err instanceof StepTimeout) return { result: "unavailable", detail: "The hologram comparison ran out of time." };
    console.warn("Document screening step failed", { step: "hologram", error: errorName(err) });
    return { result: "unavailable", detail: "The photos could not be read for the hologram comparison." };
  }
}

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 1024).indexOf("%PDF-", 0, "latin1") >= 0;
}

interface Plane { data: Float32Array; width: number; height: number }
// rgb is interleaved and lightly blurred, so single misaligned pixels do not read as shifts.
interface Picture { rgb: Float32Array; grey: Plane }
interface Fit { sx: number; sy: number; dx: number; dy: number; score: number }
interface Cell {
  gx: number; gy: number;
  // [card pixel, warped pixel] index pairs at the cell's own best offset.
  pixels: Array<[number, number]>;
  // Cell centre, -0.5 to 0.5 across the card photo.
  u: number; v: number;
  card: number[]; angle: number[];
}

const NO_STATS = { shiftedCells: 0, largestCluster: 0, peakShift: 0, colourShare: 0, samePicture: false };

export async function measureHologram(angleBytes: Buffer, cardBytes: Buffer, deadline: number): Promise<HologramStats | null> {
  const tick = () => { if (Date.now() > deadline) throw new StepTimeout("hologram"); };
  const [angle, card] = await Promise.all([load(angleBytes), load(cardBytes)]);
  if (!angle || !card) return null;
  tick();

  // Band-passed grey keeps text and edges and drops lighting, which the tilt changes.
  const cardBand = bandPass(card.grey, 1, 5), angleBand = bandPass(angle.grey, 1, 5);
  const cardCoarse = bandPass(shrink(card.grey, COARSE), 0.8, 3), angleCoarse = bandPass(shrink(angle.grey, COARSE), 0.8, 3);
  const rangeX = Math.round(angleCoarse.width * SHIFT_RANGE), rangeY = Math.round(angleCoarse.height * SHIFT_RANGE);
  const coarseFits: Fit[] = [];
  for (const scale of SCALES) {
    for (const aspect of ASPECTS) {
      tick();
      let fit: Fit | null = null;
      for (let dy = -rangeY; dy <= rangeY; dy++) for (let dx = -rangeX; dx <= rangeX; dx++) {
        const score = correlate(cardCoarse, angleCoarse, scale, scale * aspect, dx, dy, 1);
        if (score !== null && (!fit || score > fit.score)) fit = { sx: scale, sy: scale * aspect, dx, dy, score };
      }
      if (fit) coarseFits.push(fit);
    }
  }
  if (!coarseFits.length) return { alignment: 0, cells: 0, ...NO_STATS };
  // Text lines repeat and barely constrain the horizontal scale at the coarse
  // size, so the top coarse score is not always the true fit: refine several.
  coarseFits.sort((a, b) => b.score - a.score);
  let best: Fit = { ...coarseFits[0], score: -Infinity };
  for (const coarse of coarseFits.slice(0, CANDIDATES)) {
    for (const fx of REFINE) for (const fy of REFINE) {
      tick();
      for (let dy = -COARSE; dy <= COARSE; dy++) for (let dx = -COARSE; dx <= COARSE; dx++) {
        const candidate = { sx: coarse.sx * fx, sy: coarse.sy * fy, dx: coarse.dx * COARSE + dx, dy: coarse.dy * COARSE + dy };
        const score = correlate(cardBand, angleBand, candidate.sx, candidate.sy, candidate.dx, candidate.dy, 2);
        if (score !== null && score > best.score) best = { ...candidate, score };
      }
    }
  }
  const alignment = correlate(cardBand, angleBand, best.sx, best.sy, best.dx, best.dy, 1) ?? 0;
  tick();

  // The tilted photo resampled into the card photo's frame, with a margin for the per-cell slide.
  const { width, height } = card.grey;
  const W = width + LOCAL * 2, H = height + LOCAL * 2;
  const warpedRgb = new Float32Array(W * H * 3), warpedBand = new Float32Array(W * H), covered = new Uint8Array(W * H);
  const aw = angle.grey.width, ah = angle.grey.height;
  const ax = aw / 2 + best.dx, ay = ah / 2 + best.dy;
  for (let ey = 0; ey < H; ey++) {
    const v = (ey - LOCAL - height / 2) * best.sy + ay;
    if (v < 0 || v > ah - 1) continue;
    const v0 = Math.min(ah - 2, Math.floor(v)), fv = v - v0;
    for (let ex = 0; ex < W; ex++) {
      const u = (ex - LOCAL - width / 2) * best.sx + ax;
      if (u < 0 || u > aw - 1) continue;
      const u0 = Math.min(aw - 2, Math.floor(u)), fu = u - u0;
      const at = ey * W + ex;
      const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
      const p00 = v0 * aw + u0, p10 = p00 + 1, p01 = p00 + aw, p11 = p01 + 1;
      warpedBand[at] = angleBand.data[p00] * w00 + angleBand.data[p10] * w10 + angleBand.data[p01] * w01 + angleBand.data[p11] * w11;
      for (let c = 0; c < 3; c++) {
        warpedRgb[at * 3 + c] = angle.rgb[p00 * 3 + c] * w00 + angle.rgb[p10 * 3 + c] * w10 + angle.rgb[p01 * 3 + c] * w01 + angle.rgb[p11 * 3 + c] * w11;
      }
      covered[at] = 1;
    }
  }
  tick();

  // Per cell: slide locally to the best structural match, then compare colour there.
  const gridX = width >= height ? GRID_LONG : GRID_SHORT, gridY = width >= height ? GRID_SHORT : GRID_LONG;
  const cells: Cell[] = [];
  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      const x0 = Math.floor((gx * width) / gridX), x1 = Math.floor(((gx + 1) * width) / gridX);
      const y0 = Math.floor((gy * height) / gridY), y1 = Math.floor(((gy + 1) * height) / gridY);
      const area = (x1 - x0) * (y1 - y0);
      let offset = -1, bestCost = Infinity;
      for (let oy = -LOCAL; oy <= LOCAL; oy++) for (let ox = -LOCAL; ox <= LOCAL; ox++) {
        const slide = (oy + LOCAL) * W + ox + LOCAL;
        let cost = 0, count = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const at = y * W + x + slide;
          if (!covered[at]) continue;
          cost += Math.abs(cardBand.data[y * width + x] - warpedBand[at]);
          count++;
        }
        if (count >= area * 0.9 && cost / count < bestCost) { bestCost = cost / count; offset = slide; }
      }
      if (offset < 0) continue;
      const pixels: Array<[number, number]> = [];
      const cardMean = [0, 0, 0], angleMean = [0, 0, 0];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const at = y * W + x + offset, own = y * width + x;
        if (!covered[at]) continue;
        pixels.push([own, at]);
        for (let c = 0; c < 3; c++) { cardMean[c] += card.rgb[own * 3 + c]; angleMean[c] += warpedRgb[at * 3 + c]; }
      }
      cells.push({
        gx, gy, pixels, u: (x0 + x1) / 2 / width - 0.5, v: (y0 + y1) / 2 / height - 0.5,
        card: cardMean.map(sum => sum / pixels.length), angle: angleMean.map(sum => sum / pixels.length),
      });
    }
  }
  if (cells.length < MIN_CELLS) return { alignment, cells: cells.length, ...NO_STATS };
  tick();

  // Exposure, white balance and the light falling across a tilted card differ
  // between any two photos: fit per channel a gain, an offset and a linear
  // gradient, then refit without the worst quarter so the hologram does not skew it.
  let fits = [0, 1, 2].map(c => fitChannel(cells, c, cells.map(() => true)));
  const expected = (cell: Cell, c: number, value: number) => fits[c][0] * value + fits[c][1] + fits[c][2] * cell.u + fits[c][3] * cell.v;
  const errors = cells.map(cell => [0, 1, 2].reduce((sum, c) => sum + (cell.card[c] - expected(cell, c, cell.angle[c])) ** 2, 0));
  const cut = [...errors].sort((a, b) => a - b)[Math.floor(errors.length * 0.75)];
  fits = [0, 1, 2].map(c => fitChannel(cells, c, errors.map(error => error <= cut)));

  // A hologram's colours vary across it, so cell means would cancel out: each
  // pixel's shift counts on its own, and the cell's median ignores the few
  // pixels along a slightly misaligned edge.
  const shifts = cells.map(cell => {
    const values: number[] = [];
    let colourSum = 0, lightSum = 0;
    for (const [own, at] of cell.pixels) {
      const dr = card.rgb[own * 3] - expected(cell, 0, warpedRgb[at * 3]);
      const dg = card.rgb[own * 3 + 1] - expected(cell, 1, warpedRgb[at * 3 + 1]);
      const db = card.rgb[own * 3 + 2] - expected(cell, 2, warpedRgb[at * 3 + 2]);
      const light = (LIGHT_WEIGHT * Math.abs(dr + dg + db)) / 3, colour = Math.hypot((dr - dg) / 2, (dr + dg - 2 * db) / 4);
      values.push(Math.hypot(colour, light));
      colourSum += colour * colour; lightSum += light * light;
    }
    values.sort((a, b) => a - b);
    return { shift: values[Math.floor(values.length / 2)], colourShare: colourSum / Math.max(1e-9, colourSum + lightSum) };
  });
  const sorted = shifts.map(item => item.shift).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(MIN_SHIFT, median * OVER_MEDIAN);
  const shifted = new Set<number>();
  cells.forEach((cell, i) => { if (shifts[i].shift >= threshold) shifted.add(cell.gy * gridX + cell.gx); });
  const peak = shifts.reduce((top, item) => (item.shift > top.shift ? item : top), shifts[0]);
  return {
    alignment, cells: cells.length, shiftedCells: shifted.size, largestCluster: largestCluster(shifted, gridX),
    peakShift: peak.shift, colourShare: peak.colourShare,
    samePicture: angleBytes.equals(cardBytes) || (alignment > 0.97 && median < 1),
  };
}

async function load(bytes: Buffer): Promise<Picture | null> {
  const meta = await openImage(bytes).metadata();
  if (Math.min(meta.width ?? 0, meta.height ?? 0) < MIN_SIDE) return null;
  const { data, info } = await openImage(bytes).removeAlpha().toColourspace("srgb")
    .resize({ width: WORK, height: WORK, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const pixels = width * height;
  const planes = [0, 1, 2].map(() => new Float32Array(pixels)), grey = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) planes[c][i] = data[i * channels + Math.min(c, channels - 1)];
    grey[i] = 0.299 * planes[0][i] + 0.587 * planes[1][i] + 0.114 * planes[2][i];
  }
  const soft = planes.map(plane => blur({ data: plane, width, height }, 1).data);
  const rgb = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = soft[c][i];
  return { rgb, grey: { data: grey, width, height } };
}

// Maps card pixel (x, y) to the tilted photo at ((x - cx)·sx + ax + dx, (y - cy)·sy + ay + dy).
function correlate(card: Plane, angle: Plane, sx: number, sy: number, dx: number, dy: number, step: number): number | null {
  const cx = card.width / 2, cy = card.height / 2, ax = angle.width / 2 + dx, ay = angle.height / 2 + dy;
  let n = 0, total = 0, sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
  for (let y = 0; y < card.height; y += step) {
    const v = Math.round((y - cy) * sy + ay);
    const inside = v >= 0 && v < angle.height;
    for (let x = 0; x < card.width; x += step) {
      total++;
      if (!inside) continue;
      const u = Math.round((x - cx) * sx + ax);
      if (u < 0 || u >= angle.width) continue;
      const a = card.data[y * card.width + x], b = angle.data[v * angle.width + u];
      n++; sa += a; sb += b; sab += a * b; saa += a * a; sbb += b * b;
    }
  }
  if (n < total * MIN_COVERAGE) return null;
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : null;
}

function blur(plane: Plane, sigma: number): Plane {
  const { data, width, height } = plane;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k++) total += kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
  for (let k = 0; k < kernel.length; k++) kernel[k] /= total;
  const across = new Float32Array(data.length), out = new Float32Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += kernel[k + radius] * data[y * width + Math.min(width - 1, Math.max(0, x + k))];
    across[y * width + x] = sum;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += kernel[k + radius] * across[Math.min(height - 1, Math.max(0, y + k)) * width + x];
    out[y * width + x] = sum;
  }
  return { data: out, width, height };
}

function bandPass(plane: Plane, fine: number, wide: number): Plane {
  const detail = blur(plane, fine), soft = blur(plane, wide);
  for (let i = 0; i < detail.data.length; i++) detail.data[i] -= soft.data[i];
  return detail;
}

function shrink(plane: Plane, factor: number): Plane {
  const width = Math.max(1, Math.floor(plane.width / factor)), height = Math.max(1, Math.floor(plane.height / factor));
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) for (let i = 0; i < factor; i++) sum += plane.data[(y * factor + j) * plane.width + x * factor + i];
    data[y * width + x] = sum / (factor * factor);
  }
  return { data, width, height };
}

// Least squares card = gain·angle + offset + gu·u + gv·v over the kept cells.
function fitChannel(cells: Cell[], c: number, keep: boolean[]): number[] {
  const normal = Array.from({ length: 4 }, () => [0, 0, 0, 0, 0]);
  cells.forEach((cell, i) => {
    if (!keep[i]) return;
    const row = [cell.angle[c], 1, cell.u, cell.v];
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) normal[a][b] += row[a] * row[b];
      normal[a][4] += row[a] * cell.card[c];
    }
  });
  const solved = solve(normal);
  // A flat channel or a degenerate fit keeps the photos' own scale.
  if (!solved || !(solved[0] >= 0.25 && solved[0] <= 4)) {
    let sum = 0, n = 0;
    cells.forEach((cell, i) => { if (keep[i]) { sum += cell.card[c] - cell.angle[c]; n++; } });
    return [1, n ? sum / n : 0, 0, 0];
  }
  return solved;
}

// Gauss–Jordan elimination with partial pivoting on an augmented n×(n+1) matrix.
function solve(matrix: number[][]): number[] | null {
  const n = matrix.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    if (Math.abs(matrix[pivot][col]) < 1e-9) return null;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = matrix[row][col] / matrix[col][col];
      for (let k = col; k <= n; k++) matrix[row][k] -= factor * matrix[col][k];
    }
  }
  const result = matrix.map((row, i) => row[n] / row[i]);
  return result.every(Number.isFinite) ? result : null;
}

function largestCluster(cells: Set<number>, gridX: number): number {
  const seen = new Set<number>();
  let largest = 0;
  for (const start of cells) {
    if (seen.has(start)) continue;
    let size = 0;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const at = queue.pop() as number;
      size++;
      const x = at % gridX;
      for (const next of [at - gridX, at + gridX, x > 0 ? at - 1 : -1, x < gridX - 1 ? at + 1 : -1]) {
        if (next >= 0 && cells.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}
