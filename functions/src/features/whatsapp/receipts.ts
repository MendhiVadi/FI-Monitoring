import * as admin from "firebase-admin";
import { db } from "../../platform/firebase";
import { hashId } from "../otp/identity";

const order: Record<string, number> = { sending: 0, uncertain: 0, retrying: 0, accepted: 1, sent: 2, failed: 3, delivered: 4, read: 5 };
export async function recordReceipt(receipt: { id?: unknown; status?: unknown; biz_opaque_callback_data?: unknown; errors?: { code?: unknown }[] }) {
  if (typeof receipt.id !== "string" || typeof receipt.status !== "string" || !["sent", "delivered", "read", "failed"].includes(receipt.status)) return;
  const tracking = receipt.biz_opaque_callback_data;
  const direct = typeof tracking === "string" && /^[a-f0-9]{64}$/.test(tracking) ? db.collection("whatsappDeliveries").doc(tracking) : null;
  const refs = direct ? [direct] : (await db.collection("whatsappDeliveries").where("messageId", "==", receipt.id).limit(1).get()).docs.map(item => item.ref);
  for (const ref of refs) await db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data();
    if (!previous || (order[previous.status] ?? -1) > order[receipt.status as string]) return;
    tx.update(ref, { status: receipt.status, messageId: receipt.id, receivedAt: Date.now(), leaseUntil: 0,
      errorCode: receipt.status === "failed" && typeof receipt.errors?.[0]?.code === "number" ? receipt.errors[0].code : null });
  });
}
export async function stopNotifications(rawPhone: unknown, messageTime: unknown) {
  if (typeof rawPhone !== "string" || !/^\+?[1-9]\d{6,14}$/.test(rawPhone)) return;
  const phone = "+" + rawPhone.replace(/^\+/, "");
  const receivedTime = Number(messageTime) * 1000;
  if (!Number.isFinite(receivedTime) || receivedTime <= 0 || receivedTime > Date.now() + 60_000) return;
  let stoppedAt = receivedTime;
  const preference = db.collection("notificationPreferences").doc(hashId(phone));
  await db.runTransaction(async tx => {
    const previous = (await tx.get(preference)).data();
    stoppedAt = Math.max(receivedTime, previous?.stoppedAt ?? 0);
    tx.set(preference, { stoppedAt });
  });
  // Persist the opt-out on retained tickets so expiring the temporary preference
  // record never re-enables old reports. New explicit opt-ins remain independent.
  for (const field of ["notificationPhone", "waFrom"]) {
    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      let q = db.collection("tickets").where(field, "==", phone).orderBy(admin.firestore.FieldPath.documentId()).limit(200);
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get();
      if (page.empty) break;
      await db.runTransaction(async tx => {
        const fresh = await tx.getAll(...page.docs.map(item => item.ref));
        for (const item of fresh) {
          const data = item.data();
          if (data && (data.consent?.acceptedAt?.toMillis?.() ?? 0) <= stoppedAt) tx.update(item.ref, { whatsappUpdates: false });
        }
      });
      cursor = page.docs[page.docs.length - 1];
      if (page.size < 200) break;
    }
  }
  await db.runTransaction(async tx => {
    const current = (await tx.get(preference)).data();
    if (current?.stoppedAt === stoppedAt) tx.update(preference, { expiresAt: Date.now() + 90 * 86_400_000 });
  });

}
