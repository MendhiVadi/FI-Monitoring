export interface DisputeData {
  reporterName: string;
  reporterType: string;
  otherPartyName: string;
  otherPartyType: string;
  disputeType: string;
  state: string;
  district: string;
  village?: string;
  description: string;
  immediateRisk?: "yes" | "no" | "unknown";
  evidenceReferences?: string[];
  location?: { latitude: number; longitude: number };
}

export interface TicketMessage {
  body: string;
  from: "user" | "officer" | "system";
  at?: { seconds: number } | Date | string;
}

// Summary written by submitDispute; flagged counts documents screened high or altered.
export interface TicketDocuments {
  caseType: string;
  count: number;
  kinds: string[];
  flagged: number;
}

export interface Ticket {
  revision?: number;
  noteCount?: number;
  id: string;
  subject: string;
  status: string;
  waFrom?: string;
  phoneVerified?: boolean;
  // Reporter opted in to WhatsApp updates (only honoured when phoneVerified).
  whatsappUpdates?: boolean;
  source?: string;
  dispute?: DisputeData;
  messages?: TicketMessage[];
  createdAt?: { seconds: number };
  updatedAt?: { seconds: number };
  officerNotes?: string[];
  priority?: string;
  // Absent on cases filed before document uploads.
  documents?: TicketDocuments;
  // Milliseconds; set when the status becomes terminal, cleared on reopen.
  closedAt?: number | null;
}
