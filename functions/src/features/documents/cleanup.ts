import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../../platform/firebase";
import { purgeExpiredRecords } from "../otp/service";
import { DAY_MS } from "./rules";
import { drainPurgeQueue, purgeDocumentBatch, purgeDocumentRequests } from "./service";
import { firebaseStore } from "./storage";

const BATCH_SIZE = 100;
const MAX_BATCHES = 5;
type Pass = () => Promise<{ deleted: number; scanned: number; leftOver?: number }>;

// Daily: abandoned uploads expire within hours, and closed cases are only
// purged 90 days after closing. One instance so runs never overlap.
export const purgeExpiredDocuments = onSchedule({ schedule: "every 24 hours", timeoutSeconds: 540, maxInstances: 1, memory: "512MiB" }, async () => {
  const now = Date.now();
  const passes: [string, Pass][] = [
    ["documentPurges", () => drainPurgeQueue(db, firebaseStore, BATCH_SIZE)],
    ["pendingDocuments", () => purgeDocumentBatch(db, firebaseStore, "expiresAt", now, BATCH_SIZE)],
    ["closedCaseDocuments", () => purgeDocumentBatch(db, firebaseStore, "purgeAt", now, BATCH_SIZE)],
    ["documentUploadLimits", () => purgeExpiredRecords(db, "documentUploadLimits", "windowStartedAt", now - DAY_MS, BATCH_SIZE)],
    ["documentRequests", () => purgeDocumentRequests(db, now, BATCH_SIZE)],
  ];
  let failures = 0;
  for (const [name, pass] of passes) {
    let deleted = 0, leftOver = 0, remaining = false;
    // One failing pass must not leave the later ones (all hold PII) uncleaned.
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const result = await pass();
        deleted += result.deleted; leftOver += result.leftOver ?? 0;
        remaining = result.scanned === BATCH_SIZE;
        // Queue items that failed again stay queued; stop rather than spin on them.
        if (!remaining || result.deleted === 0) break;
      }
    } catch (err) {
      failures++;
      console.error("Document cleanup failed", { pass: name, code: (err as { code?: unknown })?.code ?? "unknown" });
    }
    if (deleted) console.log("Document cleanup", { pass: name, deleted });
    if (leftOver) console.warn("Document objects queued for the next run", { pass: name, count: leftOver });
    if (remaining) console.warn("Document cleanup backlog remains after the per-run cap", { pass: name });
  }
  if (failures) throw new Error(`Document cleanup failed for ${failures} pass(es)`);
});
