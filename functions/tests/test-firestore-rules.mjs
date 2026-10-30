/**
 * Access-control tests for firestore.rules, run against the Firestore emulator.
 *
 * These pin down the rule that matters most: a dispute ticket holds the
 * reporter's name and phone number, the named opposing party, a free-text
 * account of the dispute and the coordinates of the disputed land, so it must
 * never be world-readable.
 *
 * Usage (needs Java for the emulator):
 *   npm --prefix functions i -D @firebase/rules-unit-testing firebase
 *   npx firebase emulators:exec --only firestore --project demo-forestwatch "node --test functions/tests/test-firestore-rules.mjs"
 */
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, collection, query, limit, getDocs } from "firebase/firestore";

const RULES = new URL("../../firestore.rules", import.meta.url);

const testEnv = await initializeTestEnvironment({
  projectId: "demo-forestwatch",
  firestore: { rules: readFileSync(RULES, "utf8"), host: "127.0.0.1", port: 8080 },
});

const TICKET = {
  waFrom: "+919876543210",
  // Production shape: submitDispute derives reporterUid by hashing the phone
  // number (or the caller IP for an unverified guest). It is never a Firebase
  // Auth uid, so no client can ever match it — seeding a plausible-looking
  // "reporter-1" here would test a code path that cannot occur.
  reporterUid: "phone-3b8f1c2d9e7a5064b1f2c8d4e6a09371",
  phoneVerified: true,
  subject: "Boundary dispute — A vs B",
  status: "open",
  source: "web-dispute-form",
  officerNotes: [],
  dispute: { reporterName: "A", description: "x", location: { latitude: 22, longitude: 79 } },
};

// Aadhaar copies and numbers: the most sensitive record the platform holds.
const CASE_DOCUMENT = {
  submissionId: "synthetic-submission-0001", ticketId: "t1", status: "attached", kind: "aadhaar", side: "reporter",
  idNumberFull: "234567890124", idNumberMasked: "XXXX XXXX 0124", storage: { original: "case-documents/d1/original" },
  screening: { state: "done", risk: "low" }, review: null,
};

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "tickets/t1"), TICKET);
  await setDoc(doc(db, "officers/officer-1"), { email: "o@x.gov.in", role: "DFO" });
  await setDoc(doc(db, "officers/viewer-1"), { email: "v@x.gov.in", role: "Analyst", access: "viewer" });
  await setDoc(doc(db, "officers/admin-1"), { email: "a@x.gov.in", role: "CF", access: "admin" });
  await setDoc(doc(db, "officers/explicit-officer-1"), { email: "e@x.gov.in", access: "officer" });
  await setDoc(doc(db, "officers/odd-1"), { email: "u@x.gov.in", access: "superuser" });
  await setDoc(doc(db, "caseDocuments/d1"), CASE_DOCUMENT);
  await setDoc(doc(db, "tickets/t1/notes/n1"), { text: "Synthetic note", officerUid: "officer-1" });
  await setDoc(doc(db, "tickets/t1/events/e1"), { kind: "status", after: "open", officerUid: "officer-1" });
});

const anon = testEnv.unauthenticatedContext().firestore();
const stranger = testEnv.authenticatedContext("stranger-1").firestore();
// A client that has somehow signed in under the exact reporterUid string.
const reporter = testEnv.authenticatedContext(TICKET.reporterUid).firestore();
const officer = testEnv.authenticatedContext("officer-1", {auth_time: Math.floor(Date.now()/1000)}).firestore();
const staff = uid => testEnv.authenticatedContext(uid, { auth_time: Math.floor(Date.now() / 1000) }).firestore();
const viewer = staff("viewer-1"), admin = staff("admin-1");
// Raw case data: the ticket, its history and its ID documents.
const CASE_PATHS = ["tickets/t1", "tickets/t1/notes/n1", "tickets/t1/events/e1", "caseDocuments/d1"];
const CASE_COLLECTIONS = ["tickets", "tickets/t1/notes", "tickets/t1/events", "caseDocuments"];

test("anonymous visitors cannot read dispute tickets", async () => {
  await assertFails(getDoc(doc(anon, "tickets/t1")));
});

test("a signed-in non-officer cannot read someone else's ticket", async () => {
  await assertFails(getDoc(doc(stranger, "tickets/t1")));
});

test("tickets are officer-only: matching reporterUid grants no read", async () => {
  await assertFails(getDoc(doc(reporter, "tickets/t1")));
});

test("server-only collections are closed to every client", async () => {
  for (const path of [
    "disputeOtps/+919876543210",
    "otpSendLimits/abc123",
    "reporterLimits/phone-abc",
    "reporters/phone-abc",
    "whatsappDeliveries/event-abc",
    "disputeVerifications/grant", "submissionReceipts/receipt", "notificationPreferences/preference", "geocodeCache/query", "mapServiceLimits/nominatim",
    "documentUploadLimits/ip-abc", "documentPurges/d1",
  ]) {
    await assertFails(getDoc(doc(officer, path)));
    await assertFails(getDoc(doc(anon, path)));
    await assertFails(setDoc(doc(officer, path), { verified: true }));
  }
});

test("wave-2 server-only collections are closed to every client, admins included", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "documentRequests/r1"), { ticketId: "t1", documentId: "d1", kind: "aadhaar", requestedAt: 1, expiresAt: 2, fulfilledAt: null, fulfilledDocumentId: null });
    await setDoc(doc(db, "insightsCache/current"), { generatedAt: 1, byStatus: { open: 1 } });
  });
  const clients = [anon, stranger, reporter, viewer, officer, admin];
  for (const path of ["notificationLimits/phone-abc", "statusLookupLimits/addr-abc", "documentRequests/r1", "escalationState/cursor", "insightsCache/current"]) {
    const name = path.split("/")[0];
    for (const db of clients) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(getDocs(query(collection(db, name), limit(10))));
      await assertFails(setDoc(doc(db, path), { count: 0 }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  }
});

test("viewers read no raw case data: not tickets, notes, events or case documents", async () => {
  for (const db of [viewer, staff("odd-1")]) {
    for (const path of CASE_PATHS) await assertFails(getDoc(doc(db, path)));
    for (const path of CASE_COLLECTIONS) await assertFails(getDocs(query(collection(db, path), limit(10))));
  }
});

test("officers and administrators read raw case data, paged", async () => {
  for (const db of [officer, staff("explicit-officer-1"), admin]) {
    for (const path of CASE_PATHS) await assertSucceeds(getDoc(doc(db, path)));
    for (const path of CASE_COLLECTIONS) {
      await assertSucceeds(getDocs(query(collection(db, path), limit(50))));
      await assertFails(getDocs(collection(db, path)));
    }
    await assertFails(updateDoc(doc(db, "tickets/t1"), { status: "resolved" }));
    await assertFails(setDoc(doc(db, "tickets/t1/notes/forged"), { text: "forged" }));
  }
});

test("every staff level reads only its own allow-list entry and none can raise its access", async () => {
  for (const [uid, db] of [["viewer-1", viewer], ["officer-1", officer], ["admin-1", admin]]) {
    await assertSucceeds(getDoc(doc(db, "officers/" + uid)));
    await assertFails(getDoc(doc(db, "officers/" + (uid === "admin-1" ? "viewer-1" : "admin-1"))));
    await assertFails(updateDoc(doc(db, "officers/" + uid), { access: "admin" }));
  }
});

test("an allow-listed officer can read any ticket", async () => {
  const snap = await assertSucceeds(getDoc(doc(officer, "tickets/t1")));
  assert.equal(snap.data().status, "open");
});

test("no client writes tickets directly — even an officer (writes go through Cloud Functions)", async () => {
  await assertFails(updateDoc(doc(officer, "tickets/t1"), { status: "investigating", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(officer, "tickets/t1"), { officerNotes: arrayUnion("note") }));
  await assertFails(updateDoc(doc(officer, "tickets/t1"), { waFrom: "+910000000000" }));
});

test("non-officers cannot update tickets", async () => {
  await assertFails(updateDoc(doc(reporter, "tickets/t1"), { status: "resolved" }));
  await assertFails(updateDoc(doc(anon, "tickets/t1"), { status: "resolved" }));
});

test("no client may forge or delete a ticket", async () => {
  await assertFails(setDoc(doc(officer, "tickets/forged"), TICKET));
  await assertFails(setDoc(doc(anon, "tickets/forged"), TICKET));
  await assertFails(deleteDoc(doc(officer, "tickets/t1")));
});

test("a client cannot grant itself officer access", async () => {
  await assertFails(setDoc(doc(stranger, "officers/stranger-1"), { role: "DFO" }));
});

test("signed eight-hour expiry also blocks direct ticket and note reads", async () => {
  const old = testEnv.authenticatedContext("officer-1", {auth_time: Math.floor(Date.now()/1000)-28801}).firestore();
  const future = testEnv.authenticatedContext("officer-1", {auth_time: Math.floor(Date.now()/1000)+1000}).firestore();
  for (const db of [old, future]) { await assertFails(getDoc(doc(db,"tickets/t1"))); await assertFails(getDoc(doc(db,"tickets/t1/notes/n1"))); }
});
test("case history is staff-readable and server-written", async () => {
  for (const path of ["tickets/t1/notes/n1", "tickets/t1/events/e1"]) {
    await assertSucceeds(getDoc(doc(officer,path)));
    await assertFails(getDoc(doc(anon,path)));
    await assertFails(setDoc(doc(officer,path),{text:"forged"}));
  }
});
test("officer collection reads must be paged", async () => {
  for (const path of ["tickets", "tickets/t1/notes", "tickets/t1/events", "caseDocuments"]) {
    await assertSucceeds(getDocs(query(collection(officer, path), limit(50))));
    await assertFails(getDocs(collection(officer, path)));
    await assertFails(getDocs(query(collection(officer, path), limit(500))));
    await assertFails(getDocs(query(collection(anon, path), limit(50))));
  }
});
test("case documents are staff-readable and never client-written", async () => {
  const snap = await assertSucceeds(getDoc(doc(officer, "caseDocuments/d1")));
  assert.equal(snap.data().kind, "aadhaar");
  for (const db of [anon, stranger, reporter]) await assertFails(getDoc(doc(db, "caseDocuments/d1")));
  const old = testEnv.authenticatedContext("officer-1", {auth_time: Math.floor(Date.now()/1000)-28801}).firestore();
  await assertFails(getDoc(doc(old, "caseDocuments/d1")));
  for (const db of [officer, anon, stranger]) {
    await assertFails(setDoc(doc(db, "caseDocuments/forged"), { ...CASE_DOCUMENT, status: "pending" }));
    await assertFails(updateDoc(doc(db, "caseDocuments/d1"), { review: { decision: "accepted" } }));
    await assertFails(deleteDoc(doc(db, "caseDocuments/d1")));
  }
});
test.after(async () => {
  await testEnv.cleanup();
});
