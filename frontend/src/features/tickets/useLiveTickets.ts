import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../shared/firebase/functions";
import type { Ticket } from "./types";

interface Cursor { seconds: number; nanoseconds: number; id: string }
export interface TicketStats { total: number; open: number; investigating: number; resolved: number; rejected: number }
interface Page { tickets: Ticket[]; nextCursor: Cursor | null; stats: TicketStats | null }
// A bounded wait instead of the SDK's 70 s default, so a stalled cold start
// surfaces as a retryable error rather than an indefinitely "loading" registry.
const requestPage = httpsCallable<Record<string, unknown>, Page>(functions, "listTickets", { timeout: 30_000 });
const MAX_SEARCH = 120; // listTickets rejects longer terms outright
export function useLiveTickets(enabled = true, rawSearch = "", status = "all", disputeType = "all") {
  // Whitespace-only edits must not cancel and re-issue a 200-document scan.
  const search = rawSearch.trim().slice(0, MAX_SEARCH);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(enabled), [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // True from a search/filter change until its first page lands: the previous
  // list stays on screen (dimmed) instead of collapsing to a loading card.
  const [isStale, setIsStale] = useState(enabled);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const generation = useRef(0), pending = useRef(false);
  const fetchPage = useCallback(async (next: Cursor | null = null) => {
    if (!enabled || pending.current) return;
    const mine = generation.current;
    pending.current = true; setLoading(true); setError(null); setErrorCode(null);
    try {
      const { data } = await requestPage({ search, status, disputeType, cursor: next });
      if (mine !== generation.current) return;
      setTickets(previous => next ? [...new Map([...previous, ...data.tickets].map(ticket => [ticket.id, ticket])).values()] : data.tickets);
      setCursor(data.nextCursor);
      // Stats are registry-wide counts, unaffected by the filter; only overwrite them when sent.
      if (data.stats) setStats(data.stats);
      setIsStale(false); setLastLoadedAt(Date.now());
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof Error ? err.message : "The registry could not be loaded.");
      setErrorCode((err as { code?: string })?.code ?? null);
      // A failed first page leaves no valid cursor for this filter; a failed
      // "load older" keeps its cursor so the retry continues from the same place.
      if (!next) { setCursor(null); setIsStale(false); }
    } finally { if (mine === generation.current) { pending.current = false; setLoading(false); } }
  }, [enabled, search, status, disputeType]);
  useEffect(() => {
    ++generation.current; pending.current = false;
    if (!enabled) { setTickets([]); setStats(null); setCursor(null); }
    setError(null); setErrorCode(null); setLoading(enabled); setIsStale(enabled);
    const timer = setTimeout(() => { if (enabled) void fetchPage(); }, 300);
    return () => { clearTimeout(timer); ++generation.current; pending.current = false; };
  }, [enabled, fetchPage]);
  const loadMore = useCallback(() => fetchPage(cursor), [fetchPage, cursor]);
  const refresh = useCallback(() => fetchPage(), [fetchPage]);
  // After a status change, update the edited card in place so older loaded pages
  // and the scroll position survive, instead of reloading page 1 only.
  const patchTicket = useCallback((id: string, partial: Partial<Ticket>) => {
    setTickets(previous => previous.map(ticket => ticket.id === id ? { ...ticket, ...partial } : ticket));
  }, []);
  const refreshStats = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await requestPage({ search, status, disputeType, cursor: null });
      if (data.stats) setStats(data.stats);
    } catch { /* The counts stay as last loaded; the next refresh retries. */ }
  }, [enabled, search, status, disputeType]);
  return { tickets, loading, error, errorCode, stats, hasMore: cursor !== null, loadMore, refresh,
    isStale, lastLoadedAt, searchedBack: cursor?.seconds ?? null, patchTicket, refreshStats };
}
