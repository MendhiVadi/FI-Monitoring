const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.DISPUTE_OTP_SECRET = 'test-secret-not-a-real-key';
const sharp = require('sharp');
const QRCode = require('qrcode');
const screening = require('../lib/features/documents/screening/index.js');
const ids = require('../lib/features/documents/screening/idNumbers.js');
const qrLib = require('../lib/features/documents/screening/aadhaarQr.js');
const imaging = require('../lib/features/documents/screening/imaging.js');
const { tessdataDir, recognise } = require('../lib/features/documents/screening/ocr.js');
const { faceModelDir, scanFaces } = require('../lib/features/documents/screening/faces.js');

// Everything below is synthetic: generated keys, names and numbers only.
const noDuplicates = { findDuplicates: async () => ({ exactMatches: 0, nearMatches: 0, sameIdDifferentName: 0 }), uidaiCertPem: null };
const check = (output, id) => output.checks.find(item => item.id === id);

function validAadhaar(prefix) {
  for (let digit = 0; digit <= 9; digit++) if (ids.isValidAadhaar(prefix + digit)) return prefix + digit;
  throw new Error('no check digit');
}

function validAadhaarEndingWith(last4) {
  for (let i = 0; i < 10000; i++) {
    const candidate = '2345' + String(i).padStart(4, '0') + last4;
    if (ids.isValidAadhaar(candidate)) return candidate;
  }
  throw new Error('no candidate');
}

async function sceneImage(width, height, seed) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#${seed}"/><stop offset="1" stop-color="#f4f1e8"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${width * 0.3}" cy="${height * 0.4}" r="${height * 0.2}" fill="#20313a"/>
    <rect x="${width * 0.55}" y="${height * 0.5}" width="${width * 0.3}" height="${height * 0.35}" fill="#b5402a"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

function buildSecureQr(privateKey, { name, dob, gender, last4, indicator = '0', photo }) {
  const fields = ['V2', indicator, `${last4}20261023101500123`, name, dob, gender, 'C/O Test Parent', 'Pune', 'Near Test Temple', '12', 'Test Nagar', '411001', 'Test PO', 'Maharashtra', 'Test Street', 'Haveli', 'Test Village', '0123'];
  const hashes = Buffer.alloc((indicator === '3' ? 2 : indicator === '0' ? 0 : 1) * 32, 7);
  const body = Buffer.concat([...fields.map(field => Buffer.concat([Buffer.from(field, 'latin1'), Buffer.from([0xff])])), photo, hashes]);
  return { body, signature: crypto.sign('sha256', body, privateKey) };
}

function qrNumber(payload) {
  return BigInt('0x' + zlib.gzipSync(payload).toString('hex')).toString(10);
}

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
const fakePhoto = Buffer.concat([Buffer.from([0xff, 0x4f, 0xff, 0x51]), crypto.randomBytes(60)]);
const person = { name: 'Asha Synthetic Rao', dob: '14-08-1991', gender: 'F', last4: '4321', photo: fakePhoto };

test('Aadhaar numbers use the Verhoeff check digit and a 2-9 first digit', () => {
  const good = validAadhaar('23456789012');
  assert.equal(ids.isValidAadhaar(good), true);
  assert.equal(ids.isValidAadhaar(`${good.slice(0, 4)} ${good.slice(4, 8)} ${good.slice(8)}`), true);
  const wrongCheck = good.slice(0, 11) + ((Number(good[11]) + 1) % 10);
  assert.equal(ids.isValidAadhaar(wrongCheck), false);
  const swapped = good.slice(0, 3) + good[4] + good[3] + good.slice(5);
  if (swapped !== good) assert.equal(ids.isValidAadhaar(swapped), false);
  assert.equal(ids.isValidAadhaar('1' + good.slice(1)), false);
  assert.equal(ids.isValidAadhaar(good.slice(1)), false);
});

test('PAN format, holder type, masking and name normalisation', () => {
  assert.equal(ids.isValidPan('abcpk1234f'), true);
  assert.equal(ids.isValidPan('ABCCK1234F'), true);
  assert.equal(ids.isValidPan('ABCQK1234F'), false);
  assert.equal(ids.isValidPan('ABCP1234F'), false);
  assert.equal(ids.isValidPan('ABCPK12345'), false);
  assert.equal(ids.normaliseIdNumber('aadhaar', '2345-6789 0123'), '234567890123');
  assert.equal(ids.normaliseIdNumber('pan', ' abcpk 1234f '), 'ABCPK1234F');
  assert.equal(ids.maskIdNumber('aadhaar', '2345 6789 0123'), 'XXXX XXXX 0123');
  assert.equal(ids.maskIdNumber('pan', 'ABCPK1234F'), 'ABCPK****F');
  assert.equal(ids.normaliseName('  Dr. José   O’Brien-Kumar '), 'dr jose o brien kumar');
  assert.equal(ids.surnameInitial('Ramesh Kumar'), 'K');
  assert.ok(ids.nameMatchScore('Asha Rao', 'ASHA SYNTHETIC RAO') >= 0.99);
  assert.ok(ids.nameMatchScore('Asha Rao', 'Vikram Patel') < 0.5);
});

test('content sniffing reads magic bytes, not the declared type', async () => {
  assert.equal(screening.sniffContentType(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer()), 'image/jpeg');
  assert.equal(screening.sniffContentType(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()), 'image/png');
  assert.equal(screening.sniffContentType(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).webp().toBuffer()), 'image/webp');
  assert.equal(screening.sniffContentType(Buffer.from('%PDF-1.7\n%...')), 'application/pdf');
  assert.equal(screening.sniffContentType(Buffer.from('MZ\x90\x00 not an image')), null);
  assert.equal(screening.sniffContentType(Buffer.alloc(0)), null);
});

test('a synthetic signed Secure QR verifies, and one flipped byte breaks it', () => {
  for (const indicator of ['0', '3']) {
    const { body, signature } = buildSecureQr(keys.privateKey, { ...person, indicator });
    const decoded = qrLib.decodeAadhaarQr(qrNumber(Buffer.concat([body, signature])), publicPem);
    assert.equal(decoded.signatureValid, true);
    assert.equal(decoded.fields.format, 'secure_v2');
    assert.equal(decoded.fields.name, person.name);
    assert.equal(decoded.fields.dob, person.dob);
    assert.equal(decoded.fields.last4, person.last4);
    assert.equal(decoded.fields.pincode, '411001');
    assert.deepEqual(decoded.fields.photo, fakePhoto);
    const tampered = Buffer.concat([body, signature]);
    tampered[body.indexOf('Asha')] ^= 0x01;
    assert.equal(qrLib.decodeAadhaarQr(qrNumber(tampered), publicPem).signatureValid, false);
    assert.equal(qrLib.decodeAadhaarQr(qrNumber(Buffer.concat([body, signature])), null).signatureValid, null);
  }
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  const { body, signature } = buildSecureQr(keys.privateKey, person);
  assert.equal(qrLib.decodeAadhaarQr(qrNumber(Buffer.concat([body, signature])), other).signatureValid, false);
  const xml = qrLib.decodeAadhaarQr('<?xml version="1.0"?><PrintLetterBarcodeData uid="234567894321" name="Asha Rao" gender="F" yob="1991" pc="411001"/>', publicPem);
  assert.equal(xml.signatureValid, null);
  assert.equal(xml.fields.last4, '4321');
  assert.equal(qrLib.decodeAadhaarQr('https://example.test/not-aadhaar', publicPem), null);
});

test('EXIF Software naming an editor is flagged', async () => {
  const base = sharp(await sceneImage(900, 700, '6aa0c8'));
  const edited = await (base.withExif ? base.withExif({ IFD0: { Software: 'Adobe Photoshop 25.0 (Windows)' } }) : base.withMetadata({ exif: { IFD0: { Software: 'Adobe Photoshop 25.0 (Windows)' } } })).jpeg({ quality: 90 }).toBuffer();
  const output = await screening.screenDocument({ bytes: edited, contentType: 'image/jpeg', kind: 'site_photo' }, noDuplicates);
  assert.equal(check(output, 'metadata').result, 'warn');
  assert.match(check(output, 'metadata').detail, /Photoshop/);
  assert.equal(check(output, 'integrity').result, 'pass');
  assert.equal(output.width, 900);
  assert.ok(output.derived.some(file => file.key === 'ela' && file.contentType === 'image/png'));
  const wrongType = await screening.screenDocument({ bytes: edited, contentType: 'image/png', kind: 'site_photo' }, noDuplicates);
  assert.equal(check(wrongType, 'integrity').result, 'fail');
  assert.ok(wrongType.userMessages.length > 0);
});

function buildPdf(jpeg, width, height) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`,
  ];
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`;
  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let length = chunks[0].length;
  const push = buffer => { chunks.push(buffer); length += buffer.length; };
  objects.forEach((body, i) => { offsets.push(length); push(Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1')); });
  offsets.push(length);
  push(Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1'));
  push(jpeg);
  push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
  offsets.push(length);
  push(Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`, 'latin1'));
  const xref = length;
  push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

function appendIncrementalUpdate(pdf) {
  const info = Buffer.from('6 0 obj\n<< /Producer (Synthetic Editor) >>\nendobj\n', 'latin1');
  const offset = pdf.length;
  const previous = /startxref\s+(\d+)/.exec(pdf.toString('latin1'))[1];
  const xref = offset + info.length;
  return Buffer.concat([pdf, info, Buffer.from(`xref\n6 1\n${String(offset).padStart(10, '0')} 00000 n \ntrailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R /Prev ${previous} >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1')]);
}

test('a PDF saved twice (two %%EOF markers) is flagged; a single save is not', async () => {
  const jpeg = await sceneImage(640, 480, '8aa070');
  const once = buildPdf(jpeg, 640, 480);
  const first = await screening.screenDocument({ bytes: once, contentType: 'application/pdf', kind: 'other' }, noDuplicates);
  assert.equal(check(first, 'integrity').result, 'pass');
  assert.equal(first.pageCount, 1);
  assert.notEqual(check(first, 'metadata').result, 'warn');
  assert.ok(first.dhash, 'first page image is hashed');
  const twice = await screening.screenDocument({ bytes: appendIncrementalUpdate(once), contentType: 'application/pdf', kind: 'other' }, noDuplicates);
  assert.equal(check(twice, 'metadata').result, 'warn');
  assert.match(check(twice, 'metadata').detail, /Saved 2 times/);
  assert.equal(twice.dhash, first.dhash);
});

test('dHash is stable for a resized copy and differs for a different image', async () => {
  const original = await sceneImage(1200, 900, '3c6e9c');
  const resized = await sharp(original).resize(600).jpeg({ quality: 70 }).toBuffer();
  const different = await sharp(await sceneImage(1200, 900, '3c6e9c')).flop().jpeg().toBuffer();
  const [a, b, c] = await Promise.all([imaging.dHash(original), imaging.dHash(resized), imaging.dHash(different)]);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.ok(imaging.hammingHex(a, b) <= 4, `resized copy distance ${imaging.hammingHex(a, b)}`);
  assert.ok(imaging.hammingHex(a, c) > 10, `different image distance ${imaging.hammingHex(a, c)}`);
  assert.deepEqual(imaging.dHashBands('0123456789abcdef'), ['0:01', '1:23', '2:45', '3:67', '4:89', '5:ab', '6:cd', '7:ef']);
});

test('duplicates from the lookup are reported and raise the risk', async () => {
  const bytes = await sceneImage(800, 600, 'a07850');
  let query;
  const deps = { uidaiCertPem: null, findDuplicates: async q => { query = q; return { exactMatches: 1, nearMatches: 0, sameIdDifferentName: 0 }; } };
  const output = await screening.screenDocument({ bytes, contentType: 'image/jpeg', kind: 'site_photo' }, deps);
  assert.equal(query.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(query.dhashBands.length, 8);
  assert.equal(check(output, 'duplicates').result, 'fail');
  assert.ok(['medium', 'high'].includes(output.risk));
  const failing = await screening.screenDocument({ bytes, contentType: 'image/jpeg', kind: 'site_photo' }, { uidaiCertPem: null, findDuplicates: async () => { throw new Error('offline'); } });
  assert.equal(check(failing, 'duplicates').result, 'unavailable');
});

async function qrImage(text) {
  return QRCode.toBuffer(text, { errorCorrectionLevel: 'L', scale: 6, margin: 4 });
}

test('Secure QR is decoded from an image and verified end to end; tampering is "altered"', async () => {
  const number = validAadhaarEndingWith(person.last4);
  const { body, signature } = buildSecureQr(keys.privateKey, person);
  const good = await qrImage(qrNumber(Buffer.concat([body, signature])));
  const deps = { ...noDuplicates, uidaiCertPem: publicPem };
  const output = await screening.screenDocument({ bytes: good, contentType: 'image/png', kind: 'aadhaar', idNumber: number, reporterName: 'Asha Rao' }, deps);
  assert.equal(check(output, 'aadhaar_qr').result, 'pass', check(output, 'aadhaar_qr').detail);
  assert.equal(output.extracted.qr.name, person.name);
  assert.equal(output.extracted.qr.signatureValid, true);
  assert.equal(output.extracted.qr.hasPhoto, true);
  assert.equal(check(output, 'name_match').result, 'pass');
  assert.notEqual(output.risk, 'altered');
  assert.ok(output.checks.every(item => typeof item.label === 'string' && item.detail));
  assert.ok(!output.userMessages.some(message => /score|risk/i.test(message)));
  const tampered = Buffer.concat([body, signature]);
  tampered[body.indexOf('Pune')] ^= 0x01;
  const altered = await screening.screenDocument({ bytes: await qrImage(qrNumber(tampered)), contentType: 'image/png', kind: 'aadhaar' }, deps);
  assert.equal(check(altered, 'aadhaar_qr').result, 'fail');
  assert.equal(altered.risk, 'altered');
  const unconfigured = await screening.screenDocument({ bytes: good, contentType: 'image/png', kind: 'aadhaar' }, noDuplicates);
  assert.equal(check(unconfigured, 'aadhaar_qr').result, 'unavailable');
  const blank = await screening.screenDocument({ bytes: await sceneImage(1000, 700, '999999'), contentType: 'image/jpeg', kind: 'aadhaar' }, deps);
  assert.equal(check(blank, 'aadhaar_qr').result, 'warn');
  assert.ok(blank.userMessages.some(message => /QR code could not be read/.test(message)));
});

test('typed Aadhaar and PAN numbers are validated and hashed for duplicate lookups', async () => {
  const bytes = await sceneImage(1000, 700, '777777');
  const bad = await screening.screenDocument({ bytes, contentType: 'image/jpeg', kind: 'aadhaar', idNumber: '1234 5678 9012' }, noDuplicates);
  assert.equal(check(bad, 'id_numbers').result, 'fail');
  assert.equal(bad.idNumberHash, null);
  const number = validAadhaar('98765432109');
  const good = await screening.screenDocument({ bytes, contentType: 'image/jpeg', kind: 'aadhaar', idNumber: number, reporterName: '  Asha  RAO ' }, noDuplicates);
  assert.match(good.idNumberHash, /^[0-9a-f]{64}$/);
  assert.equal(good.reporterNameNorm, 'asha rao');
  const company = await screening.screenDocument({ bytes, contentType: 'image/jpeg', kind: 'pan', idNumber: 'ABCCK1234F', reporterName: 'Asha Rao' }, noDuplicates);
  assert.equal(check(company, 'id_numbers').result, 'warn');
  assert.match(check(company, 'id_numbers').detail, /4th letter/);
  const surname = await screening.screenDocument({ bytes, contentType: 'image/jpeg', kind: 'pan', idNumber: 'ABCPK1234F', reporterName: 'Asha Rao' }, noDuplicates);
  assert.match(check(surname, 'id_numbers').detail, /surname initial/);
  const matching = await screening.screenDocument({ bytes, contentType: 'image/jpeg', kind: 'pan', idNumber: 'ABCPR1234F', reporterName: 'Asha Rao' }, noDuplicates);
  assert.doesNotMatch(check(matching, 'id_numbers').detail, /surname initial|4th letter/);
});

test('OCR reads printed identifiers from local language data', { skip: !tessdataDir() && 'OCR language data missing' }, async () => {
  const number = validAadhaar('54321098765');
  const svg = `<svg width="1400" height="420" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>
    <text x="40" y="140" font-size="64" font-family="Arial" fill="#000">DOB: 14/08/1991</text>
    <text x="40" y="300" font-size="72" font-family="Arial" fill="#000">${number.slice(0, 4)} ${number.slice(4, 8)} ${number.slice(8)}</text></svg>`;
  const result = await recognise(await sharp(Buffer.from(svg)).png().toBuffer(), 30000);
  const flat = result.text.replace(/\s/g, '');
  // OCR may misread a glyph; most of the number and the date must survive.
  assert.match(flat, /14\/08\/1991/);
  assert.match(flat, new RegExp(number.slice(4)));
});

test('face models load from bundled data and find no face in a blank card', { skip: !faceModelDir() && 'face models missing' }, async () => {
  const scan = await scanFaces(await sharp({ create: { width: 640, height: 400, channels: 3, background: '#d0d0d0' } }).png().toBuffer());
  assert.equal(scan.faces.length, 0);
  assert.equal(scan.descriptor, null);
});

test('the QR photo decodes from a JPEG 2000 codestream or a JP2 file', async () => {
  const { decodeJpeg2000 } = require('../lib/features/documents/screening/jpeg2000.js');
  const factory = require('@cornerstonejs/codec-openjpeg/wasmjs');
  const codec = await (factory.default ?? factory)({ print: () => undefined, printErr: () => undefined });
  const encoder = new codec.J2KEncoder();
  const width = 48, height = 60, pixels = new Uint8Array(width * height * 3).map((_, i) => (i * 7) % 255);
  encoder.getDecodedBuffer({ width, height, bitsPerSample: 8, componentCount: 3, isSigned: false, isUsingColorTransform: true }).set(pixels);
  encoder.encode();
  const codestream = Buffer.from(encoder.getEncodedBuffer());
  encoder.delete();
  const box = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length + 8); head.write(type, 4, 'latin1'); return Buffer.concat([head, body]); };
  const jp2 = Buffer.concat([box('jP  ', Buffer.from([0x0d, 0x0a, 0x87, 0x0a])), box('ftyp', Buffer.from('jp2 \0\0\0\0jp2 ', 'latin1')), box('jp2c', codestream)]);
  for (const input of [codestream, jp2]) {
    const decoded = await decodeJpeg2000(input);
    assert.deepEqual([decoded.width, decoded.height, decoded.channels], [width, height, 3]);
  }
  assert.equal(await decodeJpeg2000(Buffer.from('not a jpeg 2000 file')), null);
});

test('hostile inputs stay bounded: VID digits, inflated QR fields, oversized QR photo headers', async () => {
  const { extractIdentifiers } = require('../lib/features/documents/screening/textFields.js');
  const { decodeJpeg2000, codestreamSamples } = require('../lib/features/documents/screening/jpeg2000.js');
  let vid = null;
  for (let i = 0; i < 100000 && !vid; i++) {
    const candidate = '9134' + String(i).padStart(8, '0') + '3456';
    if (ids.isValidAadhaar(candidate.slice(0, 12))) vid = candidate;
  }
  const number = validAadhaar('23456789012');
  const printed = `Aadhaar ${number.slice(0, 4)} ${number.slice(4, 8)} ${number.slice(8)}\nVID : ${vid.slice(0, 4)} ${vid.slice(4, 8)} ${vid.slice(8, 12)} ${vid.slice(12)}`;
  assert.deepEqual(extractIdentifiers(printed).aadhaarNumbers, [number]);
  const { body, signature } = buildSecureQr(keys.privateKey, { ...person, name: 'A'.repeat(900000) });
  const decoded = qrLib.decodeAadhaarQr(qrNumber(Buffer.concat([body, signature])), publicPem);
  assert.equal(decoded.signatureValid, true, 'the signature still covers the untruncated payload');
  assert.ok(decoded.fields.name.length <= 200);
  const header = Buffer.alloc(64);
  header.writeUInt16BE(0xff4f, 0); header.writeUInt16BE(0xff51, 2);
  header.writeUInt32BE(60000, 8); header.writeUInt32BE(60000, 12); header.writeUInt16BE(3, 40);
  assert.equal(codestreamSamples(header), 60000 * 60000 * 3);
  assert.equal(await decodeJpeg2000(header), null);
});

test('the UIDAI certificate loader returns null when no certificate is installed', () => {
  const pem = screening.loadUidaiCertificate();
  assert.ok(pem === null || /BEGIN/.test(pem));
  assert.equal(typeof screening.ENGINE_VERSION, 'string');
});
