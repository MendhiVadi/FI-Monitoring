import { memo } from "react";
import type { Ticket } from "../tickets/types";
import { StatusBadge } from "../tickets/StatusBadge";
import { formatTimestamp } from "./presentation";
import { NotProvided } from "./CaseText";
import { styles } from "./portal.styles";

// Memoised so typing in the search, reason or note fields re-renders only the
// inputs, not every loaded registry card (the list grows with "load older").
export const TicketCard = memo(function TicketCard({ ticket, selected, onSelect }: {
  ticket: Ticket;
  selected: boolean;
  onSelect: (ticket: Ticket) => void;
}) {
  const { reporterName, reporterType, district, state } = ticket.dispute ?? {};
  const place = [district, state].filter(Boolean).join(", ");
  return (
    <div
      className="ticket-card"
      onClick={() => onSelect(ticket)}
      style={{
        ...styles.ticketCard,
        borderColor: selected ? "#22c55e" : "rgba(255,255,255,0.08)",
      }}
    >
      {/* Card Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={styles.ticketIdPill}>{ticket.id}</span>
            {ticket.source === "whatsapp-hotline" ? (
              <span style={styles.whatsappSourcePill}>WhatsApp Hotline</span>
            ) : (
              <span style={styles.webSourcePill}>Web Dispute Form</span>
            )}
            {ticket.priority === "critical" && (
              <span style={styles.criticalPill}>High Urgency</span>
            )}
          </div>
          <h3 style={{ ...styles.ticketTitle, overflowWrap: "anywhere" }}>{ticket.subject || <NotProvided label="No subject recorded" />}</h3>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      {/* Reporter details & Location row */}
      <div style={styles.ticketMetaRow}>
        <div style={styles.metaItem}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>
            <span className="sr-only">Reporter: </span>
            {reporterName || <NotProvided label="Name not provided" />}
            {reporterType && <span style={{ opacity: 0.65, marginLeft: "4px" }}>({reporterType})</span>}
          </span>
        </div>

        <div style={styles.metaItem}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span><span className="sr-only">Location: </span>{place || <NotProvided label="Location not provided" />}</span>
        </div>

        {ticket.waFrom && (
          <div style={styles.metaItem}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span><span className="sr-only">Phone: </span>{ticket.waFrom}</span>
          </div>
        )}
      </div>

      {/* Verbatim summary teaser */}
      <p style={styles.ticketSnippet}>
        {ticket.dispute?.description || ticket.messages?.[0]?.body || "Open the dossier to read the report."}
      </p>

      {/* Card Action Footer */}
      <div style={{ ...styles.ticketCardFooter, flexWrap: "wrap", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
          {ticket.createdAt ? "Filed " + formatTimestamp(ticket.createdAt) : "Updated " + formatTimestamp(ticket.updatedAt)}
        </span>
        <button
          type="button"
          style={styles.pursueTicketBtn}
          aria-label={`Review case: ${ticket.subject || ticket.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(ticket);
          }}
        >
          <span>Review case</span>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
});
