import type React from "react";

// Single source of truth for ticket status labels and colours. These must stay
// in step with TICKET_STATUSES in functions/src/index.ts, which is what
// updateTicketStatus accepts and what it writes into statusLabel.
export const STATUS_LABELS: Record<string, string> = Object.assign(Object.create(null), {
  open: "Open / Awaiting Review",
  investigating: "Under Investigation",
  inspection_scheduled: "Field Inspection Scheduled",
  resolved: "Grievance resolved",
  rejected: "Closed without resolution",
});

const TONES: Record<string, [string, string]> = {
  open: ["245, 158, 11", "#fbbf24"],
  investigating: ["59, 130, 246", "#60a5fa"],
  inspection_scheduled: ["168, 85, 247", "#c4b5fd"],
  resolved: ["16, 185, 129", "#34d399"],
  rejected: ["239, 68, 68", "#f87171"],
};

// An unknown status must not borrow another status's colour — a rejected claim
// shown in the resolved green misreports the case to whoever is reading it.
export function statusTone(status: string): React.CSSProperties {
  const [rgb, color] = Object.hasOwn(TONES, status) ? TONES[status] : ["148, 163, 184", "#cbd5e1"];
  return {
    background: `rgba(${rgb}, 0.15)`,
    color,
    border: `1px solid rgba(${rgb}, 0.3)`,
  };
}
