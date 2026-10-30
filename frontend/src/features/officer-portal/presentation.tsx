import type React from "react";
import contract from "../../shared/contracts/dispute.json";
import type { StaffAccess } from "../auth/staffSession";
import type { DecisionPriority } from "../tickets/ticketDecisionTree";
import type { OverdueState, Ticket } from "../tickets/types";
import type { StaffStamp } from "../tickets/useTicketDetail";

const TONES: Record<DecisionPriority, React.CSSProperties> = {
  Critical: { color: "#fecaca", background: "rgba(239, 68, 68, 0.18)", borderColor: "rgba(239, 68, 68, 0.45)" },
  High: { color: "#fed7aa", background: "rgba(249, 115, 22, 0.18)", borderColor: "rgba(249, 115, 22, 0.45)" },
  Medium: { color: "#fde68a", background: "rgba(245, 158, 11, 0.15)", borderColor: "rgba(245, 158, 11, 0.4)" },
  Routine: { color: "#bfdbfe", background: "rgba(59, 130, 246, 0.15)", borderColor: "rgba(59, 130, 246, 0.4)" },
  Closed: { color: "#bbf7d0", background: "rgba(34, 197, 94, 0.15)", borderColor: "rgba(34, 197, 94, 0.4)" },
};

export function decisionTone(priority: DecisionPriority): React.CSSProperties {
  return TONES[priority];
}

// toLocale*String builds a fresh Intl formatter on every call; the registry
// formats one date per card and the dossier one per note/event, so reuse them.
const plainDate = new Intl.DateTimeFormat("en-IN");
const shortDate = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
// Pinned to IST like the header clock, and labelled as such.
const istDateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
});
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const NO_DATE = "Date not recorded";

export function formatTimestamp(ts: unknown): string {
  if (!ts) return NO_DATE;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? NO_DATE : shortDate.format(ts);
  if (typeof ts === "string") {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? NO_DATE : plainDate.format(date);
  }
  if (typeof ts === "object" && ts !== null && "seconds" in ts) {
    const seconds = (ts as { seconds: unknown }).seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) return shortDate.format(new Date(seconds * 1000));
  }
  return NO_DATE;
}

export function formatShortDate(seconds: number): string {
  return shortDate.format(new Date(seconds * 1000));
}

// A pending server timestamp (just written by this client) has no seconds yet.
export function formatEventTime(at: { seconds: number } | undefined): string {
  return at && Number.isFinite(at.seconds) ? istDateTime.format(new Date(at.seconds * 1000)) + " IST" : "Just now";
}

export function relativeTime(ms: number, now = Date.now()): string {
  const seconds = (ms - now) / 1000, abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  return shortDate.format(new Date(ms));
}

// Entries written before wave 2 store no email, so their staff appear by a short UID tag.
export function actorLabel(uid: string | undefined, currentUid: string | undefined): string {
  if (!uid) return "Staff member";
  return uid === currentUid ? "You" : `Staff ·${uid.slice(-4)}`;
}

// Access levels by their contract labels without the explanation in brackets:
// "Viewer", "Officer", "Administrator".
const ACCESS_LABELS = new Map(contract.staffAccess.map(level => [level.id, level.label.replace(/\s*\(.*\)\s*$/, "")]));
export const accessLabel = (access: StaffAccess | null | undefined) => (access && ACCESS_LABELS.get(access)) || "Staff";
// officerRole is the officers/{uid} role label (free text); an access level id
// reads as its label.
export function roleLabel(role: string | null | undefined): string | null {
  const text = typeof role === "string" ? role.trim().slice(0, 60) : "";
  return text ? ACCESS_LABELS.get(text) ?? text : null;
}

// Who wrote a note, event or review: name, else email, plus the role label.
// Legacy entries keep the "Staff ·xxxx" tag; masked (viewer) copies carry the role only.
export function staffIdentityLabel(entry: StaffStamp, currentUid?: string): string {
  const uid = entry.officerUid ?? entry.actorUid;
  const who = entry.officerName?.trim() || entry.officerEmail?.trim();
  const role = roleLabel(entry.officerRole ?? entry.actorRole);
  if (!who && !uid) return role ?? (entry.actor?.trim() || "Staff member");
  const name = who ? who + (uid && uid === currentUid ? " (you)" : "") : actorLabel(uid, currentUid);
  return [name, role].filter(Boolean).join(" · ");
}

// Who is on the case: "name (you)", else email, else a short UID tag. A masked
// (viewer) copy carries initials and `assigned` only. null when nobody is assigned.
export function assigneeText(ticket: Ticket, currentUid: string | undefined): string | null {
  const who = ticket.assignedName?.trim() || ticket.assignedEmail?.trim() || (ticket.assignedTo ? `Staff ·${ticket.assignedTo.slice(-4)}` : "")
    || (ticket.assigned ? "A staff member" : "");
  if (!who) return null;
  return ticket.assignedTo && ticket.assignedTo === currentUid ? `${who} (you)` : who;
}

// Overdue cases carry a glyph and words, never colour alone.
const { acknowledgeDays, resolveDays } = contract.serviceTargets;
const OVERDUE: Record<OverdueState, { short: string; long: string }> = {
  acknowledge: { short: "Overdue: not acknowledged", long: `No staff action within ${acknowledgeDays} days of filing` },
  resolve: { short: "Overdue: not resolved", long: `Not resolved within ${resolveDays} days of filing` },
};
export const overdueText = (overdue: unknown) => overdue === "acknowledge" || overdue === "resolve" ? OVERDUE[overdue] : null;

// Assignment and service-target times are stored as milliseconds.
export function formatMs(ms: number | null | undefined): string {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? istDateTime.format(new Date(ms)) + " IST" : NO_DATE;
}

export function initialsFrom(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0].replace(/[^a-z0-9]/gi, "");
  return (local.slice(0, 2) || "ST").toUpperCase();
}

// Callable error codes mapped to plain, actionable text for staff.
export function describeSaveError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "functions/aborted") return "Another staff member changed this case. The latest version is shown; review it and try again.";
  if (code === "functions/unauthenticated") return "Your session ended. Copy any unsaved text, then sign in again.";
  if (code === "functions/permission-denied") return "Your account is not allowed to make this change. Contact the portal administrator.";
  if (["functions/deadline-exceeded", "functions/unavailable", "functions/internal"].includes(code)) {
    return "Could not confirm the save. Check your connection and retry; it will not be duplicated.";
  }
  // The server's own wording for these is specific and actionable (for example the per-case note limit).
  if (["functions/invalid-argument", "functions/failed-precondition", "functions/not-found", "functions/resource-exhausted"].includes(code) &&
      err instanceof Error && err.message) return err.message;
  return "The save could not be confirmed. Retry this change; it will not be duplicated.";
}
