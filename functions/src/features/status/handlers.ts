import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { appCheckOption } from "../../platform/appCheck";
import { statusLookupsPerIpHour } from "../../platform/limits";
import { DISPUTE_OTP_SECRET } from "../../platform/secrets";
import { limitValue } from "../disputes/params";
import { screeningDeps } from "../documents/deps";
import { replaceCaseDocument } from "../documents/service";
import { validateReplacementRequest, validCaseReference } from "./rules";
import { lookupCaseStatus } from "./service";

// Firestore and Storage internals never reach an unauthenticated caller.
function failure(err: unknown, log: string, message: string, code: "internal" | "unavailable"): never {
  if (err instanceof HttpsError) throw err;
  console.error(log, { code: (err as { code?: unknown })?.code ?? "unknown" });
  throw new HttpsError(code, message);
}

// Public /track lookup: status, dates and open document requests only.
export const getCaseStatus = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 5, timeoutSeconds: 30,
  secrets: [DISPUTE_OTP_SECRET] }, async (request) => {
  const raw = request.data?.reference;
  const reference = typeof raw === "string" ? raw.trim() : "";
  if (!validCaseReference(reference)) throw new HttpsError("invalid-argument", "Enter the 20-character case reference from your confirmation.");
  const address = request.rawRequest.ip;
  if (!address) throw new HttpsError("unavailable", "Please try again later.");
  try {
    return await lookupCaseStatus(db, reference, address, limitValue(statusLookupsPerIpHour));
  } catch (err) {
    failure(err, "Case status lookup failed", "Case status is unavailable right now. Try again shortly.", "unavailable");
  }
});

// Same instance shape, quota and screening as uploadDisputeDocument (see there).
export const uploadReplacementDocument = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 5, concurrency: 1, memory: "2GiB",
  timeoutSeconds: 120, secrets: [DISPUTE_OTP_SECRET] }, async (request) => {
  let parsed;
  try { parsed = validateReplacementRequest(request.data); } catch (err) {
    throw new HttpsError("invalid-argument", err instanceof Error ? err.message : "Invalid document.");
  }
  const address = request.rawRequest.ip;
  if (!address) throw new HttpsError("unavailable", "Please try again later.");
  try {
    return await replaceCaseDocument(db, await screeningDeps(), parsed.upload,
      { phone: parsed.phone, token: parsed.token, address, secret: DISPUTE_OTP_SECRET.value() });
  } catch (err) {
    failure(err, "Replacement upload failed", "Could not save the document right now. Please try again shortly.", "internal");
  }
});
