const assert = require('node:assert/strict');
const test = require('node:test');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.DISPUTE_OTP_SECRET = 'test-secret-not-a-real-key';
const rules = require('../lib/features/documents/rules.js');
const { closureUpdate } = require('../lib/features/tickets/closure.js');
const { findDuplicateDocuments } = require('../lib/features/documents/duplicates.js');
const contract = require('../lib/platform/contracts/dispute.json');
const DAY = 86_400_000;
const base64 = bytes => Buffer.from(bytes).toString('base64');
const upload = { submissionId: 'synthetic-submission-0001', kind: 'aadhaar', fileName: 'card.jpg', contentType: 'image/jpeg', dataBase64: base64([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) };

test('deployment surface exports the document callables and the purge', () => {
  const deployed = require('../lib/index.js');
  for (const name of ['uploadDisputeDocument', 'removeDisputeDocument', 'getCaseDocumentFile', 'reviewCaseDocument', 'purgeExpiredDocuments', 'submitDispute']) assert.ok(deployed[name], name);
});

test('case type follows the other party: individuals are person vs person, everything else citizen vs government', () => {
  assert.equal(rules.caseTypeFor('Individual / private person'), 'person_vs_person');
  for (const party of contract.partyTypes.filter(p => p !== 'Individual / private person')) assert.equal(rules.caseTypeFor(party), 'citizen_vs_government');
  for (const odd of ['__proto__', 'constructor', 'invented', '']) assert.equal(rules.caseTypeFor(odd), 'citizen_vs_government');
});

test('required kinds are checked per case type, and extra kinds never satisfy a missing one', () => {
  assert.deepEqual(rules.missingRequiredKinds('citizen_vs_government', []), ['aadhaar']);
  assert.deepEqual(rules.missingRequiredKinds('citizen_vs_government', ['aadhaar', 'site_photo']), []);
  assert.deepEqual(rules.missingRequiredKinds('person_vs_person', ['aadhaar', 'pan', 'site_photo']), ['ownership_deed', 'land_record', 'possession_proof']);
  assert.deepEqual(rules.missingRequiredKinds('person_vs_person', contract.documents.caseTypes.person_vs_person.required), []);
});

test('ticket summary counts files, lists kinds once in contract order and flags high or altered risk', () => {
  const summary = rules.documentSummary('person_vs_person', [{ kind: 'pan', risk: 'low' }, { kind: 'aadhaar', risk: 'altered' }, { kind: 'site_photo', risk: 'high' }, { kind: 'site_photo', risk: 'medium' }, { kind: 'aadhaar' }]);
  assert.deepEqual(summary, { caseType: 'person_vs_person', count: 5, kinds: ['aadhaar', 'pan', 'site_photo'], flagged: 2 });
});

test('upload validation accepts a well-formed file and keeps ID numbers only for ID kinds', () => {
  const valid = rules.validateUploadRequest({ ...upload, idNumber: ' 2345 6789 0123 ', reporterName: ' Synthetic Reporter ' });
  assert.equal(valid.kind, 'aadhaar'); assert.equal(valid.side, 'reporter'); assert.equal(valid.bytes.length, 7);
  assert.equal(valid.idNumber, '2345 6789 0123'); assert.equal(valid.reporterName, 'Synthetic Reporter');
  assert.equal(rules.validateUploadRequest({ ...upload, kind: 'site_photo', idNumber: '234567890123' }).idNumber, null);
  assert.equal(rules.validateUploadRequest({ ...upload, kind: 'other_party_document' }).side, 'other_party');
  assert.equal(rules.validateUploadRequest({ ...upload, dataBase64: 'data:image/jpeg;base64,' + upload.dataBase64 }).bytes.length, 7);
  assert.equal(rules.validateUploadRequest({ ...upload, contentType: 'IMAGE/JPEG' }).contentType, 'image/jpeg');
});

test('upload validation rejects bad references, kinds, types, encodings and sizes', () => {
  const tooBig = 'A'.repeat(Math.ceil(contract.documents.maxFileBytes / 3) * 4 + 8);
  const justOver = base64(Buffer.alloc(contract.documents.maxFileBytes + 1));
  for (const bad of [{ submissionId: 'short' }, { submissionId: 'x'.repeat(81) }, { kind: '__proto__' }, { kind: 'passport' },
    { contentType: 'image/gif' }, { contentType: 'text/html' }, { dataBase64: '' }, { dataBase64: '@@@@' }, { dataBase64: 'abcde' },
    { dataBase64: tooBig }, { dataBase64: justOver }, { idNumber: '2345<script>' }, { idNumber: '1'.repeat(25) }, { reporterName: 'x'.repeat(contract.nameMax + 1) }]) {
    assert.throws(() => rules.validateUploadRequest({ ...upload, ...bad }), rules.DocumentInputError, JSON.stringify(Object.keys(bad)));
  }
  assert.throws(() => rules.validateUploadRequest(null), rules.DocumentInputError);
  assert.throws(() => rules.validateUploadRequest([upload]), rules.DocumentInputError);
  assert.equal(rules.validateUploadRequest({ ...upload, dataBase64: base64(Buffer.alloc(contract.documents.maxFileBytes, 1)) }).bytes.length, contract.documents.maxFileBytes);
});

test('file names lose paths and unsafe characters but stay readable', () => {
  assert.equal(rules.sanitiseFileName('../../etc/passwd'), 'passwd');
  assert.equal(rules.sanitiseFileName('C:\\Users\\a\\scan 01.pdf'), 'scan 01.pdf');
  assert.equal(rules.sanitiseFileName('a\u0000b<c>"d".jpg'), 'a_b_c_d_.jpg');
  assert.equal(rules.sanitiseFileName('  ..hidden.png'), 'hidden.png');
  assert.equal(rules.sanitiseFileName('खसरा नक्शा.pdf').includes('खसरा'), true);
  assert.equal(rules.sanitiseFileName('x'.repeat(300)).length, 120);
  assert.equal(/[\uD800-\uDBFF]$/.test(rules.sanitiseFileName('a' + '\u{1D400}'.repeat(70))), false);
  for (const empty of ['', '   ', undefined, 42, '/']) assert.equal(rules.sanitiseFileName(empty), 'document');
});

test('submission document ids are bounded, well-formed and de-duplicated', () => {
  const id = 'AbCdEfGhIjKlMnOpQrSt';
  assert.deepEqual(rules.validateDocumentIds(undefined), []);
  assert.deepEqual(rules.validateDocumentIds([id, id]), [id]);
  for (const bad of ['x', [id.slice(1)], [id + '/x'], ['../' + id.slice(3)], Array(13).fill(id), [42]]) assert.throws(() => rules.validateDocumentIds(bad), rules.DocumentInputError);
});

test('uploads bind to the verified phone, otherwise to the address bucket', () => {
  assert.equal(rules.ownsDocument({ phoneHash: 'p1', addressHash: 'a1' }, { phoneHash: 'p1', addressHash: 'a2' }), true);
  assert.equal(rules.ownsDocument({ phoneHash: 'p1', addressHash: 'a1' }, { phoneHash: null, addressHash: 'a1' }), false);
  assert.equal(rules.ownsDocument({ phoneHash: 'p1' }, { phoneHash: 'p2', addressHash: 'a1' }), false);
  assert.equal(rules.ownsDocument({ phoneHash: null, addressHash: 'a1' }, { phoneHash: null, addressHash: 'a1' }), true);
  assert.equal(rules.ownsDocument({ phoneHash: null, addressHash: 'a1' }, { phoneHash: null, addressHash: 'a2' }), false);
});

test('per-connection upload quota caps count and bytes in a rolling day', () => {
  const now = 1_800_000_000_000, MiB = 1024 * 1024;
  assert.deepEqual(rules.chargeUploadQuota(undefined, now, 10), { count: 1, bytes: 10, windowStartedAt: now });
  assert.deepEqual(rules.chargeUploadQuota({ count: 3, bytes: 100, windowStartedAt: now - 1000 }, now, 10), { count: 4, bytes: 110, windowStartedAt: now - 1000 });
  assert.equal(rules.chargeUploadQuota({ count: 40, bytes: 0, windowStartedAt: now - 1000 }, now, 1), null);
  assert.ok(rules.chargeUploadQuota({ count: 39, bytes: 0, windowStartedAt: now - 1000 }, now, 1));
  assert.equal(rules.chargeUploadQuota({ count: 1, bytes: 60 * MiB - 5, windowStartedAt: now - 1000 }, now, 6), null);
  assert.ok(rules.chargeUploadQuota({ count: 1, bytes: 60 * MiB - 6, windowStartedAt: now - 1000 }, now, 6));
  assert.deepEqual(rules.chargeUploadQuota({ count: 40, bytes: 60 * MiB, windowStartedAt: now - DAY }, now, 5), { count: 1, bytes: 5, windowStartedAt: now });
  assert.deepEqual(rules.chargeUploadQuota({ count: 'x', bytes: null, windowStartedAt: now - 1 }, now, 5), { count: 1, bytes: 5, windowStartedAt: now - 1 });
});

test('perceptual hash distance counts differing bits and never matches malformed hashes', () => {
  assert.equal(rules.hammingDistance('00ff00ff00ff00ff', '00ff00ff00ff00ff'), 0);
  assert.equal(rules.hammingDistance('0000000000000000', '0000000000000001'), 1);
  assert.equal(rules.hammingDistance('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(rules.hammingDistance('0000000000000000', '000000000000003f'), 6);
  for (const bad of ['', 'zz00000000000000', '00', null]) assert.equal(rules.hammingDistance('0000000000000000', bad), Infinity);
});

test('review and file requests are validated before any read', () => {
  const ok = { documentId: 'AbCdEfGhIjKlMnOpQrSt', decision: 'accepted', reason: '  Matches the QR  ', requestId: 'synthetic-request-0001' };
  assert.equal(rules.validateReviewRequest(ok).reason, 'Matches the QR');
  for (const decision of rules.REVIEW_DECISIONS) assert.equal(rules.validateReviewRequest({ ...ok, decision }).decision, decision);
  for (const bad of [{ decision: 'approve' }, { decision: '__proto__' }, { reason: 'no' }, { reason: 'x'.repeat(501) }, { requestId: 'short' }, { documentId: '../x' }]) {
    assert.throws(() => rules.validateReviewRequest({ ...ok, ...bad }), rules.DocumentInputError);
  }
  assert.deepEqual(rules.validateFileRequest({ documentId: ok.documentId }), { documentId: ok.documentId, variant: 'original' });
  assert.equal(rules.validateFileRequest({ documentId: ok.documentId, variant: 'faceQr' }).variant, 'faceQr');
  for (const variant of ['thumbnail', '__proto__', '../original']) assert.throws(() => rules.validateFileRequest({ documentId: ok.documentId, variant }), rules.DocumentInputError);
});

test('closing starts the retention clock, reopening clears it, closed-to-closed keeps it', () => {
  const now = 1_800_000_000_000, purgeAt = now + contract.documents.retentionDaysAfterClose * DAY;
  assert.deepEqual(closureUpdate('open', 'resolved', undefined, now), { closedAt: now, purgeAt });
  assert.deepEqual(closureUpdate('investigating', 'rejected', undefined, now), { closedAt: now, purgeAt });
  assert.equal(closureUpdate('resolved', 'rejected', now - 5000, now), null);
  assert.deepEqual(closureUpdate('resolved', 'rejected', undefined, now), { closedAt: now, purgeAt });
  assert.deepEqual(closureUpdate('resolved', 'open', now - 5000, now), { closedAt: null, purgeAt: null });
  assert.equal(closureUpdate('open', 'investigating', undefined, now), null);
});

function fakeDb(rows) {
  const queries = [];
  const query = (filters) => ({
    where: (field, op, value) => query([...filters, [field, op, value]]),
    select: () => query(filters),
    limit: () => ({ get: async () => {
      queries.push(filters);
      const docs = rows.filter(row => filters.every(([field, op, value]) => op === '==' ? row[field] === value
        : (row[field] || []).some(item => value.includes(item))));
      return { docs: docs.map(row => ({ get: key => row[key] })) };
    } }),
  });
  return { collection: () => query([]), queries };
}

test('duplicate lookups ignore the same submission and confirm near matches by full distance', async () => {
  const mine = 'synthetic-submission-mine';
  const bands = ['0:00', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00', '7:00'];
  const db = fakeDb([
    { submissionId: mine, sha256: 'h1', dhash: '0000000000000000', dhashBands: bands, idNumberHash: 'id1', reporterNameNorm: 'other name' },
    { submissionId: 'other-a', sha256: 'h1', dhash: '0000000000000000', dhashBands: bands, idNumberHash: 'id1', reporterNameNorm: 'synthetic reporter' },
    { submissionId: 'other-b', sha256: 'h2', dhash: '000000000000003f', dhashBands: bands, idNumberHash: 'id1', reporterNameNorm: 'someone else' },
    { submissionId: 'other-c', sha256: 'h3', dhash: '00000000000000ff', dhashBands: bands, idNumberHash: null, reporterNameNorm: null },
    { submissionId: 'other-d', sha256: 'h4', dhash: 'ffffffffffffffff', dhashBands: ['0:ff'], idNumberHash: 'id1', reporterNameNorm: null },
  ]);
  const report = await findDuplicateDocuments(db, mine, { sha256: 'h1', dhash: '0000000000000000', dhashBands: bands, idNumberHash: 'id1', reporterNameNorm: 'synthetic reporter' });
  assert.deepEqual(report, { exactMatches: 1, nearMatches: 1, sameIdDifferentName: 1 });
  assert.deepEqual(await findDuplicateDocuments(db, mine, { sha256: 'h9', dhash: null, dhashBands: bands, idNumberHash: 'id1', reporterNameNorm: null }),
    { exactMatches: 0, nearMatches: 0, sameIdDifferentName: 0 });
  // A middle initial on one side is the same person, not a different name.
  const named = fakeDb([{ submissionId: 'other-e', sha256: 'h5', dhash: null, dhashBands: [], idNumberHash: 'id2', reporterNameNorm: 'asha s rao' }]);
  for (const [name, expected] of [['asha rao', 0], ['Asha S. Rao', 0], ['ravi rao', 1]]) {
    const result = await findDuplicateDocuments(named, mine, { sha256: 'h9', dhash: null, dhashBands: [], idNumberHash: 'id2', reporterNameNorm: name });
    assert.equal(result.sameIdDifferentName, expected, name);
  }
});

test('the fallback magic-byte test agrees with the screening engine', () => {
  const { sniffContentType } = require('../lib/features/documents/screening/index.js');
  const samples = [
    [0xff, 0xd8, 0xff, 0xe0, 1], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0], [...Buffer.from('RIFF\0\0\0\0WEBPVP8 ')],
    [...Buffer.from('junk%PDF-1.7\n')], [...Buffer.from('GIF89a')], [0xff, 0xd8], [],
  ].map(bytes => Buffer.from(bytes));
  for (const bytes of samples) assert.equal(rules.sniffDocumentType(bytes), sniffContentType(bytes));
  assert.equal(rules.sniffDocumentType(Buffer.from('GIF89a')), null);
});
