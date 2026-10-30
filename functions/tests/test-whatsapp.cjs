// WhatsApp notification throttle and re-upload notice. No emulator: the
// delivery transaction runs against a small in-memory stand-in for Firestore,
// and every provider call is intercepted. Synthetic numbers only.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash, createHmac } = require('node:crypto');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.DISPUTE_OTP_SECRET = 'test-secret-not-a-real-key';
process.env.WHATSAPP_ACCESS_TOKEN = 'synthetic-never-valid';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'synthetic-never-valid';
const firebase = require('../lib/platform/firebase.js');
const { chargeNotificationLimit, NOTIFICATIONS_PER_HOUR, NOTIFICATIONS_PER_DAY } = require('../lib/features/whatsapp/throttle.js');
const { ticketUpdateNotice, REUPLOAD_REQUESTED_TEXT } = require('../lib/features/whatsapp/updates.js');
const { deliverTicketNotification } = require('../lib/features/whatsapp/delivery.js');
const { notifyWhatsAppOnTicketUpdate } = require('../lib/features/whatsapp/notifications.js');

const HOUR = 3_600_000, DAY = 86_400_000, T0 = 1_800_000_000_000;
const phoneHash = phone => createHmac('sha256', process.env.DISPUTE_OTP_SECRET).update(phone).digest('hex');
const deliveryId = eventId => createHash('sha256').update(eventId).digest('hex');

// Enough of the Admin SDK surface for delivery.ts: refs, getAll/get, and
// set/update applied on commit. Values keep Timestamp-like helpers intact.
function memoryFirestore() {
  const docs = new Map();
  const ref = path => ({ path, id: path.split('/').at(-1) });
  const snapshot = r => { const value = docs.get(r.path); return { exists: value !== undefined, id: r.id, ref: r, data: () => value && { ...value } }; };
  return {
    docs, read: path => docs.get(path),
    collection: name => ({ doc: id => ref(name + '/' + id) }),
    async runTransaction(fn) {
      const writes = [];
      const result = await fn({
        getAll: async (...refs) => refs.map(snapshot), get: async r => snapshot(r),
        set: (r, data, options) => writes.push(() => docs.set(r.path, options?.merge ? { ...docs.get(r.path), ...data } : { ...data })),
        update: (r, data) => writes.push(() => { if (!docs.has(r.path)) throw new Error('NOT_FOUND'); docs.set(r.path, { ...docs.get(r.path), ...data }); }),
      });
      for (const write of writes) write();
      return result;
    },
  };
}
function withProvider(respond) {
  const original = global.fetch, sent = [];
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).hostname, 'graph.facebook.com');
    const payload = JSON.parse(options.body);
    assert.match(payload.to, /^\+12025550\d{3}$/);
    sent.push(payload);
    return respond ? respond(payload, sent.length) : { ok: true, status: 200, json: async () => ({ messages: [{ id: 'synthetic-' + sent.length }] }) };
  };
  return { sent, restore: () => { global.fetch = original; } };
}
function useMemoryDb() {
  const original = firebase.db, memory = memoryFirestore();
  firebase.db = memory;
  return { memory, restore: () => { firebase.db = original; } };
}
const optedIn = (phone, extra = {}) => ({ status: 'open', revision: 0, noteCount: 0, phoneVerified: true, whatsappUpdates: true,
  notificationPhone: phone, consent: { acceptedAt: { toMillis: () => Date.now() - DAY } }, ...extra });

test('throttle allows six sends in a rolling hour and refuses the seventh', () => {
  let record;
  for (let i = 0; i < NOTIFICATIONS_PER_HOUR; i++) {
    record = chargeNotificationLimit(record, T0 + i * 60_000);
    assert.ok(record, 'send ' + (i + 1) + ' is within the limit');
  }
  assert.equal(NOTIFICATIONS_PER_HOUR, 6);
  assert.equal(record.sentAt.length, 6);
  assert.equal(chargeNotificationLimit(record, T0 + 10 * 60_000), null);
  // The first send leaves the hour window only once it is a full hour old.
  assert.equal(chargeNotificationLimit(record, T0 + HOUR - 1), null);
  const later = chargeNotificationLimit(record, T0 + HOUR);
  assert.ok(later);
  assert.equal(later.sentAt.length, 7);
  assert.equal(later.expiresAt, T0 + HOUR + DAY);
});

test('throttle caps a destination at twenty sends in a rolling day', () => {
  assert.equal(NOTIFICATIONS_PER_DAY, 20);
  let record, now = T0;
  // Six per hour, spaced so the hourly window never binds.
  for (let i = 0; i < NOTIFICATIONS_PER_DAY; i++) {
    now = T0 + i * 11 * 60_000;
    record = chargeNotificationLimit(record, now);
    assert.ok(record, 'send ' + (i + 1) + ' is within the limit');
  }
  assert.equal(record.sentAt.length, 20);
  assert.equal(chargeNotificationLimit(record, now + 2 * HOUR), null);
  assert.equal(chargeNotificationLimit(record, T0 + DAY - 1), null);
  // A day after the first send, one slot reopens; the record never grows past 20.
  const reopened = chargeNotificationLimit(record, T0 + DAY);
  assert.ok(reopened);
  assert.equal(reopened.sentAt.length, 20);
  assert.equal(reopened.sentAt[0], T0 + 11 * 60_000);
  assert.equal(chargeNotificationLimit(reopened, T0 + DAY + 1), null);
});

test('throttle ignores stale, malformed and far-future entries', () => {
  const record = { sentAt: [T0 - DAY, T0 - DAY - 5, 'x', null, NaN, Infinity, T0 + 10 * 60_000, ...Array(4).fill(T0 - 30 * 60_000)] };
  const charged = chargeNotificationLimit(record, T0);
  assert.deepEqual(charged.sentAt, [...Array(4).fill(T0 - 30 * 60_000), T0]);
  assert.equal(chargeNotificationLimit(undefined, T0).sentAt.length, 1);
  assert.equal(chargeNotificationLimit({ sentAt: 'not-a-list' }, T0).sentAt.length, 1);
  // Small clock skew between instances still counts toward the hour.
  assert.equal(chargeNotificationLimit({ sentAt: [...Array(5).fill(T0 - 60_000), T0 + 30_000] }, T0), null);
});

test('update notices: status, note, and re-upload requests, never note text', () => {
  const base = { status: 'open', noteCount: 1, openDocumentRequests: 0, lastNote: 'private staff note' };
  assert.equal(ticketUpdateNotice(base, { ...base }), null);
  assert.equal(ticketUpdateNotice(base, { ...base, assignedTo: 'someone', overdue: 'acknowledge', revision: 4 }), null);
  assert.deepEqual(ticketUpdateNotice(base, { ...base, status: 'investigating' }), { text: 'Under Investigation', revisionBound: true });
  assert.deepEqual(ticketUpdateNotice(base, { ...base, noteCount: 2 }),
    { text: 'Staff added an update. Current status: Open / Awaiting Review', revisionBound: true });
  assert.equal(REUPLOAD_REQUESTED_TEXT, 'Staff asked for a new copy of a document');
  assert.deepEqual(ticketUpdateNotice(base, { ...base, openDocumentRequests: 1 }), { text: REUPLOAD_REQUESTED_TEXT, revisionBound: false });
  assert.deepEqual(ticketUpdateNotice({ ...base, openDocumentRequests: undefined }, { ...base, openDocumentRequests: 1 }),
    { text: REUPLOAD_REQUESTED_TEXT, revisionBound: false });
  assert.deepEqual(ticketUpdateNotice(base, { ...base, status: 'investigating', openDocumentRequests: 2 }),
    { text: REUPLOAD_REQUESTED_TEXT + '. Current status: Under Investigation', revisionBound: false });
  // A fulfilled request (decrement) is not announced.
  assert.equal(ticketUpdateNotice({ ...base, openDocumentRequests: 2 }, { ...base, openDocumentRequests: 1 }), null);
  assert.equal(ticketUpdateNotice(base, { ...base, status: '__proto__' }), 'unsupported_status');
  for (const after of [{ ...base, noteCount: 2 }, { ...base, openDocumentRequests: 1 }, { ...base, status: 'resolved' }]) {
    assert.doesNotMatch(ticketUpdateNotice(base, after).text, /private staff note/);
  }
});

test('delivery records the seventh notification in an hour as throttled and never sends or retries it', async () => {
  const { memory, restore } = useMemoryDb(), provider = withProvider();
  try {
    const phone = '+12025550150', time = new Date().toISOString();
    memory.docs.set('tickets/synthetic-throttle', optedIn(phone));
    for (let i = 1; i <= 6; i++) await deliverTicketNotification('synthetic-throttle-' + i, time, 'synthetic-throttle', phone, 'status_update', ['x'], 0);
    assert.equal(provider.sent.length, 6);
    await deliverTicketNotification('synthetic-throttle-7', time, 'synthetic-throttle', phone, 'status_update', ['x'], 0);
    assert.equal(provider.sent.length, 6);
    const throttled = memory.read('whatsappDeliveries/' + deliveryId('synthetic-throttle-7'));
    assert.equal(throttled.status, 'throttled');
    assert.equal(throttled.leaseUntil, 0);
    // A redelivered event is final: still no send.
    await deliverTicketNotification('synthetic-throttle-7', time, 'synthetic-throttle', phone, 'status_update', ['x'], 0);
    assert.equal(provider.sent.length, 6);
    assert.equal(memory.read('whatsappDeliveries/' + deliveryId('synthetic-throttle-7')).status, 'throttled');
    // Keyed by the phone hash and holding only send times: no number stored.
    const limit = memory.read('notificationLimits/' + phoneHash(phone));
    assert.deepEqual(Object.keys(limit).sort(), ['expiresAt', 'sentAt']);
    assert.equal(limit.sentAt.length, 6);
    assert.doesNotMatch(JSON.stringify(limit), /2025550150/);
    // Another destination has its own allowance.
    memory.docs.set('tickets/synthetic-other', optedIn('+12025550151'));
    await deliverTicketNotification('synthetic-other-1', time, 'synthetic-other', '+12025550151', 'status_update', ['x'], 0);
    assert.equal(provider.sent.length, 7);
  } finally { provider.restore(); restore(); }
});

test('opted-out and superseded notifications do not use the allowance; a provider retry is charged once', async () => {
  const { memory, restore } = useMemoryDb();
  let provider = withProvider();
  try {
    const phone = '+12025550152', time = new Date().toISOString(), limitPath = 'notificationLimits/' + phoneHash(phone);
    memory.docs.set('tickets/synthetic-stopped', optedIn(phone, { whatsappUpdates: false }));
    await deliverTicketNotification('synthetic-stopped', time, 'synthetic-stopped', phone, 'status_update', ['x'], 0);
    memory.docs.set('tickets/synthetic-moved-on', optedIn(phone, { revision: 3 }));
    await deliverTicketNotification('synthetic-moved-on', time, 'synthetic-moved-on', phone, 'status_update', ['x'], 2);
    assert.equal(provider.sent.length, 0);
    assert.equal(memory.read(limitPath), undefined);
    provider.restore();
    provider = withProvider((_payload, attempt) => attempt === 1
      ? { ok: false, status: 503, json: async () => ({ error: { code: 131000 } }) }
      : { ok: true, status: 200, json: async () => ({ messages: [{ id: 'synthetic-retry' }] }) });
    memory.docs.set('tickets/synthetic-retry', optedIn(phone));
    await assert.rejects(deliverTicketNotification('synthetic-retry', time, 'synthetic-retry', phone, 'status_update', ['x'], 0), /temporarily unavailable/);
    assert.equal(memory.read('whatsappDeliveries/' + deliveryId('synthetic-retry')).status, 'retrying');
    await deliverTicketNotification('synthetic-retry', time, 'synthetic-retry', phone, 'status_update', ['x'], 0);
    assert.equal(provider.sent.length, 2);
    assert.equal(memory.read('whatsappDeliveries/' + deliveryId('synthetic-retry')).status, 'accepted');
    assert.equal(memory.read(limitPath).sentAt.length, 1);
  } finally { provider.restore(); restore(); }
});

test('a re-upload request sends the update template to an opted-in verified reporter, even after a later edit', async () => {
  const { memory, restore } = useMemoryDb(), provider = withProvider();
  try {
    const phone = '+12025550153', ticketId = 'synthetic-reupload';
    const before = optedIn(phone, { revision: 2, openDocumentRequests: 0 }), after = { ...before, revision: 3, openDocumentRequests: 1 };
    // The ticket has since moved on (revision 4); the open request must still be announced.
    memory.docs.set('tickets/' + ticketId, { ...after, revision: 4 });
    const event = (id, b, a) => ({ id, time: new Date().toISOString(), params: { ticketId }, data: { before: { data: () => b }, after: { data: () => a } } });
    await notifyWhatsAppOnTicketUpdate.run(event('synthetic-reupload-event', before, after));
    assert.equal(provider.sent.length, 1);
    const [payload] = provider.sent;
    assert.equal(payload.template.name, 'status_update');
    const params = payload.template.components[0].parameters.map(p => p.text);
    assert.equal(params[1], ticketId);
    assert.ok(params[2].startsWith(REUPLOAD_REQUESTED_TEXT + ' · '), params[2]);
    // Fulfilment (decrement), assignment and an unverified reporter send nothing.
    await notifyWhatsAppOnTicketUpdate.run(event('synthetic-fulfilled', after, { ...after, openDocumentRequests: 0 }));
    await notifyWhatsAppOnTicketUpdate.run(event('synthetic-assigned', after, { ...after, assignedTo: 'synthetic-officer' }));
    const guest = { ...after, phoneVerified: false };
    await notifyWhatsAppOnTicketUpdate.run(event('synthetic-guest', { ...guest, openDocumentRequests: 1 }, { ...guest, openDocumentRequests: 2 }));
    const stopped = { ...after, whatsappUpdates: false };
    await notifyWhatsAppOnTicketUpdate.run(event('synthetic-stopped-reupload', { ...stopped, openDocumentRequests: 1 }, { ...stopped, openDocumentRequests: 2 }));
    assert.equal(provider.sent.length, 1);
  } finally { provider.restore(); restore(); }
});
