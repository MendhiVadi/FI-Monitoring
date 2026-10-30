import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { doc, getDocFromServer, type DocumentData } from "firebase/firestore";
import { db } from "../../shared/firebase/firestore";
import { auth } from "../../shared/firebase/firebase";
import { functions } from "../../shared/firebase/functions";
import contract from "../../shared/contracts/dispute.json";
import { signOutStaff, useStaffSession } from "../auth/staffSession";
import { useLiveTickets } from "../tickets/useLiveTickets";
import { useTicketDetail } from "../tickets/useTicketDetail";
import type { Ticket } from "../tickets/types";
import { evaluateTicket } from "../tickets/ticketDecisionTree";
import { TERMINAL_STATUSES, isKnownStatus, statusLabel } from "../tickets/ticketStatus";
import { describeSaveError } from "./presentation";
import { useStaffDirectory } from "./useStaffDirectory";

// Bounded waits: a timed-out save is reconciled against its event receipt below
// and keeps its request ID, so a retry stays idempotent.
const callables = {
  status: httpsCallable(functions, "updateTicketStatus", { timeout: 30_000 }),
  note: httpsCallable(functions, "addTicketNote", { timeout: 30_000 }),
  assign: httpsCallable(functions, "assignTicket", { timeout: 30_000 }),
};
export const MAX_NOTE_LENGTH = 1500; // mirrors addTicketNote / updateTicketStatus
export const MAX_ASSIGN_REASON = 300; // mirrors assignTicket
export type SaveKind = "status" | "note" | "assign";
export interface SaveError { kind: SaveKind; message: string; retryable: boolean }
export interface Notice { id: number; message: string }
// Each save writes its case-history event under the request ID; that event is the receipt.
const RECEIPTS: Record<SaveKind, (event: DocumentData) => boolean> = {
  status: event => event.kind === "status",
  note: event => event.kind === "note",
  assign: event => event.type === "assignment",
};

// crypto.randomUUID only exists in secure contexts; a plain-http LAN demo still
// has getRandomValues. 32 hex chars satisfy the server's 20–80 character check.
export function newRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

const NOT_RETRYABLE = new Set(["functions/unauthenticated", "functions/permission-denied", "functions/invalid-argument",
  "functions/not-found", "functions/resource-exhausted"]);
const DISPUTE_TYPES: readonly string[] = contract.disputeTypes;
const readStatus = (value: string | null) => value && isKnownStatus(value) ? value : "all";
const readDispute = (value: string | null) => value && DISPUTE_TYPES.includes(value) ? value : "all";
// "me", "unassigned" or an officer's uid; viewers are never assigned, so "me" means nothing to them.
function readAssignee(value: string | null, readOnly: boolean): string {
  if (value === "unassigned") return value;
  if (value === "me") return readOnly ? "all" : value;
  return value && value !== "all" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "all";
}
const isOverdue = (ticket: Ticket) => ticket.overdue === "acknowledge" || ticket.overdue === "resolve";
// Mirrors the server's staff-action effect (the first action acknowledges the
// case; closing clears overdue), so an edited card leaves the Overdue view
// without reloading the registry. Cases without due dates are left alone.
function afterStaffAction(ticket: Ticket, status: string, now: number): Partial<Ticket> {
  const firstActionAt = ticket.firstActionAt ?? now;
  if (TERMINAL_STATUSES.has(status)) return { firstActionAt, overdue: null };
  if (typeof ticket.resolveDueAt !== "number") return { firstActionAt };
  return { firstActionAt, overdue: ticket.resolveDueAt < now ? "resolve" : null };
}
function matchesAssignee(assignedTo: string | null | undefined, filter: string, uid: string | undefined) {
  // Projections without assignment fields are left to the server's own filter.
  if (filter === "all" || assignedTo === undefined) return true;
  if (filter === "unassigned") return !assignedTo;
  return assignedTo === (filter === "me" ? uid : filter);
}

export function useOfficerPortal() {
  const { email: officerEmail, uid: sessionUid, access, displayName } = useStaffSession();
  // Viewers browse masked copies only; the server refuses their writes, and the
  // portal hides every control that would make one.
  const readOnly = access === "viewer", isAdmin = access === "admin";
  const currentUid = sessionUid ?? auth.currentUser?.uid;
  // Filters and search live in the URL too, so refresh and Back keep them.
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(() => readStatus(params.get("status")));
  const [disputeFilter, setDisputeFilter] = useState(() => readDispute(params.get("category")));
  const [searchQuery, setSearchQuery] = useState(() => (params.get("q") ?? "").slice(0, 120));
  const [assigneeFilter, setAssigneeFilter] = useState(() => readAssignee(params.get("assignee"), readOnly));
  const [overdueOnly, setOverdueOnly] = useState(() => params.get("overdue") === "1");
  // Debounced: Safari throws a SecurityError after about 100 replaceState calls
  // in 10 s (holding Backspace in the search box gets there), and react-router
  // does not catch it on replace.
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = new URLSearchParams(window.location.search), next = new URLSearchParams(current);
      const apply = (key: string, value: string, empty: string) => { if (value && value !== empty) next.set(key, value); else next.delete(key); };
      apply("status", statusFilter, "all"); apply("category", disputeFilter, "all"); apply("q", searchQuery.trim(), "");
      apply("assignee", assigneeFilter, "all"); apply("overdue", overdueOnly ? "1" : "", "");
      if (next.toString() !== current.toString()) setParams(next, { replace: true });
    }, 400);
    return () => clearTimeout(timer);
  }, [statusFilter, disputeFilter, searchQuery, assigneeFilter, overdueOnly, setParams]);
  const filtersActive = statusFilter !== "all" || disputeFilter !== "all" || searchQuery.trim() !== "" || assigneeFilter !== "all" || overdueOnly;
  const clearFilters = useCallback(() => {
    setStatusFilter("all"); setDisputeFilter("all"); setSearchQuery(""); setAssigneeFilter("all"); setOverdueOnly(false);
  }, []);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [assignReasons, setAssignReasons] = useState<Record<string, string>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, SaveError | null>>({});
  const [savingKinds, setSavingKinds] = useState<Record<string, SaveKind | null>>({});
  const setSaveError = (kind: SaveKind, message: string) => { if (selectedId) setSaveErrors(previous => ({ ...previous, [selectedId]: { kind, message, retryable: false } })); };
  const clearSaveError = () => { if (selectedId) setSaveErrors(previous => ({ ...previous, [selectedId]: null })); };
  const pending = useRef(new Set<string>());
  const requests = useRef(new Map<string, { id: string; body: string }>());
  const registry = useLiveTickets(Boolean(officerEmail), searchQuery, statusFilter, disputeFilter, assigneeFilter, overdueOnly);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const detail = useTicketDetail(officerEmail ? selectedId : null, detailAttempt, readOnly), selectedTicket = detail.ticket;
  const retryDetail = useCallback(() => setDetailAttempt(n => n + 1), []);
  // Feeds the per-officer registry filter and the admin assignment picker
  // (officers only take or release a case). listOfficers is officer+, so
  // viewers never load staff emails.
  const staff = useStaffDirectory(Boolean(officerEmail) && !readOnly);

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
  const setAssignReason = (text: string) => { if (selectedId) setAssignReasons(previous => ({ ...previous, [selectedId]: text })); };

  async function mutate(ticketId: string, kind: SaveKind, body: Record<string, unknown>, onSaved: () => void) {
    if (readOnly || pending.current.has(ticketId)) return;
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
          if (receipt.exists() && receipt.data().officerUid === auth.currentUser?.uid && RECEIPTS[kind](receipt.data())) {
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
      registry.patchTicket(ticketId, { status: nextStatus, ...afterStaffAction(selectedTicket, nextStatus, Date.now()), updatedAt: { seconds: Math.floor(Date.now() / 1000) } });
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
    const before = selectedTicket?.id === ticketId ? selectedTicket : null;
    await mutate(ticketId, "note", { note }, () => {
      setDrafts(previous => previous[ticketId]?.trim() === note ? { ...previous, [ticketId]: "" } : previous);
      if (before && before.firstActionAt == null) {
        registry.patchTicket(ticketId, afterStaffAction(before, before.status, Date.now()));
        if (isOverdue(before)) void registry.refreshStats();
      }
      showNotice("Note added to case history.");
    });
  }
  // assigneeUid null unassigns. Officers may take or release a case; admins assign anyone.
  async function handleAssign(ticketId: string, assigneeUid: string | null) {
    if (!selectedTicket || selectedTicket.id !== ticketId || (selectedTicket.assignedTo ?? null) === assigneeUid) return;
    const reason = (assignReasons[ticketId] || "").trim();
    if (reason.length > MAX_ASSIGN_REASON) { setSaveError("assign", `Keep the reason under ${MAX_ASSIGN_REASON} characters.`); return; }
    const self = assigneeUid !== null && assigneeUid === currentUid;
    const target = self ? { email: officerEmail, displayName } : staff.officers.find(officer => officer.uid === assigneeUid);
    const targetName = target ? target.displayName || target.email || "the selected officer" : "the selected officer";
    const filter = assigneeFilter, before = selectedTicket;
    await mutate(ticketId, "assign", { assigneeUid, ...(reason ? { reason } : {}), expectedRevision: selectedTicket.revision ?? 0 }, () => {
      setAssignReasons(previous => previous[ticketId]?.trim() === reason ? { ...previous, [ticketId]: "" } : previous);
      registry.patchTicket(ticketId, {
        assignedTo: assigneeUid, assignedEmail: assigneeUid ? target?.email ?? null : null, assignedName: assigneeUid ? target?.displayName ?? null : null,
        assignedAt: assigneeUid ? Date.now() : null, ...afterStaffAction(before, before.status, Date.now()), updatedAt: { seconds: Math.floor(Date.now() / 1000) },
      });
      if (isOverdue(before)) void registry.refreshStats();
      const message = assigneeUid === null ? "Case unassigned." : self ? "Case assigned to you." : `Case assigned to ${targetName}.`;
      showNotice(filter !== "all" && !matchesAssignee(assigneeUid, filter, currentUid) ? `${message} It is hidden by the current assignee filter.` : message);
    });
  }
  const selectedDecision = useMemo(() => selectedTicket ? evaluateTicket(selectedTicket, now) : null, [selectedTicket, now]);
  const unsavedCases = useMemo(() => new Set([...Object.entries(drafts), ...Object.entries(reasons), ...Object.entries(assignReasons)]
    .filter(([, text]) => text.trim()).map(([id]) => id)).size, [drafts, reasons, assignReasons]);
  // Drafts live only in this page's memory, so leaving the portal discards them too.
  const confirmDiscard = (action: string) => unsavedCases === 0 ||
    window.confirm(`You have unsaved text on ${unsavedCases} case${unsavedCases === 1 ? "" : "s"}. ${action} anyway?`);
  const confirmLeave = () => confirmDiscard("Leave the portal");
  const handleLogout = async () => {
    if (!confirmDiscard("Sign out")) return;
    selectedRef.current = null; setSelectedId(null); setDrafts({}); setReasons({}); setAssignReasons({}); setSaveErrors({}); requests.current.clear();
    await signOutStaff();
  };
  // The server filters already applied; re-check status, assignee and overdue
  // locally so a case edited out of the active filter (patched in place) leaves the list straight away.
  const visibleTickets = useMemo(() => statusFilter === "all" && assigneeFilter === "all" && !overdueOnly ? registry.tickets
    : registry.tickets.filter(ticket => (statusFilter === "all" || ticket.status === statusFilter)
      && matchesAssignee(ticket.assignedTo, assigneeFilter, currentUid) && (!overdueOnly || isOverdue(ticket))),
  [registry.tickets, statusFilter, assigneeFilter, overdueOnly, currentUid]);
  const savingKind = selectedId ? savingKinds[selectedId] ?? null : null;
  return { tickets: visibleTickets, filteredTickets: visibleTickets, ticketsLoading: registry.loading,
    ticketsError: registry.error, ticketsErrorCode: registry.errorCode, isStale: registry.isStale,
    lastLoadedAt: registry.lastLoadedAt, searchedBack: registry.searchedBack, detailError: detail.error, retryDetail, selectedId,
    stats: registry.stats, hasMore: registry.hasMore, capped: registry.capped, loadMore: registry.loadMore, refresh: registry.refresh,
    officerEmail, currentUid, access, readOnly, isAdmin, selectedTicket, setSelectedTicket,
    statusFilter, setStatusFilter, disputeFilter, setDisputeFilter, searchQuery, setSearchQuery, filtersActive, clearFilters,
    assigneeFilter, setAssigneeFilter, overdueOnly, setOverdueOnly, staff,
    newOfficerNote: selectedId ? drafts[selectedId] || "" : "", setNewOfficerNote,
    statusReason: selectedId ? reasons[selectedId] || "" : "", setStatusReason,
    assignReason: selectedId ? assignReasons[selectedId] || "" : "", setAssignReason,
    saveError: selectedId ? saveErrors[selectedId] ?? null : null, clearSaveError, savingKind, saving: savingKind !== null,
    handleLogout, confirmLeave, handleUpdateStatus, handleAddNote, handleAssign, selectedDecision, notice, showNotice, dismissNotice,
    events: detail.events, notes: detail.notes, moreNotes: detail.moreNotes, notesBusy: detail.notesBusy, loadOlderNotes: detail.loadOlderNotes,
    maskedDocuments: detail.maskedDocuments };
}
