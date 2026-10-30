import { TICKET_STATUSES, type TicketStatus } from "../tickets/status";

export const REUPLOAD_REQUESTED_TEXT = "Staff asked for a new copy of a document";

export interface TicketUpdateNotice {
  text: string;
  // A re-upload request stays open whatever happens to the status, so a later
  // status change must not supersede (and silently drop) its notice.
  revisionBound: boolean;
}

const count = (value: unknown) => Number(value) || 0;

// Decides whether a ticket write is something the reporter is told about, and
// with which text. Note text is never part of it: staff notes are private.
// Returns null for writes with nothing to report (assignment, escalation,
// document reviews other than a re-upload request, fulfilled requests), and
// "unsupported_status" when there is news but the status has no public label.
export function ticketUpdateNotice(before: Record<string, unknown>, after: Record<string, unknown>): TicketUpdateNotice | "unsupported_status" | null {
  const statusChanged = before.status !== after.status;
  const noteAdded = count(after.noteCount) > count(before.noteCount);
  // reviewCaseDocument increments openDocumentRequests for each re-upload
  // request; a fulfilled request decrements it and is not announced.
  const reuploadRequested = count(after.openDocumentRequests) > count(before.openDocumentRequests);
  if (!statusChanged && !noteAdded && !reuploadRequested) return null;
  const status = String(after.status) as TicketStatus;
  if (!Object.prototype.hasOwnProperty.call(TICKET_STATUSES, status)) return "unsupported_status";
  const label = TICKET_STATUSES[status];
  if (reuploadRequested) {
    return { text: statusChanged ? `${REUPLOAD_REQUESTED_TEXT}. Current status: ${label}` : REUPLOAD_REQUESTED_TEXT, revisionBound: false };
  }
  return { text: statusChanged ? label : `Staff added an update. Current status: ${label}`, revisionBound: true };
}
