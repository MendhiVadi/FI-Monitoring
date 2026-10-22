import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { DISPUTE_OTP_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID } from "../../platform/secrets";
import { sendWhatsAppTemplate, WhatsAppSendError } from "../whatsapp/client";
import { normalizePhone, assertIpUnderSendLimit, issueOtp, confirmOtp, recordOtpDelivery, OtpRateLimitError } from "./service";
import { addressBucket, hashId } from "./identity";

// Cost ceiling for unauthenticated endpoints: a flood queues or is shed at
// this many instances instead of scaling the bill without bound.
const PUBLIC_MAX_INSTANCES = 10;

// Sends a fresh, database-backed one-time code for dispute-intake phone
// verification. This is deliberately not Firebase Auth phone sign-in: the
// code lives in Firestore (see ./service.ts), never mints an auth token, and a
// verified phone is proven to `submitDispute` by looking up that record —
// not by carrying a signed-in session.
export const requestDisputeOtp = onCall(
  { invoker: "public", maxInstances: PUBLIC_MAX_INSTANCES, timeoutSeconds: 60,
    secrets: [DISPUTE_OTP_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID] },
  async (request) => {
    let phone: string;
    try {
      phone = normalizePhone(request.data?.phone);
    } catch (err) {
      throw new HttpsError("invalid-argument", err instanceof Error ? err.message : "Invalid phone number.");
    }

    // Unauthenticated endpoint that sends a billed WhatsApp message, so it is
    // capped per source address as well as per phone number — otherwise one
    // caller can walk a list of numbers and message-bomb at project cost.
    const address = request.rawRequest.ip;
    if (!address) throw new HttpsError("unavailable", "Please try again later.");
    try {
      await assertIpUnderSendLimit(db, hashId(addressBucket(address)));
    } catch (err) {
      // Deliberately a fixed message: the underlying error may carry Firestore
      // internals, and this endpoint is unauthenticated.
      if (err instanceof OtpRateLimitError) throw new HttpsError("resource-exhausted", err.message);
      throw new HttpsError("unavailable", "Verification storage is unavailable. Please try again shortly.");
    }

    let code: string;
    try {
      code = await issueOtp(db, phone, DISPUTE_OTP_SECRET.value());
    } catch (err) {
      if (err instanceof OtpRateLimitError) throw new HttpsError("resource-exhausted", err.message);
      throw new HttpsError("unavailable", "Verification storage is unavailable. Please try again shortly.");
    }

    try {
      const messageId = await sendWhatsAppTemplate(
        phone,
        "otp_code",
        [code],
        WHATSAPP_PHONE_NUMBER_ID.value(),
        WHATSAPP_ACCESS_TOKEN.value()
      );
      await recordOtpDelivery(db, phone, code, DISPUTE_OTP_SECRET.value(), "accepted", messageId);
    } catch (err) {
      await recordOtpDelivery(db, phone, code, DISPUTE_OTP_SECRET.value(), "failed").catch(() => undefined);
      console.error("Failed to send dispute OTP", { code: err instanceof WhatsAppSendError ? err.providerCode : "unavailable" });
      if (err instanceof WhatsAppSendError && [10, 190, 132001, 132015, 132016].includes(err.providerCode ?? -1)) {
        throw new HttpsError("failed-precondition", "WhatsApp verification is unavailable because the sender setup needs attention. Your draft is kept. Please contact the project team.");
      }
      throw new HttpsError("unavailable", "Could not send the WhatsApp verification code. Please try again shortly.");
    }
    return { sent: true };
  }
);

export const verifyDisputeOtp = onCall({ invoker: "public", maxInstances: PUBLIC_MAX_INSTANCES, timeoutSeconds: 30,
  secrets: [DISPUTE_OTP_SECRET] }, async (request) => {
  let phone: string;
  try {
    phone = normalizePhone(request.data?.phone);
  } catch (err) {
    throw new HttpsError("invalid-argument", err instanceof Error ? err.message : "Invalid phone number.");
  }
  const code = typeof request.data?.code === "string" ? request.data.code.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    throw new HttpsError("invalid-argument", "Enter the complete 6-digit code.");
  }
  let result;
  try {
    result = await confirmOtp(db, phone, code, DISPUTE_OTP_SECRET.value());
  } catch {
    console.error("OTP confirmation storage failed");
    throw new HttpsError("internal", "Could not verify the code. Try again shortly.");
  }
  if (!result.ok) {
    throw new HttpsError("permission-denied", result.reason || "Verification failed.");
  }
  // The token — not the phone number — is what proves verification to
  // submitDispute, so only this caller can spend it.
  return { verified: true, verificationToken: result.token };
});
