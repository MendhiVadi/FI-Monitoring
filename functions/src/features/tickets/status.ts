export const TICKET_STATUSES = {
  open: "Open / Awaiting Review",
  investigating: "Under Investigation",
  inspection_scheduled: "Field Inspection Scheduled",
  resolved: "Grievance resolved",
  rejected: "Grievance closed without resolution",
} as const;

export type TicketStatus = keyof typeof TICKET_STATUSES;
