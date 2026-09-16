import { cardStyle } from "./reporting.styles";

export function Confirmation({ ticketId }: { ticketId: string | null }) {
  return (
    <section style={{ ...cardStyle, textAlign: "center" }}>
      <h2 style={{ marginTop: 0, color: "#7bd89f" }}>Thank you!</h2>
      {ticketId && (
        <p style={{ opacity: 0.8, marginTop: "0.75rem" }}>
          Your reference number: <strong>{ticketId}</strong>
        </p>
      )}
      <p>Your ticket has been saved for staff review. Keep this reference number. WhatsApp updates are sent only if you requested them; a delayed message does not mean your report was lost.</p>
    </section>
  );
}
