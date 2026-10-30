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
const { hashId, addressBucket } = require("../lib/features/otp/identity.js");
const { uploadCaseDocument, removeCaseDocument, purgeDocumentBatch, drainPurgeQueue, replaceCaseDocument, purgeDocumentRequests } = require("../lib/features/documents/service.js");
const { validateUploadRequest } = require("../lib/features/documents/rules.js");
const { lookupCaseStatus } = require("../lib/features/status/service.js");
const { validateReplacementRequest } = require("../lib/features/status/rules.js");
const contract = require("../lib/platform/contracts/dispute.json");
const secret = process.env.DISPUTE_OTP_SECRET;
const input = validateDisputeInput({ reporterName: "Synthetic reporter", reporterType: contract.reporterTypes[0], otherPartyName: "Synthetic party", otherPartyType: contract.partyTypes[0], disputeType: contract.disputeTypes[0], state: "Maharashtra", district: "Pune", village: "", description: "Synthetic regression case; not an actual dispute.", location: { latitude: 18.52, longitude: 73.85 }, locationConfirmed: true });
// The default input names an individual, so it is a person-vs-person case.
const PERSON_KINDS = contract.documents.caseTypes.person_vs_person.required;
// Pending uploads as uploadDisputeDocument leaves them, bound to a phone or, for guests, an address.
async function seedDocuments({ submissionId, phone = "", address = "192.0.2.10", kinds = PERSON_KINDS, overrides = {} }) {
  const batch = db.batch(), ids = [];
  for (const kind of kinds) {
    const ref = db.collection("caseDocuments").doc(); ids.push(ref.id);
    batch.set(ref, { submissionId, phoneHash: phone ? hashId(phone) : null, addressHash: hashId(addressBucket(address)), ticketId: null,
      status: "pending", kind, side: "reporter", fileName: "synthetic.jpg", contentType: "image/jpeg", sizeBytes: 3, sha256: "synthetic-" + ref.id,
      expiresAt: Date.now() + 3_600_000, purgeAt: null, storage: { original: "case-documents/" + ref.id + "/original" },
      screening: { state: "done", risk: "low", score: 0, summary: "", checks: [], extracted: {}, engineVersion: "test", completedAt: null }, review: null,
      ...overrides[kind] });
  }
  await batch.commit();
  return ids;
}
let phoneIndex = 100;
async function options(phone = "+12025550" + String(++phoneIndex).padStart(3, "0"), kinds = PERSON_KINDS) {
  const code = await issueOtp(db, phone, secret);
  const verified = await confirmOtp(db, phone, code, secret);
  assert.equal(verified.ok, true);
  const submissionId = randomUUID();
  return { input, phone, token: verified.token, submissionId, address: "192.0.2.10", requireOtp: true, consent: true, consentVersion: contract.version, whatsappUpdates: true, secret,
    documentIds: await seedDocuments({ submissionId, phone, kinds }) };
}
const documentStatus = async ids => (await db.getAll(...ids.map(id => db.collection("caseDocuments").doc(id)))).map(snapshot => snapshot.data()?.status);
const auth = { uid: "synthetic-officer", token: { email: "staff@example.invalid", auth_time: Math.floor(Date.now() / 1000) } };
const request = data => ({ auth, data });
const viewer = { uid: "synthetic-viewer", token: { email: "viewer@example.invalid", auth_time: auth.token.auth_time } };
// Spec: every new staff write carries the officer's uid, email, name (or null) and role label.
const STAFF = { officerUid: auth.uid, officerEmail: auth.token.email, officerName: "Synthetic Officer", officerRole: "Synthetic DFO" };
const staffOf = data => ({ officerUid: data.officerUid, officerEmail: data.officerEmail, officerName: data.officerName, officerRole: data.officerRole });
test.before(async () => {
  await db.collection("officers").doc(auth.uid).set({ email: auth.token.email, displayName: STAFF.officerName, role: STAFF.officerRole });
  await db.collection("officers").doc(viewer.uid).set({ email: viewer.token.email, access: "viewer" });
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
  assert.deepEqual(await documentStatus(data.documentIds), data.documentIds.map(() => "pending"));
  const saved = await submitDisputeTransaction(db, data);
  assert.ok(saved.ticketId);
  assert.deepEqual(await documentStatus(data.documentIds), data.documentIds.map(() => "attached"));
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
  const submissions = await Promise.all(Array.from({ length: 6 }, async () => {
    const submissionId = randomUUID();
    return { ...data, submissionId, documentIds: await seedDocuments({ submissionId, address: data.address }) };
  }));
  const results = await Promise.allSettled(submissions.map(submission => submitDisputeTransaction(db, submission)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 5);
  const failed = results.find(result => result.status === "rejected");
  assert.equal(failed.reason.code, "resource-exhausted");
  const saved = await db.collection("tickets").doc(results.find(result => result.status === "fulfilled").value.ticketId).get();
  assert.equal(saved.data().whatsappUpdates, false);
  assert.equal(saved.data().phoneVerified, false);
});

test("changing verified phones cannot bypass the shared connection quota", async () => {
  // Twenty reports per connection per day (REPORTS_PER_IP_DAY default): start five short of it.
  const address = "192.0.2.40";
  await db.collection("reporterLimits").doc("ip-" + hashId(addressBucket(address))).set({ count: 15, windowStartedAt: Date.now() - 1000 });
  const submissions = await Promise.all(Array.from({ length: 6 }, () => options()));
  const results = await Promise.allSettled(submissions.map(data => submitDisputeTransaction(db, { ...data, address })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 5);
  const rejectedIndex = results.findIndex(result => result.status === "rejected");
  assert.equal(results[rejectedIndex].reason.code, "resource-exhausted");
  const rejected = submissions[rejectedIndex];
  assert.equal((await db.collection("disputeVerifications").doc(verificationKey(rejected.token, secret)).get()).data().used, false);
  assert.deepEqual(await documentStatus(rejected.documentIds), rejected.documentIds.map(() => "pending"));
});

test("submission enforces the case type's required documents and attaches them with a summary", async () => {
  const partial = await options(undefined, ["aadhaar", "pan", "site_photo"]);
  await assert.rejects(submitDisputeTransaction(db, { ...partial, address: "192.0.2.50" }), error => error.code === "failed-precondition" && /Ownership deed/.test(error.message));
  assert.equal((await db.collection("disputeVerifications").doc(verificationKey(partial.token, secret)).get()).data().used, false);
  assert.deepEqual(await documentStatus(partial.documentIds), ["pending", "pending", "pending"]);
  await assert.rejects(submitDisputeTransaction(db, { ...partial, address: "192.0.2.50", documentIds: [] }), { code: "failed-precondition" });
  // A government body needs only Aadhaar, so the same uploads now suffice.
  const government = { ...partial, address: "192.0.2.50", input: { ...input, otherPartyType: "Forest Department" } };
  const { ticketId } = await submitDisputeTransaction(db, government);
  const ticket = (await db.collection("tickets").doc(ticketId).get()).data();
  assert.deepEqual(ticket.documents, { caseType: "citizen_vs_government", count: 3, kinds: ["aadhaar", "pan", "site_photo"], flagged: 0 });
  for (const id of partial.documentIds) {
    const saved = (await db.collection("caseDocuments").doc(id).get()).data();
    assert.equal(saved.status, "attached"); assert.equal(saved.ticketId, ticketId); assert.equal(saved.expiresAt, null);
  }
});

test("submission counts flagged documents and refuses uploads it does not own", async () => {
  const flagged = { ...(await options()), address: "192.0.2.51" };
  const [first, second] = flagged.documentIds;
  await db.collection("caseDocuments").doc(first).update({ "screening.risk": "altered" });
  await db.collection("caseDocuments").doc(second).update({ "screening.risk": "high" });
  const { ticketId } = await submitDisputeTransaction(db, flagged);
  assert.equal((await db.collection("tickets").doc(ticketId).get()).data().documents.flagged, 2);
  // Already attached to that case.
  const reuse = { ...(await options()), address: "192.0.2.52" };
  await assert.rejects(submitDisputeTransaction(db, { ...reuse, documentIds: [...reuse.documentIds.slice(1), first] }), { code: "failed-precondition" });
  const cases = [
    { submissionId: randomUUID() }, // uploaded under another report
    { phone: "+12025550999" }, // verified by someone else
    { overrides: { aadhaar: { expiresAt: Date.now() - 1 } } },
    // Still being screened: no risk yet for the ticket's flagged count.
    { overrides: { aadhaar: { screening: { state: "pending", risk: null } } } },
  ];
  for (const variant of cases) {
    const documentIds = await seedDocuments({ submissionId: reuse.submissionId, phone: reuse.phone, ...variant });
    await assert.rejects(submitDisputeTransaction(db, { ...reuse, documentIds }), { code: "failed-precondition" });
  }
  // A guest upload cannot be claimed from another connection.
  const guest = { input, phone: "", token: "", address: "192.0.2.70", requireOtp: false, consent: true, consentVersion: contract.version, whatsappUpdates: false, secret, submissionId: randomUUID() };
  const guestDocs = await seedDocuments({ submissionId: guest.submissionId, address: "192.0.2.71" });
  await assert.rejects(submitDisputeTransaction(db, { ...guest, documentIds: guestDocs }), { code: "failed-precondition" });
  assert.equal((await db.collection("disputeVerifications").doc(verificationKey(reuse.token, secret)).get()).data().used, false);
  assert.ok((await submitDisputeTransaction(db, reuse)).ticketId);
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
  assert.deepEqual(staffOf(events.docs[0].data()), STAFF);
  assert.ok(events.docs[0].data().at instanceof admin.firestore.Timestamp);
  assert.equal(typeof (await ref.get()).data().firstActionAt, "number");
  await assert.rejects(handlers.updateTicketStatus.run({ auth: viewer, data: { ...data, expectedRevision: 1, requestId: randomUUID() } }), { code: "permission-denied" });
});

test("notes preserve repeated text as separate entries and retries stay idempotent", async () => {
  const ref = db.collection("tickets").doc("synthetic-notes");
  await ref.set({ status: "open", revision: 0, noteCount: 0 });
  const data = { ticketId: ref.id, note: "Synthetic note repeated intentionally", requestId: randomUUID() };
  await Promise.all([handlers.addTicketNote.run(request(data)), handlers.addTicketNote.run(request(data))]);
  await handlers.addTicketNote.run(request({ ...data, requestId: randomUUID() }));
  const notes = await ref.collection("notes").get();
  assert.equal(notes.size, 2);
  for (const note of notes.docs) assert.deepEqual(staffOf(note.data()), STAFF);
  assert.equal((await ref.get()).data().noteCount, 2);
  assert.equal((await ref.get()).data().officerNotes, undefined);
});

test("expired sessions fail on all officer callables even when allow-listed", async () => {
  const old = { ...auth, token: { ...auth.token, auth_time: auth.token.auth_time - 28801 } };
  for (const handler of [handlers.listTickets, handlers.updateTicketStatus, handlers.addTicketNote, handlers.reviewCaseDocument, handlers.getCaseDocumentFile]) {
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
  const summary = { caseType: "person_vs_person", count: 5, kinds: PERSON_KINDS, flagged: 1 };
  await db.collection("tickets").doc("synthetic-page-000224").update({ "dispute.description": "Synthetic private narrative", officerNotes: [{ note: "Synthetic legacy note" }], documents: summary });
  const projected = await handlers.listTickets.run(request({ search: "synthetic-page-000224" }));
  assert.equal(projected.tickets[0].dispute.description, undefined);
  assert.equal(projected.tickets[0].officerNotes, undefined);
  assert.deepEqual(projected.tickets[0].documents, summary);
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

test("closing a case schedules its documents for purge and reopening cancels it", async () => {
  const ref = db.collection("tickets").doc("synthetic-closure");
  await ref.set({ status: "open", revision: 0 });
  const ids = await seedDocuments({ submissionId: randomUUID(), kinds: ["aadhaar", "site_photo"] });
  for (const id of ids) await db.collection("caseDocuments").doc(id).update({ status: "attached", ticketId: ref.id, expiresAt: null });
  const change = (status, expectedRevision) => handlers.updateTicketStatus.run(request({ ticketId: ref.id, status, reason: "Synthetic change", expectedRevision, requestId: randomUUID() }));
  const before = Date.now();
  await change("resolved", 0);
  const closedAt = (await ref.get()).data().closedAt;
  assert.ok(closedAt >= before);
  for (const id of ids) assert.equal((await db.collection("caseDocuments").doc(id).get()).data().purgeAt, closedAt + contract.documents.retentionDaysAfterClose * 86_400_000);
  await change("rejected", 1);
  assert.equal((await ref.get()).data().closedAt, closedAt);
  await change("open", 2);
  assert.equal((await ref.get()).data().closedAt, undefined);
  for (const id of ids) assert.equal((await db.collection("caseDocuments").doc(id).get()).data().purgeAt, null);
});

test("document reviews are idempotent, recorded as case events and limited to attached documents", async () => {
  const ref = db.collection("tickets").doc("synthetic-review");
  await ref.set({ status: "open", revision: 0 });
  const [attached, pending] = await seedDocuments({ submissionId: randomUUID(), kinds: ["aadhaar", "pan"] });
  await db.collection("caseDocuments").doc(attached).update({ status: "attached", ticketId: ref.id, expiresAt: null });
  const data = { documentId: attached, decision: "reupload_requested", reason: "Synthetic: QR unreadable", requestId: randomUUID() };
  await assert.rejects(handlers.reviewCaseDocument.run({ auth: viewer, data }), { code: "permission-denied" });
  const before = Date.now();
  const results = await Promise.all([handlers.reviewCaseDocument.run(request(data)), handlers.reviewCaseDocument.run(request(data))]);
  for (const result of results) assert.equal(result.review.decision, "reupload_requested");
  const events = await ref.collection("events").get();
  assert.equal(events.size, 1);
  assert.deepEqual({ ...events.docs[0].data(), at: undefined }, { type: "document_review", documentId: attached, kind: "aadhaar", decision: "reupload_requested",
    reason: data.reason, actorUid: auth.uid, ...STAFF, at: undefined, revision: 1 });
  const ticket = (await ref.get()).data();
  assert.equal(ticket.revision, 1); assert.equal(ticket.openDocumentRequests, 1); assert.ok(ticket.firstActionAt >= before);
  const saved = (await db.collection("caseDocuments").doc(attached).get()).data().review;
  assert.equal(saved.by, auth.uid); assert.equal(saved.byEmail, auth.token.email); assert.ok(saved.at instanceof admin.firestore.Timestamp);
  assert.deepEqual(staffOf(saved), STAFF);
  // The re-upload request is keyed by the review's requestId and lives for replacementTtlDays.
  const opened = (await db.collection("documentRequests").doc(data.requestId).get()).data();
  assert.ok(opened.requestedAt >= before);
  assert.deepEqual(opened, { ticketId: ref.id, documentId: attached, kind: "aadhaar", requestedAt: opened.requestedAt,
    expiresAt: opened.requestedAt + contract.documents.replacementTtlDays * 86_400_000, fulfilledAt: null, fulfilledDocumentId: null });
  // The stored review carries the same server expiry, for the dossier.
  assert.equal(saved.expiresAt, opened.expiresAt);
  for (const result of results) assert.equal(result.review.expiresAt, opened.expiresAt);
  // Asking again while that request is open records the review but opens no
  // second request; the review keeps the open request's deadline.
  const again = { ...data, requestId: randomUUID() };
  await handlers.reviewCaseDocument.run(request(again));
  assert.equal((await db.collection("documentRequests").doc(again.requestId).get()).exists, false);
  assert.equal((await ref.get()).data().openDocumentRequests, 1);
  assert.equal((await db.collection("caseDocuments").doc(attached).get()).data().review.expiresAt, opened.expiresAt);
  await assert.rejects(handlers.reviewCaseDocument.run(request({ ...data, documentId: pending, requestId: randomUUID() })), { code: "failed-precondition" });
  for (const bad of [{ reason: "no" }, { decision: "approved" }]) await assert.rejects(handlers.reviewCaseDocument.run(request({ ...data, ...bad, requestId: randomUUID() })), { code: "invalid-argument" });
  // A change reference cannot be replayed against another document.
  await db.collection("caseDocuments").doc(pending).update({ status: "attached", ticketId: ref.id, expiresAt: null });
  await assert.rejects(handlers.reviewCaseDocument.run(request({ ...data, documentId: pending })), { code: "already-exists" });
});

function memoryStore() {
  const objects = new Map();
  return { objects,
    save: async (path, bytes) => { objects.set(path, bytes); },
    read: async path => { if (!objects.has(path)) throw new Error("Synthetic missing object"); return objects.get(path); },
    removeAll: async id => { for (const key of objects.keys()) if (key.startsWith("case-documents/" + id + "/")) objects.delete(key); } };
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
// Stands in for the screening engine so these tests exercise only storage, binding and quotas.
const fakeEngine = () => ({ ENGINE_VERSION: "test-engine", sniffContentType: bytes => bytes[0] === 0xff ? "image/jpeg" : null,
  screenDocument: async (screenInput, deps) => {
    await deps.findDuplicates({ sha256: "synthetic", dhash: null, dhashBands: [], idNumberHash: null, reporterNameNorm: null });
    return { risk: "low", score: 5, summary: "Synthetic screening", userMessages: ["Synthetic message"],
      checks: [{ id: "integrity", label: "File integrity", result: "pass", detail: "Synthetic" }], extracted: {},
      sha256: "synthetic-" + screenInput.kind, dhash: "0000000000000000", dhashBands: ["0:00"], idNumberHash: null, reporterNameNorm: null,
      width: 800, height: 600, pageCount: null, derived: [{ key: "ela", contentType: "image/png", bytes: Buffer.from("ela") }] };
  } });
const uploadRequest = (submissionId, kind = "site_photo", contentType = "image/jpeg") =>
  validateUploadRequest({ submissionId, kind, fileName: "photo.jpg", contentType, dataBase64: JPEG.toString("base64") });

test("uploads check the phone proof without spending it, cap each report and bind removal to the uploader", async () => {
  const verified = await options();
  const store = memoryStore(), deps = { store, engine: fakeEngine(), uidaiCertPem: null }, submissionId = randomUUID();
  const proof = { phone: verified.phone, token: verified.token, address: "192.0.2.80", requireOtp: true, secret };
  await assert.rejects(uploadCaseDocument(db, deps, uploadRequest(submissionId), { ...proof, token: "0".repeat(64) }), { code: "unauthenticated" });
  await assert.rejects(uploadCaseDocument(db, deps, uploadRequest(submissionId), { ...proof, token: "" }), { code: "unauthenticated" });
  await assert.rejects(uploadCaseDocument(db, deps, uploadRequest(submissionId, "site_photo", "image/png"), proof), { code: "invalid-argument" });
  const first = await uploadCaseDocument(db, deps, uploadRequest(submissionId, "aadhaar"), proof);
  assert.deepEqual(first.screening, { state: "done", userMessages: ["Synthetic message"] });
  const record = (await db.collection("caseDocuments").doc(first.documentId).get()).data();
  assert.equal(record.phoneHash, hashId(verified.phone)); assert.equal(record.status, "pending"); assert.equal(record.screening.state, "done");
  assert.equal(record.storage.ela, "case-documents/" + first.documentId + "/ela.png");
  assert.ok(store.objects.has(record.storage.original));
  assert.equal((await db.collection("disputeVerifications").doc(verificationKey(verified.token, secret)).get()).data().used, false);
  for (let i = 1; i < contract.documents.maxFiles; i++) await uploadCaseDocument(db, deps, uploadRequest(submissionId), proof);
  await assert.rejects(uploadCaseDocument(db, deps, uploadRequest(submissionId), proof), { code: "resource-exhausted" });
  const target = { submissionId, documentId: first.documentId };
  await assert.rejects(removeCaseDocument(db, store, target, { ...proof, phone: "+12025550998" }), { code: "unauthenticated" });
  await assert.rejects(removeCaseDocument(db, store, target, { phone: "", token: "", address: proof.address, requireOtp: false, secret }), { code: "not-found" });
  await assert.rejects(removeCaseDocument(db, store, { ...target, submissionId: randomUUID() }, proof), { code: "not-found" });
  assert.deepEqual(await removeCaseDocument(db, store, target, proof), { removed: true });
  assert.equal((await db.collection("caseDocuments").doc(first.documentId).get()).exists, false);
  assert.equal([...store.objects.keys()].some(key => key.startsWith("case-documents/" + first.documentId + "/")), false);
  assert.equal((await db.collection("documentPurges").doc(first.documentId).get()).exists, false);
  assert.deepEqual(await removeCaseDocument(db, store, target, proof), { removed: true });
  assert.ok((await uploadCaseDocument(db, deps, uploadRequest(submissionId), proof)).documentId);
});

test("the connection quota holds, and screening or storage failures never leave a broken upload", async () => {
  const store = memoryStore(), address = "192.0.2.81", submissionId = randomUUID();
  const guest = { phone: "", token: "", address, requireOtp: false, secret };
  const quota = db.collection("documentUploadLimits").doc(hashId(addressBucket(address)));
  // 150 files / 300 MiB per connection per day (UPLOADS_PER_IP_DAY / UPLOAD_BYTES_PER_IP_DAY_MIB defaults).
  const MIB = 1024 * 1024, deps = { store, engine: fakeEngine(), uidaiCertPem: null };
  await quota.set({ count: 150, bytes: 0, windowStartedAt: Date.now() - 1000 });
  await assert.rejects(uploadCaseDocument(db, deps, uploadRequest(submissionId), guest), { code: "resource-exhausted" });
  await quota.set({ count: 0, bytes: 300 * MIB - JPEG.length + 1, windowStartedAt: Date.now() - 1000 });
  await assert.rejects(uploadCaseDocument(db, deps, uploadRequest(submissionId), guest), { code: "resource-exhausted" });
  await quota.set({ count: 149, bytes: 300 * MIB - JPEG.length, windowStartedAt: Date.now() - 1000 });
  const last = await uploadCaseDocument(db, deps, uploadRequest(submissionId), guest);
  assert.equal((await quota.get()).data().count, 150);
  await removeCaseDocument(db, store, { submissionId, documentId: last.documentId }, guest);
  await quota.set({ count: 150, bytes: 300 * MIB, windowStartedAt: Date.now() - 86_400_001 });
  const broken = { ...fakeEngine(), screenDocument: async () => { throw new Error("Synthetic engine crash"); } };
  const saved = await uploadCaseDocument(db, { store, engine: broken, uidaiCertPem: null }, uploadRequest(submissionId), guest);
  assert.deepEqual(saved.screening, { state: "error", userMessages: [] });
  assert.equal((await quota.get()).data().count, 1);
  const record = (await db.collection("caseDocuments").doc(saved.documentId).get()).data();
  assert.equal(record.phoneHash, null); assert.equal(record.addressHash, hashId(addressBucket(address)));
  const failing = { ...store, save: async () => { throw new Error("Synthetic storage outage"); } };
  await assert.rejects(uploadCaseDocument(db, { store: failing, engine: fakeEngine(), uidaiCertPem: null }, uploadRequest(submissionId), guest), { code: "unavailable" });
  assert.equal((await db.collection("caseDocuments").where("submissionId", "==", submissionId).get()).size, 1);
});

test("the purge removes lapsed uploads and closed-case files but spares reopened cases", async () => {
  const store = memoryStore(), submissionId = randomUUID(), now = Date.now();
  const ids = await seedDocuments({ submissionId, kinds: ["aadhaar", "pan", "ownership_deed", "land_record"], overrides: {
    aadhaar: { expiresAt: now - 1000 },
    pan: { status: "attached", ticketId: "synthetic-purge", expiresAt: null, purgeAt: now - 1000 },
    ownership_deed: { status: "attached", ticketId: "synthetic-purge", expiresAt: null, purgeAt: null },
  } });
  const [lapsed, closed, reopened, live] = ids;
  for (const id of ids) await store.save("case-documents/" + id + "/original", Buffer.from("x"));
  await purgeDocumentBatch(db, store, "expiresAt", now);
  await purgeDocumentBatch(db, store, "purgeAt", now);
  const exists = async id => (await db.collection("caseDocuments").doc(id).get()).exists;
  assert.equal(await exists(lapsed), false); assert.equal(await exists(closed), false);
  assert.equal(await exists(reopened), true); assert.equal(await exists(live), true);
  assert.deepEqual([...store.objects.keys()].sort(), [reopened, live].map(id => "case-documents/" + id + "/original").sort());
  // A failed Storage delete keeps a tombstone until a later run succeeds.
  const [stuck] = await seedDocuments({ submissionId, kinds: ["other"], overrides: { other: { expiresAt: now - 1000 } } });
  const outage = { ...store, removeAll: async () => { throw new Error("Synthetic storage outage"); } };
  assert.ok((await purgeDocumentBatch(db, outage, "expiresAt", now)).leftOver >= 1);
  assert.equal(await exists(stuck), false);
  assert.equal((await db.collection("documentPurges").doc(stuck).get()).exists, true);
  await drainPurgeQueue(db, store);
  assert.equal((await db.collection("documentPurges").doc(stuck).get()).exists, false);
});

// A submitted case whose flagged Aadhaar copy staff asked to be uploaded again.
async function caseWithRequest({ guest = false } = {}) {
  const submissionId = randomUUID();
  const data = guest
    ? { input, phone: "", token: "", address: "192.0.2.95", requireOtp: false, consent: true, consentVersion: contract.version, whatsappUpdates: false, secret,
      submissionId, documentIds: await seedDocuments({ submissionId, address: "192.0.2.95" }) }
    : { ...(await options()), address: "192.0.2.90" };
  await db.collection("caseDocuments").doc(data.documentIds[0]).update({ "screening.risk": "altered" });
  const { ticketId } = await submitDisputeTransaction(db, data);
  const requestId = randomUUID();
  await handlers.reviewCaseDocument.run(request({ documentId: data.documentIds[0], decision: "reupload_requested", reason: "Synthetic: photo blurred", requestId }));
  return { ...data, ticketId, requestId, previousId: data.documentIds[0] };
}
async function freshGrant(phone) {
  const verified = await confirmOtp(db, phone, await issueOtp(db, phone, secret), secret);
  assert.equal(verified.ok, true);
  return verified.token;
}
const REPLACEMENT_ADDRESS = "192.0.2.91";
function replace(deps, filed, token, { phone = filed.phone, requestId = filed.requestId } = {}) {
  const parsed = validateReplacementRequest({ reference: filed.ticketId, requestId, phone, verificationToken: token,
    fileName: "replacement.jpg", contentType: "image/jpeg", dataBase64: JPEG.toString("base64") });
  return replaceCaseDocument(db, deps, parsed.upload, { phone: parsed.phone, token: parsed.token, address: REPLACEMENT_ADDRESS, secret });
}
const replacementsFor = async requestId => (await db.collection("caseDocuments").where("replacementFor", "==", requestId).get()).size;

test("replacement uploads need the filing phone's unspent grant and an open request, then supersede the old copy", async () => {
  const store = memoryStore(), deps = { store, engine: fakeEngine(), uidaiCertPem: null };
  const filed = await caseWithRequest();
  assert.equal((await db.collection("tickets").doc(filed.ticketId).get()).data().documents.flagged, 1);
  // The filing grant was spent by the submission.
  await assert.rejects(replace(deps, filed, filed.token), { code: "unauthenticated" });
  const token = await freshGrant(filed.phone);
  const stranger = "+12025550997", strangerToken = await freshGrant(stranger);
  await assert.rejects(replace(deps, filed, strangerToken, { phone: stranger }), { code: "permission-denied" });
  await assert.rejects(replace(deps, filed, strangerToken), { code: "unauthenticated" });
  await assert.rejects(replace(deps, filed, token, { requestId: randomUUID() }), { code: "not-found" });
  assert.equal(await replacementsFor(filed.requestId), 0);
  const result = await replace(deps, filed, token);
  assert.deepEqual(result.screening, { state: "done", userMessages: ["Synthetic message"] });
  const read = async (name, id) => (await db.collection(name).doc(id).get()).data();
  const fresh = await read("caseDocuments", result.documentId), old = await read("caseDocuments", filed.previousId);
  assert.equal(fresh.status, "attached"); assert.equal(fresh.ticketId, filed.ticketId); assert.equal(fresh.expiresAt, null);
  assert.equal(fresh.replaces, filed.previousId); assert.equal(fresh.supersededBy, null); assert.equal(fresh.kind, old.kind);
  assert.equal(old.status, "attached"); assert.equal(old.supersededBy, result.documentId);
  const answered = await read("documentRequests", filed.requestId);
  assert.equal(typeof answered.fulfilledAt, "number"); assert.equal(answered.fulfilledDocumentId, result.documentId);
  // The summary now describes the current copy, so the replaced flag no longer counts.
  const ticket = await read("tickets", filed.ticketId);
  assert.equal(ticket.openDocumentRequests, 0);
  assert.deepEqual(ticket.documents, { caseType: "person_vs_person", count: PERSON_KINDS.length, kinds: PERSON_KINDS, flagged: 0 });
  const event = await read("tickets/" + filed.ticketId + "/events", "replaced_" + filed.requestId);
  assert.deepEqual({ ...event, at: undefined }, { type: "document_replaced", kind: old.kind, requestId: filed.requestId, documentId: result.documentId, at: undefined });
  assert.ok(event.at instanceof admin.firestore.Timestamp);
  // Checked, not spent: the same grant still answers another request.
  assert.equal((await read("disputeVerifications", verificationKey(token, secret))).used, false);
  await assert.rejects(replace(deps, filed, token), { code: "failed-precondition" });
  assert.equal(await replacementsFor(filed.requestId), 1);
  // Staff can no longer ask for the superseded copy.
  await assert.rejects(handlers.reviewCaseDocument.run(request({ documentId: filed.previousId, decision: "reupload_requested", reason: "Synthetic: again", requestId: randomUUID() })),
    { code: "failed-precondition" });
});

test("expired requests and guest cases cannot take a replacement", async () => {
  const store = memoryStore(), deps = { store, engine: fakeEngine(), uidaiCertPem: null };
  const filed = await caseWithRequest();
  await db.collection("documentRequests").doc(filed.requestId).update({ expiresAt: Date.now() - 1 });
  await assert.rejects(replace(deps, filed, await freshGrant(filed.phone)), { code: "failed-precondition" });
  assert.equal(await replacementsFor(filed.requestId), 0);
  // A guest filed without a verified phone, so no phone can prove it owns the case.
  const guest = await caseWithRequest({ guest: true });
  assert.match((await db.collection("tickets").doc(guest.ticketId).get()).data().reporterUid, /^guest-/);
  const phone = "+12025550996";
  await assert.rejects(replace(deps, guest, await freshGrant(phone), { phone }), { code: "permission-denied" });
  assert.equal(await replacementsFor(guest.requestId), 0);
  assert.equal((await db.collection("tickets").doc(guest.ticketId).get()).data().openDocumentRequests, 1);
});

test("the public status lookup returns status, dates and open requests only, charged per connection", async () => {
  const filed = await caseWithRequest();
  await handlers.updateTicketStatus.run(request({ ticketId: filed.ticketId, status: "investigating", reason: "Synthetic private reason",
    expectedRevision: 1, requestId: randomUUID() }));
  const address = "192.0.2.100";
  const status = await lookupCaseStatus(db, filed.ticketId, address, 3);
  assert.deepEqual(Object.keys(status).sort(), ["documentRequests", "filedAt", "lastUpdatedAt", "reference", "statusId", "statusLabel", "timeline"]);
  assert.equal(status.reference, filed.ticketId); assert.equal(status.statusId, "investigating");
  assert.equal(status.timeline.length, 2); assert.equal(status.timeline[1].statusLabel, status.statusLabel);
  assert.ok(status.filedAt > 0 && status.lastUpdatedAt >= status.filedAt);
  const [open] = status.documentRequests;
  assert.equal(status.documentRequests.length, 1);
  assert.deepEqual(Object.keys(open).sort(), ["expiresAt", "kind", "kindLabel", "requestId", "requestedAt"]);
  assert.equal(open.requestId, filed.requestId); assert.equal(open.kind, PERSON_KINDS[0]); assert.ok(open.kindLabel);
  const wire = JSON.stringify(status);
  for (const text of [input.reporterName, input.otherPartyName, input.description, input.district, filed.phone, String(input.location.latitude),
    "Synthetic private reason", "Synthetic: photo blurred", auth.token.email, STAFF.officerName]) assert.equal(wire.includes(text), false);
  // Unknown references are charged too, so the reference space cannot be walked.
  await assert.rejects(lookupCaseStatus(db, "A".repeat(20), address, 3), error => error.code === "not-found" && !error.message.includes("A".repeat(20)));
  await lookupCaseStatus(db, filed.ticketId, address, 3);
  await assert.rejects(lookupCaseStatus(db, "B".repeat(20), address, 3), { code: "resource-exhausted" });
  assert.equal((await lookupCaseStatus(db, filed.ticketId, "192.0.2.102", 3)).statusId, "investigating");
  // The callable applies the 30-per-hour STATUS_LOOKUPS_PER_IP_HOUR default and validates the reference first.
  const busy = "192.0.2.101", call = reference => handlers.getCaseStatus.run({ data: { reference }, rawRequest: { ip: busy } });
  await db.collection("statusLookupLimits").doc(hashId(addressBucket(busy))).set({ count: 29, windowStartedAt: Date.now() - 1000 });
  await assert.rejects(call("not-a-reference"), { code: "invalid-argument" });
  assert.equal((await call(filed.ticketId)).statusId, "investigating");
  await assert.rejects(call(filed.ticketId), { code: "resource-exhausted" });
});

test("cleanup drops expired re-upload requests, lapsed replacements and stale wave-2 counters", async () => {
  const now = Date.now(), ticket = db.collection("tickets").doc("synthetic-requests");
  await ticket.set({ status: "open", revision: 0, openDocumentRequests: 2 });
  const requestDoc = id => db.collection("documentRequests").doc("synthetic-request-" + id);
  const base = { ticketId: ticket.id, documentId: "synthetic-document", kind: "aadhaar", requestedAt: now - 20 * 86_400_000, fulfilledDocumentId: null };
  await requestDoc("unanswered").set({ ...base, expiresAt: now - 1000, fulfilledAt: null });
  await requestDoc("answered").set({ ...base, expiresAt: now - 1000, fulfilledAt: now - 5000, fulfilledDocumentId: "synthetic-copy" });
  await requestDoc("open").set({ ...base, requestedAt: now, expiresAt: now + 86_400_000, fulfilledAt: null });
  await purgeDocumentRequests(db, now);
  assert.equal((await requestDoc("unanswered").get()).exists, false);
  assert.equal((await requestDoc("answered").get()).exists, false);
  assert.equal((await requestDoc("open").get()).exists, true);
  // Only the unanswered request stops counting; an answered one was already decremented.
  assert.equal((await ticket.get()).data().openDocumentRequests, 1);
  await purgeDocumentRequests(db, now);
  assert.equal((await ticket.get()).data().openDocumentRequests, 1);
  // An abandoned replacement stays pending and lapses like any unsent upload.
  const store = memoryStore();
  const [lapsed] = await seedDocuments({ submissionId: randomUUID(), kinds: ["aadhaar"], overrides: { aadhaar: { expiresAt: now - 1000, replacementFor: "synthetic-request-open" } } });
  await store.save("case-documents/" + lapsed + "/original", Buffer.from("x"));
  await purgeDocumentBatch(db, store, "expiresAt", now);
  assert.equal((await db.collection("caseDocuments").doc(lapsed).get()).exists, false);
  assert.equal(store.objects.size, 0);
  // purgeExpiredOtps sweeps the per-address lookup windows and per-phone notification ceilings.
  for (const [name, field, cutoff] of [["statusLookupLimits", "windowStartedAt", now - 86_400_000], ["notificationLimits", "expiresAt", now]]) {
    const stale = db.collection(name).doc("synthetic-stale"), live = db.collection(name).doc("synthetic-live");
    await stale.set({ count: 1, [field]: cutoff - 1000 }); await live.set({ count: 1, [field]: cutoff + 60_000 });
    await purgeExpiredRecords(db, name, field, cutoff);
    assert.equal((await stale.get()).exists, false); assert.equal((await live.get()).exists, true);
  }
});
