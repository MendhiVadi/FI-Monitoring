import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "../../shared/firebase/firestore";
import { auth } from "../../shared/firebase/firebase";
import { functions } from "../../shared/firebase/functions";
import { signOutStaff, useStaffSession } from "../auth/staffSession";
import { useLiveTickets } from "../tickets/useLiveTickets";
import { useTicketDetail } from "../tickets/useTicketDetail";
import type { Ticket } from "../tickets/types";
import { evaluateTicket } from "../tickets/ticketDecisionTree";

export function useOfficerPortal() {
  const { email: officerEmail } = useStaffSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all"), [disputeFilter, setDisputeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string | null>>({});
  const setSaveError = (error: string | null) => { if (selectedId) setSaveErrors(previous => ({ ...previous, [selectedId]: error })); };
  const [saving, setSaving] = useState(false);
  const pending = useRef(new Set<string>());
  const requests = useRef(new Map<string, { id: string; body: string }>());
  const registry = useLiveTickets(Boolean(officerEmail), searchQuery, statusFilter, disputeFilter);
  const detail = useTicketDetail(officerEmail ? selectedId : null), selectedTicket = detail.ticket;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const setSelectedTicket = (ticket: Ticket | null) => { setSelectedId(ticket?.id ?? null); setSaveError(null); };
  const setNewOfficerNote = (text: string) => { if (selectedId) setDrafts(previous => ({ ...previous, [selectedId]: text })); };
  const setStatusReason = (text: string) => { if (selectedId) setReasons(previous => ({ ...previous, [selectedId]: text })); };
  async function mutate(ticketId: string, kind: "status" | "note", body: Record<string, unknown>, onSaved?: () => void) {
    if (pending.current.has(ticketId)) return;
    const key = ticketId + ":" + kind, serialized = JSON.stringify(body);
    let request = requests.current.get(key);
    if (!request || request.body !== serialized) { request = { id: crypto.randomUUID(), body: serialized }; requests.current.set(key, request); }
    pending.current.add(ticketId); setSaving(true); setSaveErrors(previous => ({ ...previous, [ticketId]: null }));
    try {
      await httpsCallable(functions, kind === "status" ? "updateTicketStatus" : "addTicketNote")({ ticketId, requestId: request.id, ...body });
      requests.current.delete(key); onSaved?.(); await registry.refresh();
    } catch (err) {
      // The server may have committed before the response was lost. Reconcile
      // with its immutable event before presenting a retry as a failed write.
      try {
        const receipt = await getDocFromServer(doc(db, "tickets", ticketId, "events", request.id));
        if (receipt.exists() && receipt.data().officerUid === auth.currentUser?.uid && receipt.data().kind === kind) {
          requests.current.delete(key); onSaved?.(); await registry.refresh(); return;
        }
      } catch { /* Keep the request ID for an idempotent retry while offline. */ }
      const code = (err as { code?: string })?.code;
      if (code === "functions/aborted") requests.current.delete(key);
      setSaveErrors(previous => ({ ...previous, [ticketId]: err instanceof Error ? err.message : "The save could not be confirmed. Retry this change." }));
    } finally { pending.current.delete(ticketId); setSaving(pending.current.size > 0); }
  }
  async function handleUpdateStatus(ticketId: string, nextStatus: string) {
    if (!selectedTicket || selectedTicket.id !== ticketId || selectedTicket.status === nextStatus) return;
    const reason = (reasons[ticketId] || "").trim();
    if (reason.length < 3) { setSaveError("Enter a short reason before changing the status."); return; }
    await mutate(ticketId, "status", { status: nextStatus, reason, expectedRevision: selectedTicket.revision ?? 0 });
  }
  async function handleAddNote(ticketId: string) {
    const note = (drafts[ticketId] || "").trim();
    if (!note || note.length > 1500) { setSaveError("Enter a note of 1–1,500 characters."); return; }
    await mutate(ticketId, "note", { note }, () => setDrafts(previous => previous[ticketId]?.trim() === note ? { ...previous, [ticketId]: "" } : previous));
  }
  const handleLogout = async () => { setSelectedId(null); setDrafts({}); setReasons({}); setSaveErrors({}); requests.current.clear(); await signOutStaff(); };
  return { tickets: registry.tickets, filteredTickets: registry.tickets, ticketsLoading: registry.loading,
    ticketsError: registry.error, detailError: detail.error, selectedId, stats: registry.stats, hasMore: registry.hasMore,
    loadMore: registry.loadMore, refresh: registry.refresh, officerEmail, selectedTicket, setSelectedTicket,
    statusFilter, setStatusFilter, disputeFilter, setDisputeFilter, searchQuery, setSearchQuery,
    newOfficerNote: selectedId ? drafts[selectedId] || "" : "", setNewOfficerNote,
    statusReason: selectedId ? reasons[selectedId] || "" : "", setStatusReason,
    saveError: selectedId ? saveErrors[selectedId] ?? null : null, setSaveError, saving, handleLogout, handleUpdateStatus, handleAddNote,
    selectedDecision: selectedTicket ? evaluateTicket(selectedTicket, now) : null,
    events: detail.events, notes: detail.notes, moreNotes: detail.moreNotes, notesBusy: detail.notesBusy, loadOlderNotes: detail.loadOlderNotes };
}
