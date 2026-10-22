import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "../../shared/firebase/firestore";
import { auth } from "../../shared/firebase/firebase";
import { functions } from "../../shared/firebase/functions";
import contract from "../../shared/contracts/dispute.json";
import { signOutStaff, useStaffSession } from "../auth/staffSession";
import { useLiveTickets } from "../tickets/useLiveTickets";
import { useTicketDetail } from "../tickets/useTicketDetail";
import type { Ticket } from "../tickets/types";
import { evaluateTicket } from "../tickets/ticketDecisionTree";
import { isKnownStatus, statusLabel } from "../tickets/ticketStatus";
import { describeSaveError } from "./presentation";

// Bounded waits: a timed-out save is reconciled against its event receipt below
// and keeps its request ID, so a retry stays idempotent.
const callables = {
  status: httpsCallable(functions, "updateTicketStatus", { timeout: 30_000 }),
  note: httpsCallable(functions, "addTicketNote", { timeout: 30_000 }),
};
export const MAX_NOTE_LENGTH = 1500; // mirrors addTicketNote / updateTicketStatus
export type SaveKind = "status" | "note";
export interface SaveError { kind: SaveKind; message: string; retryable: boolean }
export interface Notice { id: number; message: string }

// crypto.randomUUID only exists in secure contexts; a plain-http LAN demo still
// has getRandomValues. 32 hex chars satisfy the server's 20–80 character check.
function newRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

const NOT_RETRYABLE = new Set(["functions/unauthenticated", "functions/permission-denied", "functions/invalid-argument",
  "functions/not-found", "functions/resource-exhausted"]);
const DISPUTE_TYPES: readonly string[] = contract.disputeTypes;
const readStatus = (value: string | null) => value && isKnownStatus(value) ? value : "all";
const readDispute = (value: string | null) => value && DISPUTE_TYPES.includes(value) ? value : "all";

export function useOfficerPortal() {
  const { email: officerEmail } = useStaffSession();
  // Filters and search live in the URL too, so refresh and Back keep them.
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(() => readStatus(params.get("status")));
  const [disputeFilter, setDisputeFilter] = useState(() => readDispute(params.get("category")));
  const [searchQuery, setSearchQuery] = useState(() => (params.get("q") ?? "").slice(0, 120));
  // Debounced: Safari throws a SecurityError after about 100 replaceState calls
  // in 10 s (holding Backspace in the search box gets there), and react-router
  // does not catch it on replace.
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = new URLSearchParams(window.location.search), next = new URLSearchParams(current);
      const apply = (key: string, value: string, empty: string) => { if (value && value !== empty) next.set(key, value); else next.delete(key); };
      apply("status", statusFilter, "all"); apply("category", disputeFilter, "all"); apply("q", searchQuery.trim(), "");
      if (next.toString() !== current.toString()) setParams(next, { replace: true });
    }, 400);
    return () => clearTimeout(timer);
  }, [statusFilter, disputeFilter, searchQuery, setParams]);
  const filtersActive = statusFilter !== "all" || disputeFilter !== "all" || searchQuery.trim() !== "";
  const clearFilters = useCallback(() => { setStatusFilter("all"); setDisputeFilter("all"); setSearchQuery(""); }, []);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, SaveError | null>>({});
  const [savingKinds, setSavingKinds] = useState<Record<string, SaveKind | null>>({});
  const setSaveError = (kind: SaveKind, message: string) => { if (selectedId) setSaveErrors(previous => ({ ...previous, [selectedId]: { kind, message, retryable: false } })); };
  const clearSaveError = () => { if (selectedId) setSaveErrors(previous => ({ ...previous, [selectedId]: null })); };
  const pending = useRef(new Set<string>());
  const requests = useRef(new Map<string, { id: string; body: string }>());
  const registry = useLiveTickets(Boolean(officerEmail), searchQuery, statusFilter, disputeFilter);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const detail = useTicketDetail(officerEmail ? selectedId : null, detailAttempt), selectedTicket = detail.ticket;
  const retryDetail = useCallback(() => setDetailAttempt(n => n + 1), []);

  // Short confirmations for completed saves, announced politely. The portal
  // renders the region inside the open dialog, since the page behind it is inert.
  const [notice, setNotice] = useState<Notice | null>(null);
  const showNotice = useCallback((message: string) => setNotice({ id: Date.now(), message }), []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(current => current?.id === notice.id ? null : current), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const [now, setNow] = useState(() => new Date());
  // Ticket age only feeds the open dossier's triage, so do not re-render the
  // whole registry every minute while no dossier is open.
  useEffect(() => {
    if (!selectedId) return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [selectedId]);
  // Stable identity so memoised registry cards do not all re-render per keystroke.
  const selectedRef = useRef<string | null>(null);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  const setSelectedTicket = useCallback((ticket: Ticket | null) => {
    const previous = selectedRef.current;
    if (previous) setSaveErrors(errors => ({ ...errors, [previous]: null }));
    selectedRef.current = ticket?.id ?? null;
    if (ticket) setNow(new Date()); // the minute timer is paused while closed
    setSelectedId(ticket?.id ?? null);
  }, []);
  const setNewOfficerNote = (text: string) => { if (selectedId) setDrafts(previous => ({ ...previous, [selectedId]: text })); };
  const setStatusReason = (text: string) => { if (selectedId) setReasons(previous => ({ ...previous, [selectedId]: text })); };

  async function mutate(ticketId: string, kind: SaveKind, body: Record<string, unknown>, onSaved: () => void) {
    if (pending.current.has(ticketId)) return;
    pending.current.add(ticketId);
    setSavingKinds(previous => ({ ...previous, [ticketId]: kind }));
    setSaveErrors(previous => ({ ...previous, [ticketId]: null }));
    const key = ticketId + ":" + kind, serialized = JSON.stringify(body);
    let request: { id: string; body: string } | undefined;
    try {
      request = requests.current.get(key);
      if (!request || request.body !== serialized) { request = { id: newRequestId(), body: serialized }; requests.current.set(key, request); }
      await callables[kind]({ ticketId, requestId: request.id, ...body });
      requests.current.delete(key); onSaved();
    } catch (err) {
      // The server may have committed before the response was lost. Reconcile
      // with its immutable event before presenting a retry as a failed write.
      if (request) {
        try {
          const receipt = await getDocFromServer(doc(db, "tickets", ticketId, "events", request.id));
          if (receipt.exists() && receipt.data().officerUid === auth.currentUser?.uid && receipt.data().kind === kind) {
            requests.current.delete(key); onSaved(); return;
          }
        } catch { /* Keep the request ID for an idempotent retry while offline. */ }
      }
      const code = (err as { code?: string })?.code;
      if (code === "functions/aborted") requests.current.delete(key);
      // Offer Retry only where resending the same change could succeed.
      const retryable = !NOT_RETRYABLE.has(code ?? "");
      setSaveErrors(previous => ({ ...previous, [ticketId]: { kind, message: describeSaveError(err), retryable } }));
    } finally {
      pending.current.delete(ticketId);
      setSavingKinds(previous => ({ ...previous, [ticketId]: null }));
    }
  }
  async function handleUpdateStatus(ticketId: string, nextStatus: string) {
    if (!selectedTicket || selectedTicket.id !== ticketId || selectedTicket.status === nextStatus) return;
    const reason = (reasons[ticketId] || "").trim();
    if (reason.length < 3) { setSaveError("status", "Enter a short reason (at least 3 characters) before changing the status."); return; }
    if (reason.length > MAX_NOTE_LENGTH) { setSaveError("status", "Keep the reason under 1,500 characters."); return; }
    const notifies = selectedTicket.whatsappUpdates === true && selectedTicket.phoneVerified === true;
    const filter = statusFilter;
    await mutate(ticketId, "status", { status: nextStatus, reason, expectedRevision: selectedTicket.revision ?? 0 }, () => {
      // A reason belongs to one change; never carry it silently into the next.
      setReasons(previous => previous[ticketId]?.trim() === reason ? { ...previous, [ticketId]: "" } : previous);
      registry.patchTicket(ticketId, { status: nextStatus, updatedAt: { seconds: Math.floor(Date.now() / 1000) } });
      void registry.refreshStats();
      const label = statusLabel(nextStatus);
      showNotice(filter !== "all" && filter !== nextStatus
        ? `Case moved to "${label}"; it is hidden by the current status filter.`
        : `Status changed to "${label}"` + (notifies ? " · a WhatsApp update will be sent to the reporter." : "."));
    });
  }
  async function handleAddNote(ticketId: string) {
    const note = (drafts[ticketId] || "").trim();
    if (!note || note.length > MAX_NOTE_LENGTH) { setSaveError("note", "Enter a note of 1–1,500 characters."); return; }
    await mutate(ticketId, "note", { note }, () => {
      setDrafts(previous => previous[ticketId]?.trim() === note ? { ...previous, [ticketId]: "" } : previous);
      showNotice("Note added to case history.");
    });
  }
  const selectedDecision = useMemo(() => selectedTicket ? evaluateTicket(selectedTicket, now) : null, [selectedTicket, now]);
  const unsavedCases = useMemo(() => new Set([...Object.entries(drafts), ...Object.entries(reasons)]
    .filter(([, text]) => text.trim()).map(([id]) => id)).size, [drafts, reasons]);
  // Drafts live only in this page's memory, so leaving the portal discards them too.
  const confirmDiscard = (action: string) => unsavedCases === 0 ||
    window.confirm(`You have unsaved text on ${unsavedCases} case${unsavedCases === 1 ? "" : "s"}. ${action} anyway?`);
  const confirmLeave = () => confirmDiscard("Leave the portal");
  const handleLogout = async () => {
    if (!confirmDiscard("Sign out")) return;
    selectedRef.current = null; setSelectedId(null); setDrafts({}); setReasons({}); setSaveErrors({}); requests.current.clear();
    await signOutStaff();
  };
  // The server filter already applied; re-check status locally so a case edited
  // out of the active filter (patched in place) leaves the list straight away.
  const visibleTickets = useMemo(() => statusFilter === "all" ? registry.tickets
    : registry.tickets.filter(ticket => ticket.status === statusFilter), [registry.tickets, statusFilter]);
  const savingKind = selectedId ? savingKinds[selectedId] ?? null : null;
  return { tickets: visibleTickets, filteredTickets: visibleTickets, ticketsLoading: registry.loading,
    ticketsError: registry.error, ticketsErrorCode: registry.errorCode, isStale: registry.isStale,
    lastLoadedAt: registry.lastLoadedAt, searchedBack: registry.searchedBack, detailError: detail.error, retryDetail, selectedId,
    stats: registry.stats, hasMore: registry.hasMore, loadMore: registry.loadMore, refresh: registry.refresh,
    officerEmail, currentUid: auth.currentUser?.uid, selectedTicket, setSelectedTicket,
    statusFilter, setStatusFilter, disputeFilter, setDisputeFilter, searchQuery, setSearchQuery, filtersActive, clearFilters,
    newOfficerNote: selectedId ? drafts[selectedId] || "" : "", setNewOfficerNote,
    statusReason: selectedId ? reasons[selectedId] || "" : "", setStatusReason,
    saveError: selectedId ? saveErrors[selectedId] ?? null : null, clearSaveError, savingKind, saving: savingKind !== null,
    handleLogout, confirmLeave, handleUpdateStatus, handleAddNote, selectedDecision, notice, showNotice, dismissNotice,
    events: detail.events, notes: detail.notes, moreNotes: detail.moreNotes, notesBusy: detail.notesBusy, loadOlderNotes: detail.loadOlderNotes };
}
