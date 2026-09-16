import type React from "react";
import type { DecisionPriority } from "../tickets/ticketDecisionTree";
import { styles } from "./portal.styles";

export function renderStatusBadge(status: string) {
  switch (status) {
    case "open":
      return <span style={styles.badgeOpen}>● Action Required</span>;
    case "investigating":
      return <span style={styles.badgeInvestigating}>● Under Investigation</span>;
    case "inspection_scheduled":
      return <span style={styles.badgeScheduled}>● Field Inspection</span>;
    case "resolved":
      return <span style={styles.badgeResolved}>● Resolved</span>;
    case "rejected":
      return <span style={styles.badgeRejected}>● Rejected</span>;
    default:
      return <span style={styles.badgeInvestigating}>{status}</span>;
  }
}

export function decisionTone(priority: DecisionPriority): React.CSSProperties {
  const tones: Record<DecisionPriority, React.CSSProperties> = {
    Critical: { color: "#fecaca", background: "rgba(239, 68, 68, 0.18)", borderColor: "rgba(239, 68, 68, 0.45)" },
    High: { color: "#fed7aa", background: "rgba(249, 115, 22, 0.18)", borderColor: "rgba(249, 115, 22, 0.45)" },
    Medium: { color: "#fde68a", background: "rgba(245, 158, 11, 0.15)", borderColor: "rgba(245, 158, 11, 0.4)" },
    Routine: { color: "#bfdbfe", background: "rgba(59, 130, 246, 0.15)", borderColor: "rgba(59, 130, 246, 0.4)" },
    Closed: { color: "#bbf7d0", background: "rgba(34, 197, 94, 0.15)", borderColor: "rgba(34, 197, 94, 0.4)" },
  };
  return tones[priority];
}

export function formatTimestamp(ts: unknown): string {
  if (!ts) return "Recently";
  if (typeof ts === "string") return new Date(ts).toLocaleDateString("en-IN");
  if (typeof ts === "object" && ts !== null && "seconds" in ts) {
    return new Date((ts as { seconds: number }).seconds * 1000).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  return "Recently";
}
