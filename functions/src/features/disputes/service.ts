import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import contract from "../../platform/contracts/dispute.json";
import { addressBucket, hashId } from "../otp/identity";
import { verificationKey } from "../otp/service";
import { caseTypeFor, documentSummary, kindLabel, MAX_FILES, missingRequiredKinds, ownsDocument } from "../documents/rules";

export interface DisputeInput {
  reporterName: string; reporterType: string; otherPartyName: string; otherPartyType: string;
  disputeType: string; state: string; district: string; village: string; description: string;
  location: { latitude: number; longitude: number };
  immediateRisk: "yes" | "no" | "unknown";
  evidenceReferences: string[];
}
export const DAY_MS = 86_400_000;
const districts: Record<string, string[]> = contract.districts;

function field(record: Record<string, unknown>, key: string, min: number, max: number): string {
  const value = typeof record[key] === "string" ? (record[key] as string).trim() : "";
  if (value.length < min || value.length > max) throw new Error(key + " must contain " + min + "–" + max + " characters.");
  return value;
}
export function validateDisputeInput(data: unknown): DisputeInput {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Missing dispute details.");
  const r = data as Record<string, unknown>;
  const reporterName = field(r, "reporterName", 2, contract.nameMax);
  const otherPartyName = field(r, "otherPartyName", 2, contract.nameMax);
  const reporterType = field(r, "reporterType", 1, 80);
  const otherPartyType = field(r, "otherPartyType", 1, 80);
  const disputeType = field(r, "disputeType", 1, 80);
  const state = field(r, "state", 1, 80), district = field(r, "district", 1, 80);
  if (!contract.reporterTypes.includes(reporterType) || !contract.partyTypes.includes(otherPartyType) ||
      !contract.disputeTypes.includes(disputeType)) throw new Error("Choose a supported reporter, party and dispute type.");
  if (!Object.prototype.hasOwnProperty.call(districts, state) || !districts[state].includes(district)) throw new Error("Choose a district belonging to the selected state.");
  const description = field(r, "description", contract.descriptionMin, contract.descriptionMax);
  const village = field(r, "village", 0, contract.nameMax);
  const location = r.location as DisputeInput["location"] | undefined;
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      location.latitude < 6 || location.latitude > 38 || location.longitude < 68 || location.longitude > 98) {
    throw new Error("Choose valid latitude and longitude for land in India.");
  }
  if (r.locationConfirmed !== true) throw new Error("Confirm the disputed location on the map.");
  const immediateRisk = r.immediateRisk ?? "unknown";
  if (immediateRisk !== "yes" && immediateRisk !== "no" && immediateRisk !== "unknown") throw new Error("Choose a supported immediate risk answer.");
  const references = r.evidenceReferences ?? [];
  if (!Array.isArray(references) || references.length > 10 || references.some(value => typeof value !== "string" || !value.trim() || value.trim().length > 120)) throw new Error("Provide up to 10 evidence references of 120 characters each.");
  return { reporterName, reporterType, otherPartyName, otherPartyType, disputeType, state, district, village, description,
    immediateRisk, evidenceReferences: references.map((value: string) => value.trim()),
    location: { latitude: location.latitude, longitude: location.longitude } };
}

export async function submitDisputeTransaction(db: admin.firestore.Firestore, options: {
  input: DisputeInput; phone: string; token: string; submissionId: string; address: string;
  requireOtp: boolean; consent: boolean; consentVersion: string; whatsappUpdates: boolean; secret: string; documentIds?: string[];
}): Promise<{ ticketId: string; replayed: boolean }> {
  const { input, phone, token, submissionId, address, requireOtp, consent, consentVersion, whatsappUpdates, secret } = options;
  const documentIds = [...new Set(options.documentIds ?? [])];
  if (documentIds.length > MAX_FILES) throw new HttpsError("invalid-argument", "Attach up to " + MAX_FILES + " uploaded documents.");
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(submissionId)) throw new HttpsError("invalid-argument", "A submission reference is required.");
  if (!consent || consentVersion !== contract.version) throw new HttpsError("invalid-argument", "Accept the current privacy notice before submitting.");
  if (requireOtp && (!phone || !/^[a-f0-9]{64}$/.test(token))) throw new HttpsError("unauthenticated", "Verify your phone before submitting.");
  // A receipt is addressed by the secret proof + client request ID, not by a guessable phone alone.
  const receipt = db.collection("submissionReceipts").doc(hashId("submission:" + (token || address) + ":" + submissionId));
  const grant = token ? db.collection("disputeVerifications").doc(verificationKey(token, secret)) : null;
  const addressLimit = db.collection("reporterLimits").doc("ip-" + hashId(addressBucket(address)));
  const ticket = db.collection("tickets").doc();
  const documentRefs = documentIds.map(id => db.collection("caseDocuments").doc(id));
  return db.runTransaction(async (tx) => {
    // One round trip for every document whose id is already known (a contended
    // transaction repeats all of its reads); only the reporter quota id
    // depends on the verification outcome.
    const known = grant ? [receipt, addressLimit, grant] : [receipt, addressLimit];
    const snapshots = await tx.getAll(...known, ...documentRefs);
    const [receiptSnap, addressSnap] = snapshots, grantSnap = grant ? snapshots[2] : undefined;
    if (receiptSnap.exists && receiptSnap.data()!.expiresAt > Date.now()) {
      return { ticketId: receiptSnap.data()!.ticketId as string, replayed: true };
    }
    const proof = grantSnap?.data();
    const verified = Boolean(proof && !proof.used && proof.expiresAt > Date.now() && proof.phoneHash === hashId(phone));
    if (requireOtp && !verified) throw new HttpsError("unauthenticated", "Phone verification expired. Verify again; your draft is kept.");
    const uid = verified ? "phone-" + hashId(phone) : "guest-" + hashId(address);
    const limit = db.collection("reporterLimits").doc(uid);
    const previous = (await tx.get(limit)).data();
    const previousAddress = addressSnap.data();
    const now = Date.now();
    const count = previous && previous.windowStartedAt > now - DAY_MS ? Number(previous.count) || 0 : 0;
    const addressCount = previousAddress && previousAddress.windowStartedAt > now - DAY_MS ? Number(previousAddress.count) || 0 : 0;
    if (count >= 5 || addressCount >= 5) throw new HttpsError("resource-exhausted", "Five reports were submitted in the last daily window from this number or connection. Try again later.");
    // Uploads are bound to the verified phone, or for guests to the address
    // bucket, so another caller's submissionId cannot claim them.
    const caller = { phoneHash: verified ? hashId(phone) : null, addressHash: hashId(addressBucket(address)) };
    const documents = snapshots.slice(known.length).map(snapshot => snapshot.data());
    if (documents.some(doc => !doc || doc.submissionId !== submissionId || doc.status !== "pending" || !(doc.expiresAt > now) ||
        !(verified ? doc.phoneHash === caller.phoneHash : ownsDocument(doc, caller)))) {
      throw new HttpsError("failed-precondition", "One or more uploaded documents expired or are no longer available. Upload them again; your draft is kept.");
    }
    // An upload still being screened has no risk yet (the ticket's flagged
    // count would miss it) and may not have its file stored.
    if (documents.some(doc => doc!.screening?.state === "pending")) {
      throw new HttpsError("failed-precondition", "One or more documents are still being checked. Wait a moment, then submit again.");
    }
    const caseType = caseTypeFor(input.otherPartyType);
    const missing = missingRequiredKinds(caseType, documents.map(doc => doc!.kind));
    if (missing.length) throw new HttpsError("failed-precondition", "Upload the required documents: " + missing.map(kindLabel).join(", ") + ".");
    const stamp = admin.firestore.FieldValue.serverTimestamp();
    tx.create(ticket, {
      waFrom: verified ? phone : "", notificationPhone: verified ? phone : "", reporterUid: uid,
      phoneVerified: verified, whatsappUpdates: verified && whatsappUpdates,
      consent: { version: consentVersion, acceptedAt: stamp, whatsappUpdates: verified && whatsappUpdates },
      subject: (input.disputeType + " — " + input.reporterName + " vs " + input.otherPartyName).slice(0, 160),
      messages: [], status: "open", source: "web-dispute-form", dispute: input,
      revision: 0, noteCount: 0, createdAt: stamp, updatedAt: stamp,
      documents: documentSummary(caseType, documents.map(doc => ({ kind: doc!.kind, risk: doc!.screening?.risk }))),
    });
    for (const ref of documentRefs) tx.update(ref, { status: "attached", ticketId: ticket.id, expiresAt: null });
    if (verified && grant) tx.update(grant, { used: true, ticketId: ticket.id });
    tx.set(limit, { count: count + 1, windowStartedAt: count === 0 ? now : previous!.windowStartedAt });
    tx.set(addressLimit, { count: addressCount + 1, windowStartedAt: addressCount === 0 ? now : previousAddress!.windowStartedAt });
    tx.set(receipt, { ticketId: ticket.id, expiresAt: now + DAY_MS });
    return { ticketId: ticket.id, replayed: false };
  });
}
