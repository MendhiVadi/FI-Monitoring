import sharp from "sharp";
import { openImage, type RawImage } from "./imaging";
import { StepTimeout } from "./runtime";

export interface CopyMoveResult {
  suspicious: boolean;
  // Share of the image covered by the matched source and copy, 0–1.
  share: number;
  pairs: number;
  // Offset from a region to its copy, in pixels of the original image.
  shift: { dx: number; dy: number } | null;
  heatmap: Buffer;
}

// Analysis runs on a reduced, slightly blurred greyscale copy: the blur keeps
// recompression noise and resampling from breaking matches, and copies smaller
// than about 1% of the image are not looked for.
const MAX_SIDE = 512;
const BLUR_SIGMA = 1;
// A block is a 4×4 grid of 4×4-pixel cell means, described by the 15 AC
// coefficients of their DCT: without the DC term a copy pasted slightly
// brighter or darker still matches.
const CELL = 4;
const BLOCK = CELL * 4;
// Flat blocks (sky, paper, a plain wall) match everywhere and prove nothing.
const MIN_STD = 4;
// Blocks whose structure runs along one axis only (ruled lines, text lines seen
// from afar, a straight edge) match all along that axis.
const MIN_CROSS_SHARE = 0.12;
// Candidates share coarse bins of the two first-order coefficients and lie
// close on the diagonal one; a second set of bins offset by half a bin catches
// pairs split by a bin edge.
const BIN = 24;
const MAX_FINE_GAP = 6;
const MAX_SCAN = 48;
const MAX_DISTANCE = 7;
const RELATIVE_DISTANCE = 0.08;
// Overlapping or touching blocks of a smooth patch match trivially.
const MIN_PARTNER_SHIFT = BLOCK / 2;
const MIN_SHIFT = 24;
const MIN_PAIRS = 150;
const MAX_CANDIDATES = 16;
// Matched sources with several matched neighbours: a filled region, not a scatter.
const MIN_DENSE = 80;
const DENSE_NEIGHBOURS = 6;
// A copied block matches its copy and little else; a block of repeated texture
// (a grid, woven cloth, foliage) matches many blocks at many offsets.
const MIN_UNIQUENESS = 0.4;
// A word printed twice matches as well, but over a few strokes on plain paper;
// a pasted region carries at least this many edge pixels (gradient sum at
// least EDGE in the analysis copy).
const EDGE = 6;
const MIN_STRUCTURE = 1400;

// Orthonormal 4-point DCT basis.
const BASIS = Array.from({ length: 4 }, (_, u) => Array.from({ length: 4 }, (_, x) =>
  (u === 0 ? 0.5 : Math.SQRT1_2) * Math.cos(((2 * x + 1) * u * Math.PI) / 8)));
// AC coefficients, low frequencies first; the first three form the sort key.
const ZIGZAG: Array<[number, number]> = [[0, 1], [1, 0], [1, 1], [0, 2], [2, 0], [1, 2], [2, 1], [2, 2], [0, 3], [3, 0], [1, 3], [3, 1], [2, 3], [3, 2], [3, 3]];
const AC = ZIGZAG.length;
const INDEX_BITS = 2 ** 18;
const FINE_STEPS = 16384;

// Block matching after Fridrich et al.: blocks are sorted by their description
// so near-identical ones end up side by side, and a copy shows up as many
// pairs sharing one offset.
export async function detectCopyMove(input: Buffer | RawImage, deadline: number): Promise<CopyMoveResult | null> {
  const meta = await openImage(input).metadata();
  const { data: pixels, info } = await openImage(input).removeAlpha().greyscale()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true }).blur(BLUR_SIGMA)
    .raw().toBuffer({ resolveWithObject: true });
  const width = info.width, height = info.height, channels = info.channels;
  if (width < BLOCK * 4 || height < BLOCK * 4) return null;
  const grey = new Uint8Array(width * height);
  for (let i = 0; i < grey.length; i++) grey[i] = pixels[i * channels];
  const tick = () => { if (Date.now() > deadline) throw new StepTimeout("copy_move"); };

  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += grey[y * width + x];
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1] + row;
    }
  }
  const cellsX = width - CELL + 1, cellsY = height - CELL + 1;
  const cells = new Float32Array(cellsX * cellsY);
  for (let y = 0; y < cellsY; y++) for (let x = 0; x < cellsX; x++) {
    cells[y * cellsX + x] = (sum[(y + CELL) * stride + x + CELL] - sum[y * stride + x + CELL] - sum[(y + CELL) * stride + x] + sum[y * stride + x]) / (CELL * CELL);
  }
  tick();

  const blocksX = width - BLOCK + 1, blocksY = height - BLOCK + 1;
  const coefficients = new Float32Array(blocksX * blocksY * AC);
  const energies: number[] = [], positions: number[] = [];
  const grid = new Float64Array(16), rows = new Float64Array(16), full = new Float64Array(16);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) grid[i * 4 + j] = cells[(by + i * CELL) * cellsX + bx + j * CELL];
      // Separable DCT: along each row, then down each column.
      for (let i = 0; i < 4; i++) for (let v = 0; v < 4; v++) {
        rows[i * 4 + v] = BASIS[v][0] * grid[i * 4] + BASIS[v][1] * grid[i * 4 + 1] + BASIS[v][2] * grid[i * 4 + 2] + BASIS[v][3] * grid[i * 4 + 3];
      }
      let energy = 0, alongX = 0, alongY = 0;
      for (let u = 0; u < 4; u++) for (let v = 0; v < 4; v++) {
        const value = BASIS[u][0] * rows[v] + BASIS[u][1] * rows[4 + v] + BASIS[u][2] * rows[8 + v] + BASIS[u][3] * rows[12 + v];
        full[u * 4 + v] = value;
        if (u === 0 && v === 0) continue;
        energy += value * value;
        if (u === 0) alongX += value * value; else if (v === 0) alongY += value * value;
      }
      if (energy < MIN_STD * MIN_STD * 16 || (energy - Math.max(alongX, alongY)) < MIN_CROSS_SHARE * energy) continue;
      const at = positions.length * AC;
      for (let k = 0; k < AC; k++) coefficients[at + k] = full[ZIGZAG[k][0] * 4 + ZIGZAG[k][1]];
      positions.push(by * width + bx);
      energies.push(Math.sqrt(energy));
    }
    if (by % 32 === 0) tick();
  }
  const count = Math.min(positions.length, INDEX_BITS);

  const involved = new Uint16Array(count);
  const seen = new Set<number>();
  const pairsFrom: number[] = [], pairsTo: number[] = [], pairShift: number[] = [];
  const shifts = new Map<number, number>();
  const shiftKey = (dx: number, dy: number) => dx * 4096 + (dy + 2048);
  const coarse = (value: number, offset: number) => Math.max(0, Math.min(255, Math.floor((value + 2048 + offset) / BIN)));
  const order = new Float64Array(count), sortedBlock = new Int32Array(count), sortedGroup = new Int32Array(count), sortedFine = new Int32Array(count);
  for (const offset of [0, BIN / 2]) {
    for (let b = 0; b < count; b++) {
      const group = coarse(coefficients[b * AC], offset) * 256 + coarse(coefficients[b * AC + 1], offset);
      const fine = Math.max(0, Math.min(FINE_STEPS - 1, Math.round((coefficients[b * AC + 2] + 2048) * 4)));
      order[b] = (group * FINE_STEPS + fine) * INDEX_BITS + b;
    }
    order.sort();
    for (let i = 0; i < count; i++) {
      const head = Math.floor(order[i] / INDEX_BITS);
      sortedBlock[i] = order[i] - head * INDEX_BITS; sortedGroup[i] = Math.floor(head / FINE_STEPS); sortedFine[i] = head % FINE_STEPS;
    }
    tick();
    for (let i = 0; i < count; i++) {
      const a = sortedBlock[i], ax = positions[a] % width, ay = (positions[a] - ax) / width;
      const limit = (MAX_DISTANCE + RELATIVE_DISTANCE * energies[a]) ** 2;
      for (let j = i + 1; j < count && j <= i + MAX_SCAN; j++) {
        if (sortedGroup[j] !== sortedGroup[i] || sortedFine[j] - sortedFine[i] > MAX_FINE_GAP * 4) break;
        const b = sortedBlock[j];
        let distance = 0;
        for (let k = 0; k < AC && distance <= limit; k++) {
          const diff = coefficients[a * AC + k] - coefficients[b * AC + k];
          distance += diff * diff;
        }
        if (distance > limit) continue;
        const bx = positions[b] % width, by = (positions[b] - bx) / width;
        let from = a, to = b, dx = bx - ax, dy = by - ay;
        if (dx < 0 || (dx === 0 && dy < 0)) { from = b; to = a; dx = -dx; dy = -dy; }
        const reach = dx * dx + dy * dy;
        if (reach < MIN_PARTNER_SHIFT * MIN_PARTNER_SHIFT) continue;
        const pair = from * INDEX_BITS + to;
        if (seen.has(pair)) continue;
        seen.add(pair);
        involved[from] = Math.min(65535, involved[from] + 1); involved[to] = Math.min(65535, involved[to] + 1);
        if (reach < MIN_SHIFT * MIN_SHIFT) continue;
        const key = shiftKey(dx, dy);
        shifts.set(key, (shifts.get(key) ?? 0) + 1);
        pairsFrom.push(from); pairsTo.push(to); pairShift.push(key);
      }
      if (i % 4096 === 0) tick();
    }
  }

  // Edge pixels of the blurred copy: what a match is made of, as opposed to the
  // plain paper around a word that happens to be printed twice.
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    edges[i] = Math.abs(grey[i + 1] - grey[i - 1]) + Math.abs(grey[i + width] - grey[i - width]) >= EDGE ? 1 : 0;
  }
  // Offsets within a pixel of each other are one copy seen through resampling.
  const near = (dx: number, dy: number) => {
    let total = 0;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) total += shifts.get(shiftKey(dx + ox, dy + oy)) ?? 0;
    return total;
  };
  // The strongest offsets, each once: its ±1 neighbours are the same copy.
  const candidates: number[] = [];
  for (const [key] of [...shifts.entries()].sort((a, b) => b[1] - a[1])) {
    if (candidates.length >= MAX_CANDIDATES) break;
    const dx = Math.floor(key / 4096), dy = (key % 4096) - 2048;
    if (!candidates.some(other => Math.abs(Math.floor(other / 4096) - dx) <= 2 && Math.abs((other % 4096) - 2048 - dy) <= 2)) candidates.push(key);
  }
  let best: { dx: number; dy: number; pairs: number; members: number[] } | null = null;
  const covered = new Uint8Array(width * height);
  for (const key of candidates) {
    const dx = Math.floor(key / 4096), dy = (key % 4096) - 2048;
    const pairs = near(dx, dy);
    if (pairs < MIN_PAIRS || (best && pairs <= best.pairs)) continue;
    // A grid, a ruled form or woven texture repeats at every multiple of its period.
    if (near(dx * 2, dy * 2) >= pairs * 0.4 || near(Math.round(dx / 2), Math.round(dy / 2)) >= pairs * 0.4) continue;
    const members: number[] = [];
    for (let p = 0; p < pairShift.length; p++) {
      const sx = Math.floor(pairShift[p] / 4096), sy = (pairShift[p] % 4096) - 2048;
      if (Math.abs(sx - dx) <= 1 && Math.abs(sy - dy) <= 1) members.push(p);
    }
    const onShift = new Map<number, number>();
    for (const p of members) for (const block of [pairsFrom[p], pairsTo[p]]) onShift.set(block, (onShift.get(block) ?? 0) + 1);
    let uniqueness = 0;
    for (const [block, hits] of onShift) uniqueness += hits / involved[block];
    if (uniqueness / onShift.size < MIN_UNIQUENESS) continue;
    const sources = new Set(members.map(p => positions[pairsFrom[p]]));
    let dense = 0;
    for (const at of sources) {
      let neighbours = 0;
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if ((ox || oy) && sources.has(at + oy * width + ox)) neighbours++;
      if (neighbours >= DENSE_NEIGHBOURS) dense++;
    }
    if (dense < MIN_DENSE) continue;
    // A copy is one connected region; separate words that happen to repeat at
    // the same offset are judged by the largest of them alone.
    // Sources are grouped on a 4-pixel grid, so gaps left by missed matches
    // inside a copy do not split it.
    const cellOf = (at: number) => ((at / width) >> 2) * 4096 + ((at % width) >> 2);
    const byCell = new Map<number, number[]>();
    for (const at of sources) {
      const cell = cellOf(at);
      if (!byCell.has(cell)) byCell.set(cell, []);
      byCell.get(cell)!.push(at);
    }
    let region: number[] = [];
    const visited = new Set<number>();
    for (const seed of byCell.keys()) {
      if (visited.has(seed)) continue;
      const part = [seed], blocks: number[] = [];
      visited.add(seed);
      for (let k = 0; k < part.length; k++) {
        blocks.push(...byCell.get(part[k])!);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const next = part[k] + oy * 4096 + ox;
          if (byCell.has(next) && !visited.has(next)) { visited.add(next); part.push(next); }
        }
      }
      if (blocks.length > region.length) region = blocks;
    }
    covered.fill(0);
    let structure = 0;
    for (const at of region) {
      const x0 = at % width, y0 = (at - x0) / width;
      for (let y = y0; y < y0 + BLOCK; y++) for (let x = x0; x < x0 + BLOCK; x++) {
        const i = y * width + x;
        if (!covered[i]) { covered[i] = 1; structure += edges[i]; }
      }
    }
    if (structure >= MIN_STRUCTURE) best = { dx, dy, pairs, members };
  }
  tick();

  const mask = new Uint8Array(width * height); // 1 = source, 2 = copy
  if (best) {
    for (const p of best.members) {
      for (const [block, mark] of [[pairsFrom[p], 1], [pairsTo[p], 2]] as const) {
        const x0 = positions[block] % width, y0 = Math.floor(positions[block] / width);
        for (let y = y0; y < y0 + BLOCK; y++) for (let x = x0; x < x0 + BLOCK; x++) mask[y * width + x] ||= mark;
      }
    }
  }
  const heat = Buffer.alloc(width * height * 3);
  let marked = 0;
  for (let i = 0; i < grey.length; i++) {
    const dim = grey[i] * 0.35;
    if (mask[i]) marked++;
    heat[i * 3] = mask[i] ? 255 : dim;
    heat[i * 3 + 1] = mask[i] === 1 ? 70 : mask[i] === 2 ? 190 : dim;
    heat[i * 3 + 2] = mask[i] ? 30 : dim;
  }
  // Small analysis copies are doubled with nearest-neighbour so they stay legible.
  const zoom = Math.max(width, height) < 400 ? 2 : 1;
  const heatmap = await sharp(heat, { raw: { width, height, channels: 3 } })
    .resize({ width: width * zoom, height: height * zoom, kernel: "nearest" }).png({ compressionLevel: 9 }).toBuffer();
  const scale = (meta.width && meta.height ? Math.max(meta.width, meta.height) : Math.max(width, height)) / Math.max(width, height);
  return {
    suspicious: !!best, share: marked / (width * height), pairs: best?.pairs ?? 0,
    shift: best ? { dx: Math.round(best.dx * scale), dy: Math.round(best.dy * scale) } : null, heatmap,
  };
}
