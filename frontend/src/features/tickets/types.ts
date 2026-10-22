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
}
