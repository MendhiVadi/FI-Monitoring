import { createHash } from "node:crypto";
import { db } from "../../platform/firebase";
import { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID } from "../../platform/secrets";
import { sendWhatsAppTemplate, WhatsAppSendError } from "./client";
import { hashId } from "../otp/identity";

const FINAL = ["accepted", "sent", "delivered", "read", "failed", "uncertain", "superseded", "opted_out"];
export async function deliverTicketNotification(eventId: string, eventTime: string, ticketId: string,
  phone: string, template: string, parameters: string[], expectedRevision?: number): Promise<void> {
  const id = createHash("sha256").update(eventId).digest("hex");
  const ref = db.collection("whatsappDeliveries").doc(id), now = Date.now();
  if (!Number.isFinite(Date.parse(eventTime)) || now - Date.parse(eventTime) > 86_400_000) return;
  const claimed = await db.runTransaction(async tx => {
    const [delivery, ticket, preference] = await tx.getAll(ref, db.collection("tickets").doc(ticketId),
      db.collection("notificationPreferences").doc(hashId(phone)));
    const state = delivery.data(), current = ticket.data(), optedOut = preference.data();
    if (FINAL.includes(state?.status)) return false;
    if (state?.status === "sending") {
      if (state.leaseUntil > now) throw new Error("Notification send is in progress.");
      tx.update(ref, { status: "uncertain", leaseUntil: 0 });
      return false;
    }
    const created = current?.consent?.acceptedAt?.toMillis?.() ?? current?.createdAt?.toMillis?.() ?? 0;
    const status = !current || current.whatsappUpdates !== true || current.phoneVerified !== true ||
      (optedOut?.stoppedAt && optedOut.stoppedAt >= created) ? "opted_out" :
      (expectedRevision !== undefined && (current.revision ?? 0) !== expectedRevision) ? "superseded" : "sending";
    tx.set(ref, { ticketId, template, status, leaseUntil: status === "sending" ? now + 60_000 : 0,
      windowStartedAt: state?.windowStartedAt ?? now }, { merge: true });
    return status === "sending";
  });
  if (!claimed) return;
  async function recordSendError(status: string, errorCode: number | string) {
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!current || ["sent", "delivered", "read", "failed"].includes(current.status)) return;
      tx.update(ref, { status, leaseUntil: 0, errorCode });
    });
  }
  let messageId: string;
  try {
    if (!/^\+?[1-9]\d{6,14}$/.test(phone)) throw new WhatsAppSendError(400);
    messageId = await sendWhatsAppTemplate(phone, template, parameters,
      WHATSAPP_PHONE_NUMBER_ID.value(), WHATSAPP_ACCESS_TOKEN.value(), id);
  } catch (err) {
    if (!(err instanceof WhatsAppSendError)) {
      // A timeout/disconnect may occur after provider acceptance. Wait for the
      // correlated receipt; a blind retry can notify the reporter twice.
      await recordSendError("uncertain", "send_unconfirmed");
      return;
    }
    const retryableCodes = [130429, 131000, 131016, 131048, 131056];
    const retryable = err.status >= 500 || err.status === 429 || retryableCodes.includes(err.providerCode ?? -1);
    await recordSendError(retryable ? "retrying" : "failed", err.providerCode ?? err.status);
    if (retryable) throw new Error("Notification provider temporarily unavailable.");
    return;
  }
  // If this commit fails, the next invocation leaves the send uncertain instead
  // of sending it again. A webhook can still complete the record using id.
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    const alreadyReceived = ["sent", "delivered", "read", "failed"].includes(current?.status);
    tx.update(ref, { messageId, status: alreadyReceived ? current!.status : "accepted", acceptedAt: now, leaseUntil: 0 });
  });
}
