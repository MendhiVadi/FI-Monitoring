import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { DISPUTE_OTP_SECRET } from "../../platform/secrets";
import { normalizePhone } from "../otp/service";
import { otpRequired } from "../disputes/params";
import { requireOfficer } from "../tickets/authorization";
import { DocumentInputError, sniffDocumentType, validateFileRequest, validateReviewRequest, validateUploadRequest, validDocumentId,
  validSubmissionId } from "./rules";
import { readCaseDocumentFile, removeCaseDocument, reviewDocument, uploadCaseDocument, type ReporterProof, type ScreeningEngine } from "./service";
import { firebaseStore } from "./storage";

// Loaded on first upload only (see ScreeningEngine); the certificate is read once per instance.
let uidaiCertPem: string | null | undefined;
// Every report needs an Aadhaar upload, so an engine that fails to load (a
// missing native binary, say) must not stop reporting: files are still
// type-checked and stored, and staff see "screening could not run".
const unavailableEngine: ScreeningEngine = { ENGINE_VERSION: "unavailable", sniffContentType: sniffDocumentType,
  screenDocument: () => Promise.reject(Object.assign(new Error("Screening engine unavailable"), { name: "EngineUnavailable" })) };
async function screeningDeps() {
  try {
    const engine = await import("./screening/index");
    if (uidaiCertPem === undefined) uidaiCertPem = engine.loadUidaiCertificate();
    return { store: firebaseStore, engine, uidaiCertPem };
  } catch (err) {
    console.error("Document screening engine failed to load", { error: err instanceof Error ? err.name : "unknown" });
    return { store: firebaseStore, engine: unavailableEngine, uidaiCertPem: null };
  }
}

function invalid(err: unknown, fallback: string): never {
  throw new HttpsError("invalid-argument", err instanceof DocumentInputError || err instanceof Error ? err.message : fallback);
}
function reporterProof(data: Record<string, unknown> | undefined, address: string | undefined): ReporterProof {
  if (!address) throw new HttpsError("unavailable", "Please try again later.");
  let phone = "";
  try { if (data?.phone) phone = normalizePhone(data.phone); } catch (err) { invalid(err, "Invalid phone number."); }
  // Only a well-formed token can match a grant; anything else is dropped unhashed.
  const raw = data?.verificationToken;
  const token = typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw) ? raw : "";
  return { phone, token, address, requireOtp: otpRequired.value(), secret: DISPUTE_OTP_SECRET.value() };
}
// Firestore and Storage internals never reach an unauthenticated caller.
function storageFailure(err: unknown, message: string): never {
  if (err instanceof HttpsError) throw err;
  console.error(message, { code: (err as { code?: unknown })?.code ?? "unknown" });
  throw new HttpsError("internal", "Could not save the document right now. Please try again shortly.");
}

// Screening decodes images and PDFs in memory, hence the larger instance; the
// low instance cap is the cost ceiling for an unauthenticated endpoint. One
// request per instance: the default 80 would split 2 GiB and one CPU between
// that many OCR workers, and a burst would fail every upload at once.
export const uploadDisputeDocument = onCall({ invoker: "public", maxInstances: 5, concurrency: 1, memory: "2GiB", timeoutSeconds: 120,
  secrets: [DISPUTE_OTP_SECRET] }, async (request) => {
  let upload;
  try { upload = validateUploadRequest(request.data); } catch (err) { invalid(err, "Invalid document."); }
  const proof = reporterProof(request.data, request.rawRequest.ip);
  try {
    return await uploadCaseDocument(db, await screeningDeps(), upload, proof);
  } catch (err) {
    storageFailure(err, "Document upload failed");
  }
});

export const removeDisputeDocument = onCall({ invoker: "public", maxInstances: 10, timeoutSeconds: 30,
  secrets: [DISPUTE_OTP_SECRET] }, async (request) => {
  const submissionId = request.data?.submissionId, documentId = request.data?.documentId;
  if (!validSubmissionId(submissionId) || !validDocumentId(documentId)) throw new HttpsError("invalid-argument", "A valid document reference is required.");
  const proof = reporterProof(request.data, request.rawRequest.ip);
  try {
    return await removeCaseDocument(db, firebaseStore, { submissionId, documentId }, proof);
  } catch (err) {
    storageFailure(err, "Document removal failed");
  }
});

export const getCaseDocumentFile = onCall({ invoker: "public", maxInstances: 10, memory: "512MiB", timeoutSeconds: 60 }, async (request) => {
  await requireOfficer(request.auth);
  let target;
  try { target = validateFileRequest(request.data); } catch (err) { invalid(err, "Invalid document reference."); }
  try {
    return await readCaseDocumentFile(db, firebaseStore, target.documentId, target.variant);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("Document file read failed", { code: (err as { code?: unknown })?.code ?? "unknown" });
    throw new HttpsError("unavailable", "The file could not be loaded. Try again shortly.");
  }
});

export const reviewCaseDocument = onCall({ invoker: "public", maxInstances: 10 }, async (request) => {
  const officer = await requireOfficer(request.auth);
  let input;
  try { input = validateReviewRequest(request.data); } catch (err) { invalid(err, "Invalid review."); }
  return reviewDocument(db, officer, input);
});
