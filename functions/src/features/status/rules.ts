import { DocumentInputError, kindLabel, parseFilePayload, parseIdNumber, validRequestId } from "../documents/rules";
import type { ReplacementUpload } from "../documents/service";
import { normalizePhone } from "../otp/service";
import { TICKET_STATUSES } from "../tickets/status";

// Pure rules for the public status lookup and document replacement. Nothing
// here touches Firestore, Storage or the screening engine.

export const HOUR_MS = 3_600_000;
// Default of the STATUS_LOOKUPS_PER_IP_HOUR param (platform/limits.ts).
export const STATUS_LOOKUPS_PER_HOUR = 30;
export const MAX_TIMELINE = 50;
export const MAX_OPEN_REQUESTS = 20;

// The reference is the ticket id itself: 20 random characters, unguessable,
// so knowing it is what lets a reporter see their case's status.
export const validCaseReference = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9]{20}$/.test(value);

export interface LookupWindow { count: number; windowStartedAt: number }
// Fixed hourly window per address bucket. Returns the charged window, or null when over the limit.
export function chargeLookup(previous: Partial<LookupWindow> | undefined, now: number, limit = STATUS_LOOKUPS_PER_HOUR): LookupWindow | null {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : STATUS_LOOKUPS_PER_HOUR;
  const live = typeof previous?.windowStartedAt === "number" && previous.windowStartedAt > now - HOUR_MS;
  const count = live ? Number(previous!.count) || 0 : 0;
  if (count >= cap) return null;
  return { count: count + 1, windowStartedAt: live ? previous!.windowStartedAt! : now };
}

export function validateReplacementRequest(data: unknown): { upload: ReplacementUpload; phone: string; token: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DocumentInputError("Missing document details.");
  const r = data as Record<string, unknown>;
  const reference = typeof r.reference === "string" ? r.reference.trim() : "";
  if (!validCaseReference(reference)) throw new DocumentInputError("Enter the 20-character case reference.");
  if (!validRequestId(r.requestId)) throw new DocumentInputError("Choose the document request you are answering.");
  const file = parseFilePayload(r);
  const idNumber = parseIdNumber(r.idNumber);
  let phone = "";
  if (r.phone) {
    try { phone = normalizePhone(r.phone); } catch { throw new DocumentInputError("Enter a valid phone number in international format."); }
  }
  // Only a well-formed token can match a grant; anything else is dropped unhashed.
  const token = typeof r.verificationToken === "string" && /^[a-f0-9]{64}$/.test(r.verificationToken) ? r.verificationToken : "";
  return { upload: { reference, requestId: r.requestId, ...file, idNumber }, phone, token };
}

const millis = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const time = value as { toMillis?: () => number; seconds?: unknown } | null | undefined;
  if (typeof time?.toMillis === "function") return time.toMillis();
  return typeof time?.seconds === "number" ? time.seconds * 1000 : 0;
};
const knownStatus = (status: unknown): status is keyof typeof TICKET_STATUSES =>
  typeof status === "string" && Object.prototype.hasOwnProperty.call(TICKET_STATUSES, status);
export const statusLabel = (status: unknown) => knownStatus(status) ? TICKET_STATUSES[status] : "Under review";

export interface CaseStatus {
  reference: string; statusId: string; statusLabel: string; filedAt: number | null; lastUpdatedAt: number | null;
  timeline: { statusLabel: string; at: number }[];
  documentRequests: { requestId: string; kind: string; kindLabel: string; requestedAt: number; expiresAt: number }[];
}
export interface StatusEventRow { after?: unknown; at?: unknown }
export interface RequestRow { id: string; kind?: unknown; requestedAt?: unknown; expiresAt?: unknown; fulfilledAt?: unknown }

// The public projection: status, dates and open re-upload requests only. No
// names, phone, narrative, location, reasons or staff identities, whatever
// the inputs carry.
export function projectCaseStatus(reference: string, ticket: { status?: unknown; createdAt?: unknown; updatedAt?: unknown },
  events: StatusEventRow[], requests: RequestRow[], now: number): CaseStatus {
  const statusId = typeof ticket.status === "string" ? ticket.status : "open";
  const filedAt = millis(ticket.createdAt) || null;
  const changes = events.map(event => ({ after: event.after, at: millis(event.at) }))
    .filter(event => knownStatus(event.after) && event.at > 0).sort((a, b) => a.at - b.at)
    .map(event => ({ statusLabel: statusLabel(event.after), at: event.at }));
  // Every case starts open when it is filed; later entries are the status changes.
  const filed = filedAt ? [{ statusLabel: TICKET_STATUSES.open, at: filedAt }] : [];
  const timeline = [...filed, ...changes.slice(-(MAX_TIMELINE - filed.length))];
  const documentRequests = requests
    .filter(row => row.fulfilledAt == null && typeof row.kind === "string" && typeof row.expiresAt === "number" && row.expiresAt > now)
    .map(row => ({ requestId: row.id, kind: row.kind as string, kindLabel: kindLabel(row.kind as string), requestedAt: millis(row.requestedAt),
      expiresAt: row.expiresAt as number }))
    .sort((a, b) => a.requestedAt - b.requestedAt).slice(0, MAX_OPEN_REQUESTS);
  return { reference, statusId, statusLabel: statusLabel(statusId), filedAt, lastUpdatedAt: millis(ticket.updatedAt) || filedAt, timeline, documentRequests };
}
