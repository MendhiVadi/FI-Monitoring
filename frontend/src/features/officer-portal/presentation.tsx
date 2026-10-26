import type React from "react";
import type { DecisionPriority } from "../tickets/ticketDecisionTree";

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

// Email is not stored on notes/events, so other staff appear by a short UID tag.
export function actorLabel(uid: string | undefined, currentUid: string | undefined): string {
  if (!uid) return "Staff member";
  return uid === currentUid ? "You" : `Staff ·${uid.slice(-4)}`;
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
