const assert = require('node:assert/strict');
const test = require('node:test');
const adminPath = require.resolve('firebase-admin');
const realAdmin = require('firebase-admin');
const documents = new Map();
let nextId = 0;
const db = {
  collection(name) {
    return {
      doc(id) {
        return { path: `${name}/${id}`, async set(value) { documents.set(this.path, value); } };
      },
      async add(value) {
        assert.doesNotThrow(() => assertNoUndefined(value));
        const id = `test-${++nextId}`;
        documents.set(`${name}/${id}`, value);
        return { id };
      },
    };
  },
  async runTransaction(callback) {
    return callback({
      get: async (ref) => ({ data: () => documents.get(ref.path) }),
      set: (ref, value) => documents.set(ref.path, value),
    });
  },
};
function assertNoUndefined(value) {
  assert.notEqual(value, undefined);
  if (value && typeof value === 'object') Object.values(value).forEach(assertNoUndefined);
}
const firestore = Object.assign(() => db, {
  Timestamp: realAdmin.firestore.Timestamp,
  FieldValue: realAdmin.firestore.FieldValue,
});
require.cache[adminPath].exports = { initializeApp() {}, firestore };
const { submitDispute } = require('../lib/index.js');
const { validateDisputeInput } = require('../lib/disputes.js');
const input = {
  reporterName: 'Test reporter', reporterType: 'Individual', otherPartyName: 'Test party',
  otherPartyType: 'Individual', disputeType: 'Boundary dispute', state: 'Delhi', district: 'New Delhi',
  description: 'Synthetic test only; no actual dispute.', location: { latitude: 28.593, longitude: 77.22 },
};
test('coordinates must be finite numbers within geographic limits', () => {
  for (const location of [undefined, { latitude: 91, longitude: 10 }, { latitude: 1, longitude: 181 },
    { latitude: NaN, longitude: 0 }, { latitude: '28', longitude: 77 }]) {
    assert.throws(() => validateDisputeInput({ ...input, location }), /latitude and longitude/);
  }
  assertNoUndefined(validateDisputeInput(input));
});
test('OTP pause saves coordinates, marks unverified, limits abuse, and can be reversed', async () => {
  process.env.DISPUTE_OTP_REQUIRED = 'false';
  const request = { data: input, rawRequest: { ip: '192.0.2.1' } };
  const result = await submitDispute.run(request);
  const saved = documents.get(`tickets/${result.ticketId}`);
  assert.deepEqual(saved.dispute.location, input.location);
  assert.equal(saved.phoneVerified, false);
  assert.equal(saved.whatsappUpdates, false);
  for (let count = 1; count < 5; count++) await submitDispute.run(request);
  await assert.rejects(submitDispute.run(request), { code: 'resource-exhausted' });
  process.env.DISPUTE_OTP_REQUIRED = 'true';
  await assert.rejects(submitDispute.run(request), { code: 'unauthenticated' });
  const verified = await submitDispute.run({ ...request, auth: { uid: 'test-verified', token: { phone_number: '+12025550123' } } });
  assert.equal(documents.get(`tickets/${verified.ticketId}`).phoneVerified, true);
});
