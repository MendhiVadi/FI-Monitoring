import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../../platform/firebase";
import { purgeExpiredRecords } from "./service";

const DAY_MS = 86_400_000;
export const purgeExpiredOtps = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 540 }, async () => {
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
  for (const [collection, field, cutoff] of collections) {
    let deleted = 0, remaining = false;
    for (let batch = 0; batch < 10; batch++) {
      const result = await purgeExpiredRecords(db, collection, field, cutoff);
      deleted += result.deleted;
      remaining = result.scanned === 200;
      if (!remaining) break;
    }
    if (deleted) console.log("Expired record cleanup", { collection, deleted });
    if (remaining) console.warn("Cleanup backlog remains after 2,000 examined records", { collection });
  }
});
