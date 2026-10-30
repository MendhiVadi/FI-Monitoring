import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../shared/firebase/functions";
import type { Ticket } from "./types";

interface Cursor { seconds: number; nanoseconds: number; id: string }
export interface TicketStats {
  total: number; open: number; investigating: number; resolved: number; rejected: number;
  // Wave 2: overdue cases, and non-terminal cases filed more than 7 / 30 days ago.
  overdue?: number; waiting7?: number; waiting30?: number;
}
interface Page { tickets: Ticket[]; nextCursor: Cursor | null; stats: TicketStats | null }
// A bounded wait instead of the SDK's 70 s default, so a stalled cold start
// surfaces as a retryable error rather than an indefinitely "loading" registry.
const requestPage = httpsCallable<Record<string, unknown>, Page>(functions, "listTickets", { timeout: 30_000 });
const MAX_SEARCH = 120; // listTickets rejects longer terms outright
/** The registry keeps at most this many cases in memory (vault/Wave-2-Spec.md §7). */
export const REGISTRY_CAP = 500;
/** "all", "me", "unassigned" or an officer's uid (listTickets `assignee`). */
export type AssigneeFilter = string;

// Request state belongs to one filter set (`key`). After a search/filter change
// it reads as a fresh request until that filter's own first update lands.
interface RequestState { key: string; loading: boolean; error: string | null; errorCode: string | null; isStale: boolean }
const freshRequest = (key: string, enabled: boolean): RequestState => ({ key, loading: enabled, error: null, errorCode: null, isStale: enabled });
// One per filter set. The effect retires it when the filters change or the
// registry unmounts, so a late page for an old filter is dropped.
interface Run { live: boolean; pending: boolean }
const NONE: never[] = [];

export function useLiveTickets(enabled = true, rawSearch = "", status = "all", disputeType = "all", assignee: AssigneeFilter = "all", overdue = false) {
  // Whitespace-only edits must not cancel and re-issue a 200-document scan.
  const search = rawSearch.trim().slice(0, MAX_SEARCH);
  const filterKey = JSON.stringify([enabled, search, status, disputeType, assignee, overdue]);
  // The loaded list survives a filter change (dimmed while isStale) and is
  // only dropped while the registry is disabled (signed out).
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [requestState, setRequestState] = useState(() => freshRequest(filterKey, enabled));
  const current = requestState.key === filterKey ? requestState : freshRequest(filterKey, enabled);
  const run = useRef<Run | null>(null);
  const request = useCallback((next: Cursor | null) => requestPage({
    search, status, disputeType, cursor: next,
    ...(assignee !== "all" ? { assignee } : {}), ...(overdue ? { overdue: true } : {}),
  }), [search, status, disputeType, assignee, overdue]);
  const fetchPage = useCallback(async (next: Cursor | null = null) => {
    const mine = run.current;
    if (!enabled || !mine?.live || mine.pending) return;
    const update = (patch: Partial<RequestState>) =>
      setRequestState(previous => ({ ...(previous.key === filterKey ? previous : freshRequest(filterKey, true)), ...patch }));
    mine.pending = true; update({ loading: true, error: null, errorCode: null });
    try {
      const { data } = await request(next);
      if (!mine.live) return;
      setTickets(previous => {
        const merged = next ? [...new Map([...previous, ...data.tickets].map(ticket => [ticket.id, ticket])).values()] : data.tickets;
        return merged.length > REGISTRY_CAP ? merged.slice(0, REGISTRY_CAP) : merged;
      });
      setCursor(data.nextCursor);
      // Stats are registry-wide counts, unaffected by the filter; only overwrite them when sent.
      if (data.stats) setStats(data.stats);
      update({ isStale: false }); setLastLoadedAt(Date.now());
    } catch (err) {
      if (!mine.live) return;
      update({ error: err instanceof Error ? err.message : "The registry could not be loaded.", errorCode: (err as { code?: string })?.code ?? null });
      // A failed first page leaves no valid cursor for this filter; a failed
      // "load older" keeps its cursor so the retry continues from the same place.
      if (!next) { setCursor(null); update({ isStale: false }); }
    } finally { mine.pending = false; if (mine.live) update({ loading: false }); }
  }, [enabled, filterKey, request]);
  useEffect(() => {
    const mine: Run = { live: true, pending: false };
    run.current = mine;
    // While disabled the list is already hidden (below); this also drops it from memory.
    const timer = setTimeout(() => { if (enabled) void fetchPage(); else { setTickets([]); setStats(null); setCursor(null); } }, 300);
    return () => { clearTimeout(timer); mine.live = false; };
  }, [enabled, fetchPage]);
  const shownTickets = enabled ? tickets : NONE, shownCursor = enabled ? cursor : null;
  // Past the cap, no further pages are fetched; the portal asks for a narrower search.
  const capped = shownCursor !== null && shownTickets.length >= REGISTRY_CAP;
  const loadMore = useCallback(() => capped ? Promise.resolve() : fetchPage(cursor), [fetchPage, cursor, capped]);
  const refresh = useCallback(() => fetchPage(), [fetchPage]);
  // After a status change, update the edited card in place so older loaded pages
  // and the scroll position survive, instead of reloading page 1 only.
  const patchTicket = useCallback((id: string, partial: Partial<Ticket>) => {
    setTickets(previous => previous.map(ticket => ticket.id === id ? { ...ticket, ...partial } : ticket));
  }, []);
  const refreshStats = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await request(null);
      if (data.stats) setStats(data.stats);
    } catch { /* The counts stay as last loaded; the next refresh retries. */ }
  }, [enabled, request]);
  return { tickets: shownTickets, loading: current.loading, error: current.error, errorCode: current.errorCode, stats: enabled ? stats : null,
    hasMore: shownCursor !== null && !capped, capped, loadMore, refresh,
    isStale: current.isStale, lastLoadedAt, searchedBack: shownCursor?.seconds ?? null, patchTicket, refreshStats };
}
