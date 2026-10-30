import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { appCheckOption } from "../../platform/appCheck";
import { requireOfficer, staffStamp, normalizeAccess, hasAccess, type StaffIdentity } from "./authorization";
import { validStaffUid } from "./access";
import { TICKET_STATUSES, type TicketStatus } from "./status";
import { closureUpdate } from "./closure";
import { computeOverdue, firstActionPatch, overdueTransition } from "../cases/targets";

export function validTicketId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new HttpsError("invalid-argument", "A valid ticket reference is required.");
  }
  return value;
}
function mutationId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{20,80}$/.test(value)) {
    throw new HttpsError("invalid-argument", "A unique change reference is required.");
  }
  return value;
}

// The staff-action side effects every handler applies in its own transaction:
// the first action acknowledges the case, and a change that moves the overdue
// state (closing, reopening, acknowledging) records it straight away with the
// officer's identity instead of waiting for the hourly escalation job.
function staffActionEffects(tx: admin.firestore.Transaction, ref: admin.firestore.DocumentReference,
  before: admin.firestore.DocumentData, patch: Record<string, unknown>, officer: StaffIdentity, now: number) {
  const first = firstActionPatch(before, now);
  const transition = overdueTransition(before.overdue, computeOverdue({ ...before, ...patch, ...first }, now), now);
  if (transition) {
    tx.create(ref.collection("events").doc(), { type: "escalation", overdue: transition.overdue, ...staffStamp(officer),
      at: admin.firestore.FieldValue.serverTimestamp() });
  }
  return { ...first, ...(transition ?? {}) };
}

// Each note notifies the reporter, so a per-case ceiling also bounds message volume.
const MAX_NOTES_PER_TICKET = 500;
export const updateTicketStatus = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 10 }, async (request) => {
  const officer = await requireOfficer(request.auth);
  const ticketId = validTicketId(request.data?.ticketId), requestId = mutationId(request.data?.requestId);
  const status = request.data?.status;
  const reason = typeof request.data?.reason === "string" ? request.data.reason.trim() : "";
  const expectedRevision = request.data?.expectedRevision;
  if (typeof status !== "string" || !Object.prototype.hasOwnProperty.call(TICKET_STATUSES, status) ||
      !Number.isInteger(expectedRevision) || expectedRevision < 0 || reason.length < 3 || reason.length > 1500) {
    throw new HttpsError("invalid-argument", "Choose a status and give a reason (3–1,500 characters).");
  }
  const ref = db.collection("tickets").doc(ticketId), eventRef = ref.collection("events").doc(requestId);
  return db.runTransaction(async (tx) => {
    const [ticket, event] = await Promise.all([tx.get(ref), tx.get(eventRef)]);
    if (!ticket.exists) throw new HttpsError("not-found", "Ticket not found.");
    if (event.exists) {
      if (event.data()!.officerUid !== officer.uid) throw new HttpsError("already-exists", "Change reference is already used.");
      return { ticketId, status: ticket.data()!.status, revision: ticket.data()!.revision ?? 0 };
    }
    const before = ticket.data()!, revision = Number(before.revision) || 0;
    if (revision !== expectedRevision) throw new HttpsError("aborted", "Another officer updated this case. Review the latest details before saving.");
    if (before.status === status) return { ticketId, status, revision };
    // Closing or reopening moves the document retention clock in the same
    // commit, so a reopened case can never lose its files to the purge.
    const now = Date.now();
    const closure = closureUpdate(before.status, status, before.closedAt, now);
    const documents = closure ? (await tx.get(db.collection("caseDocuments").where("ticketId", "==", ticketId).select("ticketId").limit(50))).docs : [];
    const at = admin.firestore.FieldValue.serverTimestamp(), statusLabel = TICKET_STATUSES[status as TicketStatus];
    const effects = staffActionEffects(tx, ref, before, { status }, officer, now);
    tx.update(ref, { status, statusLabel, revision: revision + 1, updatedAt: at, lastUpdatedBy: officer.uid, ...effects,
      ...(closure ? { closedAt: closure.closedAt ?? admin.firestore.FieldValue.delete() } : {}) });
    for (const document of documents) tx.update(document.ref, { purgeAt: closure!.purgeAt });
    tx.create(eventRef, { kind: "status", before: before.status, after: status, reason, ...staffStamp(officer), at, revision: revision + 1 });
    return { ticketId, status, statusLabel, revision: revision + 1 };
  });
});
export const addTicketNote = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 10 }, async (request) => {
  const officer = await requireOfficer(request.auth);
  const ticketId = validTicketId(request.data?.ticketId), requestId = mutationId(request.data?.requestId);
  const note = typeof request.data?.note === "string" ? request.data.note.trim() : "";
  if (!note || note.length > 1500) throw new HttpsError("invalid-argument", "Enter a note of 1–1,500 characters.");
  const ref = db.collection("tickets").doc(ticketId), noteRef = ref.collection("notes").doc(requestId);
  return db.runTransaction(async (tx) => {
    const [ticket, existing] = await Promise.all([tx.get(ref), tx.get(noteRef)]);
    if (!ticket.exists) throw new HttpsError("not-found", "Ticket not found.");
    if (existing.exists) {
      if (existing.data()!.officerUid !== officer.uid) throw new HttpsError("already-exists", "Change reference is already used.");
      return { ticketId };
    }
    const at = admin.firestore.FieldValue.serverTimestamp(), data = ticket.data()!;
    if ((Number(data.noteCount) || 0) >= MAX_NOTES_PER_TICKET) {
      throw new HttpsError("resource-exhausted", "This case has reached its note limit. Record further detail in a status change.");
    }
    const revision = (Number(data.revision) || 0) + 1, stamp = staffStamp(officer);
    const effects = staffActionEffects(tx, ref, data, {}, officer, Date.now());
    tx.create(noteRef, { text: note, ...stamp, at });
    tx.create(ref.collection("events").doc(requestId), { kind: "note", noteId: requestId, ...stamp, at, revision });
    tx.update(ref, { noteCount: (Number(data.noteCount) || 0) + 1, revision, updatedAt: at, lastUpdatedBy: officer.uid, ...effects });
    return { ticketId };
  });
});

export interface AssignInput { ticketId: string; assigneeUid: string | null; reason: string; expectedRevision: number; requestId: string }
export function validateAssignInput(data: unknown): AssignInput {
  const r = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const ticketId = validTicketId(r.ticketId), requestId = mutationId(r.requestId);
  const assigneeUid = r.assigneeUid ?? null;
  if (assigneeUid !== null && !validStaffUid(assigneeUid)) throw new HttpsError("invalid-argument", "Choose a staff member, or nobody.");
  const reason = r.reason === undefined || r.reason === null ? "" : typeof r.reason === "string" ? r.reason.trim() : null;
  if (reason === null || reason.length > 300) throw new HttpsError("invalid-argument", "Keep the assignment reason to 300 characters.");
  const expectedRevision = r.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new HttpsError("invalid-argument", "A case revision is required.");
  }
  return { ticketId, assigneeUid, reason, expectedRevision, requestId };
}
// An officer may take a case or hand back their own; an administrator may
// assign anyone (or nobody).
export function assignmentAllowed(officer: { uid: string; access: string }, currentAssignee: unknown, assigneeUid: string | null): boolean {
  if (officer.access === "admin") return true;
  if (officer.access !== "officer") return false;
  return assigneeUid === officer.uid || (assigneeUid === null && currentAssignee === officer.uid);
}
export const assignTicket = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 10 }, async (request) => {
  const officer = await requireOfficer(request.auth);
  const input = validateAssignInput(request.data);
  const ref = db.collection("tickets").doc(input.ticketId), eventRef = ref.collection("events").doc(input.requestId);
  const assigneeRef = input.assigneeUid ? db.collection("officers").doc(input.assigneeUid) : null;
  return db.runTransaction(async (tx) => {
    const [ticket, event, assignee] = await tx.getAll(ref, eventRef, ...(assigneeRef ? [assigneeRef] : []));
    if (!ticket.exists) throw new HttpsError("not-found", "Ticket not found.");
    const before = ticket.data()!, revision = Number(before.revision) || 0;
    if (event.exists) {
      const previous = event.data()!;
      if (previous.officerUid !== officer.uid || previous.type !== "assignment") throw new HttpsError("already-exists", "Change reference is already used.");
      return { revision };
    }
    if (revision !== input.expectedRevision) throw new HttpsError("aborted", "Another officer updated this case. Review the latest details before saving.");
    const current = typeof before.assignedTo === "string" ? before.assignedTo : null;
    if (!assignmentAllowed(officer, current, input.assigneeUid)) {
      throw new HttpsError("permission-denied", "Officers can assign a case to themselves or hand back their own; ask an administrator to assign others.");
    }
    if (current === input.assigneeUid) return { revision };
    let toEmail: string | null = null, toName: string | null = null;
    if (assignee) {
      // Read-only viewers cannot work a case, so they cannot be assigned one.
      if (!assignee.exists || !hasAccess(normalizeAccess(assignee.get("access")), "officer")) {
        throw new HttpsError("failed-precondition", "Choose a staff member with officer or administrator access.");
      }
      const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
      toEmail = text(assignee.get("email")) ?? (assignee.id === officer.uid ? officer.email || null : null);
      toName = text(assignee.get("displayName"));
    }
    const now = Date.now(), at = admin.firestore.FieldValue.serverTimestamp();
    const assignment = { assignedTo: input.assigneeUid, assignedEmail: toEmail, assignedName: toName, assignedAt: input.assigneeUid ? now : null };
    const effects = staffActionEffects(tx, ref, before, assignment, officer, now);
    tx.update(ref, { ...assignment, revision: revision + 1, updatedAt: at, lastUpdatedBy: officer.uid, ...effects });
    tx.create(eventRef, { type: "assignment", from: current, to: input.assigneeUid, toEmail, toName, reason: input.reason || null,
      ...staffStamp(officer), at, revision: revision + 1 });
    return { revision: revision + 1 };
  });
});
