import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, startAfter, type QueryDocumentSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db } from "../../shared/firebase/firestore";
import { functions } from "../../shared/firebase/functions";
import type { MaskedCase, MaskedCaseDocument, MaskedTicket, StaffIdentity, Ticket, TicketEvent } from "./types";

// Staff writes since wave 2 carry the author's email, display name (or null)
// and role label; older entries have only officerUid (vault/Wave-2-Spec.md §1).
// A masked (viewer) copy names the author by role label only (`actor`).
export type StaffStamp = StaffIdentity & { actor?: string | null };
export interface OfficerNote extends StaffStamp { id: string; text: string; at?: { seconds: number } }
// A masked assignment event says only whether someone was assigned, and their initials.
export interface CaseEvent extends TicketEvent { actor?: string | null; assigned?: boolean }

// Firestore timestamps cross a callable as { _seconds } (Admin SDK JSON) or as
// milliseconds; the dossier reads { seconds } like a live snapshot.
export function toWireTime(value: unknown): { seconds: number } | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return { seconds: Math.floor(value / 1000) };
  if (value && typeof value === "object") {
    const time = value as { seconds?: unknown; _seconds?: unknown };
    const seconds = typeof time.seconds === "number" ? time.seconds : time._seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) return { seconds };
  }
  return undefined;
}

// getMaskedCase (viewer+): names as initials, phone and contact details masked,
// location rounded, no files. Only the shape differs from a live ticket.
// Created once, with the same bounded wait as the registry.
const requestMaskedCase = httpsCallable<{ ticketId: string }, MaskedCase>(functions, "getMaskedCase", { timeout: 30_000 });

function fromMaskedTicket(raw: MaskedTicket): Ticket {
  const { phone, reporterName, otherPartyName, createdAt, updatedAt, dispute, documents, ...rest } = raw;
  return {
    ...rest,
    waFrom: phone ?? undefined, documents: documents ?? undefined,
    createdAt: toWireTime(createdAt), updatedAt: toWireTime(updatedAt),
    dispute: dispute && { ...dispute, location: dispute.location ?? undefined, reporterName, otherPartyName },
  };
}
const fromMaskedEntries = <T,>(entries: { id?: unknown; at?: unknown }[] | undefined, prefix: string) =>
  (entries ?? []).map((entry, index) => ({ ...entry, id: typeof entry.id === "string" ? entry.id : `${prefix}-${index}`, at: toWireTime(entry.at) }) as T);

const NONE: never[] = [];
// Bumping attempt re-subscribes (or, masked, re-fetches) the same case after a
// failed load (dossier Retry). `masked` is the viewer path: a one-off
// getMaskedCase read instead of live Firestore listeners viewers cannot open.
export function useTicketDetail(id: string | null, attempt = 0, masked = false) {
  const [ticket, setTicket] = useState<Ticket | null>(null), [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<OfficerNote[]>([]), [older, setOlder] = useState<OfficerNote[]>([]);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [maskedDocuments, setMaskedDocuments] = useState<MaskedCaseDocument[]>([]);
  // Refs, not state, so the print path can await several pages in a row
  // without each call closing over the previous page's cursor.
  const cursor = useRef<QueryDocumentSnapshot | null>(null), busy = useRef(false);
  const [moreNotes, setMoreNotes] = useState(false), [notesBusy, setNotesBusy] = useState(false);
  // Bumped when a fresh first page of notes replaces the list, so an older page
  // still in flight is dropped. `subscription` is retired when the case closes.
  const generation = useRef(0), subscription = useRef<{ live: boolean } | null>(null);
  // Opening another case (or retrying) clears the previous one while rendering,
  // so its notes and history never show under the new case for a frame.
  const key = `${id}:${attempt}:${masked}`;
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) {
    setLoadedKey(key); setNotesBusy(false);
    setTicket(null); setError(null); setNotes([]); setOlder([]); setEvents([]); setMaskedDocuments([]); setMoreNotes(false);
  }
  useEffect(() => {
    busy.current = false; cursor.current = null;
    if (!id || masked) return;
    const mine = { live: true };
    subscription.current = mine;
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
    return () => { mine.live = false; offTicket(); offNotes(); offEvents(); };
  }, [id, attempt, masked]);
  useEffect(() => {
    if (!id || !masked) return;
    const mine = { live: true };
    requestMaskedCase({ ticketId: id }).then(({ data }) => {
      if (!mine.live) return;
      setTicket({ ...fromMaskedTicket(data.ticket), id: data.ticket.id || id });
      setEvents(fromMaskedEntries<CaseEvent>(data.events, "event"));
      setNotes(fromMaskedEntries<OfficerNote>(data.notes, "note"));
      setMaskedDocuments(data.documents ?? []);
    }, err => {
      if (!mine.live) return;
      setError((err as { code?: string })?.code === "functions/not-found"
        ? "This ticket no longer exists." : "The current case could not be loaded. Check your session and connection.");
    });
    return () => { mine.live = false; };
  }, [id, attempt, masked]);
  // Resolves true while older pages remain.
  const loadOlderNotes = useCallback(async (): Promise<boolean> => {
    const live = subscription.current;
    if (!id || masked || !cursor.current || busy.current || !live?.live) return false;
    const mine = generation.current;
    const current = () => live.live && mine === generation.current;
    busy.current = true; setNotesBusy(true);
    try {
      const page = await getDocs(query(collection(db, "tickets", id, "notes"), orderBy("at", "desc"), startAfter(cursor.current), limit(50)));
      if (!current()) return false;
      setOlder(previous => [...previous, ...page.docs.map(note => ({ ...note.data(), id: note.id }) as OfficerNote)]);
      cursor.current = page.docs.at(-1) ?? null;
      const more = page.size === 50;
      setMoreNotes(more);
      return more;
    } catch {
      if (current()) setError("Older notes could not be loaded.");
      return false;
    } finally { if (current()) { busy.current = false; setNotesBusy(false); } }
  }, [id, masked]);
  // The dossier re-renders on every keystroke in its note/reason inputs; only
  // rebuild the deduplicated list (up to 50 per page) when a page changes.
  const merged = useMemo(() => [...new Map([...notes, ...older].map(note => [note.id, note])).values()], [notes, older]);
  return { ticket: ticket?.id === id ? ticket : null, error, events: loadedKey === key ? events : NONE, notes: loadedKey !== key ? NONE : merged,
    moreNotes, notesBusy, loadOlderNotes, maskedDocuments: masked ? maskedDocuments : null };
}
