import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
const require = createRequire(import.meta.url);
// Fail closed: this file is never allowed to reach production Firestore or Meta.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
process.env.GCLOUD_PROJECT = "demo-forestwatch";
process.env.GOOGLE_CLOUD_PROJECT = "demo-forestwatch";
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: "demo-forestwatch" });
process.env.DISPUTE_OTP_SECRET = "synthetic-test-secret";
process.env.WHATSAPP_ACCESS_TOKEN = "synthetic-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "synthetic-sender";
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error("External traffic is disabled in transaction tests"); };
const admin = require("firebase-admin");
const handlers = require("../lib/index.js");
const { db } = require("../lib/platform/firebase.js");
const { submitDisputeTransaction, validateDisputeInput } = require("../lib/features/disputes/service.js");
const { issueOtp, confirmOtp, recordOtpDelivery, purgeExpiredRecords, verificationKey } = require("../lib/features/otp/service.js");
const { deliverTicketNotification } = require("../lib/features/whatsapp/delivery.js");
const { recordReceipt, stopNotifications } = require("../lib/features/whatsapp/receipts.js");
const { reserveGeocodeSlot, releaseGeocodeSlot } = require("../lib/features/maps/geocode.js");
const contract = require("../lib/platform/contracts/dispute.json");
const secret = process.env.DISPUTE_OTP_SECRET;
const input = validateDisputeInput({ reporterName: "Synthetic reporter", reporterType: contract.reporterTypes[0], otherPartyName: "Synthetic party", otherPartyType: contract.partyTypes[0], disputeType: contract.disputeTypes[0], state: "Maharashtra", district: "Pune", village: "", description: "Synthetic regression case; not an actual dispute.", location: { latitude: 18.52, longitude: 73.85 }, locationConfirmed: true });
let phoneIndex = 100;
async function options(phone = "+12025550" + String(++phoneIndex).padStart(3, "0")) {
  const code = await issueOtp(db, phone, secret);
  const verified = await confirmOtp(db, phone, code, secret);
  assert.equal(verified.ok, true);
  return { input, phone, token: verified.token, submissionId: randomUUID(), address: "192.0.2.10", requireOtp: true, consent: true, consentVersion: contract.version, whatsappUpdates: true, secret };
}
const auth = { uid: "synthetic-officer", token: { email: "staff@example.invalid", auth_time: Math.floor(Date.now() / 1000) } };
const request = data => ({ auth, data });
test.before(async () => {
  await db.collection("officers").doc(auth.uid).set({ email: auth.token.email });
});
test.after(async () => { global.fetch = originalFetch; await db.terminate(); await admin.app().delete(); });

test("an aborted commit leaves the proof, ticket and quota unchanged", async () => {
  const data = await options();
  const failing = { collection: name => db.collection(name), runTransaction: callback => db.runTransaction(async tx => {
    await callback(tx); throw new Error("Synthetic commit interruption");
  }) };
  const before = (await db.collection("tickets").count().get()).data().count;
  await assert.rejects(submitDisputeTransaction(failing, data), /commit interruption/);
  assert.equal((await db.collection("tickets").count().get()).data().count, before);
  assert.equal((await db.collection("disputeVerifications").doc(verificationKey(data.token, secret)).get()).data().used, false);
  const saved = await submitDisputeTransaction(db, data);
  assert.ok(saved.ticketId);
});

test("parallel identical retries create one ticket and spend one verification", async () => {
  const data = await options();
  const results = await Promise.all(Array.from({ length: 5 }, () => submitDisputeTransaction(db, data)));
  assert.equal(new Set(results.map(result => result.ticketId)).size, 1);
  assert.equal(results.filter(result => !result.replayed).length, 1);
  await assert.rejects(submitDisputeTransaction(db, { ...data, submissionId: randomUUID() }), { code: "unauthenticated" });
  // Simulate a lost response, then expiry of the original proof: the receipt still wins.
  await db.collection("disputeVerifications").doc(verificationKey(data.token, secret)).update({ expiresAt: 1 });
  assert.equal((await submitDisputeTransaction(db, data)).ticketId, results[0].ticketId);
});

test("resending a code preserves completed verification and failed guesses persist", async () => {
  const data = await options();
  const fresh = await issueOtp(db, data.phone, secret);
  const wrong = fresh === "000000" ? "000001" : "000000";
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await confirmOtp(db, data.phone, wrong, secret)).ok, false);
  assert.equal((await db.collection("disputeOtps").doc(data.phone).get()).data().attempts, 5);
  assert.equal((await confirmOtp(db, data.phone, fresh, secret)).ok, false);
  assert.ok((await submitDisputeTransaction(db, data)).ticketId);
  const next = await issueOtp(db, data.phone, secret);
  await recordOtpDelivery(db, data.phone, fresh, secret, "failed");
  assert.equal((await confirmOtp(db, data.phone, next, secret)).ok, true);
});

test("parallel guest submissions enforce the daily quota inside the transaction", async () => {
  const data = { input, phone: "", token: "", address: "192.0.2.30", requireOtp: false, consent: true, consentVersion: contract.version, whatsappUpdates: true, secret };
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => submitDisputeTransaction(db, { ...data, submissionId: randomUUID() })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 5);
  const failed = results.find(result => result.status === "rejected");
  assert.equal(failed.reason.code, "resource-exhausted");
  const saved = await db.collection("tickets").doc(results.find(result => result.status === "fulfilled").value.ticketId).get();
  assert.equal(saved.data().whatsappUpdates, false);
  assert.equal(saved.data().phoneVerified, false);
});

test("changing verified phones cannot bypass the shared connection quota", async () => {
  const submissions = await Promise.all(Array.from({ length: 6 }, () => options()));
  const results = await Promise.allSettled(submissions.map(data => submitDisputeTransaction(db, { ...data, address: "192.0.2.40" })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 5);
  const rejectedIndex = results.findIndex(result => result.status === "rejected");
  assert.equal(results[rejectedIndex].reason.code, "resource-exhausted");
  const rejected = submissions[rejectedIndex];
  assert.equal((await db.collection("disputeVerifications").doc(verificationKey(rejected.token, secret)).get()).data().used, false);
});

test("status changes detect conflicts, reject prototype keys and record immutable reasons", async () => {
  const ref = db.collection("tickets").doc("synthetic-conflict");
  await ref.set({ status: "open", revision: 0 });
  const data = { ticketId: ref.id, status: "investigating", reason: "Synthetic review", expectedRevision: 0, requestId: randomUUID() };
  for (const status of ["__proto__", "constructor", "toString"]) await assert.rejects(handlers.updateTicketStatus.run(request({ ...data, status })), { code: "invalid-argument" });
  const results = await Promise.allSettled([handlers.updateTicketStatus.run(request(data)), handlers.updateTicketStatus.run(request({ ...data, status: "resolved", requestId: randomUUID() }))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "aborted");
  const events = await ref.collection("events").get();
  assert.equal(events.size, 1); assert.equal(events.docs[0].data().reason, "Synthetic review");
  assert.equal(events.docs[0].data().officerUid, auth.uid);
  assert.ok(events.docs[0].data().at instanceof admin.firestore.Timestamp);
});

test("notes preserve repeated text as separate entries and retries stay idempotent", async () => {
  const ref = db.collection("tickets").doc("synthetic-notes");
  await ref.set({ status: "open", revision: 0, noteCount: 0 });
  const data = { ticketId: ref.id, note: "Synthetic note repeated intentionally", requestId: randomUUID() };
  await Promise.all([handlers.addTicketNote.run(request(data)), handlers.addTicketNote.run(request(data))]);
  await handlers.addTicketNote.run(request({ ...data, requestId: randomUUID() }));
  assert.equal((await ref.collection("notes").get()).size, 2);
  assert.equal((await ref.get()).data().noteCount, 2);
  assert.equal((await ref.get()).data().officerNotes, undefined);
});

test("expired sessions fail on all officer callables even when allow-listed", async () => {
  const old = { ...auth, token: { ...auth.token, auth_time: auth.token.auth_time - 28801 } };
  for (const handler of [handlers.listTickets, handlers.updateTicketStatus, handlers.addTicketNote]) {
    await assert.rejects(handler.run({ auth: old, data: {} }), { code: "unauthenticated" });
    await assert.rejects(handler.run({ auth: { ...auth, uid: "not-allow-listed" }, data: {} }), { code: "permission-denied" });
  }
});

test("older records remain searchable after 200 items; counts cover the complete registry", async () => {
  const batch = db.batch();
  for (let i = 0; i < 225; i++) batch.set(db.collection("tickets").doc("synthetic-page-" + String(i).padStart(6, "0")), {
    status: "open", subject: i === 224 ? "Synthetic oldest needle" : "Synthetic page", updatedAt: admin.firestore.Timestamp.fromMillis(1_500_000_000_000 - i * 1000), dispute: { state: "Maharashtra", district: "Pune" },
  });
  await batch.commit();
  let cursor = null, found = false, pages = 0;
  do {
    const page = await handlers.listTickets.run(request({ search: "oldest needle", cursor }));
    found ||= page.tickets.some(ticket => ticket.id === "synthetic-page-000224");
    if (!cursor) assert.equal(page.stats.total, (await db.collection("tickets").count().get()).data().count);
    cursor = page.nextCursor; pages++;
  } while (cursor && pages < 10);
  assert.equal(found, true); assert.ok(pages > 1);
  const exact = await handlers.listTickets.run(request({ search: "synthetic-page-000224" }));
  assert.equal(exact.tickets[0].id, "synthetic-page-000224");
  await db.collection("tickets").doc("synthetic-page-000224").update({ "dispute.description": "Synthetic private narrative", officerNotes: [{ note: "Synthetic legacy note" }] });
  const projected = await handlers.listTickets.run(request({ search: "synthetic-page-000224" }));
  assert.equal(projected.tickets[0].dispute.description, undefined);
  assert.equal(projected.tickets[0].officerNotes, undefined);
});

test("cleanup rechecks expiry after the query so a refreshed record survives", async () => {
  const ref = db.collection("syntheticCleanup").doc("refresh");
  await ref.set({ expiresAt: 1 });
  const raced = { collection: name => ({ where: (...args) => ({ limit: count => ({ get: async () => {
    const snapshot = await db.collection(name).where(...args).limit(count).get();
    await ref.update({ expiresAt: Date.now() + 100000 }); return snapshot;
  } }) }) }), runTransaction: fn => db.runTransaction(fn) };
  assert.equal((await purgeExpiredRecords(raced, "syntheticCleanup", "expiresAt", Date.now())).deleted, 0);
  assert.equal((await ref.get()).exists, true);
});

test("the geocoder has one shared slot under concurrent calls", async () => {
  await db.collection("mapServiceLimits").doc("nominatim").delete();
  const now = Date.now();
  const results = await Promise.all(Array.from({ length: 4 }, () => reserveGeocodeSlot(now, "test-owner")));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await reserveGeocodeSlot(now + 5000), false);
  await releaseGeocodeSlot("other-owner", now + 5000);
  assert.equal(await reserveGeocodeSlot(now + 6000), false);
  await releaseGeocodeSlot("test-owner", now + 6000);
  assert.equal(await reserveGeocodeSlot(now + 7099), false);
  assert.equal(await reserveGeocodeSlot(now + 7100), true);
});

test("notification retries avoid duplicate uncertain sends and preserve monotonic receipts", async () => {
  const ref = db.collection("tickets").doc("synthetic-delivery"), phone = "+12025550900";
  await ref.set({ status: "open", revision: 1, phoneVerified: true, whatsappUpdates: true, notificationPhone: phone });
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("Synthetic timeout after possible acceptance"); };
  const event = "synthetic-uncertain", time = new Date().toISOString();
  await deliverTicketNotification(event, time, ref.id, phone, "status_update", [], 1);
  await deliverTicketNotification(event, time, ref.id, phone, "status_update", [], 1);
  assert.equal(calls, 1);
  const id = createHash("sha256").update(event).digest("hex");
  const delivery = db.collection("whatsappDeliveries").doc(id);
  assert.equal((await delivery.get()).data().status, "uncertain");
  await recordReceipt({ id: "synthetic-meta-id", status: "read", biz_opaque_callback_data: id });
  await recordReceipt({ id: "synthetic-meta-id", status: "sent", biz_opaque_callback_data: id });
  assert.equal((await delivery.get()).data().status, "read");
  await deliverTicketNotification("synthetic-old-revision", time, ref.id, phone, "status_update", [], 0);
  assert.equal(calls, 1);
});

test("provider receipts arriving before a transport error cannot be downgraded", async () => {
  const ref = db.collection("tickets").doc("synthetic-early-receipt"), phone = "+12025550901";
  await ref.set({ revision: 0, phoneVerified: true, whatsappUpdates: true });
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    await recordReceipt({ id: "synthetic-early-meta", status: "delivered", biz_opaque_callback_data: body.biz_opaque_callback_data });
    throw new Error("Synthetic lost send response");
  };
  await deliverTicketNotification("synthetic-early", new Date().toISOString(), ref.id, phone, "status_update", [], 0);
  const id = createHash("sha256").update("synthetic-early").digest("hex");
  assert.equal((await db.collection("whatsappDeliveries").doc(id).get()).data().status, "delivered");
});

test("STOP persists on older tickets and a replay does not revoke a later explicit opt-in", async () => {
  const phone = "+12025550902", stopped = Math.floor(Date.now() / 1000) - 5;
  const older = db.collection("tickets").doc("synthetic-stop-old"), newer = db.collection("tickets").doc("synthetic-stop-new");
  await older.set({ notificationPhone: phone, whatsappUpdates: true, consent: { acceptedAt: admin.firestore.Timestamp.fromMillis((stopped - 1) * 1000) } });
  await newer.set({ notificationPhone: phone, whatsappUpdates: true, consent: { acceptedAt: admin.firestore.Timestamp.fromMillis((stopped + 1) * 1000) } });
  await stopNotifications(phone, String(stopped));
  await stopNotifications(phone, String(stopped));
  assert.equal((await older.get()).data().whatsappUpdates, false);
  assert.equal((await newer.get()).data().whatsappUpdates, true);
});
