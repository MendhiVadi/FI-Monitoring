import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, DISPUTE_OTP_SECRET } from "../../platform/secrets";
import { deliverTicketNotification } from "./delivery";
import { ticketUpdateNotice } from "./updates";

export const notifyWhatsAppOnTicketUpdate = onDocumentUpdated(
  {
    document: "tickets/{ticketId}",
    region: "asia-south1",
    retry: true,
    // Provider rate-limit (429) errors are redelivered (retry: true), so this
    // only paces sends. The per-phone ceiling is enforced in delivery.
    maxInstances: 10,
    secrets: [WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, DISPUTE_OTP_SECRET],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const notice = ticketUpdateNotice(before, after);
    if (!notice) return;
    const phone = typeof after.notificationPhone === "string" ? after.notificationPhone : after.waFrom;
    const ticketId = event.params.ticketId;
    // Mirror delivery's consent checks here so unverified tickets skip its transaction and delivery record.
    if (typeof phone !== "string" || !phone || after.whatsappUpdates !== true || after.phoneVerified !== true) return;
    if (notice === "unsupported_status") {
      console.error("Skipped WhatsApp update for unsupported status", { ticketId, status: String(after.status) });
      return;
    }
    await deliverTicketNotification(event.id, event.time, ticketId, phone, "status_update",
      ["Forest Rights dispute", ticketId, notice.text + " · " + new Date(event.time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })],
      notice.revisionBound ? after.revision ?? 0 : undefined);
  }
);
