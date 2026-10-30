import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../../platform/firebase";
import { TERMINAL_STATUSES } from "../tickets/status";
import { computeOverdue, legacyBackfill, NON_TERMINAL_STATUSES, OVERDUE_STATES, overdueTransition } from "./targets";

const BATCH_SIZE = 100;
const MAX_BATCHES = 5;
type Result = { scanned: number; changed: number };

// Re-reads each candidate inside a transaction (an officer may have acted
// since the query) and writes the ticket's new state plus one immutable
// escalation event per transition. Revision and updatedAt are left alone: a
// system flag must neither reorder the registry nor invalidate an officer's
// open edit.
async function escalateBatch(query: admin.firestore.Query, now: number): Promise<Result> {
  const candidates = await query.limit(BATCH_SIZE).get();
  if (candidates.empty) return { scanned: 0, changed: 0 };
  const changed = await db.runTransaction(async tx => {
    const fresh = await tx.getAll(...candidates.docs.map(snapshot => snapshot.ref));
    let count = 0;
    for (const snapshot of fresh) {
      const data = snapshot.data();
      if (!data) continue;
      const transition = overdueTransition(data.overdue, computeOverdue(data, now), now);
      if (!transition) continue;
      tx.update(snapshot.ref, transition);
      tx.create(snapshot.ref.collection("events").doc(), { type: "escalation", overdue: transition.overdue, at: admin.firestore.FieldValue.serverTimestamp() });
      count++;
    }
    return count;
  });
  return { scanned: candidates.size, changed };
}

// Cases filed before service targets existed cannot be found by a query on a
// missing field, so they are walked once in document-id order, resuming from
// a cursor in the server-only `escalationState/backfill` record.
async function backfillLegacyTickets(now: number): Promise<number> {
  const stateRef = db.collection("escalationState").doc("backfill");
  const state = (await stateRef.get()).data();
  if (state?.done === true) return 0;
  let cursor = typeof state?.cursor === "string" ? state.cursor : null, updated = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    let page = db.collection("tickets").orderBy(admin.firestore.FieldPath.documentId()).select("createdAt").limit(BATCH_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    if (!snapshot.empty) {
      updated += await db.runTransaction(async tx => {
        const fresh = await tx.getAll(...snapshot.docs.map(doc => doc.ref));
        let count = 0;
        for (const doc of fresh) {
          const patch = doc.exists ? legacyBackfill(doc.data()!, now) : null;
          if (patch) { tx.update(doc.ref, patch); count++; }
        }
        return count;
      });
      cursor = snapshot.docs[snapshot.docs.length - 1].id;
    }
    if (snapshot.size < BATCH_SIZE) {
      await stateRef.set({ done: true, cursor: null, completedAt: now });
      return updated;
    }
  }
  await stateRef.set({ done: false, cursor, updatedAt: now });
  return updated;
}

// Hourly: flags non-terminal cases that missed a service target (contract
// serviceTargets; internal goals, not legal deadlines) and clears flags that
// no longer apply. Each pass only matches tickets whose state must change, so
// every batch makes progress. One instance so runs never overlap.
export const escalateOverdueCases = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 540, maxInstances: 1 }, async () => {
  const now = Date.now(), tickets = db.collection("tickets");
  let failures = 0;
  try {
    const backfilled = await backfillLegacyTickets(now);
    if (backfilled) console.log("Service-target backfill", { updated: backfilled });
  } catch (err) {
    failures++;
    console.error("Service-target backfill failed", { code: (err as { code?: unknown })?.code ?? "unknown" });
  }
  const passes: [string, () => admin.firestore.Query][] = [
    // Not acknowledged in time.
    ["acknowledge", () => tickets.where("status", "in", NON_TERMINAL_STATUSES).where("firstActionAt", "==", null)
      .where("overdue", "==", null).where("ackDueAt", "<", now)],
    // Past the resolve target (or reopened after it).
    ["resolve", () => tickets.where("status", "in", NON_TERMINAL_STATUSES).where("overdue", "==", null).where("resolveDueAt", "<", now)],
    // Acknowledged since being flagged (e.g. by a document review).
    ["acknowledged", () => tickets.where("overdue", "==", "acknowledge").where("firstActionAt", ">", 0)],
    // Closed while flagged.
    ["closed", () => tickets.where("status", "in", [...TERMINAL_STATUSES]).where("overdue", "in", [...OVERDUE_STATES])],
  ];
  for (const [name, query] of passes) {
    let changed = 0, remaining = false;
    // One failing pass must not stop the others.
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const result = await escalateBatch(query(), now);
        changed += result.changed;
        remaining = result.scanned === BATCH_SIZE;
        // Nothing changed means the rest moved on since the query; stop rather than spin.
        if (!remaining || result.changed === 0) break;
      }
    } catch (err) {
      failures++;
      console.error("Overdue escalation failed", { pass: name, code: (err as { code?: unknown })?.code ?? "unknown" });
    }
    if (changed) console.log("Overdue escalation", { pass: name, changed });
    if (remaining) console.warn("Overdue escalation backlog remains after the per-run cap", { pass: name });
  }
  if (failures) throw new Error(`Overdue escalation failed for ${failures} pass(es)`);
});
