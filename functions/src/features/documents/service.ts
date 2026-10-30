import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { addressBucket, hashId } from "../otp/identity";
import { verificationKey } from "../otp/service";
import { computeOverdue, firstActionPatch, overdueTransition } from "../cases/targets";
import { findDuplicateDocuments } from "./duplicates";
import { DERIVED_NAMES, documentPrefix, VARIANT_TYPES, type DocumentStore } from "./storage";
import { caseTypeFor, chargeUploadQuota, DEFAULT_UPLOAD_LIMITS, documentSummary, kindDefinition, MAX_FILES, ownsDocument, PENDING_TTL_MS,
  REPLACEMENT_TTL_MS, RETENTION_MS, sideOf, type Caller, type FileVariant, type ReviewDecision, type UploadLimits,
  type UploadRequest } from "./rules";
import type { CompanionFile, ScreeningDeps, ScreeningInput, ScreeningOutput } from "./screening/index";
import { maskIdNumber, normaliseIdNumber } from "./screening/idNumbers";

// The engine (OCR, PDF and face models) is injected rather than imported, so
// only the upload callables ever load it; every other function shares this
// codebase and would otherwise pay for it on each cold start.
export interface ScreeningEngine {
  ENGINE_VERSION: string;
  sniffContentType(bytes: Buffer): string | null;
  screenDocument(input: ScreeningInput, deps: ScreeningDeps): Promise<ScreeningOutput>;
}
// `limits` carries the deployed per-connection upload params; tests and older
// callers fall back to their defaults.
export interface UploadDeps { store: DocumentStore; engine: ScreeningEngine; uidaiCertPem: string | null; limits?: UploadLimits }
export interface ReporterProof { phone: string; token: string; address: string; requireOtp: boolean; secret: string }
// Replacements always need a verified phone, whatever DISPUTE_OTP_REQUIRED says.
export interface ReplacementProof { phone: string; token: string; address: string; secret: string }
export interface ReplacementUpload {
  reference: string; requestId: string; fileName: string; contentType: string; bytes: Buffer; idNumber: string | null;
}
// What requireOfficer returns; only uid and email are guaranteed on older allow-list entries.
export interface StaffIdentity { uid: string; email: string; displayName?: unknown; role?: unknown; access?: unknown }
// Where the screening engine may look for a related document (for example the
// Aadhaar card a selfie or a tilted card photo is compared with).
export type CompanionScope = { submissionId: string; caller: Caller } | { ticketId: string };

const TOKEN = /^[a-f0-9]{64}$/;
const SCREENING_LIMIT_MS = 80_000;
const COMPANION_CANDIDATES = 30;
const CASE_DOCUMENTS_SCAN = 200;
const collection = (db: admin.firestore.Firestore) => db.collection("caseDocuments");
const requests = (db: admin.firestore.Firestore) => db.collection("documentRequests");
const tombstone = (db: admin.firestore.Firestore, id: string) => db.collection("documentPurges").doc(id);
const millis = (value: unknown): number => {
  if (typeof value === "number") return value;
  const time = value as { toMillis?: () => number; seconds?: unknown } | null | undefined;
  if (typeof time?.toMillis === "function") return time.toMillis();
  return typeof time?.seconds === "number" ? time.seconds * 1000 : 0;
};

// Staff identity stored on every new staff write (spec: officerUid, officerEmail,
// officerName = displayName or null, officerRole).
export function officerFields(officer: StaffIdentity) {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
  return { officerUid: officer.uid, officerEmail: officer.email || null, officerName: text(officer.displayName),
    officerRole: text(officer.role) ?? text(officer.access) };
}

function proofRefs(db: admin.firestore.Firestore, proof: ReporterProof) {
  if (proof.requireOtp && (!proof.phone || !TOKEN.test(proof.token))) {
    throw new HttpsError("unauthenticated", "Verify your phone before adding documents.");
  }
  return { addressHash: hashId(addressBucket(proof.address)),
    grant: proof.phone && TOKEN.test(proof.token) ? db.collection("disputeVerifications").doc(verificationKey(proof.token, proof.secret)) : null };
}
// Same test as submitDispute, but read-only: uploads must not spend the grant
// that the final submission still needs.
const liveGrant = (grant: admin.firestore.DocumentData | undefined, phone: string, now: number) =>
  Boolean(grant && !grant.used && grant.expiresAt > now && grant.phoneHash === hashId(phone));
function callerFrom(grant: admin.firestore.DocumentData | undefined, proof: ReporterProof, addressHash: string, now: number): Caller {
  const phoneHash = liveGrant(grant, proof.phone, now) ? hashId(proof.phone) : null;
  if (proof.requireOtp && !phoneHash) throw new HttpsError("unauthenticated", "Phone verification expired. Verify again; your draft is kept.");
  return { phoneHash, addressHash };
}

// Removing the record and queueing its objects is one transaction; the
// tombstone keeps a failed Storage delete visible to the daily purge.
async function eraseObjects(db: admin.firestore.Firestore, store: DocumentStore, documentId: string) {
  await store.removeAll(documentId);
  await tombstone(db, documentId).delete();
}
async function discardPending(db: admin.firestore.Firestore, store: DocumentStore, ref: admin.firestore.DocumentReference) {
  const removed = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data()!.status !== "pending") return false;
    tx.delete(ref); tx.set(tombstone(db, ref.id), { queuedAt: Date.now() });
    return true;
  });
  if (removed) await eraseObjects(db, store, ref.id).catch(() => undefined);
}

function screeningRecord(output: ScreeningOutput, engineVersion: string) {
  const { qr, ocr } = output.extracted ?? {};
  const list = (values: unknown) => Array.isArray(values) ? values.filter(v => typeof v === "string").slice(0, 10) : [];
  return {
    state: "done", risk: output.risk, score: output.score, summary: String(output.summary ?? "").slice(0, 300),
    checks: (output.checks ?? []).slice(0, 40).map(check => ({ id: String(check.id).slice(0, 60), label: String(check.label).slice(0, 120),
      result: check.result, detail: String(check.detail ?? "").slice(0, 600) })),
    extracted: {
      ...(qr ? { qr: { signatureValid: qr.signatureValid ?? null, name: qr.name ?? null, dob: qr.dob ?? null, gender: qr.gender ?? null,
        last4: qr.last4 ?? null, district: qr.district ?? null, state: qr.state ?? null, pincode: qr.pincode ?? null, hasPhoto: qr.hasPhoto === true } } : {}),
      ...(ocr ? { ocr: { text: String(ocr.text ?? "").slice(0, 4000), aadhaarNumbers: list(ocr.aadhaarNumbers),
        panNumbers: list(ocr.panNumbers), dates: list(ocr.dates) } } : {}),
    },
    engineVersion, completedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}
const failedScreening = (engineVersion: string) => ({ state: "error", risk: null, score: null,
  summary: "Automatic screening could not run; review this file manually.", checks: [], extracted: {}, engineVersion,
  completedAt: admin.firestore.FieldValue.serverTimestamp() });

// ScreeningDeps.companion: the latest non-superseded document of `kind` in the
// same submission (owned by the same caller) or, for replacements, attached to
// the same case. Read failures mean "no companion": the check is then skipped.
export async function findCompanion(db: admin.firestore.Firestore, store: DocumentStore, scope: CompanionScope, selfId: string,
  kind: string, now = Date.now()): Promise<CompanionFile | null> {
  if (typeof kind !== "string" || !kindDefinition(kind)) return null;
  const byKind = collection(db).where("kind", "==", kind);
  const query = "ticketId" in scope ? byKind.where("ticketId", "==", scope.ticketId) : byKind.where("submissionId", "==", scope.submissionId);
  const snapshot = await query.select("status", "ticketId", "phoneHash", "addressHash", "expiresAt", "supersededBy", "replacementFor",
    "uploadedAt", "contentType", "storage").limit(COMPANION_CANDIDATES).get();
  const usable = snapshot.docs.filter(doc => {
    const data = doc.data();
    if (doc.id === selfId || data.supersededBy) return false;
    return "ticketId" in scope ? data.status === "attached" && data.ticketId === scope.ticketId
      : data.status === "pending" && !data.replacementFor && Number(data.expiresAt) > now && ownsDocument(data, scope.caller);
  });
  const latest = usable.sort((a, b) => millis(b.get("uploadedAt")) - millis(a.get("uploadedAt")))[0];
  const path = latest?.get("storage")?.original;
  if (!latest || typeof path !== "string" || !path.startsWith(documentPrefix(latest.id))) return null;
  return { bytes: await store.read(path), contentType: String(latest.get("contentType")) };
}
function companionLoader(db: admin.firestore.Firestore, store: DocumentStore, scope: CompanionScope, selfId: string) {
  // Several checks may ask for the same kind (hologram and selfie both use the Aadhaar card).
  const loaded = new Map<string, Promise<CompanionFile | null>>();
  return (kind: string): Promise<CompanionFile | null> => {
    if (!loaded.has(kind)) loaded.set(kind, findCompanion(db, store, scope, selfId, kind).catch(() => null));
    return loaded.get(kind)!;
  };
}

interface ScreeningJob {
  bytes: Buffer; contentType: string; kind: string; idNumber: string | null; reporterName: string | null;
  submissionId: string; companion: CompanionScope;
}
// Stores the original, screens it and fills in the record created by the
// caller. Shared by first uploads and replacements.
async function storeAndScreen(db: admin.firestore.Firestore, deps: UploadDeps, ref: admin.firestore.DocumentReference, job: ScreeningJob) {
  const { engine, store } = deps, original = documentPrefix(ref.id) + "original";
  try {
    await store.save(original, job.bytes, job.contentType);
  } catch (err) {
    await discardPending(db, store, ref).catch(() => undefined);
    console.error("Document upload storage failed", { code: (err as { code?: unknown })?.code ?? "unknown" });
    throw new HttpsError("unavailable", "Could not store the file right now. Please try again shortly.");
  }
  const screeningDeps: ScreeningDeps = { findDuplicates: (q: Parameters<ScreeningDeps["findDuplicates"]>[0]) => findDuplicateDocuments(db, job.submissionId, q),
    uidaiCertPem: deps.uidaiCertPem, companion: companionLoader(db, store, job.companion, ref.id) };
  let output: ScreeningOutput | null = null, timer: NodeJS.Timeout | undefined;
  try {
    // The engine budgets its own steps; this outer bound still leaves time to
    // store the record if a step stalls, before the callable's own timeout.
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Screening timed out"), { name: "ScreeningTimeout" })), SCREENING_LIMIT_MS);
    });
    output = await Promise.race([engine.screenDocument({ bytes: job.bytes, contentType: job.contentType, kind: job.kind, idNumber: job.idNumber,
      reporterName: job.reporterName }, screeningDeps), stalled]);
  } catch (err) {
    // Screening only flags for staff: a crash must not cost the reporter the upload.
    console.error("Document screening failed", { kind: job.kind, error: err instanceof Error ? err.name : "unknown" });
  } finally {
    clearTimeout(timer);
  }
  const storage: Record<string, string> = { original };
  for (const file of output?.derived ?? []) {
    if (!Object.prototype.hasOwnProperty.call(DERIVED_NAMES, file.key)) continue;
    const key = file.key as keyof typeof DERIVED_NAMES, path = documentPrefix(ref.id) + DERIVED_NAMES[key];
    try { await store.save(path, file.bytes, VARIANT_TYPES[key]); storage[key] = path; }
    catch { console.warn("Derived document file was not stored", { key }); }
  }
  const screening = output ? screeningRecord(output, engine.ENGINE_VERSION) : failedScreening(engine.ENGINE_VERSION);
  try {
    await ref.update({ storage, screening, ...(output ? {
      sha256: output.sha256, dhash: output.dhash ?? null, dhashBands: output.dhashBands ?? [], idNumberHash: output.idNumberHash ?? null,
      reporterNameNorm: output.reporterNameNorm ?? null, width: output.width ?? null, height: output.height ?? null, pageCount: output.pageCount ?? null,
    } : {}) });
  } catch (err) {
    // Removed while it was being screened: drop the late objects too, queued
    // first so a failed delete is still retried by the daily purge.
    if ((err as { code?: unknown })?.code === 5) {
      await tombstone(db, ref.id).set({ queuedAt: Date.now() }).catch(() => undefined);
      await eraseObjects(db, store, ref.id).catch(() => undefined);
      throw new HttpsError("not-found", "This upload was removed.");
    }
    throw err;
  }
  const userMessages = (output?.userMessages ?? []).filter(m => typeof m === "string").slice(0, 5).map(m => m.slice(0, 300));
  // No risk level for the reporter: a per-upload verdict would let a forger
  // keep editing a document until it reads "low". Staff see it in the portal.
  return { state: screening.state, userMessages };
}

// The record fields both upload paths start with; screening fills in the rest.
function pendingRecord(base: { submissionId: string; phoneHash: string | null; addressHash: string; kind: string; side: string; fileName: string;
  contentType: string; bytes: Buffer; idType: string | undefined; idNumber: string | null; engineVersion: string; documentId: string; now: number }) {
  return {
    submissionId: base.submissionId, phoneHash: base.phoneHash, addressHash: base.addressHash, ticketId: null, status: "pending",
    kind: base.kind, side: base.side, fileName: base.fileName, contentType: base.contentType, sizeBytes: base.bytes.length,
    sha256: createHash("sha256").update(base.bytes).digest("hex"), dhash: null, dhashBands: [], idNumberHash: null, reporterNameNorm: null,
    width: null, height: null, pageCount: null,
    idNumberFull: base.idNumber, idNumberMasked: base.idType && base.idNumber ? maskIdNumber(base.idType, base.idNumber) : null,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp(), expiresAt: base.now + PENDING_TTL_MS, purgeAt: null,
    storage: { original: documentPrefix(base.documentId) + "original" }, screening: { state: "pending", risk: null, score: null, summary: "", checks: [],
      extracted: {}, engineVersion: base.engineVersion, completedAt: null },
    review: null,
  };
}

export async function uploadCaseDocument(db: admin.firestore.Firestore, deps: UploadDeps, request: UploadRequest, proof: ReporterProof) {
  const { engine } = deps;
  if (engine.sniffContentType(request.bytes) !== request.contentType) {
    throw new HttpsError("invalid-argument", "The file's contents do not match its type. Choose the original file again.");
  }
  const { addressHash, grant } = proofRefs(db, proof);
  const idType = kindDefinition(request.kind)?.idNumber;
  const idNumber = idType && request.idNumber ? normaliseIdNumber(idType, request.idNumber) || null : null;
  const limitRef = db.collection("documentUploadLimits").doc(addressHash);
  const ref = collection(db).doc();
  const pending = collection(db).where("submissionId", "==", request.submissionId).where("status", "==", "pending")
    .select("expiresAt").limit(MAX_FILES * 2);
  // The record is created before the slow work so in-flight uploads count
  // toward the per-report limit; screening fills it in afterwards.
  const caller = await db.runTransaction(async tx => {
    const [limitSnap, grantSnap] = await tx.getAll(...(grant ? [limitRef, grant] : [limitRef]));
    const now = Date.now();
    const caller = callerFrom(grantSnap?.data(), proof, addressHash, now);
    const live = (await tx.get(pending)).docs.filter(doc => Number(doc.get("expiresAt")) > now).length;
    if (live >= MAX_FILES) throw new HttpsError("resource-exhausted", "A report can hold " + MAX_FILES + " documents. Remove one before adding another.");
    const quota = chargeUploadQuota(limitSnap.data(), now, request.bytes.length, deps.limits ?? DEFAULT_UPLOAD_LIMITS);
    if (!quota) throw new HttpsError("resource-exhausted", "Too many documents were uploaded from this connection today. Try again later.");
    tx.set(limitRef, quota);
    tx.create(ref, pendingRecord({ submissionId: request.submissionId, phoneHash: caller.phoneHash, addressHash, kind: request.kind, side: request.side,
      fileName: request.fileName, contentType: request.contentType, bytes: request.bytes, idType, idNumber, engineVersion: engine.ENGINE_VERSION,
      documentId: ref.id, now }));
    return caller;
  });
  const screening = await storeAndScreen(db, deps, ref, { bytes: request.bytes, contentType: request.contentType, kind: request.kind, idNumber,
    reporterName: request.reporterName, submissionId: request.submissionId, companion: { submissionId: request.submissionId, caller } });
  return { documentId: ref.id, screening };
}

export async function removeCaseDocument(db: admin.firestore.Firestore, store: DocumentStore,
  target: { submissionId: string; documentId: string }, proof: ReporterProof) {
  const { addressHash, grant } = proofRefs(db, proof);
  const ref = collection(db).doc(target.documentId);
  const removed = await db.runTransaction(async tx => {
    const [snapshot, grantSnap] = await tx.getAll(...(grant ? [ref, grant] : [ref]));
    const caller = callerFrom(grantSnap?.data(), proof, addressHash, Date.now());
    // A retried removal finds nothing left to do.
    if (!snapshot.exists) return false;
    const data = snapshot.data()!;
    if (data.submissionId !== target.submissionId || !ownsDocument(data, caller)) throw new HttpsError("not-found", "Document not found.");
    // A replacement in flight belongs to a submitted case already.
    if (data.status !== "pending" || data.replacementFor) throw new HttpsError("failed-precondition", "Documents of a submitted report cannot be removed.");
    tx.delete(ref); tx.set(tombstone(db, ref.id), { queuedAt: Date.now() });
    return true;
  });
  if (removed) await eraseObjects(db, store, ref.id).catch(() => console.warn("Document objects left for the daily purge"));
  return { removed: true };
}

export async function readCaseDocumentFile(db: admin.firestore.Firestore, store: DocumentStore, documentId: string, variant: FileVariant) {
  const data = (await collection(db).doc(documentId).get()).data();
  // Pending uploads belong to no case yet, so staff have no reason to open them.
  if (!data || data.status !== "attached") throw new HttpsError("not-found", "Document not found.");
  const path = data.storage?.[variant];
  if (typeof path !== "string" || !path.startsWith(documentPrefix(documentId))) {
    throw new HttpsError("not-found", "This view is not available for this document.");
  }
  const bytes = await store.read(path);
  return { contentType: variant === "original" ? String(data.contentType) : VARIANT_TYPES[variant], dataBase64: bytes.toString("base64") };
}

export async function reviewDocument(db: admin.firestore.Firestore, officer: StaffIdentity,
  input: { documentId: string; decision: ReviewDecision; reason: string; requestId: string }) {
  const ref = collection(db).doc(input.documentId);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data) throw new HttpsError("not-found", "Document not found.");
    if (data.status !== "attached" || typeof data.ticketId !== "string") throw new HttpsError("failed-precondition", "Only documents of a submitted case can be reviewed.");
    const ticketRef = db.collection("tickets").doc(data.ticketId), eventRef = ticketRef.collection("events").doc(input.requestId);
    const requestRef = requests(db).doc(input.requestId);
    const [ticket, event, existingRequest] = await tx.getAll(ticketRef, eventRef, requestRef);
    if (event.exists) {
      const previous = event.data()!;
      if (previous.actorUid !== officer.uid || previous.documentId !== input.documentId) throw new HttpsError("already-exists", "Change reference is already used.");
      return { review: wireReview(data.review) };
    }
    if (!ticket.exists) throw new HttpsError("not-found", "Ticket not found.");
    if (existingRequest.exists) throw new HttpsError("already-exists", "Change reference is already used.");
    const now = Date.now(), before = ticket.data()!;
    // One open request per document: asking again while the reporter still
    // has an unexpired request records the review but sends no second request.
    let createRequest = false, expiresAt: number | null = null;
    if (input.decision === "reupload_requested") {
      if (data.supersededBy) throw new HttpsError("failed-precondition", "A newer copy of this document was already uploaded. Review that copy instead.");
      const open = await tx.get(requests(db).where("documentId", "==", input.documentId).where("fulfilledAt", "==", null).limit(10));
      const live = open.docs.map(doc => Number(doc.get("expiresAt"))).filter(expiry => expiry > now);
      createRequest = live.length === 0;
      // The review carries the reporter's deadline (ms), so the dossier shows
      // the server's expiry: a new request's, else the one still open.
      expiresAt = createRequest ? now + REPLACEMENT_TTL_MS : Math.max(...live);
    }
    const at = admin.firestore.FieldValue.serverTimestamp(), revision = (Number(before.revision) || 0) + 1;
    const staff = officerFields(officer);
    const review = { decision: input.decision, reason: input.reason, by: officer.uid, byEmail: officer.email || null, ...staff,
      ...(expiresAt !== null ? { expiresAt } : {}) };
    tx.update(ref, { review: { ...review, at } });
    // actorUid and officerUid keep the existing case-history labels working.
    tx.create(eventRef, { type: "document_review", documentId: input.documentId, kind: data.kind, decision: input.decision,
      reason: input.reason, actorUid: officer.uid, ...staff, at, revision });
    // A document review counts as the first staff action for the service
    // targets; acknowledging an overdue case is recorded straight away, as for
    // status changes and notes.
    const first = firstActionPatch(before, now);
    const transition = overdueTransition(before.overdue, computeOverdue({ ...before, ...first }, now), now);
    if (transition) tx.create(ticketRef.collection("events").doc(), { type: "escalation", overdue: transition.overdue, ...staff, at });
    const ticketUpdate: Record<string, unknown> = { revision, updatedAt: at, lastUpdatedBy: officer.uid, ...first, ...(transition ?? {}) };
    if (createRequest) {
      tx.create(requestRef, { ticketId: data.ticketId, documentId: input.documentId, kind: data.kind, requestedAt: now,
        expiresAt, fulfilledAt: null, fulfilledDocumentId: null });
      ticketUpdate.openDocumentRequests = Math.max(0, Number(before.openDocumentRequests) || 0) + 1;
    }
    tx.update(ticketRef, ticketUpdate);
    return { review: { ...review, at: { seconds: Math.floor(now / 1000), nanoseconds: 0 } } };
  });
}
function wireReview(review: admin.firestore.DocumentData | null | undefined) {
  if (!review) return null;
  const at = review.at;
  return { ...review, at: at && typeof at.seconds === "number" ? { seconds: at.seconds, nanoseconds: at.nanoseconds || 0 } : null };
}

const NO_REQUEST = "No open document request matches this reference.";
// uploadReplacementDocument: answers a staff "request re-upload" for a case
// filed with a verified phone. The verification grant is checked, not spent.
export async function replaceCaseDocument(db: admin.firestore.Firestore, deps: UploadDeps, upload: ReplacementUpload, proof: ReplacementProof) {
  const { engine, store } = deps;
  if (!proof.phone || !TOKEN.test(proof.token)) throw new HttpsError("unauthenticated", "Verify your phone before uploading.");
  if (engine.sniffContentType(upload.bytes) !== upload.contentType) {
    throw new HttpsError("invalid-argument", "The file's contents do not match its type. Choose the original file again.");
  }
  const phoneHash = hashId(proof.phone), addressHash = hashId(addressBucket(proof.address));
  const ticketRef = db.collection("tickets").doc(upload.reference), requestRef = requests(db).doc(upload.requestId);
  const grantRef = db.collection("disputeVerifications").doc(verificationKey(proof.token, proof.secret));
  const limitRef = db.collection("documentUploadLimits").doc(addressHash);
  const ref = collection(db).doc();
  const opened = await db.runTransaction(async tx => {
    const [grantSnap, ticketSnap, requestSnap, limitSnap] = await tx.getAll(grantRef, ticketRef, requestRef, limitRef);
    const now = Date.now();
    if (!liveGrant(grantSnap.data(), proof.phone, now)) throw new HttpsError("unauthenticated", "Phone verification expired. Verify your phone again.");
    const ticket = ticketSnap.data(), open = requestSnap.data();
    if (!ticket || !open || open.ticketId !== upload.reference) throw new HttpsError("not-found", NO_REQUEST);
    // Guest reports have no verified phone, so nobody can prove they filed them.
    if (ticket.reporterUid !== "phone-" + phoneHash) {
      throw new HttpsError("permission-denied", "Verify the phone number this case was filed with to upload a new copy.");
    }
    if (open.fulfilledAt != null) throw new HttpsError("failed-precondition", "This document request has already been answered.");
    if (!(Number(open.expiresAt) > now)) throw new HttpsError("failed-precondition", "This document request has expired. Contact the office handling your case.");
    const previousRef = collection(db).doc(String(open.documentId));
    const previous = (await tx.get(previousRef)).data();
    if (!previous || previous.status !== "attached" || previous.ticketId !== upload.reference || previous.supersededBy) {
      throw new HttpsError("failed-precondition", "This document request is no longer open.");
    }
    const kind = String(open.kind), idType = kindDefinition(kind)?.idNumber;
    const quota = chargeUploadQuota(limitSnap.data(), now, upload.bytes.length, deps.limits ?? DEFAULT_UPLOAD_LIMITS);
    if (!quota) throw new HttpsError("resource-exhausted", "Too many documents were uploaded from this connection today. Try again later.");
    tx.set(limitRef, quota);
    const idNumber = idType && upload.idNumber ? normaliseIdNumber(idType, upload.idNumber) || null : null;
    // Pending until fulfilled, so a failed or abandoned replacement lapses
    // like any unsent upload. It keeps the case's submissionId: the
    // reporter's own earlier files are then not counted as duplicates.
    const submissionId = String(previous.submissionId ?? "");
    tx.create(ref, { ...pendingRecord({ submissionId, phoneHash, addressHash, kind, side: sideOf(kind), fileName: upload.fileName,
      contentType: upload.contentType, bytes: upload.bytes, idType, idNumber, engineVersion: engine.ENGINE_VERSION, documentId: ref.id, now }),
      replacementFor: upload.requestId });
    const name = ticket.dispute?.reporterName;
    return { kind, idNumber, submissionId, previousId: previousRef.id, reporterName: typeof name === "string" ? name : null };
  });
  const screening = await storeAndScreen(db, deps, ref, { bytes: upload.bytes, contentType: upload.contentType, kind: opened.kind,
    idNumber: opened.idNumber, reporterName: opened.reporterName, submissionId: opened.submissionId, companion: { ticketId: upload.reference } });
  const previousRef = collection(db).doc(opened.previousId);
  const caseDocuments = collection(db).where("ticketId", "==", upload.reference).select("kind", "status", "supersededBy", "screening.risk")
    .limit(CASE_DOCUMENTS_SCAN);
  const fulfilled = await db.runTransaction(async tx => {
    const [requestSnap, ticketSnap, recordSnap, previousSnap] = await tx.getAll(requestRef, ticketRef, ref, previousRef);
    const attached = await tx.get(caseDocuments);
    const record = recordSnap.data(), open = requestSnap.data(), ticket = ticketSnap.data();
    if (!record || record.status !== "pending") return false;
    // A parallel upload answered the request first.
    if (!open || open.fulfilledAt != null || !ticket || !previousSnap.exists || previousSnap.get("supersededBy")) return false;
    const now = Date.now(), at = admin.firestore.FieldValue.serverTimestamp();
    // A closed case keeps its retention clock: the new copy is purged with the rest.
    const purgeAt = typeof ticket.closedAt === "number" ? ticket.closedAt + RETENTION_MS : null;
    tx.update(ref, { status: "attached", ticketId: upload.reference, expiresAt: null, purgeAt, replaces: opened.previousId, supersededBy: null });
    tx.update(previousRef, { supersededBy: ref.id });
    tx.update(requestRef, { fulfilledAt: now, fulfilledDocumentId: ref.id });
    // The summary describes the case's current files, so a replaced copy no
    // longer counts (nor does its risk flag).
    const current = attached.docs.filter(doc => doc.id !== ref.id && doc.id !== opened.previousId && doc.get("status") === "attached" && !doc.get("supersededBy"))
      .map(doc => ({ kind: String(doc.get("kind")), risk: doc.get("screening.risk") }));
    current.push({ kind: opened.kind, risk: record.screening?.risk ?? null });
    const caseType = typeof ticket.documents?.caseType === "string" ? ticket.documents.caseType : caseTypeFor(String(ticket.dispute?.otherPartyType ?? ""));
    tx.update(ticketRef, { documents: documentSummary(caseType, current), updatedAt: at,
      openDocumentRequests: Math.max(0, (Number(ticket.openDocumentRequests) || 0) - 1) });
    tx.create(ticketRef.collection("events").doc("replaced_" + upload.requestId), { type: "document_replaced", kind: opened.kind,
      requestId: upload.requestId, documentId: ref.id, at });
    return true;
  });
  if (!fulfilled) {
    await discardPending(db, store, ref).catch(() => undefined);
    throw new HttpsError("failed-precondition", "This document request has already been answered.");
  }
  return { documentId: ref.id, screening };
}

// Deletes records whose `field` deadline passed, re-checked inside the
// transaction so a case reopened after the query keeps its documents.
export async function purgeDocumentBatch(db: admin.firestore.Firestore, store: DocumentStore, field: "expiresAt" | "purgeAt",
  now: number, batchLimit = 100): Promise<{ deleted: number; scanned: number; leftOver: number }> {
  const stale = await collection(db).where(field, "<", now).limit(batchLimit).get();
  if (stale.empty) return { deleted: 0, scanned: 0, leftOver: 0 };
  const ids = await db.runTransaction(async tx => {
    const fresh = await tx.getAll(...stale.docs.map(snapshot => snapshot.ref));
    const gone: string[] = [];
    for (const snapshot of fresh) {
      const data = snapshot.data(), value = data?.[field];
      const eligible = field === "expiresAt" ? data?.status === "pending" : data?.status === "attached";
      if (eligible && typeof value === "number" && value < now) {
        tx.delete(snapshot.ref); tx.set(tombstone(db, snapshot.id), { queuedAt: now }); gone.push(snapshot.id);
      }
    }
    return gone;
  });
  let leftOver = 0;
  for (const id of ids) await eraseObjects(db, store, id).catch(() => { leftOver++; });
  return { deleted: ids.length, scanned: stale.size, leftOver };
}

// Re-upload requests are only useful until they expire. Expired ones are
// deleted (the case history keeps the review and replacement events), and an
// unanswered one no longer counts toward the case's openDocumentRequests.
export async function purgeDocumentRequests(db: admin.firestore.Firestore, now: number, batchLimit = 100): Promise<{ deleted: number; scanned: number }> {
  const stale = await requests(db).where("expiresAt", "<", now).limit(batchLimit).get();
  if (stale.empty) return { deleted: 0, scanned: 0 };
  const deleted = await db.runTransaction(async tx => {
    const fresh = await tx.getAll(...stale.docs.map(snapshot => snapshot.ref));
    const expired = fresh.filter(snapshot => snapshot.exists && typeof snapshot.get("expiresAt") === "number" && snapshot.get("expiresAt") < now);
    const unanswered = new Map<string, number>();
    for (const snapshot of expired) {
      const ticketId = snapshot.get("ticketId");
      if (snapshot.get("fulfilledAt") == null && typeof ticketId === "string" && ticketId) unanswered.set(ticketId, (unanswered.get(ticketId) ?? 0) + 1);
    }
    const tickets = unanswered.size ? await tx.getAll(...[...unanswered.keys()].map(id => db.collection("tickets").doc(id))) : [];
    for (const ticket of tickets) {
      if (!ticket.exists) continue;
      tx.update(ticket.ref, { openDocumentRequests: Math.max(0, (Number(ticket.get("openDocumentRequests")) || 0) - unanswered.get(ticket.id)!) });
    }
    for (const snapshot of expired) tx.delete(snapshot.ref);
    return expired.length;
  });
  return { deleted, scanned: stale.size };
}

// Retries Storage deletes that failed after their records were removed.
export async function drainPurgeQueue(db: admin.firestore.Firestore, store: DocumentStore, batchLimit = 100) {
  const queued = await db.collection("documentPurges").limit(batchLimit).get();
  let deleted = 0, leftOver = 0;
  for (const item of queued.docs) await eraseObjects(db, store, item.id).then(() => { deleted++; }, () => { leftOver++; });
  return { deleted, scanned: queued.size, leftOver };
}
