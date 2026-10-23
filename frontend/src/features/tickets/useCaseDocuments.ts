import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../shared/firebase/firestore";
import { sortDocuments, type CaseDocument } from "./caseDocuments";

// The rules reject officer list queries above 100; a case holds at most 12.
const PAGE = 50;

// Live, like the dossier itself, so a finished screening or another officer's
// review appears without a refresh. Pass null for cases filed before uploads.
export function useCaseDocuments(ticketId: string | null, attempt = 0) {
  const [state, setState] = useState<{ key: string | null; documents: CaseDocument[]; loaded: boolean; error: string | null }>(
    { key: null, documents: [], loaded: false, error: null });
  const key = ticketId ? `${ticketId}:${attempt}` : null;
  useEffect(() => {
    if (!ticketId) return;
    const mine = `${ticketId}:${attempt}`;
    return onSnapshot(query(collection(db, "caseDocuments"), where("ticketId", "==", ticketId), limit(PAGE)), snapshot => {
      const documents = sortDocuments(snapshot.docs.map(document => ({ ...document.data(), id: document.id }) as CaseDocument));
      setState({ key: mine, documents, loaded: true, error: null });
    }, () => setState({ key: mine, documents: [], loaded: true, error: "Uploaded documents could not be loaded. Check your session and connection." }));
  }, [ticketId, attempt]);
  // A previous case's (or attempt's) result never shows under the current one.
  const current = state.key === key ? state : { documents: [], loaded: false, error: null };
  return { documents: current.documents, loading: Boolean(ticketId) && !current.loaded, error: current.error };
}
