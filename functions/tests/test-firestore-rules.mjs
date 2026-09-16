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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion } from "firebase/firestore";

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

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "tickets/t1"), TICKET);
  await setDoc(doc(db, "officers/officer-1"), { email: "o@x.gov.in", role: "DFO" });
});

const anon = testEnv.unauthenticatedContext().firestore();
const stranger = testEnv.authenticatedContext("stranger-1").firestore();
// A client that has somehow signed in under the exact reporterUid string.
const reporter = testEnv.authenticatedContext(TICKET.reporterUid).firestore();
const officer = testEnv.authenticatedContext("officer-1", {auth_time: Math.floor(Date.now()/1000)}).firestore();

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
  ]) {
    await assertFails(getDoc(doc(officer, path)));
    await assertFails(getDoc(doc(anon, path)));
    await assertFails(setDoc(doc(officer, path), { verified: true }));
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
test.after(async () => {
  await testEnv.cleanup();
});
