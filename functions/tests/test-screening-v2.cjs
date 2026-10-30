const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash, webcrypto } = require('node:crypto');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.DISPUTE_OTP_SECRET = 'test-secret-not-a-real-key';
const sharp = require('sharp');
const pkijs = require('pkijs');
const asn1js = require('asn1js');
const screening = require('../lib/features/documents/screening/index.js');
const { detectCopyMove } = require('../lib/features/documents/screening/copyMove.js');
const { verifyPdfSignatures } = require('../lib/features/documents/screening/pdfSignature.js');
const { kycProvider } = require('../lib/features/documents/screening/kyc/index.js');

// Everything below is synthetic: generated images, keys and numbers only.
const deps = { findDuplicates: async () => ({ exactMatches: 0, nearMatches: 0, sameIdDifferentName: 0 }), uidaiCertPem: null, companion: async () => null };
const check = (output, id) => output.checks.find(item => item.id === id);

// ---- Copy-move: forgeries (a region pasted elsewhere) and clean images ----

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
async function noiseLayer(width, height, cell, seed) {
  const w = Math.max(2, Math.ceil(width / cell)), h = Math.max(2, Math.ceil(height / cell)), next = rng(seed);
  const raw = Buffer.alloc(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(next() * 256);
  return sharp(raw, { raw: { width: w, height: h, channels: 1 } }).resize(width, height, { kernel: 'cubic' }).raw().toBuffer();
}
// Multi-scale value noise tinted like bark, soil or fabric.
async function textured(width, height, seed) {
  const layers = await Promise.all([4, 16, 64].map((cell, i) => noiseLayer(width, height, cell, seed + i * 7)));
  const weights = [0.35, 0.35, 0.3];
  const data = Buffer.alloc(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    const v = layers.reduce((sum, layer, i) => sum + layer[p] * weights[i], 0);
    data[p * 3] = Math.min(255, v * 0.9 + 30); data[p * 3 + 1] = Math.min(255, v * 0.75 + 25); data[p * 3 + 2] = Math.min(255, v * 0.55 + 20);
  }
  return { width, height, data };
}
async function rasterise(svg, grainSeed, grainAmount) {
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (grainAmount) {
    const grain = rng(grainSeed);
    for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, data[i] + Math.round((grain() - 0.5) * grainAmount)));
  }
  return { width: info.width, height: info.height, data };
}
const WORDS = 'land survey plot village tehsil khasra owner boundary record mutation registered deed revenue officer patta north south east west road canal well field acre hectare share heir sale witness'.split(' ');
// A record page: heading, 13 lines of text, a round office stamp and a signature stroke.
function documentPage(width, height, seed) {
  const next = rng(seed), lines = [];
  for (let i = 0; i < 13; i++) {
    let line = '';
    while (line.length < 52) line += WORDS[Math.floor(next() * WORDS.length)] + ' ';
    lines.push(`<text x="60" y="${170 + i * 36}" font-family="serif" font-size="22" fill="#222">${line.trim()}</text>`);
  }
  return rasterise(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f7f4ec"/>
    <text x="60" y="100" font-family="serif" font-size="40" font-weight="bold" fill="#111">RECORD OF RIGHTS ${seed % 97}</text>
    ${lines.join('')}
    <g transform="translate(760 640)"><circle r="80" fill="none" stroke="#3a3aa8" stroke-width="6"/><circle r="60" fill="none" stroke="#3a3aa8" stroke-width="2"/>
      <text y="-10" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#3a3aa8">TEHSIL</text>
      <text y="18" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#3a3aa8">OFFICE ${seed % 89}</text></g>
    <path d="M 120 680 C 160 620, 200 720, 240 650 S 320 700, 360 640" fill="none" stroke="#1b2a6b" stroke-width="3"/></svg>`, seed + 1, 6);
}
// A site photo: gradient sky over textured ground, with a house.
async function scene(width, height, seed) {
  const ground = await textured(width, height, seed);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6fa3d8"/><stop offset="1" stop-color="#dfeaf3"/></linearGradient></defs>
    <rect width="100%" height="${height * 0.45}" fill="url(#g)"/>
    <rect x="${width * 0.6}" y="${height * 0.3}" width="${width * 0.18}" height="${height * 0.3}" fill="#8b3a2a"/>
    <polygon points="${width * 0.58},${height * 0.3} ${width * 0.69},${height * 0.18} ${width * 0.8},${height * 0.3}" fill="#5a2a1a"/></svg>`;
  const overlay = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
  const data = Buffer.from(ground.data);
  for (let p = 0; p < width * height; p++) {
    const a = overlay[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) data[p * 3 + c] = Math.round(overlay[p * 4 + c] * a + data[p * 3 + c] * (1 - a));
  }
  return { width, height, data };
}
function gradient(width, height) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 3;
    data[p] = 40 + (x / width) * 180; data[p + 1] = 60 + (y / height) * 150; data[p + 2] = 200 - (x / width) * 120;
  }
  return { width, height, data };
}
// A ruled register repeats the same cell everywhere: a classic false positive.
function form(width) {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(`<line x1="50" x2="${width - 50}" y1="${120 + i * 50}" y2="${120 + i * 50}" stroke="#333" stroke-width="2"/>`);
  for (const x of [50, 300, 600, width - 50]) rows.push(`<line x1="${x}" x2="${x}" y1="120" y2="670" stroke="#333" stroke-width="2"/>`);
  return rasterise(`<svg width="${width}" height="750" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/>
    <text x="50" y="80" font-family="sans-serif" font-size="30" fill="#111">Khatauni register</text>${rows.join('')}</svg>`, 0, 0);
}
// Mostly flat paper with two lines of text.
function plainPaper(width, height) {
  return rasterise(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f3efe4"/>
    <text x="80" y="140" font-family="serif" font-size="26" fill="#333">To the Tehsildar, regarding plot 41/2 boundary</text>
    <text x="80" y="190" font-family="serif" font-size="26" fill="#333">dispute raised by the applicant last month.</text></svg>`, 5, 4);
}
function copyRegion(image, from, to, size, brightness = 0) {
  const data = Buffer.from(image.data);
  for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) for (let c = 0; c < 3; c++) {
    const value = image.data[((from.y + y) * image.width + from.x + x) * 3 + c] + brightness;
    data[((to.y + y) * image.width + to.x + x) * 3 + c] = Math.max(0, Math.min(255, value));
  }
  const dx = to.x - from.x, dy = to.y - from.y;
  // The detector reports each offset pointing right (or down when vertical).
  return { ...image, data, shift: dx < 0 || (dx === 0 && dy < 0) ? { dx: -dx, dy: -dy } : { dx, dy } };
}
function encode(image, quality) {
  const pipeline = sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } });
  return quality ? pipeline.jpeg({ quality }).toBuffer() : pipeline.png().toBuffer();
}

let syntheticSet;
async function copyMoveSet() {
  if (syntheticSet) return syntheticSet;
  const W = 1000, H = 750;
  const [a, b, c, a2, ca, cb, cc, cf, cp] = await Promise.all([textured(W, H, 11), documentPage(W, H, 23), scene(W, H, 31), textured(W, H, 47),
    textured(W, H, 61), documentPage(W, H, 67), scene(W, H, 71), form(W), plainPaper(W, H)]);
  const forgeries = [
    ['texture, exact copy, PNG', copyRegion(a, { x: 100, y: 120 }, { x: 620, y: 420 }, { w: 140, h: 140 }), 0],
    ['texture, JPEG 90', copyRegion(a, { x: 300, y: 80 }, { x: 560, y: 480 }, { w: 140, h: 140 }), 90],
    ['texture, +8 brightness, JPEG 85', copyRegion(a2, { x: 120, y: 400 }, { x: 640, y: 160 }, { w: 120, h: 160 }, 8), 85],
    ['document, stamp copied, PNG', copyRegion(b, { x: 670, y: 550 }, { x: 330, y: 560 }, { w: 180, h: 180 }), 0],
    ['document, text block copied, JPEG 90', copyRegion(b, { x: 60, y: 210 }, { x: 420, y: 640 }, { w: 320, h: 80 }), 90],
    ['document, stamp -6 brightness, JPEG 80', copyRegion(b, { x: 670, y: 550 }, { x: 80, y: 560 }, { w: 180, h: 180 }, -6), 80],
    ['scene, ground patch over the house, JPEG 92', copyRegion(c, { x: 150, y: 520 }, { x: 600, y: 240 }, { w: 180, h: 160 }), 92],
    ['scene, JPEG 75', copyRegion(c, { x: 80, y: 420 }, { x: 520, y: 560 }, { w: 150, h: 150 }), 75],
    ['texture, small copy, -6 brightness, JPEG 90', copyRegion(a2, { x: 700, y: 80 }, { x: 200, y: 520 }, { w: 110, h: 110 }, -6), 90],
  ];
  const clean = [['texture, PNG', ca, 0], ['texture, JPEG 70', ca, 70], ['document, JPEG 90', cb, 90], ['scene, JPEG 88', cc, 88],
    ['smooth gradient, JPEG 85', gradient(W, H), 85], ['ruled form, PNG', cf, 0], ['plain paper, JPEG 80', cp, 80]];
  syntheticSet = {
    forgeries: await Promise.all(forgeries.map(async ([name, image, quality]) => ({ name, shift: image.shift, bytes: await encode(image, quality) }))),
    clean: await Promise.all(clean.map(async ([name, image, quality]) => ({ name, bytes: await encode(image, quality) }))),
  };
  return syntheticSet;
}

test('copy-move finds at least 7 of 9 pasted regions at the right offset and flags none of the clean images', async () => {
  const { forgeries, clean } = await copyMoveSet();
  const missed = [];
  for (const item of forgeries) {
    const found = await detectCopyMove(item.bytes, Date.now() + 15_000);
    const right = found.suspicious && found.shift && Math.abs(found.shift.dx - item.shift.dx) <= 12 && Math.abs(found.shift.dy - item.shift.dy) <= 12;
    if (!right) missed.push(item.name);
    assert.ok(found.heatmap.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  }
  assert.ok(missed.length <= 2, 'missed: ' + missed.join('; '));
  const flagged = [];
  for (const item of clean) if ((await detectCopyMove(item.bytes, Date.now() + 15_000)).suspicious) flagged.push(item.name);
  assert.deepEqual(flagged, []);
});

test('copy-move analyses a 2000 px image within its deadline and stops at an expired one', async () => {
  const big = await encode(await textured(2000, 1500, 83), 90);
  const started = Date.now();
  const found = await detectCopyMove(big, started + 8_000);
  assert.ok(Date.now() - started < 8_000);
  assert.equal(found.suspicious, false);
  await assert.rejects(detectCopyMove(big, Date.now() - 1), error => error.name === 'StepTimeout');
  // Too small to hold a meaningful copy.
  assert.equal(await detectCopyMove(await sharp({ create: { width: 40, height: 40, channels: 3, background: '#777' } }).png().toBuffer(), Date.now() + 5_000), null);
});

test('screening warns on a copied region, stores the heatmap only then, and never fails on it', async () => {
  const { forgeries, clean } = await copyMoveSet();
  const forged = forgeries[3];
  const output = await screening.screenDocument({ bytes: forged.bytes, contentType: 'image/png', kind: 'site_photo' }, deps);
  assert.equal(check(output, 'copy_move').result, 'warn');
  assert.equal(check(output, 'copy_move').label, 'Copied regions');
  assert.ok(output.derived.some(file => file.key === 'copyMove' && file.contentType === 'image/png'));
  assert.notEqual(output.risk, 'altered');
  const ids = output.checks.map(item => item.id);
  assert.ok(ids.indexOf('duplicates') > ids.indexOf('copy_move'), 'duplicates are listed after the image checks');
  const plain = await screening.screenDocument({ bytes: clean[2].bytes, contentType: 'image/jpeg', kind: 'site_photo' }, deps);
  assert.equal(check(plain, 'copy_move').result, 'pass');
  assert.ok(!plain.derived.some(file => file.key === 'copyMove'));
  // Stitched selfie frames repeat their background by design.
  const selfie = await screening.screenDocument({ bytes: forged.bytes, contentType: 'image/png', kind: 'selfie' }, deps);
  assert.equal(check(selfie, 'copy_move'), undefined);
  assert.equal(check(selfie, 'name_match'), undefined, 'selfies are picture kinds');
});

// ---- PDF signatures: a self-signed CMS signature over the ByteRange ----

const engine = new pkijs.CryptoEngine({ name: 'node', crypto: webcrypto });
const SIGNER = 'Synthetic Test Signer';
let signerKeys;
async function signer() {
  if (signerKeys) return signerKeys;
  const keys = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 7 });
  for (const name of [certificate.issuer, certificate.subject]) {
    name.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: SIGNER }) }));
  }
  certificate.notBefore.value = new Date(Date.UTC(2026, 0, 1));
  certificate.notAfter.value = new Date(Date.UTC(2036, 0, 1));
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey, engine);
  await certificate.sign(keys.privateKey, 'SHA-256', engine);
  signerKeys = { keys, certificate };
  return signerKeys;
}
async function cmsSignature(data) {
  const { keys, certificate } = await signer();
  const digest = await webcrypto.subtle.digest('SHA-256', data);
  const signed = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }),
    signerInfos: [new pkijs.SignerInfo({
      version: 1,
      sid: new pkijs.IssuerAndSerialNumber({ issuer: certificate.issuer, serialNumber: certificate.serialNumber }),
      signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: [
        new pkijs.Attribute({ type: '1.2.840.113549.1.9.3', values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' })] }),
        new pkijs.Attribute({ type: '1.2.840.113549.1.9.4', values: [new asn1js.OctetString({ valueHex: digest })] }),
      ] }),
    })],
    certificates: [certificate],
  });
  await signed.sign(keys.privateKey, 0, 'SHA-256', data, engine);
  const info = new pkijs.ContentInfo({ contentType: pkijs.ContentInfo.SIGNED_DATA, content: signed.toSchema(true) });
  return Buffer.from(info.toSchema().toBER(false));
}
const CONTENTS_HEX = 16384;
// A one-page PDF with a proper xref; `signature` adds a signed /Sig field.
async function pdfFile({ signature }) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R' + (signature ? ' /AcroForm << /Fields [4 0 R] /SigFlags 3 >>' : '') + ' >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]' + (signature ? ' /Annots [4 0 R]' : '') + ' >>',
  ];
  if (signature) {
    objects.push('<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] /V 5 0 R /T (Signature1) /P 3 0 R >>');
    objects.push('<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0000000000 0000000000 0000000000] /Contents <'
      + '0'.repeat(CONTENTS_HEX) + '> /M (D:20261029120000Z) >>');
  }
  let body = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((object, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  let bytes = Buffer.from(body, 'latin1');
  if (!signature) return bytes;
  const start = bytes.indexOf('/Contents <') + '/Contents '.length, end = start + CONTENTS_HEX + 2;
  const range = [0, start, end, bytes.length - end].map(value => String(value).padStart(10, '0'));
  const placeholder = '[0 0000000000 0000000000 0000000000]';
  bytes = Buffer.from(body.replace(placeholder, `[${range[0].replace(/^0+(?=\d)/, '')} ${range[1]} ${range[2]} ${range[3]}]`.padEnd(placeholder.length)), 'latin1');
  assert.equal(bytes.length, Buffer.byteLength(body, 'latin1'));
  const der = await cmsSignature(Buffer.concat([bytes.subarray(0, start), bytes.subarray(end)]));
  bytes.write(der.toString('hex').padEnd(CONTENTS_HEX, '0'), start + 1, 'latin1');
  return bytes;
}

test('PDF signatures verify over their byte ranges: valid, tampered after signing, unsigned', async () => {
  const signed = await pdfFile({ signature: true });
  const [valid] = await verifyPdfSignatures(signed);
  assert.equal(valid.valid, true);
  assert.equal(valid.signer, SIGNER);
  assert.equal(valid.subFilter, 'adbe.pkcs7.detached');
  assert.equal(valid.coversFile, true);

  // Same length, one signed byte changed: the page size.
  const tampered = Buffer.from(signed.toString('latin1').replace('/MediaBox [0 0 200 200]', '/MediaBox [0 0 300 200]'), 'latin1');
  const [broken] = await verifyPdfSignatures(tampered);
  assert.equal(broken.valid, false);
  assert.match(broken.reason, /changed after signing|does not match/);

  assert.deepEqual(await verifyPdfSignatures(await pdfFile({ signature: false })), []);
  // A signature value that is not CMS (e.g. legacy adbe.x509.rsa_sha1) is
  // "unsupported", not proof of tampering: only a digest mismatch is.
  const garbage = Buffer.from(signed);
  garbage.write('3082ffff', signed.indexOf('/Contents <') + '/Contents <'.length, 'latin1');
  const [unsupported] = await verifyPdfSignatures(garbage);
  assert.equal(unsupported.valid, null);
  assert.match(unsupported.reason, /format this check does not support/);
  assert.ok(createHash('sha256').update(signed).digest('hex') !== createHash('sha256').update(tampered).digest('hex'));
});

test('screening: a broken PDF signature makes the file altered, a valid one passes with the signer, an unsigned one omits the check', async () => {
  const signed = await pdfFile({ signature: true });
  const ok = await screening.screenDocument({ bytes: signed, contentType: 'application/pdf', kind: 'land_record' }, deps);
  assert.equal(check(ok, 'pdf_signature').result, 'pass');
  assert.match(check(ok, 'pdf_signature').detail, new RegExp(SIGNER));
  assert.notEqual(ok.risk, 'altered');

  const tampered = Buffer.from(signed.toString('latin1').replace('/MediaBox [0 0 200 200]', '/MediaBox [0 0 300 200]'), 'latin1');
  const altered = await screening.screenDocument({ bytes: tampered, contentType: 'application/pdf', kind: 'land_record' }, deps);
  assert.equal(check(altered, 'pdf_signature').result, 'fail');
  assert.equal(altered.risk, 'altered');
  assert.equal(altered.score, 100);
  assert.match(altered.summary, /PDF's digital signature/);
  // Nothing about the signature reaches the reporter.
  assert.ok(!altered.userMessages.some(message => /signature/i.test(message)));

  const unsigned = await screening.screenDocument({ bytes: await pdfFile({ signature: false }), contentType: 'application/pdf', kind: 'land_record' }, deps);
  assert.equal(check(unsigned, 'pdf_signature'), undefined);
  assert.notEqual(unsigned.risk, 'altered');
  assert.equal(screening.ENGINE_VERSION, 'screening-2026-10-29.1');
});

// ---- KYC provider ----

test('KYC provider: none by default, mock is deterministic, labelled and unscored', async () => {
  const saved = process.env.KYC_PROVIDER;
  try {
    delete process.env.KYC_PROVIDER;
    assert.equal(kycProvider(), null);
    assert.equal(kycProvider('none'), null);
    assert.equal(kycProvider('something-else'), null);
    const mock = kycProvider(' Mock ');
    assert.equal(mock.label, 'Mock verification — not a real KYC check');
    assert.equal(mock.scored, false);
    const ask = idNumber => mock.verify({ kind: 'aadhaar', idType: 'aadhaar', idNumber, name: 'Synthetic Reporter' }, Date.now() + 1000);
    assert.equal((await ask('234567890123')).result, 'pass');
    assert.deepEqual(await ask('234567890123'), await ask('234567890123'));
    assert.equal((await ask('234567890120')).result, 'warn');
    assert.equal((await ask(null)).result, 'unavailable');

    const pdf = await pdfFile({ signature: false });
    const input = { bytes: pdf, contentType: 'application/pdf', kind: 'pan', idNumber: 'ABCPE1234F', reporterName: 'Synthetic Example' };
    const without = await screening.screenDocument(input, deps);
    assert.equal(check(without, 'kyc'), undefined);
    process.env.KYC_PROVIDER = 'mock';
    const withMock = await screening.screenDocument(input, deps);
    assert.equal(check(withMock, 'kyc').label, 'Mock verification — not a real KYC check');
    assert.equal(check(withMock, 'kyc').result, 'pass');
    // A malformed number is never sent to the provider.
    const malformed = await screening.screenDocument({ ...input, idNumber: 'NOTAPAN' }, deps);
    assert.equal(check(malformed, 'kyc').result, 'unavailable');
    // The mock never moves the score.
    assert.equal(withMock.score, without.score);
    const aadhaarless = await screening.screenDocument({ ...input, kind: 'land_record' }, deps);
    assert.equal(check(aadhaarless, 'kyc'), undefined, 'only ID kinds are checked');
  } finally {
    if (saved === undefined) delete process.env.KYC_PROVIDER; else process.env.KYC_PROVIDER = saved;
  }
});

// ---- Companion checks: hologram (aadhaar_angle) and liveness / selfie match (selfie) ----

const SOFT = new Set(['pass', 'warn', 'info', 'unavailable']);
// A card photo, and the same card tilted on a dark table with a rainbow tint in one corner.
async function tiltedCard() {
  const page = await documentPage(600, 380, 11);
  const card = await encode(page, 90);
  const tinted = Buffer.from(page.data);
  for (let y = 250; y < 330; y++) for (let x = 430; x < 540; x++) for (let c = 0; c < 3; c++) {
    const at = (y * 600 + x) * 3 + c;
    tinted[at] = Math.max(0, Math.min(255, tinted[at] + 55 * Math.sin((x - 430) / 14 + (y - 250) / 30 + c * 2.1)));
  }
  const inner = await sharp(tinted, { raw: { width: 600, height: 380, channels: 3 } }).resize(510, 300, { fit: 'fill' }).png().toBuffer();
  const angle = await sharp({ create: { width: 640, height: 420, channels: 3, background: { r: 40, g: 36, b: 34 } } })
    .composite([{ input: inner, left: 70, top: 55 }]).jpeg({ quality: 88 }).toBuffer();
  return { card, angle };
}
function companionDeps(files) {
  const asked = [];
  return { asked, deps: { ...deps, companion: async kind => { asked.push(kind); return typeof files === 'function' ? files() : files[kind] ?? null; } } };
}
function assertSoft(output, ids) {
  for (const id of ids) {
    const item = check(output, id);
    assert.ok(item, `${id} is reported`);
    assert.ok(SOFT.has(item.result), `${id} is ${item.result}`);
    assert.equal(typeof item.label, 'string');
    assert.ok(item.detail.length > 0);
  }
  assert.notEqual(output.risk, 'altered');
  assert.ok(output.userMessages.every(message => !/hologram|selfie|liveness/i.test(message)), 'nothing about these checks reaches the reporter');
}

test('screening an aadhaar_angle compares it with the companion Aadhaar photo, or reports the hologram unavailable', async () => {
  const { card, angle } = await tiltedCard();
  const input = { bytes: angle, contentType: 'image/jpeg', kind: 'aadhaar_angle' };

  const alone = await screening.screenDocument(input, deps);
  assertSoft(alone, ['hologram']);
  assert.equal(check(alone, 'hologram').result, 'unavailable');

  const paired = companionDeps({ aadhaar: { bytes: card, contentType: 'image/jpeg' } });
  const withCard = await screening.screenDocument(input, paired.deps);
  assert.deepEqual(paired.asked, ['aadhaar']);
  assertSoft(withCard, ['hologram']);
  assert.notEqual(check(withCard, 'hologram').detail, check(alone, 'hologram').detail, 'the comparison ran');
  assert.equal(check(withCard, 'liveness'), undefined);
  assert.equal(check(withCard, 'name_match'), undefined, 'tilted photos are picture kinds');

  const pdfCard = companionDeps({ aadhaar: { bytes: Buffer.from('%PDF-1.7\n%%EOF\n'), contentType: 'application/pdf' } });
  const withPdf = await screening.screenDocument(input, pdfCard.deps);
  assertSoft(withPdf, ['hologram']);
  assert.equal(check(withPdf, 'hologram').result, 'unavailable');

  // A failing companion lookup is "no companion", never a failed screening.
  const broken = companionDeps(() => { throw new Error('lookup failed'); });
  const withBroken = await screening.screenDocument(input, broken.deps);
  assertSoft(withBroken, ['hologram']);
  assert.equal(check(withBroken, 'hologram').result, 'unavailable');
});

test('screening a faceless selfie strip reports liveness and selfie match without failing or altering', async () => {
  const frames = await Promise.all([1, 2, 3].map(seed => textured(480, 480, seed * 31)));
  const strip = await sharp({ create: { width: 1440, height: 480, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(await Promise.all(frames.map(async (frame, i) => ({ input: await encode(frame), left: i * 480, top: 0 })))).jpeg({ quality: 85 }).toBuffer();
  const input = { bytes: strip, contentType: 'image/jpeg', kind: 'selfie' };

  const alone = await screening.screenDocument(input, deps);
  assertSoft(alone, ['liveness', 'selfie_match']);
  assert.ok(['warn', 'unavailable'].includes(check(alone, 'liveness').result), 'no face in any frame is not a pass');
  assert.equal(check(alone, 'selfie_match').result, 'unavailable');
  assert.equal(check(alone, 'faces'), undefined, 'three frames hold three faces by design');
  assert.equal(check(alone, 'hologram'), undefined);

  // A companion Aadhaar without a readable face or QR gives no reference to match.
  const { card } = await tiltedCard();
  const paired = companionDeps({ aadhaar: { bytes: card, contentType: 'image/jpeg' } });
  const withCard = await screening.screenDocument(input, paired.deps);
  assert.deepEqual(paired.asked, ['aadhaar']);
  assertSoft(withCard, ['liveness', 'selfie_match']);
  assert.equal(check(withCard, 'selfie_match').result, 'unavailable');
  assert.notEqual(check(withCard, 'selfie_match').detail, check(alone, 'selfie_match').detail, 'the reason names the missing face, not a missing upload');
});
