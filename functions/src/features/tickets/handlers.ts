import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { requireOfficer } from "./authorization";
import { TICKET_STATUSES, type TicketStatus } from "./status";
import { closureUpdate } from "./closure";

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
// Each note notifies the reporter, so a per-case ceiling also bounds message volume.
const MAX_NOTES_PER_TICKET = 500;
export const updateTicketStatus = onCall({ invoker: "public", maxInstances: 10 }, async (request) => {
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
    const closure = closureUpdate(before.status, status, before.closedAt, Date.now());
    const documents = closure ? (await tx.get(db.collection("caseDocuments").where("ticketId", "==", ticketId).select("ticketId").limit(50))).docs : [];
    const at = admin.firestore.FieldValue.serverTimestamp(), statusLabel = TICKET_STATUSES[status as TicketStatus];
    tx.update(ref, { status, statusLabel, revision: revision + 1, updatedAt: at, lastUpdatedBy: officer.uid,
      ...(closure ? { closedAt: closure.closedAt ?? admin.firestore.FieldValue.delete() } : {}) });
    for (const document of documents) tx.update(document.ref, { purgeAt: closure!.purgeAt });
    tx.create(eventRef, { kind: "status", before: before.status, after: status, reason, officerUid: officer.uid, at, revision: revision + 1 });
    return { ticketId, status, statusLabel, revision: revision + 1 };
  });
});
export const addTicketNote = onCall({ invoker: "public", maxInstances: 10 }, async (request) => {
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
    const revision = (Number(data.revision) || 0) + 1;
    tx.create(noteRef, { text: note, officerUid: officer.uid, at });
    tx.create(ref.collection("events").doc(requestId), { kind: "note", noteId: requestId, officerUid: officer.uid, at, revision });
    tx.update(ref, { noteCount: (Number(data.noteCount) || 0) + 1, revision, updatedAt: at, lastUpdatedBy: officer.uid });
    return { ticketId };
  });
});
