import { httpsCallable } from "firebase/functions";
import { doc, getDocFromServer } from "firebase/firestore";
import { auth } from "../../shared/firebase/firebase";
import { db } from "../../shared/firebase/firestore";
import { functions } from "../../shared/firebase/functions";
import type { DocumentReview, FileVariant, ReviewDecision } from "../tickets/caseDocuments";

// Created once, with the same bounded wait as the status and note saves.
const getFile = httpsCallable<{ documentId: string; variant: FileVariant }, { contentType: string; dataBase64: string }>(
  functions, "getCaseDocumentFile", { timeout: 30_000 });
const review = httpsCallable<{ documentId: string; decision: ReviewDecision; reason: string; requestId: string }, { review: DocumentReview }>(
  functions, "reviewCaseDocument", { timeout: 30_000 });

// Blob URLs share this page's origin, so only types the upload screen accepts
// (plus the server's own PNG/JPEG derivatives) may become one; anything else
// could render as active content inside the portal.
const RENDERABLE = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export async function fetchDocumentFile(documentId: string, variant: FileVariant): Promise<{ url: string; contentType: string }> {
  const { data } = await getFile({ documentId, variant });
  const contentType = data.contentType.split(";")[0].trim().toLowerCase();
  if (!RENDERABLE.has(contentType)) throw new Error("unsupported-type");
  const binary = atob(data.dataBase64), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return { url: URL.createObjectURL(new Blob([bytes], { type: contentType })), contentType };
}

export async function submitDocumentReview(documentId: string, decision: ReviewDecision, reason: string, requestId: string) {
  await review({ documentId, decision, reason, requestId });
}

// A timed-out call may still have committed. Its case-history event (keyed by
// the request ID, like status and note saves) is the receipt; matching the
// stored review instead would report a resent identical review as saved.
export async function reviewWasSaved(ticketId: string | null, documentId: string, requestId: string): Promise<boolean> {
  if (!ticketId) return false;
  try {
    const receipt = (await getDocFromServer(doc(db, "tickets", ticketId, "events", requestId))).data();
    return Boolean(receipt && receipt.type === "document_review" && receipt.documentId === documentId && receipt.actorUid === auth.currentUser?.uid);
  } catch { return false; }
}
