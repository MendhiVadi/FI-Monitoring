export const TICKET_STATUSES = {
  open: "Open / Awaiting Review",
  investigating: "Under Investigation",
  inspection_scheduled: "Field Inspection Scheduled",
  resolved: "Grievance resolved",
  rejected: "Grievance closed without resolution",
} as const;

export type TicketStatus = keyof typeof TICKET_STATUSES;

// A case in one of these states is closed: its documents start the retention clock.
export const TERMINAL_STATUSES: readonly string[] = ["resolved", "rejected"];
