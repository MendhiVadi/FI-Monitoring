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
  const now = 1_800_000_000_000, MiB = 1024 * 1024, limits = { files: 40, bytes: 60 * MiB };
  assert.deepEqual(rules.chargeUploadQuota(undefined, now, 10, limits), { count: 1, bytes: 10, windowStartedAt: now });
  assert.deepEqual(rules.chargeUploadQuota({ count: 3, bytes: 100, windowStartedAt: now - 1000 }, now, 10, limits), { count: 4, bytes: 110, windowStartedAt: now - 1000 });
  assert.equal(rules.chargeUploadQuota({ count: 40, bytes: 0, windowStartedAt: now - 1000 }, now, 1, limits), null);
  assert.ok(rules.chargeUploadQuota({ count: 39, bytes: 0, windowStartedAt: now - 1000 }, now, 1, limits));
  assert.equal(rules.chargeUploadQuota({ count: 1, bytes: 60 * MiB - 5, windowStartedAt: now - 1000 }, now, 6, limits), null);
  assert.ok(rules.chargeUploadQuota({ count: 1, bytes: 60 * MiB - 6, windowStartedAt: now - 1000 }, now, 6, limits));
  assert.deepEqual(rules.chargeUploadQuota({ count: 40, bytes: 60 * MiB, windowStartedAt: now - DAY }, now, 5, limits), { count: 1, bytes: 5, windowStartedAt: now });
  assert.deepEqual(rules.chargeUploadQuota({ count: 'x', bytes: null, windowStartedAt: now - 1 }, now, 5, limits), { count: 1, bytes: 5, windowStartedAt: now - 1 });
});

test('wave-2 upload quota defaults are 150 files and 300 MiB per connection per day', () => {
  const now = 1_800_000_000_000, MiB = 1024 * 1024;
  assert.deepEqual(rules.DEFAULT_UPLOAD_LIMITS, { files: 150, bytes: 300 * MiB });
  assert.ok(rules.chargeUploadQuota({ count: 149, bytes: 0, windowStartedAt: now - 1000 }, now, 1));
  assert.equal(rules.chargeUploadQuota({ count: 150, bytes: 0, windowStartedAt: now - 1000 }, now, 1), null);
  assert.ok(rules.chargeUploadQuota({ count: 1, bytes: 300 * MiB - 6, windowStartedAt: now - 1000 }, now, 6));
  assert.equal(rules.chargeUploadQuota({ count: 1, bytes: 300 * MiB - 5, windowStartedAt: now - 1000 }, now, 6), null);
});

test('int params fall back to their declared default when the runtime has no value', () => {
  const { limitValue } = require('../lib/features/disputes/params.js');
  const limits = require('../lib/platform/limits.js');
  const expected = { otpSendsPerIpHour: 30, reportsPerIpDay: 20, uploadsPerIpDay: 150, uploadBytesPerIpDayMib: 300, statusLookupsPerIpHour: 30 };
  for (const [name, value] of Object.entries(expected)) assert.equal(limitValue(limits[name]), value, name);
  const fake = (value, fallback) => ({ value: () => value, options: { default: fallback } });
  assert.equal(limitValue(fake(12, 30)), 12);
  for (const bad of [0, -3, NaN, 1.5]) assert.equal(limitValue(fake(bad, 30)), 30);
  assert.equal(limitValue(fake(0, undefined)), 1);
});

test('new cases carry service targets, explicit unassigned and not-overdue fields', () => {
  const { serviceTargets } = require('../lib/features/disputes/service.js');
  const now = 1_800_000_000_000;
  assert.deepEqual(serviceTargets(now), { ackDueAt: now + contract.serviceTargets.acknowledgeDays * DAY,
    resolveDueAt: now + contract.serviceTargets.resolveDays * DAY, firstActionAt: null, overdue: null });
  assert.equal(serviceTargets(now).ackDueAt - now, 3 * DAY);
  assert.equal(serviceTargets(now).resolveDueAt - now, 30 * DAY);
});

test('staff writes record uid, email, display name or null, and role', () => {
  const { officerFields } = require('../lib/features/documents/service.js');
  assert.deepEqual(officerFields({ uid: 'u1', email: 'staff@example.invalid', displayName: ' Synthetic Officer ', role: 'District officer', access: 'officer' }),
    { officerUid: 'u1', officerEmail: 'staff@example.invalid', officerName: 'Synthetic Officer', officerRole: 'District officer' });
  assert.deepEqual(officerFields({ uid: 'u2', email: '', access: 'admin' }), { officerUid: 'u2', officerEmail: null, officerName: null, officerRole: 'admin' });
  assert.deepEqual(officerFields({ uid: 'u3', email: 'x@example.invalid', displayName: 42, role: '' }), { officerUid: 'u3', officerEmail: 'x@example.invalid', officerName: null, officerRole: null });
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
  assert.equal(rules.validateFileRequest({ documentId: ok.documentId, variant: 'copyMove' }).variant, 'copyMove');
  for (const variant of ['thumbnail', '__proto__', '../original', 'copy-move']) assert.throws(() => rules.validateFileRequest({ documentId: ok.documentId, variant }), rules.DocumentInputError);
});

test('every derived variant has a stored name and content type under the document prefix', () => {
  const storage = require('../lib/features/documents/storage.js');
  assert.equal(storage.DERIVED_NAMES.copyMove, 'copy-move.png');
  assert.equal(storage.VARIANT_TYPES.copyMove, 'image/png');
  for (const variant of rules.FILE_VARIANTS.filter(v => v !== 'original')) {
    assert.ok(storage.DERIVED_NAMES[variant], variant); assert.match(storage.VARIANT_TYPES[variant], /^image\//);
  }
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

function companionDb(rows) {
  const query = filters => ({
    where: (field, op, value) => query([...filters, [field, value]]),
    select: () => query(filters),
    limit: () => ({ get: async () => ({ docs: rows.filter(row => filters.every(([field, value]) => row[field] === value))
      .map(row => ({ id: row.id, data: () => row, get: key => row[key] })) }) }),
  });
  return { collection: () => query([]) };
}

test('companion lookup returns the latest usable document of a kind in the same submission or case', async () => {
  const { findCompanion } = require('../lib/features/documents/service.js');
  const now = 1_800_000_000_000, ts = ms => ({ toMillis: () => ms });
  const mine = { phoneHash: 'p1', addressHash: 'a1' };
  const row = (id, extra) => ({ id, kind: 'aadhaar', submissionId: 's1', status: 'pending', ticketId: null, ...mine, expiresAt: now + 1000,
    uploadedAt: ts(now - 5000), contentType: 'image/jpeg', storage: { original: 'case-documents/' + id + '/original' }, ...extra });
  const rows = [
    row('older', { uploadedAt: ts(now - 9000) }),
    row('latest', { uploadedAt: ts(now - 1000) }),
    row('replaced', { uploadedAt: ts(now - 10), supersededBy: 'latest' }),
    row('lapsed', { uploadedAt: ts(now - 20), expiresAt: now - 1 }),
    row('someone-else', { uploadedAt: ts(now - 30), phoneHash: 'p2' }),
    row('in-flight-replacement', { uploadedAt: ts(now - 40), replacementFor: 'synthetic-request' }),
    row('self', { uploadedAt: ts(now) }),
    row('case-old', { submissionId: 's0', status: 'attached', ticketId: 't1', uploadedAt: ts(now - 9000) }),
    row('case-new', { submissionId: 's0', status: 'attached', ticketId: 't1', uploadedAt: ts(now - 100) }),
    row('case-superseded', { submissionId: 's0', status: 'attached', ticketId: 't1', uploadedAt: ts(now - 50), supersededBy: 'case-new' }),
    row('bad-path', { submissionId: 's9', storage: { original: 'case-documents/elsewhere/original' } }),
  ];
  const reads = [];
  const store = { read: async path => { reads.push(path); return Buffer.from(path); } };
  const db = companionDb(rows);
  const found = await findCompanion(db, store, { submissionId: 's1', caller: mine }, 'self', 'aadhaar', now);
  assert.deepEqual(found, { bytes: Buffer.from('case-documents/latest/original'), contentType: 'image/jpeg' });
  // Guests bind by address; a phone-bound upload is not theirs.
  assert.equal(await findCompanion(db, store, { submissionId: 's1', caller: { phoneHash: null, addressHash: 'a1' } }, 'self', 'aadhaar', now), null);
  const forCase = await findCompanion(db, store, { ticketId: 't1' }, 'self', 'aadhaar', now);
  assert.equal(forCase.bytes.toString(), 'case-documents/case-new/original');
  assert.equal(await findCompanion(db, store, { submissionId: 's9', caller: mine }, 'self', 'aadhaar', now), null);
  assert.equal(await findCompanion(db, store, { submissionId: 's1', caller: mine }, 'self', 'selfie', now), null);
  assert.equal(await findCompanion(db, store, { submissionId: 's1', caller: mine }, 'self', '__proto__', now), null);
  assert.deepEqual(reads, ['case-documents/latest/original', 'case-documents/case-new/original']);
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

// A transaction-capable stand-in for the review path: documents by path, equality queries only.
function reviewDb(initial) {
  const store = new Map(Object.entries(initial));
  let auto = 0;
  const ref = path => ({ id: path.split('/').pop(), path, collection: name => ({ doc: id => ref(path + '/' + name + '/' + (id ?? 'auto-' + ++auto)) }) });
  const snap = target => ({ id: target.id, ref: target, exists: store.has(target.path), data: () => store.get(target.path), get: key => store.get(target.path)?.[key] });
  const query = (name, filters) => ({ query: true, name, filters, where: (field, op, value) => query(name, [...filters, [field, value]]), limit: () => query(name, filters) });
  const db = {
    collection: name => ({ doc: id => ref(name + '/' + id), where: (field, op, value) => query(name, [[field, value]]) }),
    runTransaction: async work => work({
      get: async target => target.query
        ? { docs: [...store].filter(([path, data]) => path.split('/').length === 2 && path.startsWith(target.name + '/')
          && target.filters.every(([field, value]) => data[field] === value)).map(([path]) => snap(ref(path))) }
        : snap(target),
      getAll: async (...targets) => targets.map(snap),
      update: (target, data) => store.set(target.path, { ...store.get(target.path), ...data }),
      create: (target, data) => { assert.ok(!store.has(target.path), 'create over ' + target.path); store.set(target.path, data); },
    }),
  };
  return { db, store };
}

test('a re-upload review records the officer, acknowledges the case and opens one document request', async () => {
  const { reviewDocument } = require('../lib/features/documents/service.js');
  const now = Date.now();
  const { db, store } = reviewDb({
    'tickets/t1': { status: 'open', revision: 2, firstActionAt: null, overdue: 'acknowledge', ackDueAt: now - 1000, resolveDueAt: now + 30 * DAY, openDocumentRequests: 0 },
    'caseDocuments/d1': { status: 'attached', ticketId: 't1', kind: 'aadhaar', review: null, supersededBy: null },
  });
  const officer = { uid: 'officer-1', email: 'staff@example.invalid', displayName: 'Synthetic Officer', role: 'District officer', access: 'officer' };
  const staff = { officerUid: 'officer-1', officerEmail: 'staff@example.invalid', officerName: 'Synthetic Officer', officerRole: 'District officer' };
  const ask = requestId => reviewDocument(db, officer, { documentId: 'd1', decision: 'reupload_requested', reason: 'Blurred photo', requestId });
  const { review } = await ask('request-0001');
  assert.equal(review.decision, 'reupload_requested');
  assert.deepEqual({ ...store.get('caseDocuments/d1').review, at: undefined, expiresAt: 0 }, { decision: 'reupload_requested', reason: 'Blurred photo', by: 'officer-1',
    byEmail: 'staff@example.invalid', ...staff, at: undefined, expiresAt: 0 });
  const event = store.get('tickets/t1/events/request-0001');
  assert.equal(event.type, 'document_review');
  for (const [field, value] of Object.entries(staff)) assert.equal(event[field], value, field);
  const request = store.get('documentRequests/request-0001');
  assert.deepEqual({ ...request, requestedAt: 0, expiresAt: 0 }, { ticketId: 't1', documentId: 'd1', kind: 'aadhaar', requestedAt: 0, expiresAt: 0,
    fulfilledAt: null, fulfilledDocumentId: null });
  assert.equal(request.expiresAt - request.requestedAt, rules.REPLACEMENT_TTL_MS);
  // The review carries the request's server expiry (ms), for the dossier.
  assert.equal(store.get('caseDocuments/d1').review.expiresAt, request.expiresAt);
  assert.equal(review.expiresAt, request.expiresAt);
  const ticket = store.get('tickets/t1');
  assert.equal(ticket.openDocumentRequests, 1);
  assert.equal(ticket.revision, 3);
  assert.equal(typeof ticket.firstActionAt, 'number');
  assert.equal(ticket.overdue, null);
  assert.ok([...store.keys()].some(path => path.startsWith('tickets/t1/events/auto-') && store.get(path).type === 'escalation'));

  // A retry with the same reference changes nothing.
  const before = JSON.stringify([...store]);
  await ask('request-0001');
  assert.equal(JSON.stringify([...store]), before);
  // Asking again while the request is open records the review only.
  await ask('request-0002');
  assert.equal(store.has('documentRequests/request-0002'), false);
  assert.equal(store.get('tickets/t1').openDocumentRequests, 1);
  assert.equal(store.get('caseDocuments/d1').review.expiresAt, request.expiresAt);
  assert.equal(store.get('tickets/t1').firstActionAt, ticket.firstActionAt);
});
