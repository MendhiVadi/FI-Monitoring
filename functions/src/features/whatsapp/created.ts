import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, DISPUTE_OTP_SECRET } from "../../platform/secrets";
import { deliverTicketNotification } from "./delivery";

export const notifyWhatsAppOnTicketCreated = onDocumentCreated({
  document: "tickets/{ticketId}", region: "asia-south1", retry: true,
  secrets: [WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, DISPUTE_OTP_SECRET],
}, async (event) => {
  const ticket = event.data?.data();
  if (!ticket || ticket.whatsappUpdates !== true || ticket.phoneVerified !== true) return;
  const phone = ticket.notificationPhone || ticket.waFrom;
  if (typeof phone !== "string" || !phone) return;
  await deliverTicketNotification(event.id, event.time, event.params.ticketId, phone, "request_created", [
    "Forest Rights dispute", event.params.ticketId, "Open / Awaiting Review",
  ], ticket.revision ?? 0);
});
