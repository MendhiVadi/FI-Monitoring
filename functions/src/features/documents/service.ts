import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { addressBucket, hashId } from "../otp/identity";
import { verificationKey } from "../otp/service";
import { findDuplicateDocuments } from "./duplicates";
import { DERIVED_NAMES, documentPrefix, VARIANT_TYPES, type DocumentStore } from "./storage";
import { chargeUploadQuota, kindDefinition, MAX_FILES, ownsDocument, PENDING_TTL_MS, type Caller, type FileVariant,
  type ReviewDecision, type UploadRequest } from "./rules";
import type { ScreeningDeps, ScreeningInput, ScreeningOutput } from "./screening/index";
import { maskIdNumber, normaliseIdNumber } from "./screening/idNumbers";

// The engine (OCR, PDF and face models) is injected rather than imported, so
// only the upload callable ever loads it; every other function shares this
// codebase and would otherwise pay for it on each cold start.
export interface ScreeningEngine {
  ENGINE_VERSION: string;
  sniffContentType(bytes: Buffer): string | null;
  screenDocument(input: ScreeningInput, deps: ScreeningDeps): Promise<ScreeningOutput>;
}
export interface UploadDeps { store: DocumentStore; engine: ScreeningEngine; uidaiCertPem: string | null }
export interface ReporterProof { phone: string; token: string; address: string; requireOtp: boolean; secret: string }

const TOKEN = /^[a-f0-9]{64}$/;
const SCREENING_LIMIT_MS = 80_000;
const collection = (db: admin.firestore.Firestore) => db.collection("caseDocuments");
const tombstone = (db: admin.firestore.Firestore, id: string) => db.collection("documentPurges").doc(id);

function proofRefs(db: admin.firestore.Firestore, proof: ReporterProof) {
  if (proof.requireOtp && (!proof.phone || !TOKEN.test(proof.token))) {
    throw new HttpsError("unauthenticated", "Verify your phone before adding documents.");
  }
  return { addressHash: hashId(addressBucket(proof.address)),
    grant: proof.phone && TOKEN.test(proof.token) ? db.collection("disputeVerifications").doc(verificationKey(proof.token, proof.secret)) : null };
}
// Same test as submitDispute, but read-only: uploads must not spend the grant
// that the final submission still needs.
function callerFrom(grant: admin.firestore.DocumentData | undefined, proof: ReporterProof, addressHash: string, now: number): Caller {
  const phoneHash = grant && !grant.used && grant.expiresAt > now && grant.phoneHash === hashId(proof.phone) ? hashId(proof.phone) : null;
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

export async function uploadCaseDocument(db: admin.firestore.Firestore, deps: UploadDeps, request: UploadRequest, proof: ReporterProof) {
  const { engine, store } = deps;
  if (engine.sniffContentType(request.bytes) !== request.contentType) {
    throw new HttpsError("invalid-argument", "The file's contents do not match its type. Choose the original file again.");
  }
  const { addressHash, grant } = proofRefs(db, proof);
  const idType = kindDefinition(request.kind)?.idNumber;
  const idNumber = idType && request.idNumber ? normaliseIdNumber(idType, request.idNumber) || null : null;
  const limitRef = db.collection("documentUploadLimits").doc(addressHash);
  const ref = collection(db).doc(), original = documentPrefix(ref.id) + "original";
  const pending = collection(db).where("submissionId", "==", request.submissionId).where("status", "==", "pending")
    .select("expiresAt").limit(MAX_FILES * 2);
  // The record is created before the slow work so in-flight uploads count
  // toward the per-report limit; screening fills it in afterwards.
  await db.runTransaction(async tx => {
    const [limitSnap, grantSnap] = await tx.getAll(...(grant ? [limitRef, grant] : [limitRef]));
    const now = Date.now();
    const caller = callerFrom(grantSnap?.data(), proof, addressHash, now);
    const live = (await tx.get(pending)).docs.filter(doc => Number(doc.get("expiresAt")) > now).length;
    if (live >= MAX_FILES) throw new HttpsError("resource-exhausted", "A report can hold " + MAX_FILES + " documents. Remove one before adding another.");
    const quota = chargeUploadQuota(limitSnap.data(), now, request.bytes.length);
    if (!quota) throw new HttpsError("resource-exhausted", "Too many documents were uploaded from this connection today. Try again later.");
    tx.set(limitRef, quota);
    tx.create(ref, {
      submissionId: request.submissionId, phoneHash: caller.phoneHash, addressHash, ticketId: null, status: "pending",
      kind: request.kind, side: request.side, fileName: request.fileName, contentType: request.contentType, sizeBytes: request.bytes.length,
      sha256: createHash("sha256").update(request.bytes).digest("hex"), dhash: null, dhashBands: [], idNumberHash: null, reporterNameNorm: null,
      width: null, height: null, pageCount: null,
      idNumberFull: idNumber, idNumberMasked: idType && idNumber ? maskIdNumber(idType, idNumber) : null,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(), expiresAt: now + PENDING_TTL_MS, purgeAt: null,
      storage: { original }, screening: { state: "pending", risk: null, score: null, summary: "", checks: [], extracted: {},
        engineVersion: engine.ENGINE_VERSION, completedAt: null },
      review: null,
    });
  });
  try {
    await store.save(original, request.bytes, request.contentType);
  } catch (err) {
    await discardPending(db, store, ref).catch(() => undefined);
    console.error("Document upload storage failed", { code: (err as { code?: unknown })?.code ?? "unknown" });
    throw new HttpsError("unavailable", "Could not store the file right now. Please try again shortly.");
  }
  let output: ScreeningOutput | null = null, timer: NodeJS.Timeout | undefined;
  try {
    // The engine budgets its own steps; this outer bound still leaves time to
    // store the record if a step stalls, before the callable's own timeout.
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Screening timed out"), { name: "ScreeningTimeout" })), SCREENING_LIMIT_MS);
    });
    output = await Promise.race([engine.screenDocument({ bytes: request.bytes, contentType: request.contentType, kind: request.kind, idNumber,
      reporterName: request.reporterName }, { findDuplicates: q => findDuplicateDocuments(db, request.submissionId, q), uidaiCertPem: deps.uidaiCertPem }), stalled]);
  } catch (err) {
    // Screening only flags for staff: a crash must not cost the reporter the upload.
    console.error("Document screening failed", { kind: request.kind, error: err instanceof Error ? err.name : "unknown" });
  } finally {
    clearTimeout(timer);
  }
  const storage: Record<string, string> = { original };
  for (const file of output?.derived ?? []) {
    if (!Object.prototype.hasOwnProperty.call(DERIVED_NAMES, file.key)) continue;
    const path = documentPrefix(ref.id) + DERIVED_NAMES[file.key];
    try { await store.save(path, file.bytes, VARIANT_TYPES[file.key]); storage[file.key] = path; }
    catch { console.warn("Derived document file was not stored", { key: file.key }); }
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
  return { documentId: ref.id, screening: { state: screening.state, userMessages } };
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
    if (data.status !== "pending") throw new HttpsError("failed-precondition", "Documents of a submitted report cannot be removed.");
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

export async function reviewDocument(db: admin.firestore.Firestore, officer: { uid: string; email: string },
  input: { documentId: string; decision: ReviewDecision; reason: string; requestId: string }) {
  const ref = collection(db).doc(input.documentId);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data) throw new HttpsError("not-found", "Document not found.");
    if (data.status !== "attached" || typeof data.ticketId !== "string") throw new HttpsError("failed-precondition", "Only documents of a submitted case can be reviewed.");
    const ticketRef = db.collection("tickets").doc(data.ticketId), eventRef = ticketRef.collection("events").doc(input.requestId);
    const [ticket, event] = await tx.getAll(ticketRef, eventRef);
    if (event.exists) {
      const previous = event.data()!;
      if (previous.actorUid !== officer.uid || previous.documentId !== input.documentId) throw new HttpsError("already-exists", "Change reference is already used.");
      return { review: wireReview(data.review) };
    }
    if (!ticket.exists) throw new HttpsError("not-found", "Ticket not found.");
    const at = admin.firestore.FieldValue.serverTimestamp(), revision = (Number(ticket.data()!.revision) || 0) + 1;
    const review = { decision: input.decision, reason: input.reason, by: officer.uid, byEmail: officer.email || null };
    tx.update(ref, { review: { ...review, at } });
    // officerUid keeps the existing case-history actor labels working.
    tx.create(eventRef, { type: "document_review", documentId: input.documentId, kind: data.kind, decision: input.decision,
      reason: input.reason, actorUid: officer.uid, officerUid: officer.uid, at, revision });
    tx.update(ticketRef, { revision, updatedAt: at, lastUpdatedBy: officer.uid });
    return { review: { ...review, at: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } } };
  });
}
function wireReview(review: admin.firestore.DocumentData | null | undefined) {
  if (!review) return null;
  const at = review.at;
  return { ...review, at: at && typeof at.seconds === "number" ? { seconds: at.seconds, nanoseconds: at.nanoseconds || 0 } : null };
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

// Retries Storage deletes that failed after their records were removed.
export async function drainPurgeQueue(db: admin.firestore.Firestore, store: DocumentStore, batchLimit = 100) {
  const queued = await db.collection("documentPurges").limit(batchLimit).get();
  let deleted = 0, leftOver = 0;
  for (const item of queued.docs) await eraseObjects(db, store, item.id).then(() => { deleted++; }, () => { leftOver++; });
  return { deleted, scanned: queued.size, leftOver };
}
