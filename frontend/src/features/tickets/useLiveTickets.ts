import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../shared/firebase/functions";
import type { Ticket } from "./types";

interface Cursor { seconds: number; nanoseconds: number; id: string }
export interface TicketStats { total: number; open: number; investigating: number; resolved: number; rejected: number }
interface Page { tickets: Ticket[]; nextCursor: Cursor | null; stats: TicketStats | null }
const requestPage = httpsCallable<Record<string, unknown>, Page>(functions, "listTickets");
export function useLiveTickets(enabled = true, search = "", status = "all", disputeType = "all") {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(enabled), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), pending = useRef(false);
  const fetchPage = useCallback(async (next: Cursor | null = null) => {
    if (!enabled || pending.current) return;
    const mine = generation.current;
    pending.current = true; setLoading(true); setError(null);
    try {
      const { data } = await requestPage({ search, status, disputeType, cursor: next });
      if (mine !== generation.current) return;
      setTickets(previous => next ? [...new Map([...previous, ...data.tickets].map(ticket => [ticket.id, ticket])).values()] : data.tickets);
      setCursor(data.nextCursor);
      if (data.stats) setStats(data.stats);
    } catch (err) {
      if (mine === generation.current) setError(err instanceof Error ? err.message : "The registry could not be loaded.");
    } finally { if (mine === generation.current) { pending.current = false; setLoading(false); } }
  }, [enabled, search, status, disputeType]);
  useEffect(() => {
    ++generation.current; pending.current = false;
    setTickets([]); setStats(null); setCursor(null); setError(null); setLoading(enabled);
    const timer = setTimeout(() => { if (enabled) void fetchPage(); }, 300);
    return () => { clearTimeout(timer); ++generation.current; pending.current = false; };
  }, [enabled, fetchPage]);
  return { tickets, loading, error, stats, hasMore: cursor !== null, loadMore: () => fetchPage(cursor), refresh: () => fetchPage() };
}
