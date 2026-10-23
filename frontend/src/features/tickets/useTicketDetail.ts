import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, startAfter, type QueryDocumentSnapshot } from "firebase/firestore";
import { db } from "../../shared/firebase/firestore";
import type { Ticket } from "./types";
export interface OfficerNote { id: string; text: string; officerUid: string; at?: { seconds: number } }
// Document reviews carry type "document_review", the document's kind in kind and actorUid.
export interface CaseEvent {
  id: string; kind: string; type?: string; before?: string; after?: string; reason?: string;
  documentId?: string; decision?: string; officerUid?: string; actorUid?: string; at?: { seconds: number };
}
const NONE: never[] = [];
// Bumping attempt re-subscribes the same case after a failed load (dossier Retry).
export function useTicketDetail(id: string | null, attempt = 0) {
  const [ticket, setTicket] = useState<Ticket | null>(null), [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<OfficerNote[]>([]), [older, setOlder] = useState<OfficerNote[]>([]);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  // Refs, not state, so the print path can await several pages in a row
  // without each call closing over the previous page's cursor.
  const cursor = useRef<QueryDocumentSnapshot | null>(null), busy = useRef(false);
  const [moreNotes, setMoreNotes] = useState(false), [notesBusy, setNotesBusy] = useState(false);
  const generation = useRef(0);
  const [loadedId, setLoadedId] = useState(id);
  useEffect(() => {
    ++generation.current; setLoadedId(id); setNotesBusy(false); busy.current = false; cursor.current = null;
    setTicket(null); setError(null); setNotes([]); setOlder([]); setEvents([]); setMoreNotes(false);
    if (!id) return;
    const offTicket = onSnapshot(doc(db, "tickets", id), snapshot => {
      if (!snapshot.exists()) { setTicket(null); setError("This ticket no longer exists."); return; }
      setTicket({ ...snapshot.data(), id: snapshot.id } as Ticket);
    }, () => { setTicket(null); setError("The current case could not be loaded. Check your session and connection."); });
    const offNotes = onSnapshot(query(collection(db, "tickets", id, "notes"), orderBy("at", "desc"), limit(50)), snapshot => {
      ++generation.current; setOlder([]); setNotesBusy(false); busy.current = false;
      setNotes(snapshot.docs.map(note => ({ ...note.data(), id: note.id }) as OfficerNote));
      cursor.current = snapshot.docs.at(-1) ?? null; setMoreNotes(snapshot.size === 50);
    }, () => setError("Case notes could not be loaded."));
    const offEvents = onSnapshot(query(collection(db, "tickets", id, "events"), orderBy("at", "desc"), limit(50)), snapshot => {
      setEvents(snapshot.docs.map(event => ({ ...event.data(), id: event.id }) as CaseEvent));
    }, () => setError("Case history could not be loaded."));
    return () => { ++generation.current; offTicket(); offNotes(); offEvents(); };
  }, [id, attempt]);
  // Resolves true while older pages remain.
  const loadOlderNotes = useCallback(async (): Promise<boolean> => {
    if (!id || !cursor.current || busy.current) return false;
    const mine = generation.current;
    busy.current = true; setNotesBusy(true);
    try {
      const page = await getDocs(query(collection(db, "tickets", id, "notes"), orderBy("at", "desc"), startAfter(cursor.current), limit(50)));
      if (mine !== generation.current) return false;
      setOlder(previous => [...previous, ...page.docs.map(note => ({ ...note.data(), id: note.id }) as OfficerNote)]);
      cursor.current = page.docs.at(-1) ?? null;
      const more = page.size === 50;
      setMoreNotes(more);
      return more;
    } catch {
      if (mine === generation.current) setError("Older notes could not be loaded.");
      return false;
    } finally { if (mine === generation.current) { busy.current = false; setNotesBusy(false); } }
  }, [id]);
  // The dossier re-renders on every keystroke in its note/reason inputs; only
  // rebuild the deduplicated list (up to 50 per page) when a page changes.
  const merged = useMemo(() => [...new Map([...notes, ...older].map(note => [note.id, note])).values()], [notes, older]);
  return { ticket: ticket?.id === id ? ticket : null, error, events: loadedId === id ? events : NONE, notes: loadedId !== id ? NONE : merged, moreNotes, notesBusy, loadOlderNotes };
}
