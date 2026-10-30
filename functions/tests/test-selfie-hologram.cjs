const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const { estimateYaw } = require('../lib/features/documents/screening/faces.js');
const selfie = require('../lib/features/documents/screening/selfie.js');
const hologram = require('../lib/features/documents/screening/hologram.js');

// Everything below is synthetic: generated landmarks, descriptors and images only.
const RESULTS = new Set(['pass', 'warn', 'unavailable']);

// ---- Yaw from the 68 landmarks ----

function landmarks({ leftEye = [40, 50], rightEye = [80, 50], nose = [60, 70], roll = 0 } = {}) {
  const points = Array.from({ length: 68 }, () => ({ x: 60, y: 60 }));
  const ring = (from, [cx, cy]) => { for (let i = 0; i < 6; i++) points[from + i] = { x: cx + Math.cos(i) * 4, y: cy + Math.sin(i) * 2 }; };
  ring(36, leftEye);
  ring(42, rightEye);
  points[30] = { x: nose[0], y: nose[1] };
  if (!roll) return points;
  const cos = Math.cos(roll), sin = Math.sin(roll);
  return points.map(({ x, y }) => ({ x: 60 + (x - 60) * cos - (y - 60) * sin, y: 60 + (x - 60) * sin + (y - 60) * cos }));
}
const near = (actual, expected, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is not near ${expected}`);

test('yaw is zero facing the camera and negative when the nose moves to the image right (the person\'s left)', () => {
  near(estimateYaw(landmarks()), 0);
  near(estimateYaw(landmarks({ nose: [70, 70] })), -0.25);
  near(estimateYaw(landmarks({ nose: [52, 70] })), 0.2);
});

test('yaw ignores head roll and face size', () => {
  near(estimateYaw(landmarks({ nose: [70, 70], roll: Math.PI / 6 })), -0.25);
  near(estimateYaw(landmarks({ leftEye: [0, 0], rightEye: [200, 0], nose: [150, 90] })), -0.25);
});

test('yaw is null without usable landmarks', () => {
  assert.equal(estimateYaw(landmarks().slice(0, 40)), null);
  assert.equal(estimateYaw(landmarks({ leftEye: [60, 50], rightEye: [60, 50] })), null);
  const broken = landmarks();
  broken[30] = { x: NaN, y: 70 };
  assert.equal(estimateYaw(broken), null);
});

// ---- Liveness and match decisions ----

function descriptor(seed, jitter = 0) {
  const out = new Float32Array(128);
  for (let i = 0; i < out.length; i++) out[i] = Math.sin(seed * 13.1 + i * 0.7) * 0.08 + Math.cos(i * 1.3 + seed) * jitter;
  return out;
}
function thumb(seed) {
  const out = new Uint8Array(32 * 32);
  for (let i = 0; i < out.length; i++) out[i] = (i * 7 + seed * 41) % 256;
  return out;
}
const person = descriptor(1);
const frame = (yaw, extra = {}) => ({ faces: 1, yaw, descriptor: descriptor(1, 0.002), thumb: thumb(Math.round(yaw * 100) + 50), ...extra });
const goodFrames = () => [frame(0.01), frame(-0.15), frame(0.14)];

test('liveness passes for one face per frame, the right turns and the same person', () => {
  const verdict = selfie.judgeLiveness(goodFrames());
  assert.equal(verdict.result, 'pass');
  assert.match(verdict.detail, /turned left and right/);
});

test('liveness warns when a frame has no face or more than one', () => {
  const frames = goodFrames();
  frames[1] = { ...frames[1], faces: 0, yaw: null, descriptor: null };
  frames[2] = { ...frames[2], faces: 2, yaw: null, descriptor: null };
  const verdict = selfie.judgeLiveness(frames);
  assert.equal(verdict.result, 'warn');
  assert.match(verdict.detail, /No face in the turned left frame/);
  assert.match(verdict.detail, /2 faces in the turned right frame/);
});

test('liveness warns when the head does not turn, or turns the wrong way', () => {
  const still = selfie.judgeLiveness([frame(0), frame(-0.02), frame(0.03)]);
  assert.equal(still.result, 'warn');
  assert.match(still.detail, /did not turn left/);
  assert.match(still.detail, /did not turn right/);
  const oneWay = selfie.judgeLiveness([frame(0), frame(-0.2), frame(-0.1)]);
  assert.equal(oneWay.result, 'warn');
  assert.doesNotMatch(oneWay.detail, /did not turn left/);
  assert.match(oneWay.detail, /did not turn right/);
  const mirrored = selfie.judgeLiveness([frame(0), frame(0.2), frame(-0.2)]);
  assert.equal(mirrored.result, 'warn');
  assert.match(mirrored.detail, /opposite way/);
});

test('liveness warns about identical frames', () => {
  const frames = goodFrames();
  frames[2] = { ...frames[2], thumb: frames[0].thumb };
  const verdict = selfie.judgeLiveness(frames);
  assert.equal(verdict.result, 'warn');
  assert.match(verdict.detail, /straight and turned right frames are the same picture/);
});

test('liveness warns when the frames show different people or cannot be measured', () => {
  const frames = goodFrames();
  frames[1] = { ...frames[1], descriptor: descriptor(9) };
  assert.ok(selfie.frameDifference(frames[0].thumb, frames[1].thumb) > 1.5);
  const swapped = selfie.judgeLiveness(frames);
  assert.equal(swapped.result, 'warn');
  assert.match(swapped.detail, /not all show the same person/);
  const unmeasured = goodFrames();
  unmeasured[0] = { ...unmeasured[0], yaw: null };
  assert.match(selfie.judgeLiveness(unmeasured).detail, /could not be measured/);
});

test('liveness warns when the upload is not the three-pose strip', () => {
  const verdict = selfie.judgeLiveness([frame(0)]);
  assert.equal(verdict.result, 'warn');
  assert.match(verdict.detail, /three-pose/);
});

test('match follows face-api distances and is null with nothing to compare', () => {
  assert.equal(selfie.judgeMatch({ card: null, qr: null }), null);
  assert.equal(selfie.judgeMatch({ card: NaN, qr: null }), null);
  const strong = selfie.judgeMatch({ card: 0.38, qr: 0.45 });
  assert.equal(strong.result, 'pass');
  assert.match(strong.detail, /matches the Aadhaar card photo \(distance 0\.38\) and the QR photo/);
  const likely = selfie.judgeMatch({ card: 0.55, qr: null });
  assert.equal(likely.result, 'pass');
  assert.match(likely.detail, /likely matches/);
  const different = selfie.judgeMatch({ card: 0.72, qr: null });
  assert.equal(different.result, 'warn');
  assert.match(different.detail, /does not clearly match the Aadhaar card photo/);
  const mixed = selfie.judgeMatch({ card: 0.42, qr: 0.65 });
  assert.equal(mixed.result, 'warn');
  assert.match(mixed.detail, /does not clearly match the QR photo.*It does match the Aadhaar card photo/);
});

test('frame helpers: difference and mean descriptor', () => {
  assert.equal(selfie.frameDifference(thumb(1), thumb(1)), 0);
  assert.equal(selfie.frameDifference(new Uint8Array(4), new Uint8Array(5)), Infinity);
  assert.equal(selfie.meanDescriptor([]), null);
  const mean = selfie.meanDescriptor([new Float32Array([0, 2]), new Float32Array([2, 4])]);
  assert.deepEqual(Array.from(mean), [1, 3]);
  assert.ok(person.length === 128);
});

// ---- Splitting the client's strip ----

async function strip(width, height, colours) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const colour = colours[Math.min(colours.length - 1, Math.floor((x * colours.length) / width))];
    data.set(colour, (y * width + x) * 3);
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}
const RED = [200, 30, 30], GREEN = [30, 200, 30], BLUE = [30, 30, 200];

test('the 3:1 strip splits into straight, left and right frames in order', async () => {
  const frames = await selfie.splitStrip(await strip(1440, 480, [RED, GREEN, BLUE]));
  assert.equal(frames.length, 3);
  frames.forEach((part, i) => {
    assert.equal(part.width, 480);
    assert.equal(part.height, 480);
    const centre = (240 * part.width + 240) * part.channels;
    const dominant = [0, 1, 2].reduce((top, c) => (part.data[centre + c] > part.data[centre + top] ? c : top), 0);
    assert.equal(dominant, i);
  });
  const big = await selfie.splitStrip(await strip(2880, 960, [RED, GREEN, BLUE]));
  assert.deepEqual(big.map(part => [part.width, part.height]), [[480, 480], [480, 480], [480, 480]]);
});

test('a plain photo stays one frame', async () => {
  const frames = await selfie.splitStrip(await strip(900, 600, [RED]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].width, 900);
});

test('checkSelfie on a faceless strip warns or is unavailable, and has no match without references', async () => {
  const deadline = Date.now() + 30_000;
  const bytes = await strip(1440, 480, [RED, GREEN, BLUE]);
  const alone = await selfie.checkSelfie(bytes, { cardFace: null, qrFace: null }, deadline);
  assert.ok(RESULTS.has(alone.liveness.result));
  assert.notEqual(alone.liveness.result, 'pass');
  assert.equal(alone.match, null);
  if (alone.liveness.result === 'warn') assert.match(alone.liveness.detail, /No face in the straight frame/);
  const withCard = await selfie.checkSelfie(bytes, { cardFace: person, qrFace: null }, deadline);
  assert.ok(withCard.match);
  assert.equal(withCard.match.result, 'unavailable');
  assert.ok(Date.now() <= deadline + 1000);
});

test('checkSelfie is unavailable when time has already run out or the bytes are not an image', async () => {
  const late = await selfie.checkSelfie(await strip(1440, 480, [RED, GREEN, BLUE]), { cardFace: person, qrFace: null }, Date.now() - 1);
  assert.equal(late.liveness.result, 'unavailable');
  assert.equal(late.match.result, 'unavailable');
  const junk = await selfie.checkSelfie(Buffer.from('not an image'), { cardFace: null, qrFace: null }, Date.now() + 5000);
  assert.equal(junk.liveness.result, 'unavailable');
  assert.equal(junk.match, null);
});

// ---- Hologram decision ----

const stats = (over = {}) => ({
  alignment: 0.7, cells: 160, shiftedCells: 5, largestCluster: 4, peakShift: 40, colourShare: 0.8, samePicture: false, ...over,
});

test('hologram decision: localised shifts pass, missing or spread shifts warn, never fail', () => {
  assert.equal(hologram.judgeHologramShift(stats()).result, 'pass');
  assert.match(hologram.judgeHologramShift(stats()).detail, /colour shift/);
  assert.match(hologram.judgeHologramShift(stats({ colourShare: 0.2 })).detail, /glare/);
  assert.equal(hologram.judgeHologramShift(null).result, 'unavailable');
  assert.equal(hologram.judgeHologramShift(stats({ alignment: 0.1 })).result, 'unavailable');
  assert.equal(hologram.judgeHologramShift(stats({ cells: 20 })).result, 'unavailable');
  assert.match(hologram.judgeHologramShift(stats({ samePicture: true })).detail, /same picture/);
  assert.equal(hologram.judgeHologramShift(stats({ shiftedCells: 0, largestCluster: 0, peakShift: 5 })).result, 'warn');
  assert.match(hologram.judgeHologramShift(stats({ shiftedCells: 90, largestCluster: 80 })).detail, /most of the card/);
  assert.match(hologram.judgeHologramShift(stats({ shiftedCells: 1, largestCluster: 1, peakShift: 15 })).detail, /faint/);
  for (const over of [{}, { alignment: 0 }, { samePicture: true }, { shiftedCells: 0 }, { shiftedCells: 159 }]) {
    assert.ok(RESULTS.has(hologram.judgeHologramShift(stats(over)).result));
  }
});

// ---- Hologram on synthetic cards ----

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
// A card-like picture: cream ground, a border, a photo block and lines of "text".
function cardPixels(width, height) {
  const next = rng(7);
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 3;
    data[at] = 236 - y / 12; data[at + 1] = 228 - y / 14; data[at + 2] = 205 - x / 20;
  }
  const fill = (x0, y0, w, h, colour) => {
    for (let y = y0; y < Math.min(height, y0 + h); y++) for (let x = x0; x < Math.min(width, x0 + w); x++) data.set(colour, (y * width + x) * 3);
  };
  fill(0, 0, width, 8, [180, 40, 30]); fill(0, height - 8, width, 8, [30, 110, 60]);
  for (let y = 70; y < 290; y += 10) for (let x = 30; x < 160; x += 10) fill(x, y, 10, 10, [90 + next() * 120, 70 + next() * 100, 60 + next() * 90]);
  for (let line = 0; line < 9; line++) {
    let x = 190;
    while (x < width - 40) {
      const word = 12 + Math.floor(next() * 40);
      fill(x, 70 + line * 28, word, 9, [30, 30, 40]);
      x += word + 8 + Math.floor(next() * 10);
    }
  }
  return data;
}
// Rainbow tint over one corner, as the tilt makes the hologram change colour.
function addHologram(data, width, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const at = (y * width + x) * 3, phase = (x - x0) / 14 + (y - y0) / 30;
    data[at] = Math.max(0, Math.min(255, data[at] + 55 * Math.sin(phase)));
    data[at + 1] = Math.max(0, Math.min(255, data[at + 1] + 55 * Math.sin(phase + 2.1)));
    data[at + 2] = Math.max(0, Math.min(255, data[at + 2] + 55 * Math.sin(phase + 4.2)));
  }
}
async function cardPhotos({ hologramPatch }) {
  const width = 600, height = 380;
  const base = cardPixels(width, height);
  const card = await sharp(base, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  const tilted = Buffer.from(base);
  if (hologramPatch) addHologram(tilted, width, 430, 250, 110, 80);
  // Tilted and further away: smaller, foreshortened, darker, on a dark table.
  const inner = await sharp(tilted, { raw: { width, height, channels: 3 } })
    .resize(510, 300, { fit: 'fill' }).linear(0.9, 6).png().toBuffer();
  const angle = await sharp({ create: { width: 640, height: 420, channels: 3, background: { r: 40, g: 36, b: 34 } } })
    .composite([{ input: inner, left: 70, top: 55 }]).jpeg({ quality: 88 }).toBuffer();
  return { card, angle };
}

test('checkHologram returns a valid verdict within the deadline on synthetic cards', async () => {
  for (const hologramPatch of [true, false]) {
    const { card, angle } = await cardPhotos({ hologramPatch });
    const started = Date.now(), deadline = started + 8000;
    const verdict = await hologram.checkHologram(angle, card, deadline);
    assert.ok(RESULTS.has(verdict.result), verdict.result);
    assert.equal(typeof verdict.detail, 'string');
    assert.ok(verdict.detail.length > 0);
    assert.ok(Date.now() <= deadline + 1000, 'finished after the deadline');
    if (hologramPatch) assert.equal(verdict.result, 'pass', verdict.detail);
    else assert.equal(verdict.result, 'warn', verdict.detail);
  }
});

test('checkHologram is unavailable for PDFs, tiny or unreadable photos and an expired deadline, and warns on the same picture', async () => {
  const { card, angle } = await cardPhotos({ hologramPatch: true });
  const soon = () => Date.now() + 8000;
  assert.equal((await hologram.checkHologram(angle, Buffer.from('%PDF-1.7\n'), soon())).result, 'unavailable');
  assert.equal((await hologram.checkHologram(Buffer.from('%PDF-1.4\n'), card, soon())).result, 'unavailable');
  const tiny = await sharp(card).resize(100, 60).jpeg().toBuffer();
  assert.equal((await hologram.checkHologram(tiny, card, soon())).result, 'unavailable');
  assert.equal((await hologram.checkHologram(Buffer.from('not an image'), card, soon())).result, 'unavailable');
  assert.equal((await hologram.checkHologram(angle, card, Date.now() - 1)).result, 'unavailable');
  const same = await hologram.checkHologram(card, card, soon());
  assert.equal(same.result, 'warn');
  assert.match(same.detail, /same picture/);
});
