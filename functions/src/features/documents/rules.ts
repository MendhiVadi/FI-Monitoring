import contract from "../../platform/contracts/dispute.json";

// Pure document rules shared by the callables, submitDispute and the tests.
// Nothing here touches Firestore, Storage or the screening engine.

export const DAY_MS = 86_400_000;
export const MIB = 1024 * 1024;
export const MAX_FILE_BYTES: number = contract.documents.maxFileBytes;
export const MAX_FILES: number = contract.documents.maxFiles;
export const PENDING_TTL_MS = contract.documents.pendingTtlMinutes * 60_000;
export const RETENTION_MS = contract.documents.retentionDaysAfterClose * DAY_MS;
export const REPLACEMENT_TTL_MS = contract.documents.replacementTtlDays * DAY_MS;
// Defaults of the UPLOADS_PER_IP_DAY / UPLOAD_BYTES_PER_IP_DAY_MIB params
// (platform/limits.ts); the callables pass the deployed values.
export const UPLOADS_PER_DAY = 150;
export const UPLOAD_BYTES_PER_DAY = 300 * MIB;
export const NEAR_DUPLICATE_DISTANCE = 6;
export const REVIEW_DECISIONS = ["accepted", "rejected", "reupload_requested"] as const;
export const FILE_VARIANTS = ["original", "ela", "faceCard", "faceQr", "copyMove"] as const;
export type ReviewDecision = typeof REVIEW_DECISIONS[number];
export type FileVariant = typeof FILE_VARIANTS[number];
export type CaseType = keyof typeof contract.documents.caseTypes;

interface KindDefinition { id: string; label: string; side: string; idNumber?: string }
const kinds = new Map<string, KindDefinition>(contract.documents.kinds.map(kind => [kind.id, kind as KindDefinition]));
const kindOrder = new Map(contract.documents.kinds.map((kind, index) => [kind.id, index]));
const caseTypes: Record<string, { label: string; required: string[]; optional: string[] }> = contract.documents.caseTypes;
const partyCaseTypes: Record<string, string> = contract.documents.caseTypeByPartyType;
const accepted: string[] = contract.documents.acceptedTypes;

export class DocumentInputError extends Error {}

export const kindDefinition = (kind: string) => kinds.get(kind);
export const kindLabel = (kind: string) => kinds.get(kind)?.label ?? kind;

// Anything unmapped is treated like a government body: that case type asks for
// the least identity material, so an unknown party never demands more PII.
export function caseTypeFor(otherPartyType: string): CaseType {
  const mapped = Object.prototype.hasOwnProperty.call(partyCaseTypes, otherPartyType) ? partyCaseTypes[otherPartyType] : "";
  return (Object.prototype.hasOwnProperty.call(caseTypes, mapped) ? mapped : "citizen_vs_government") as CaseType;
}

export function missingRequiredKinds(caseType: string, present: Iterable<string>): string[] {
  const have = new Set(present);
  return (caseTypes[caseType]?.required ?? []).filter(kind => !have.has(kind));
}

export const sortKinds = (values: Iterable<string>) =>
  [...new Set(values)].sort((a, b) => (kindOrder.get(a) ?? kindOrder.size) - (kindOrder.get(b) ?? kindOrder.size) || a.localeCompare(b));

export const isFlaggedRisk = (risk: unknown) => risk === "high" || risk === "altered";

export function documentSummary(caseType: string, documents: { kind: string; risk?: unknown }[]) {
  return { caseType, count: documents.length, kinds: sortKinds(documents.map(d => d.kind)),
    flagged: documents.filter(d => isFlaggedRisk(d.risk)).length };
}

export const validSubmissionId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{20,80}$/.test(value);
export const validDocumentId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9]{20}$/.test(value);
export const validRequestId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{20,80}$/.test(value);

export function validateDocumentIds(value: unknown): string[] {
  const ids = value ?? [];
  if (!Array.isArray(ids) || ids.length > MAX_FILES || !ids.every(validDocumentId)) {
    throw new DocumentInputError("Attach up to " + MAX_FILES + " uploaded documents.");
  }
  return [...new Set(ids)];
}

// Keeps a readable name for staff while dropping paths, control characters
// and anything a download header or file system could misread.
export function sanitiseFileName(value: unknown): string {
  const base = (typeof value === "string" ? value : "").normalize("NFC").split(/[\\/]/).pop() ?? "";
  // \p{M} keeps the vowel signs of Indic scripts, which are marks, not letters.
  const clean = base.replace(/[^\p{L}\p{M}\p{N} ._()-]+/gu, "_").replace(/\s+/g, " ").replace(/^[ .]+/, "").trim();
  // The cut can split an astral letter; a lone surrogate is not valid UTF-8.
  return (clean || "document").slice(0, 120).replace(/[\uD800-\uDBFF]$/, "");
}

export interface UploadRequest {
  submissionId: string; kind: string; side: string; fileName: string; contentType: string; bytes: Buffer;
  idNumber: string | null; reporterName: string | null;
}

// The file half of an upload, shared by first uploads and replacements.
export interface FilePayload { fileName: string; contentType: string; bytes: Buffer }
export function parseFilePayload(r: Record<string, unknown>): FilePayload {
  const contentType = typeof r.contentType === "string" ? r.contentType.trim().toLowerCase() : "";
  if (!accepted.includes(contentType)) throw new DocumentInputError("Upload a JPEG, PNG, WebP or PDF file.");
  // Bound the string before decoding so an oversized body is refused cheaply.
  const raw = typeof r.dataBase64 === "string" ? r.dataBase64.replace(/^data:[\w/+.-]+;base64,/, "") : "";
  if (raw.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) throw new DocumentInputError(tooLarge());
  if (!raw || raw.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new DocumentInputError("The file could not be read. Choose it again.");
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length) throw new DocumentInputError("The file is empty.");
  if (bytes.length > MAX_FILE_BYTES) throw new DocumentInputError(tooLarge());
  return { fileName: sanitiseFileName(r.fileName), contentType, bytes };
}
// Format only; whether the kind takes a number is decided by the caller.
export function parseIdNumber(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.length > 24 || !/^[0-9A-Za-z -]+$/.test(trimmed)) throw new DocumentInputError("Enter the ID number using letters and digits only.");
  return trimmed;
}

export function validateUploadRequest(data: unknown): UploadRequest {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DocumentInputError("Missing document details.");
  const r = data as Record<string, unknown>;
  if (!validSubmissionId(r.submissionId)) throw new DocumentInputError("A submission reference is required.");
  const kind = typeof r.kind === "string" ? kinds.get(r.kind) : undefined;
  if (!kind) throw new DocumentInputError("Choose a supported document type.");
  const { fileName, contentType, bytes } = parseFilePayload(r);
  const idNumber = kind.idNumber ? parseIdNumber(r.idNumber) : null;
  let reporterName: string | null = null;
  if (typeof r.reporterName === "string" && r.reporterName.trim()) {
    reporterName = r.reporterName.trim();
    if (reporterName.length > contract.nameMax) throw new DocumentInputError("The reporter name is too long.");
  }
  return { submissionId: r.submissionId, kind: kind.id, side: sideOf(kind.id), fileName, contentType, bytes, idNumber, reporterName };
}
export const sideOf = (kind: string) => kinds.get(kind)?.side === "other_party" ? "other_party" : "reporter";
const tooLarge = () => "Each file must be " + Math.floor(MAX_FILE_BYTES / MIB) + " MB or smaller.";

// The engine's magic-byte test, kept here so uploads are still type-checked
// when the engine itself cannot load (see uploadDisputeDocument).
export function sniffDocumentType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return bytes.subarray(0, 1024).indexOf("%PDF-", 0, "latin1") >= 0 ? "application/pdf" : null;
}

// A record binds to the verified phone when there was one, otherwise to the
// caller's address bucket. submissionId alone is a client value, not a secret.
export interface Caller { phoneHash: string | null; addressHash: string }
export function ownsDocument(record: { phoneHash?: unknown; addressHash?: unknown }, caller: Caller): boolean {
  return typeof record.phoneHash === "string" && record.phoneHash ? record.phoneHash === caller.phoneHash
    : record.addressHash === caller.addressHash;
}

export interface UploadQuota { count: number; bytes: number; windowStartedAt: number }
export interface UploadLimits { files: number; bytes: number }
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = { files: UPLOADS_PER_DAY, bytes: UPLOAD_BYTES_PER_DAY };
// Returns the charged window, or null when this upload would exceed it.
export function chargeUploadQuota(previous: Partial<UploadQuota> | undefined, now: number, size: number,
  limits: UploadLimits = DEFAULT_UPLOAD_LIMITS): UploadQuota | null {
  const live = typeof previous?.windowStartedAt === "number" && previous.windowStartedAt > now - DAY_MS;
  const count = live ? Number(previous!.count) || 0 : 0, bytes = live ? Number(previous!.bytes) || 0 : 0;
  if (count + 1 > limits.files || bytes + size > limits.bytes) return null;
  return { count: count + 1, bytes: bytes + size, windowStartedAt: live ? previous!.windowStartedAt! : now };
}

// Bit distance between two 64-bit perceptual hashes; malformed input never matches.
export function hammingDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) return Infinity;
  let x = BigInt("0x" + a) ^ BigInt("0x" + b), bits = 0;
  while (x) { bits += Number(x & 1n); x >>= 1n; }
  return bits;
}

export function validateReviewRequest(data: unknown): { documentId: string; decision: ReviewDecision; reason: string; requestId: string } {
  const r = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const reason = typeof r.reason === "string" ? r.reason.trim() : "";
  if (!validDocumentId(r.documentId) || !validRequestId(r.requestId) ||
      !REVIEW_DECISIONS.includes(r.decision as ReviewDecision) || reason.length < 3 || reason.length > 500) {
    throw new DocumentInputError("Choose a decision and give a reason (3–500 characters).");
  }
  return { documentId: r.documentId, decision: r.decision as ReviewDecision, reason, requestId: r.requestId };
}

export function validateFileRequest(data: unknown): { documentId: string; variant: FileVariant } {
  const r = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const variant = r.variant ?? "original";
  if (!validDocumentId(r.documentId) || !FILE_VARIANTS.includes(variant as FileVariant)) {
    throw new DocumentInputError("A valid document reference is required.");
  }
  return { documentId: r.documentId, variant: variant as FileVariant };
}
