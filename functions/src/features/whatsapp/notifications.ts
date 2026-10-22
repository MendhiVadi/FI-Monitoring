import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, DISPUTE_OTP_SECRET } from "../../platform/secrets";
import { TICKET_STATUSES, type TicketStatus } from "../tickets/status";
import { deliverTicketNotification } from "./delivery";

export const notifyWhatsAppOnTicketUpdate = onDocumentUpdated(
  {
    document: "tickets/{ticketId}",
    region: "asia-south1",
    retry: true,
    // Throttled events are redelivered (retry: true), so this only paces sends.
    maxInstances: 10,
    secrets: [WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, DISPUTE_OTP_SECRET],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const statusChanged = before.status !== after.status;
    const noteAdded = (after.noteCount ?? 0) > (before.noteCount ?? 0);
    if (!statusChanged && !noteAdded) return;
    const phone = typeof after.notificationPhone === "string" ? after.notificationPhone : after.waFrom;
    const ticketId = event.params.ticketId;
    // Mirror delivery's consent checks here so unverified tickets skip its transaction and delivery record.
    if (typeof phone !== "string" || !phone || after.whatsappUpdates !== true || after.phoneVerified !== true) return;
    const status = String(after.status) as TicketStatus;
    if (!Object.prototype.hasOwnProperty.call(TICKET_STATUSES, status)) {
      console.error("Skipped WhatsApp update for unsupported status", { ticketId, status });
      return;
    }
    const update = statusChanged ? TICKET_STATUSES[status]
      : `Staff added an update. Current status: ${TICKET_STATUSES[status]}`;
    await deliverTicketNotification(event.id, event.time, ticketId, phone, "status_update",
      ["Forest Rights dispute", ticketId, update + " · " + new Date(event.time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })], after.revision ?? 0);
  }
);
