import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../../platform/firebase";
import { purgeExpiredRecords } from "./service";

const DAY_MS = 86_400_000;
const BATCH_SIZE = 200;
const MAX_BATCHES = 10;
// One instance is enough for an hourly sweep and keeps a slow run from
// overlapping the next trigger on the same documents.
export const purgeExpiredOtps = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 540, maxInstances: 1 }, async () => {
  const now = Date.now();
  const collections: [string, string, number | admin.firestore.Timestamp][] = [
    ["disputeOtps", "expiresAt", now - 60 * 60 * 1000],
    ["disputeVerifications", "expiresAt", now],
    ["geocodeCache", "expiresAt", now],
    ["submissionReceipts", "expiresAt", now],
    ["otpSendLimits", "windowStartedAt", now - 60 * 60 * 1000],
    ["reporterLimits", "windowStartedAt", now - DAY_MS],
    ["whatsappDeliveries", "windowStartedAt", now - 30 * DAY_MS],
    ["notificationPreferences", "expiresAt", now],
    // New intake no longer creates duplicate contact profiles.
    ["reporters", "updatedAt", admin.firestore.Timestamp.fromMillis(now - 30 * DAY_MS)],
  ];
  let failures = 0;
  for (const [collection, field, cutoff] of collections) {
    let deleted = 0, remaining = false;
    // One failing collection must not leave every later one (several hold
    // phone-keyed PII) uncleaned until the next run.
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const result = await purgeExpiredRecords(db, collection, field, cutoff, BATCH_SIZE);
        deleted += result.deleted;
        remaining = result.scanned === BATCH_SIZE;
        if (!remaining) break;
      }
    } catch (err) {
      failures++;
      console.error("Expired record cleanup failed", { collection, code: (err as { code?: unknown })?.code ?? "unknown" });
    }
    if (deleted) console.log("Expired record cleanup", { collection, deleted });
    if (remaining) console.warn("Cleanup backlog remains after the per-run cap", { collection, examined: BATCH_SIZE * MAX_BATCHES });
  }
  // Still surface the run as failed so scheduler monitoring sees it.
  if (failures) throw new Error(`Expired record cleanup failed for ${failures} collection(s)`);
});
