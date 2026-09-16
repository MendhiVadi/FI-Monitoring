import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineBoolean } from "firebase-functions/params";
import { db } from "../../platform/firebase";
import { DISPUTE_OTP_SECRET } from "../../platform/secrets";
import { normalizePhone } from "../otp/service";
import { submitDisputeTransaction, validateDisputeInput } from "./service";

const otpRequired = defineBoolean("DISPUTE_OTP_REQUIRED", { default: true });
export const submitDispute = onCall({ invoker: "public", secrets: [DISPUTE_OTP_SECRET] }, async (request) => {
  let input, phone = "";
  try {
    input = validateDisputeInput(request.data);
    if (request.data?.phone) phone = normalizePhone(request.data.phone);
  } catch (err) {
    throw new HttpsError("invalid-argument", err instanceof Error ? err.message : "Invalid dispute details.");
  }
  const address = request.rawRequest.ip;
  if (!address) throw new HttpsError("unavailable", "Please try again later.");
  return submitDisputeTransaction(db, {
    input, phone, address, requireOtp: otpRequired.value(), secret: DISPUTE_OTP_SECRET.value(),
    token: typeof request.data?.verificationToken === "string" ? request.data.verificationToken : "",
    submissionId: typeof request.data?.submissionId === "string" ? request.data.submissionId : "",
    consent: request.data?.consent === true, consentVersion: request.data?.consentVersion,
    whatsappUpdates: request.data?.whatsappUpdates === true,
  });
});
