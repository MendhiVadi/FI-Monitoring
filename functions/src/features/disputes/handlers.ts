import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { appCheckOption } from "../../platform/appCheck";
import { reportsPerIpDay } from "../../platform/limits";
import { DISPUTE_OTP_SECRET } from "../../platform/secrets";
import { normalizePhone } from "../otp/service";
import { validateDocumentIds } from "../documents/rules";
import { limitValue, otpRequired } from "./params";
import { submitDisputeTransaction, validateDisputeInput } from "./service";

// Unauthenticated, so the instance count is the cost ceiling under a flood.
export const submitDispute = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 10, timeoutSeconds: 30,
  secrets: [DISPUTE_OTP_SECRET] }, async (request) => {
  let input, documentIds, phone = "";
  try {
    input = validateDisputeInput(request.data);
    documentIds = validateDocumentIds(request.data?.documentIds);
    if (request.data?.phone) phone = normalizePhone(request.data.phone);
  } catch (err) {
    throw new HttpsError("invalid-argument", err instanceof Error ? err.message : "Invalid dispute details.");
  }
  const address = request.rawRequest.ip;
  if (!address) throw new HttpsError("unavailable", "Please try again later.");
  // Only a well-formed token can match a grant; anything else is dropped
  // here instead of being hashed, at any length, into document ids.
  const rawToken = request.data?.verificationToken;
  const token = typeof rawToken === "string" && /^[a-f0-9]{64}$/.test(rawToken) ? rawToken : "";
  try {
    return await submitDisputeTransaction(db, {
      input, phone, address, requireOtp: otpRequired.value(), secret: DISPUTE_OTP_SECRET.value(), token,
      submissionId: typeof request.data?.submissionId === "string" ? request.data.submissionId : "",
      consent: request.data?.consent === true, consentVersion: request.data?.consentVersion,
      whatsappUpdates: request.data?.whatsappUpdates === true, documentIds, addressLimit: limitValue(reportsPerIpDay),
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    // Storage failures (contention, timeouts) are retry-safe via the receipt.
    // Kept as "internal": the web client reads "unavailable" as a network
    // fault on the reporter's side. The log carries no Firestore internals.
    console.error("Dispute submission storage failed", { code: (err as { code?: unknown })?.code ?? "unknown" });
    throw new HttpsError("internal", "Could not save the report right now. Your draft is kept; please try again shortly.");
  }
});
