const assert = require('node:assert/strict');
const test = require('node:test');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.DISPUTE_OTP_SECRET = 'test-secret-not-a-real-key';
const status = require('../lib/features/status/rules.js');
const { DocumentInputError } = require('../lib/features/documents/rules.js');
const contract = require('../lib/platform/contracts/dispute.json');
const HOUR = 3_600_000, DAY = 86_400_000;
const reference = 'AbCdEfGhIjKlMnOpQrSt';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const replacement = { reference, requestId: 'synthetic-request-0001', phone: '+12025550123', verificationToken: 'a'.repeat(64),
  fileName: '../scan.jpg', contentType: 'image/jpeg', dataBase64: jpeg };

test('the status module exports both public callables', () => {
  const handlers = require('../lib/features/status/handlers.js');
  for (const name of ['getCaseStatus', 'uploadReplacementDocument']) assert.equal(typeof handlers[name], 'function', name);
});

test('references are exactly 20 letters or digits', () => {
  assert.equal(status.validCaseReference(reference), true);
  for (const bad of ['', reference.slice(1), reference + 'x', 'AbCdEfGhIjKlMnOpQr-t', 'AbCdEfGhIjKlMnOpQr/t', '../AbCdEfGhIjKlMnOpQ', 42, null, undefined]) {
    assert.equal(status.validCaseReference(bad), false, String(bad));
  }
});

test('status lookups are capped per connection in a fixed hourly window', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(status.chargeLookup(undefined, now), { count: 1, windowStartedAt: now });
  assert.deepEqual(status.chargeLookup({ count: 29, windowStartedAt: now - 1000 }, now), { count: 30, windowStartedAt: now - 1000 });
  assert.equal(status.chargeLookup({ count: 30, windowStartedAt: now - 1000 }, now), null);
  assert.deepEqual(status.chargeLookup({ count: 30, windowStartedAt: now - HOUR }, now), { count: 1, windowStartedAt: now });
  assert.equal(status.chargeLookup({ count: 5, windowStartedAt: now - 1 }, now, 5), null);
  // A broken limit never means "unlimited".
  for (const limit of [0, -1, NaN, undefined]) assert.equal(status.chargeLookup({ count: 30, windowStartedAt: now - 1 }, now, limit), null);
  assert.deepEqual(status.chargeLookup({ count: 'x', windowStartedAt: now - 1 }, now), { count: 1, windowStartedAt: now - 1 });
});

test('replacement uploads are validated before any read', () => {
  const parsed = status.validateReplacementRequest({ ...replacement, idNumber: ' 2345 6789 0123 ' });
  assert.equal(parsed.phone, '+12025550123'); assert.equal(parsed.token, 'a'.repeat(64));
  assert.equal(parsed.upload.reference, reference); assert.equal(parsed.upload.requestId, replacement.requestId);
  assert.equal(parsed.upload.fileName, 'scan.jpg'); assert.equal(parsed.upload.contentType, 'image/jpeg');
  assert.equal(parsed.upload.bytes.length, 7); assert.equal(parsed.upload.idNumber, '2345 6789 0123');
  assert.equal(status.validateReplacementRequest({ ...replacement, reference: ' ' + reference + ' ' }).upload.reference, reference);
  // Missing proof is not a format error: the service answers "verify your phone".
  const unverified = status.validateReplacementRequest({ ...replacement, phone: undefined, verificationToken: 'not-a-token' });
  assert.equal(unverified.phone, ''); assert.equal(unverified.token, '');
  for (const bad of [{ reference: 'short' }, { reference: '__proto__' }, { requestId: 'x' }, { requestId: '../../etc' }, { phone: '12345' },
    { contentType: 'image/gif' }, { dataBase64: '' }, { dataBase64: '@@@@' }, { idNumber: '2345<script>' },
    { dataBase64: Buffer.alloc(contract.documents.maxFileBytes + 1).toString('base64') }]) {
    assert.throws(() => status.validateReplacementRequest({ ...replacement, ...bad }), DocumentInputError, JSON.stringify(Object.keys(bad)));
  }
  for (const bad of [null, [], 'x']) assert.throws(() => status.validateReplacementRequest(bad), DocumentInputError);
});

test('the public status projection carries status, dates and open requests only', () => {
  const now = 1_800_000_000_000, ts = ms => ({ toMillis: () => ms });
  const ticket = { status: 'investigating', createdAt: ts(now - 10 * DAY), updatedAt: ts(now - DAY),
    // Present on the record, never in the projection.
    waFrom: '+12025550123', subject: 'Synthetic subject', dispute: { reporterName: 'Synthetic', description: 'Synthetic narrative', location: { latitude: 18, longitude: 73 } } };
  const events = [
    { after: 'investigating', at: ts(now - 2 * DAY), reason: 'Synthetic private reason', officerUid: 'staff' },
    { after: 'inspection_scheduled', at: ts(now - 5 * DAY), reason: 'Synthetic private reason' },
    { after: '__proto__', at: ts(now - 3 * DAY) },
    { after: 'resolved', at: null },
  ];
  const requests = [
    { id: 'synthetic-request-b', kind: 'pan', requestedAt: now - 2 * DAY, expiresAt: now + DAY, fulfilledAt: null, documentId: 'secret-doc', ticketId: reference },
    { id: 'synthetic-request-a', kind: 'aadhaar', requestedAt: now - 3 * DAY, expiresAt: now + DAY, fulfilledAt: null },
    { id: 'synthetic-request-done', kind: 'aadhaar', requestedAt: now - 4 * DAY, expiresAt: now + DAY, fulfilledAt: now - DAY },
    { id: 'synthetic-request-lapsed', kind: 'aadhaar', requestedAt: now - 20 * DAY, expiresAt: now - 1, fulfilledAt: null },
  ];
  const result = status.projectCaseStatus(reference, ticket, events, requests, now);
  assert.deepEqual(result, {
    reference, statusId: 'investigating', statusLabel: 'Under Investigation', filedAt: now - 10 * DAY, lastUpdatedAt: now - DAY,
    timeline: [
      { statusLabel: 'Open / Awaiting Review', at: now - 10 * DAY },
      { statusLabel: 'Field Inspection Scheduled', at: now - 5 * DAY },
      { statusLabel: 'Under Investigation', at: now - 2 * DAY },
    ],
    documentRequests: [
      { requestId: 'synthetic-request-a', kind: 'aadhaar', kindLabel: contract.documents.kinds.find(k => k.id === 'aadhaar').label, requestedAt: now - 3 * DAY, expiresAt: now + DAY },
      { requestId: 'synthetic-request-b', kind: 'pan', kindLabel: 'PAN card', requestedAt: now - 2 * DAY, expiresAt: now + DAY },
    ],
  });
  const text = JSON.stringify(result);
  for (const secret of ['+1202', 'Synthetic', 'private reason', 'secret-doc', 'staff', 'latitude']) assert.equal(text.includes(secret), false, secret);
});

test('the projection tolerates legacy records and bounds the timeline', () => {
  const now = 1_800_000_000_000;
  const legacy = status.projectCaseStatus(reference, { status: 'archived' }, [], [], now);
  assert.deepEqual(legacy, { reference, statusId: 'archived', statusLabel: 'Under review', filedAt: null, lastUpdatedAt: null, timeline: [], documentRequests: [] });
  const wire = status.projectCaseStatus(reference, { createdAt: { seconds: 1_700_000_000, nanoseconds: 0 } }, [], [], now);
  assert.equal(wire.statusId, 'open'); assert.equal(wire.filedAt, 1_700_000_000_000); assert.equal(wire.lastUpdatedAt, 1_700_000_000_000);
  const many = Array.from({ length: 120 }, (_, i) => ({ after: i % 2 ? 'open' : 'investigating', at: now - 1000 + i }));
  const bounded = status.projectCaseStatus(reference, { status: 'open', createdAt: now - DAY }, many, [], now);
  assert.equal(bounded.timeline.length, status.MAX_TIMELINE);
  assert.deepEqual(bounded.timeline[0], { statusLabel: 'Open / Awaiting Review', at: now - DAY });
  assert.equal(bounded.timeline.at(-1).at, now - 1000 + 119);
});
