import { callFunction, readableCallableError } from "../reporting/callables";
import { UPLOAD_TIMEOUT_MS } from "../reporting/documentUploads";

// Public status lookup and document re-upload (Wave 2 spec §5). The server
// returns no names, phone numbers, description, location or reasons, and this
// page keeps what it shows in component state only.

/** A ticket id: what the confirmation page calls the reference number. */
const REFERENCE_PATTERN = /^[A-Za-z0-9]{20}$/;
const REFERENCE_LENGTH = 20;

export interface TimelineEntry { statusLabel: string; at: number }
export interface DocumentRequest { requestId: string; kind: string; kindLabel: string; requestedAt: number; expiresAt: number }
export interface CaseStatus {
  reference: string;
  statusId: string;
  statusLabel: string;
  filedAt: number | null;
  lastUpdatedAt: number | null;
  timeline: TimelineEntry[];
  documentRequests: DocumentRequest[];
}

/** Spaces and dashes are dropped: people copy references from chats and prints. Case is kept, ids are case-sensitive. */
export function normaliseReference(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function referenceError(reference: string): string | null {
  if (!reference) return "Enter the reference number from your confirmation.";
  if (/[^A-Za-z0-9]/.test(reference)) return "A reference has only letters and numbers. Check it against your confirmation.";
  if (reference.length !== REFERENCE_LENGTH) {
    return `A reference has ${REFERENCE_LENGTH} letters and numbers; this one has ${reference.length}. Check it against your confirmation.`;
  }
  return REFERENCE_PATTERN.test(reference) ? null : "Check the reference against your confirmation.";
}

// Timestamps are documented as milliseconds; a Firestore Timestamp or an ISO
// string is accepted too, so a server-side change does not blank the page.
function toMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const seconds = (value as { seconds?: unknown; _seconds?: unknown }).seconds ?? (value as { _seconds?: unknown })._seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}
const text = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");

function parseCaseStatus(raw: unknown, reference: string): CaseStatus {
  const data = (raw ?? {}) as Record<string, unknown>;
  const timeline = (Array.isArray(data.timeline) ? data.timeline : []).flatMap((entry): TimelineEntry[] => {
    const at = toMs((entry as { at?: unknown })?.at);
    const label = text((entry as { statusLabel?: unknown })?.statusLabel);
    return at !== null && label ? [{ statusLabel: label, at }] : [];
  }).sort((a, b) => a.at - b.at);
  const documentRequests = (Array.isArray(data.documentRequests) ? data.documentRequests : []).flatMap((entry): DocumentRequest[] => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const requestId = text(item.requestId, 120);
    const requestedAt = toMs(item.requestedAt);
    const expiresAt = toMs(item.expiresAt);
    if (!requestId || requestedAt === null || expiresAt === null) return [];
    return [{ requestId, kind: text(item.kind, 60), kindLabel: text(item.kindLabel), requestedAt, expiresAt }];
  });
  return {
    reference: text(data.reference, 40) || reference,
    statusId: text(data.statusId, 60),
    statusLabel: text(data.statusLabel) || "Status not available",
    filedAt: toMs(data.filedAt),
    lastUpdatedAt: toMs(data.lastUpdatedAt),
    timeline,
    documentRequests,
  };
}

export async function lookupCaseStatus(reference: string): Promise<CaseStatus> {
  const raw = await callFunction<{ reference: string }, unknown>("getCaseStatus", { reference });
  return parseCaseStatus(raw, reference);
}

const codeOf = (err: unknown) => (err as { code?: string })?.code;

/** Where a lookup failure is shown: next to the field (fix the reference) or as a page notice (try later). */
export function lookupFailure(err: unknown): { atField: boolean; message: string } {
  const code = codeOf(err);
  if (code === "functions/not-found") {
    return { atField: true, message: "No report was found with this reference. Check each character (capital and small letters are different) and try again." };
  }
  if (code === "functions/invalid-argument") {
    return { atField: true, message: "This is not a valid reference. Check it against your confirmation." };
  }
  if (code === "functions/resource-exhausted") {
    return { atField: false, message: readableCallableError(err, "Too many lookups were made from this connection. Try again in an hour.") };
  }
  return { atField: false, message: readableCallableError(err, "The status service is unavailable. Please try again shortly.") };
}

export interface ReplacementUpload {
  reference: string;
  requestId: string;
  phone: string;
  verificationToken: string;
  fileName: string;
  contentType: string;
  dataBase64: string;
  idNumber?: string;
}

/** Sends a replacement for one open request. The server screens it before replying,
 *  hence the long timeout; only reporter-safe messages come back. */
export async function uploadReplacementDocument(input: ReplacementUpload): Promise<{ documentId: string; userMessages: string[] }> {
  const result = await callFunction<ReplacementUpload, { documentId?: unknown; screening?: { state?: unknown; userMessages?: unknown } }>(
    "uploadReplacementDocument", input, { timeout: UPLOAD_TIMEOUT_MS });
  const messages = Array.isArray(result?.screening?.userMessages) ? result.screening.userMessages : [];
  return {
    documentId: typeof result?.documentId === "string" ? result.documentId : "",
    userMessages: messages.filter((m): m is string => typeof m === "string" && m.length <= 300).slice(0, 5),
  };
}

export const isUnauthenticated = (err: unknown) => codeOf(err) === "functions/unauthenticated";
