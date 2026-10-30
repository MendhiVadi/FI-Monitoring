import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { appCheckOption } from "../../platform/appCheck";
import { requireOfficer } from "../tickets/authorization";
import { validTicketId } from "../tickets/handlers";
import { maskedDocument, maskedEvent, maskedNote, maskedTicket, partyNames } from "./masking";

const HISTORY_LIMIT = 100;
const DOCUMENT_LIMIT = 50;

// A case as a read-only viewer may see it (viewer+): initials instead of
// names, a masked phone, redacted free text, a coarse location, staff by role
// only, and document verdicts without files, ID numbers or extracted fields.
// Officers and administrators may call it too (e.g. to preview the view).
export const getMaskedCase = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 10 }, async (request) => {
  await requireOfficer(request.auth, "viewer");
  const ticketId = validTicketId(request.data?.ticketId);
  const ref = db.collection("tickets").doc(ticketId);
  const [ticket, events, notes, documents] = await Promise.all([
    ref.get(),
    ref.collection("events").orderBy("at", "desc").limit(HISTORY_LIMIT).get(),
    ref.collection("notes").orderBy("at", "desc").limit(HISTORY_LIMIT).get(),
    // Only the fields the masked view uses ever leave Firestore.
    db.collection("caseDocuments").where("ticketId", "==", ticketId)
      .select("kind", "side", "status", "supersededBy", "screening.risk", "screening.summary", "review.decision", "review.at").limit(DOCUMENT_LIMIT).get(),
  ]);
  if (!ticket.exists) throw new HttpsError("not-found", "Ticket not found.");
  const data = ticket.data()!, names = partyNames(data);
  return {
    ticket: maskedTicket(ticket.id, data),
    // Oldest first, like the dossier; the most recent HISTORY_LIMIT entries.
    events: [...events.docs].reverse().map(entry => maskedEvent(entry.id, entry.data(), names)),
    notes: [...notes.docs].reverse().map(entry => maskedNote(entry.id, entry.data(), names)),
    // The case's current files, like ticket.documents: a copy the reporter has
    // replaced would otherwise still read "re-upload requested" to a viewer.
    documents: documents.docs.filter(entry => entry.get("status") === "attached" && !entry.get("supersededBy"))
      .map(entry => maskedDocument(entry.id, entry.data(), names)),
  };
});
