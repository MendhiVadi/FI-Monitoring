import contract from "../../platform/contracts/dispute.json";
import { TERMINAL_STATUSES, TICKET_STATUSES } from "../tickets/status";
import { toMillis } from "./time";

// Internal service targets (contract.serviceTargets): staff follow-up goals,
// not legal deadlines. Pure logic shared by the staff handlers and the hourly
// `escalateOverdueCases` job, so both always agree on a ticket's state.
export const DAY_MS = 86_400_000;
export const ACKNOWLEDGE_MS = contract.serviceTargets.acknowledgeDays * DAY_MS;
export const RESOLVE_MS = contract.serviceTargets.resolveDays * DAY_MS;
export const OVERDUE_STATES = ["acknowledge", "resolve"] as const;
export type Overdue = typeof OVERDUE_STATES[number] | null;
export const NON_TERMINAL_STATUSES: string[] = Object.keys(TICKET_STATUSES).filter(status => !TERMINAL_STATUSES.includes(status));

export function dueDates(createdAtMs: number): { ackDueAt: number; resolveDueAt: number } {
  return { ackDueAt: createdAtMs + ACKNOWLEDGE_MS, resolveDueAt: createdAtMs + RESOLVE_MS };
}

export function storedOverdue(value: unknown): Overdue {
  return value === "acknowledge" || value === "resolve" ? value : null;
}

// Terminal → null; no staff action past the acknowledge target → "acknowledge";
// past the resolve target → "resolve"; otherwise null. A ticket without due
// dates (legacy, not yet backfilled) is never overdue.
export function computeOverdue(ticket: { status?: unknown; firstActionAt?: unknown; ackDueAt?: unknown; resolveDueAt?: unknown }, now: number): Overdue {
  if (TERMINAL_STATUSES.includes(String(ticket.status))) return null;
  const ackDueAt = typeof ticket.ackDueAt === "number" ? ticket.ackDueAt : null;
  const resolveDueAt = typeof ticket.resolveDueAt === "number" ? ticket.resolveDueAt : null;
  if (ackDueAt !== null && ticket.firstActionAt == null && ackDueAt < now) return "acknowledge";
  if (resolveDueAt !== null && resolveDueAt < now) return "resolve";
  return null;
}

// The fields to write when the overdue state changes, or null when it does not.
export function overdueTransition(previous: unknown, next: Overdue, now: number): { overdue: Overdue; overdueSince: number | null } | null {
  if (storedOverdue(previous) === next) return null;
  return { overdue: next, overdueSince: next ? now : null };
}

// The first staff action (status change, note, assignment, document review).
export function firstActionPatch(ticket: { firstActionAt?: unknown }, now: number): { firstActionAt?: number } {
  return ticket.firstActionAt == null ? { firstActionAt: now } : {};
}

// Cases filed before service targets existed: due dates from createdAt, and
// explicit nulls so "unassigned" / "not overdue" become queryable. A legacy
// case staff already touched (revision > 0) counts as acknowledged at its last
// update, so it is not escalated for a first action it already had.
export function legacyBackfill(ticket: Record<string, unknown>, now: number): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (typeof ticket.ackDueAt !== "number" || typeof ticket.resolveDueAt !== "number") {
    const createdAt = toMillis(ticket.createdAt) ?? toMillis(ticket.updatedAt) ?? now;
    Object.assign(patch, dueDates(createdAt));
  }
  if (ticket.firstActionAt === undefined) {
    patch.firstActionAt = (Number(ticket.revision) || 0) > 0 ? (toMillis(ticket.updatedAt) ?? now) : null;
  }
  if (ticket.overdue === undefined) patch.overdue = null;
  if (ticket.assignedTo === undefined) Object.assign(patch, { assignedTo: null, assignedEmail: null, assignedName: null, assignedAt: null });
  return Object.keys(patch).length ? patch : null;
}

// Cutoffs for "waiting more than N days" (created before now − N days).
export function waitingCutoff(now: number, days: number): number {
  return now - days * DAY_MS;
}
