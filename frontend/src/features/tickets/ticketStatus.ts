import type React from "react";

// Single source of truth for ticket status labels and colours. These must stay
// in step with TICKET_STATUSES in functions/src/features/tickets/status.ts,
// which is what updateTicketStatus accepts and what it writes into statusLabel
// (and what the reporter's WhatsApp update quotes).
export const STATUS_ORDER = ["open", "investigating", "inspection_scheduled", "resolved", "rejected"] as const;
export type KnownStatus = (typeof STATUS_ORDER)[number];

export const STATUS_LABELS: Record<string, string> = Object.assign(Object.create(null), {
  open: "Open / Awaiting Review",
  investigating: "Under Investigation",
  inspection_scheduled: "Field Inspection Scheduled",
  resolved: "Grievance resolved",
  rejected: "Grievance closed without resolution",
});

// Compact names for badges, cards and the case-history timeline.
export const STATUS_SHORT_LABELS: Record<string, string> = Object.assign(Object.create(null), {
  open: "Open",
  investigating: "Investigating",
  inspection_scheduled: "Inspection scheduled",
  resolved: "Resolved",
  rejected: "Closed, unresolved",
});

// Each status also gets its own glyph so it is never conveyed by colour alone.
export const STATUS_GLYPHS: Record<string, string> = Object.assign(Object.create(null), {
  open: "○",
  investigating: "◐",
  inspection_scheduled: "◆",
  resolved: "✓",
  rejected: "✕",
});

export const TERMINAL_STATUSES = new Set<string>(["resolved", "rejected"]);

export function isKnownStatus(status: string): status is KnownStatus {
  return (STATUS_ORDER as readonly string[]).includes(status);
}

export function statusLabel(status: string, short = false): string {
  const labels = short ? STATUS_SHORT_LABELS : STATUS_LABELS;
  return Object.hasOwn(labels, status) ? labels[status] : status || "Unknown status";
}

// One palette everywhere: open amber, investigating blue, inspection violet,
// resolved green, closed-without-resolution slate.
const TONES: Record<string, [string, string]> = {
  open: ["245, 158, 11", "#fbbf24"],
  investigating: ["59, 130, 246", "#60a5fa"],
  inspection_scheduled: ["168, 85, 247", "#c4b5fd"],
  resolved: ["16, 185, 129", "#34d399"],
  rejected: ["148, 163, 184", "#cbd5e1"],
};

// An unknown status must not borrow another status's colour — a rejected claim
// shown in the resolved green misreports the case to whoever is reading it.
export function statusTone(status: string): React.CSSProperties {
  const [rgb, color] = Object.hasOwn(TONES, status) ? TONES[status] : ["244, 114, 182", "#f9a8d4"];
  return {
    background: `rgba(${rgb}, 0.15)`,
    color,
    border: `1px solid rgba(${rgb}, 0.3)`,
  };
}
