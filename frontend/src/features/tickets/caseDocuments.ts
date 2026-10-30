import contract from "../../shared/contracts/dispute.json";

// Mirrors caseDocuments/{documentId} (vault/Documents-and-Screening.md). The
// records are server-written; staff only read them and post a review.
export type DocumentRisk = "low" | "medium" | "high" | "altered";
export type CheckResult = "pass" | "warn" | "fail" | "info" | "unavailable";
export type ReviewDecision = "accepted" | "rejected" | "reupload_requested";
export type FileVariant = "original" | "ela" | "faceCard" | "faceQr" | "copyMove";

export interface ScreeningCheck { id: string; label: string; result: CheckResult; detail: string }
export interface QrFields {
  signatureValid: boolean | null;
  // The server stores null for a field the QR did not carry.
  name?: string | null; dob?: string | null; gender?: string | null; last4?: string | null;
  district?: string | null; state?: string | null; pincode?: string | null; hasPhoto?: boolean;
}
export interface OcrFields { text?: string; aadhaarNumbers?: string[]; panNumbers?: string[]; dates?: string[] }
export interface DocumentScreening {
  state: "pending" | "done" | "error";
  risk: DocumentRisk | null;
  score: number | null;
  summary: string;
  checks: ScreeningCheck[];
  extracted?: { qr?: QrFields; ocr?: OcrFields };
  engineVersion?: string;
  completedAt?: { seconds: number } | null;
}
// Reviews written since wave 2 also carry the reviewer's name and role label;
// a reupload_requested one also carries the reporter's deadline (ms).
export interface DocumentReview {
  decision: ReviewDecision; reason: string; by: string; byEmail: string | null; at?: { seconds: number };
  officerName?: string | null; officerRole?: string | null; expiresAt?: number | null;
}
export interface CaseDocument {
  id: string;
  ticketId: string | null;
  status: "pending" | "attached";
  kind: string;
  side: "reporter" | "other_party";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width?: number | null; height?: number | null; pageCount?: number | null;
  idNumberFull?: string | null;
  idNumberMasked?: string | null;
  uploadedAt?: { seconds: number };
  storage?: { original: string; ela?: string; faceCard?: string; faceQr?: string; copyMove?: string };
  screening?: DocumentScreening;
  review?: DocumentReview | null;
  // A re-upload (uploadReplacementDocument) names the document it replaces;
  // the old one then names its replacement.
  replaces?: string | null;
  supersededBy?: string | null;
}

const { kinds, caseTypes, caseTypeByPartyType } = contract.documents;
const KIND_ORDER = new Map(kinds.map((kind, index) => [kind.id, index]));
const KIND_LABELS = new Map(kinds.map(kind => [kind.id, kind.label]));
const CASE_TYPES: Record<string, { label: string; required: string[] }> = caseTypes;
const PARTY_CASE_TYPES: Record<string, string> = caseTypeByPartyType;

export const REVIEW_LIMITS = { min: 3, max: 500 } as const; // mirrors reviewCaseDocument
/** Days a reporter has to answer a re-upload request (contract documents.replacementTtlDays). */
export const REPLACEMENT_TTL_DAYS: number = contract.documents.replacementTtlDays;
export const REVIEW_LABELS: Record<ReviewDecision, string> = {
  accepted: "Accepted",
  rejected: "Rejected",
  reupload_requested: "Re-upload requested",
};

// Own keys only: a stored party type such as "constructor" must not resolve
// to an Object.prototype member.
const caseTypeOf = (caseType: string | undefined) => caseType && Object.hasOwn(CASE_TYPES, caseType) ? CASE_TYPES[caseType] : undefined;

export const kindLabel = (kind: string) => KIND_LABELS.get(kind) ?? kind;

// Plain names for the screening checks added in wave 2, used when a stored
// check carries no label of its own (vault/Wave-2-Spec.md §6).
const CHECK_LABELS: Record<string, string> = {
  pdf_signature: "PDF digital signature",
  copy_move: "Copied regions (copy-move)",
  hologram: "Hologram (tilted photo)",
  liveness: "Selfie liveness",
  selfie_match: "Selfie matches the Aadhaar photo",
  kyc: "Identity (KYC) check",
};
export const checkLabel = (check: { id: string; label?: string }) =>
  check.label?.trim() || (Object.hasOwn(CHECK_LABELS, check.id) ? CHECK_LABELS[check.id] : check.id);
export const caseTypeLabel = (caseType: string | undefined) => caseTypeOf(caseType)?.label || "Unknown case type";
// Legacy tickets carry no case type; derive the one a new report would get.
export const caseTypeForParty = (partyType: string | undefined) =>
  partyType && Object.hasOwn(PARTY_CASE_TYPES, partyType) ? PARTY_CASE_TYPES[partyType] : undefined;
export const isFlagged = (document: CaseDocument) => document.screening?.risk === "high" || document.screening?.risk === "altered";

export type ReuploadState = "open" | "fulfilled" | "expired";
// Where a reupload_requested review stands. documentRequests are server-only;
// the review carries the server's expiry (ms) since wave 2, and older reviews
// and masked (viewer) copies fall back to review time plus REPLACEMENT_TTL_DAYS.
// A masked review time arrives as ms, and viewers get current copies only, so
// a viewer sees open or expired.
export function reuploadRequest(review: { decision: string; at?: { seconds: number } | number | null; expiresAt?: number | null } | null | undefined,
  supersededBy?: string | null, now = Date.now()): { state: ReuploadState; expiresAt: number | null } | null {
  if (review?.decision !== "reupload_requested") return null;
  const at = typeof review.at === "number" ? review.at : typeof review.at?.seconds === "number" ? review.at.seconds * 1000 : NaN;
  const stored = typeof review.expiresAt === "number" && Number.isFinite(review.expiresAt) ? review.expiresAt : null;
  const expiresAt = stored ?? (Number.isFinite(at) ? at + REPLACEMENT_TTL_DAYS * 86_400_000 : null);
  return { state: supersededBy ? "fulfilled" : expiresAt !== null && now > expiresAt ? "expired" : "open", expiresAt };
}

export function missingRequiredKinds(caseType: string | undefined, present: Iterable<string>): string[] {
  const have = new Set(present);
  return (caseTypeOf(caseType)?.required ?? []).filter(kind => !have.has(kind));
}

// Contract kind order first (required identity papers lead), then upload time.
export function sortDocuments(documents: CaseDocument[]): CaseDocument[] {
  const rank = (kind: string) => KIND_ORDER.get(kind) ?? KIND_ORDER.size;
  return [...documents].sort((a, b) => rank(a.kind) - rank(b.kind) || (a.uploadedAt?.seconds ?? Infinity) - (b.uploadedAt?.seconds ?? Infinity));
}

// OCR returns whole numbers; staff see them masked until they ask.
export function maskIdNumber(value: string): string {
  const compact = value.replace(/[\s._-]+/g, "");
  if (/^\d{12}$/.test(compact)) return "XXXX XXXX " + compact.slice(-4);
  if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(compact)) return compact.slice(0, 5) + "****" + compact.slice(-1);
  return compact.length > 4 ? "•".repeat(compact.length - 4) + compact.slice(-4) : compact;
}

// Reporters often name files after the number on them ("aadhaar 2345 6789 0123.jpg",
// "aadhaar_234567890123.jpg"), so only digits bound an Aadhaar number; a PAN is
// anchored by its four digits. Masking a lookalike too is the safe side.
const NUMBERS_IN_TEXT = /(?<!\d)\d{4}[ ._-]?\d{4}[ ._-]?\d{4}(?!\d)|[A-Z]{5}\d{4}[A-Z]/gi;
export const hasIdNumberInText = (text: string) => text.search(NUMBERS_IN_TEXT) !== -1;
export const maskIdNumbersInText = (text: string) => text.replace(NUMBERS_IN_TEXT, maskIdNumber);

export function formatAadhaar(value: string): string {
  const compact = value.replace(/\s+/g, "");
  return /^\d{12}$/.test(compact) ? compact.replace(/(\d{4})(?=\d)/g, "$1 ") : compact;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
