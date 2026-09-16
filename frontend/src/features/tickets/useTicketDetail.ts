import { useEffect, useRef, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, startAfter, type QueryDocumentSnapshot } from "firebase/firestore";
import { db } from "../../shared/firebase/firestore";
import type { Ticket } from "./types";
export interface OfficerNote { id: string; text: string; officerUid: string; at?: { seconds: number } }
export interface CaseEvent { id: string; kind: string; before?: string; after?: string; reason?: string; officerUid: string; at?: { seconds: number } }
export function useTicketDetail(id: string | null) {
  const [ticket, setTicket] = useState<Ticket | null>(null), [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<OfficerNote[]>([]), [older, setOlder] = useState<OfficerNote[]>([]);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [moreNotes, setMoreNotes] = useState(false), [notesBusy, setNotesBusy] = useState(false);
  const generation = useRef(0);
  const [loadedId, setLoadedId] = useState(id);
  useEffect(() => {
    ++generation.current; setLoadedId(id); setNotesBusy(false);
    setTicket(null); setError(null); setNotes([]); setOlder([]); setEvents([]); setCursor(null); setMoreNotes(false);
    if (!id) return;
    const offTicket = onSnapshot(doc(db, "tickets", id), snapshot => {
      if (!snapshot.exists()) { setTicket(null); setError("This ticket no longer exists."); return; }
      setTicket({ ...snapshot.data(), id: snapshot.id } as Ticket);
    }, () => { setTicket(null); setError("The current case could not be loaded. Check your session and connection."); });
    const offNotes = onSnapshot(query(collection(db, "tickets", id, "notes"), orderBy("at", "desc"), limit(50)), snapshot => {
      ++generation.current; setOlder([]); setNotesBusy(false);
      setNotes(snapshot.docs.map(note => ({ ...note.data(), id: note.id }) as OfficerNote));
      setCursor(snapshot.docs.at(-1) ?? null); setMoreNotes(snapshot.size === 50);
    }, () => setError("Case notes could not be loaded."));
    const offEvents = onSnapshot(query(collection(db, "tickets", id, "events"), orderBy("at", "desc"), limit(50)), snapshot => {
      setEvents(snapshot.docs.map(event => ({ ...event.data(), id: event.id }) as CaseEvent));
    }, () => setError("Case history could not be loaded."));
    return () => { ++generation.current; offTicket(); offNotes(); offEvents(); };
  }, [id]);
  async function loadOlderNotes() {
    if (!id || !cursor || notesBusy) return;
    const mine = generation.current;
    setNotesBusy(true);
    try {
      const page = await getDocs(query(collection(db, "tickets", id, "notes"), orderBy("at", "desc"), startAfter(cursor), limit(50)));
      if (mine !== generation.current) return;
      setOlder(previous => [...previous, ...page.docs.map(note => ({ ...note.data(), id: note.id }) as OfficerNote)]);
      setCursor(page.docs.at(-1) ?? null); setMoreNotes(page.size === 50);
    } catch { if (mine === generation.current) setError("Older notes could not be loaded."); }
    finally { if (mine === generation.current) setNotesBusy(false); }
  }
  return { ticket: ticket?.id === id ? ticket : null, error, events: loadedId === id ? events : [], notes: loadedId !== id ? [] : [...new Map([...notes, ...older].map(note => [note.id, note])).values()], moreNotes, notesBusy, loadOlderNotes };
}
