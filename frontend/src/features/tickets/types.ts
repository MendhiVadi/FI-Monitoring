export interface DisputeData {
  reporterName: string;
  reporterType: string;
  otherPartyName: string;
  otherPartyType: string;
  disputeType: string;
  state: string;
  district: string;
  village?: string;
  description: string;
  immediateRisk?: "yes" | "no" | "unknown";
  evidenceReferences?: string[];
  location?: { latitude: number; longitude: number };
}

export interface TicketMessage {
  body: string;
  from: "user" | "officer" | "system";
  at?: { seconds: number } | Date | string;
}

// Summary written by submitDispute; flagged counts documents screened high or altered.
export interface TicketDocuments {
  caseType: string;
  count: number;
  kinds: string[];
  flagged: number;
}

// Set by escalateOverdueCases (vault/Wave-2-Spec.md §3): "acknowledge" while no
// staff action happened within the acknowledge target, "resolve" past the
// resolve target, null otherwise. Absent until the first escalation run.
export type OverdueState = "acknowledge" | "resolve";

export interface Ticket {
  revision?: number;
  noteCount?: number;
  id: string;
  subject: string;
  status: string;
  statusLabel?: string;
  waFrom?: string;
  phoneVerified?: boolean;
  // Reporter opted in to WhatsApp updates (only honoured when phoneVerified).
  whatsappUpdates?: boolean;
  source?: string;
  dispute?: DisputeData;
  messages?: TicketMessage[];
  createdAt?: { seconds: number };
  updatedAt?: { seconds: number };
  officerNotes?: string[];
  priority?: string;
  // Absent on cases filed before document uploads.
  documents?: TicketDocuments;
  // Milliseconds; set when the status becomes terminal, cleared on reopen.
  closedAt?: number | null;
  // Assignment (assignTicket). All null when unassigned; absent on older cases.
  assignedTo?: string | null;
  assignedEmail?: string | null;
  assignedName?: string | null;
  assignedAt?: number | null;
  // Masked (viewer) copies only: they drop assignedTo, so this says whether
  // anyone has the case; assignedName is then initials.
  assigned?: boolean;
  // Service targets, all milliseconds.
  ackDueAt?: number | null;
  resolveDueAt?: number | null;
  firstActionAt?: number | null;
  overdue?: OverdueState | null;
  overdueSince?: number | null;
  // Re-upload requests still waiting for the reporter.
  openDocumentRequests?: number;
}

// officers/{uid}.access; mirrors StaffAccess in auth/staffSession.ts.
export type StaffAccessLevel = "viewer" | "officer" | "admin";

// Stamped on every staff write since wave 2 (status event, note, document
// review, assignment, staff escalation). Older entries carry officerUid only;
// a document review names its author with actorUid / actorRole.
export interface StaffIdentity {
  officerUid?: string;
  officerEmail?: string | null;
  officerName?: string | null;
  officerRole?: string | null;
  actorUid?: string;
  actorRole?: string | null;
}

// Status and note events carry `kind`; the others carry `type`.
export type CaseEventKind = "status" | "note";
export type CaseEventType = "document_review" | "assignment" | "escalation" | "document_replaced";

// tickets/{id}/events/{eventId}. Fields beyond id/at depend on kind or type:
// status (before, after, reason), assignment (from, to, toEmail, toName, reason,
// revision), escalation (overdue), document_review (documentId, decision, kind =
// the document's kind), document_replaced (kind, requestId, documentId).
export interface TicketEvent extends StaffIdentity {
  id: string;
  kind?: CaseEventKind | string;
  type?: CaseEventType | string;
  before?: string;
  after?: string;
  reason?: string | null;
  documentId?: string;
  decision?: string;
  requestId?: string;
  revision?: number;
  from?: string | null;
  to?: string | null;
  toEmail?: string | null;
  toName?: string | null;
  overdue?: OverdueState | null;
  at?: { seconds: number };
}

// listOfficers (officer+) → { officers } (at most 200).
export interface StaffMember {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string | null;
  access: StaffAccessLevel;
}

// documentRequests/{requestId} (requestId = the reupload_requested review's
// requestId). Server-only; all times in milliseconds.
export interface DocumentRequest {
  requestId: string;
  ticketId: string;
  documentId: string;
  kind: string;
  requestedAt: number;
  expiresAt: number;
  fulfilledAt: number | null;
  fulfilledDocumentId: string | null;
}

// getMaskedCase (viewer+) → MaskedCase. Names are initials, the phone is
// "+91•••••1234" (or null), free text has numbers and emails as "•••", the
// location is rounded to 2 decimals, staff appear by role label only (`actor`)
// and documents carry no files, ID numbers or extracted fields. Times are ms.
export interface MaskedTicket {
  id: string;
  status: string;
  statusLabel: string;
  subject: string;
  dispute: {
    reporterType: string;
    otherPartyType: string;
    disputeType: string;
    state: string;
    district: string;
    village: string;
    description: string;
    location: { latitude: number; longitude: number } | null;
    immediateRisk: "yes" | "no" | "unknown";
  };
  reporterName: string;
  otherPartyName: string;
  phone: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  // The assignee's initials (null without a display name); `assigned` says
  // whether anyone has the case at all.
  assignedName: string | null;
  assigned: boolean;
  overdue: OverdueState | null;
  documents: TicketDocuments | null;
}
export interface MaskedEvent {
  id: string;
  kind?: string;
  type?: string;
  before?: string;
  after?: string;
  decision?: string;
  overdue?: OverdueState | null;
  documentId?: string;
  noteId?: string;
  requestId?: string;
  revision?: number;
  reason?: string;
  // Assignment events: whether someone was assigned, and the assignee's
  // initials (null without a display name).
  assigned?: boolean;
  toName?: string | null;
  // Role label, "Staff", "System" (escalation), "Reporter" (replacement) or null.
  actor: string | null;
  at: number | null;
}
export interface MaskedNote { id: string; text: string; actor: string | null; at: number | null }
export interface MaskedCaseDocument {
  id: string;
  kind: string;
  side: "reporter" | "other_party";
  risk: "low" | "medium" | "high" | "altered" | null;
  summary: string;
  review: { decision: "accepted" | "rejected" | "reupload_requested"; at: number | null } | null;
}
export interface MaskedCase { ticket: MaskedTicket; events: MaskedEvent[]; notes: MaskedNote[]; documents: MaskedCaseDocument[] }
