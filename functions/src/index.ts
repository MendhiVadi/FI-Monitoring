import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineBoolean, defineSecret } from "firebase-functions/params";
import { createHash } from "node:crypto";
import { sendWhatsAppTemplate } from "./whatsapp";
import { validateDisputeInput, createDisputeTicket, assertUnderRateLimit } from "./disputes";

admin.initializeApp();
const db = admin.firestore();

// Require Firebase phone verification by default. The parameter remains
// configurable for controlled maintenance, but an unset deployment is secure.
const otpRequired = defineBoolean("DISPUTE_OTP_REQUIRED", { default: true });
export const submitDispute = onCall(async (request) => {
  const phone = request.auth?.token.phone_number as string | undefined;
  const verified = Boolean(phone && request.auth?.uid);
  if (otpRequired.value() && !verified) {
    throw new HttpsError("unauthenticated", "Verify your phone number before submitting a dispute.");
  }
  // Keep the existing daily limit while verification is paused, without storing raw IPs.
  const address = request.rawRequest.ip;
  if (!verified && !address) throw new HttpsError("unavailable", "Please try again later.");
  const uid = verified ? request.auth!.uid : "guest-" + createHash("sha256").update(address!).digest("hex");

  let input;
  try {
    input = validateDisputeInput(request.data);
  } catch (err) {
    throw new HttpsError("invalid-argument", err instanceof Error ? err.message : "Invalid dispute details.");
  }

  try {
    await assertUnderRateLimit(db, uid);
  } catch (err) {
    throw new HttpsError("resource-exhausted", err instanceof Error ? err.message : "Rate limit exceeded.");
  }

  const ticketId = await createDisputeTicket(db, phone || "", uid, input, verified);
  return { ticketId };
});

const WHATSAPP_ACCESS_TOKEN = defineSecret("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID");

export const notifyWhatsAppOnTicketUpdate = onDocumentUpdated(
  {
    document: "tickets/{ticketId}",
    secrets: [WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status) return;
    const phone = typeof after.notificationPhone === "string" ? after.notificationPhone : after.waFrom;
    const ticketId = event.params.ticketId;
    if (typeof phone !== "string" || !phone || after.whatsappUpdates !== true) return;
    try {
      await sendWhatsAppTemplate(
        phone,
        "ticket_status_update",
        [ticketId, String(after.status)],
        WHATSAPP_PHONE_NUMBER_ID.value(),
        WHATSAPP_ACCESS_TOKEN.value()
      );
    } catch (err) {
      console.error("Failed to send WhatsApp ticket update", { ticketId, phone, err: String(err) });
    }
  }
);
