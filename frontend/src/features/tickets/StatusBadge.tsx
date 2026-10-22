import { STATUS_GLYPHS, statusLabel, statusTone } from "./ticketStatus";

// Shared status pill: label + per-status glyph + tone from ticketStatus.ts.
export function StatusBadge({ status, long = false }: { status: string; long?: boolean }) {
  const glyph = Object.hasOwn(STATUS_GLYPHS, status) ? STATUS_GLYPHS[status] : "?";
  return (
    <span
      style={{
        ...statusTone(status),
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.2rem 0.65rem",
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 700,
        // Stays on one line where it fits; the long labels may wrap rather than
        // overflow a 360px screen.
        maxWidth: "100%",
      }}
    >
      <span aria-hidden="true">{glyph}</span>
      {statusLabel(status, !long)}
    </span>
  );
}
