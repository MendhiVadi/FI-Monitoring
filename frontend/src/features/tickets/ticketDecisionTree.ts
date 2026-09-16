import type { Ticket } from "./types";

export type DecisionPriority = "Critical" | "High" | "Medium" | "Routine" | "Closed";

export interface DecisionFactor {
  label: string;
  value: string;
  signal: "risk" | "protective" | "neutral";
}

export interface TicketDecision {
  priority: DecisionPriority;
  recommendedAction: string;
  responseWindow: string;
  rationale: string;
  path: string[];
  factors: DecisionFactor[];
  dataGaps: string[];
}

const DAY_MS = 86_400_000;

// null (not 0) when the ticket carries no date, so "filed today" and "no date
// recorded" stay distinguishable — 0 made every ticket under 24 hours old
// report "Date unavailable" while its dataGaps list said the date was present.
function ticketAgeDays(ticket: Ticket, now: Date): number | null {
  const seconds = ticket.createdAt?.seconds ?? ticket.updatedAt?.seconds;
  if (!seconds) return null;
  return Math.max(0, Math.floor((now.getTime() - seconds * 1000) / DAY_MS));
}

// Only what the CITIZEN wrote. Officer notes and officer replies used to be
// scanned too, so an officer typing "arranged stay order" into their own log
// escalated the ticket they were working on to Critical — the triage would
// react to its own handling rather than to the grievance.
function citizenNarrative(ticket: Ticket): string {
  return [
    ticket.dispute?.description,
    ...(ticket.messages ?? []).filter((m) => m.from === "user").map((m) => m.body),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// Word-boundary matched: bare substring matching fired "harvest" inside
// "harvesting rights", pushing routine produce-rights filings into the
// Critical branch.
function hasAny(text: string, terms: string[]): boolean {
  return text.split(/[.!?;\n]|\bbut\b|\bhowever\b/).some(clause => terms.some(term => {
    const match = new RegExp("\\b" + term + "\\b").exec(clause);
    if (!match) return false;
    const before = clause.slice(0, match.index);
    return !/\b(no|not|never|without|lack|lacking|denies)\b/.test(before);
  }));
}

/**
 * Deterministic decision rules for officer triage.
 * It never changes a ticket automatically; it only recommends the next action.
 */
export function evaluateTicket(ticket: Ticket, now = new Date()): TicketDecision {
  const ageDays = ticketAgeDays(ticket, now);
  const narrative = citizenNarrative(ticket);
  const disputeType = ticket.dispute?.disputeType ?? "Unclassified grievance";
  const isCommunity = /community|gram sabha/i.test(ticket.dispute?.reporterType ?? "");
  const isDelay = /delay|stalled/i.test(disputeType);
  const isLandConflict = /land record|boundary|encroachment|ownership/i.test(disputeType);
  const narrativeRisk = hasAny(narrative, [
    "urgent",
    "eviction",
    "demolition",
    "displacement",
    "blocked",
    "violence",
    "stay order",
    "harvest",
    "migration begins",
  ]);
  const hasImmediateRisk = ticket.dispute?.immediateRisk === "yes";
  const hasEvidence = (ticket.dispute?.evidenceReferences?.length ?? 0) > 0;
  const actionUnderway =
    ["investigating", "inspection_scheduled"].includes(ticket.status) ||
    ((ticket.noteCount ?? 0) + (ticket.officerNotes?.length ?? 0)) > 0;

  const factors: DecisionFactor[] = [
    {
      label: "Case age",
      value: ageDays === null
        ? "Date unavailable"
        : ageDays === 0
          ? "Filed today"
          : `${ageDays} day${ageDays === 1 ? "" : "s"} in registry`,
      signal: ageDays !== null && ageDays >= 7 ? "risk" : "neutral",
    },
    { label: "Dispute pattern", value: disputeType, signal: isDelay || isLandConflict ? "risk" : "neutral" },
    { label: "People affected", value: isCommunity ? "Community / Gram Sabha" : "Individual or unspecified", signal: isCommunity ? "risk" : "neutral" },
    { label: "Immediate harm", value: hasImmediateRisk ? "Reporter explicitly reports immediate risk; staff must verify" : ticket.dispute?.immediateRisk === "no" ? "Reporter reports no immediate risk" : narrativeRisk ? "Possible risk language; ask the reporter to clarify" : "Not assessed", signal: hasImmediateRisk ? "risk" : "neutral" },
    { label: "Supporting evidence", value: hasEvidence ? "References supplied; contents have not been verified" : "No evidence references supplied", signal: hasEvidence ? "protective" : "neutral" },
    { label: "Official progress", value: actionUnderway ? "Investigation activity recorded" : "No official action recorded", signal: actionUnderway ? "protective" : "risk" },
    { label: "Contact verification", value: ticket.phoneVerified ? "Phone verified" : "Not recorded", signal: ticket.phoneVerified ? "protective" : "neutral" },
  ];

  const dataGaps = [
    !ticket.createdAt?.seconds && "Original filing date",
    !ticket.dispute?.location && "Reported coordinates or parcel boundary",
    !ticket.phoneVerified && "Reporter contact verification",
    !hasEvidence && "Documentary or GIS evidence reference",
  ].filter((gap): gap is string => Boolean(gap));

  if (ticket.status === "resolved" || ticket.status === "rejected") {
    return {
      priority: "Closed",
      recommendedAction: "Verify the closure record and retain the dossier for audit.",
      responseWindow: "Closed; verify the recorded reason",
      rationale: "The ticket is already in a terminal workflow state.",
      path: ["Terminal status? Yes", `Status = ${ticket.status}`, "Closure audit"],
      factors,
      dataGaps,
    };
  }

  if (hasImmediateRisk && (isCommunity || isLandConflict)) {
    return {
      priority: "Critical",
      recommendedAction: "Escalate to the District Level Committee and arrange an immediate field/legal safeguard review.",
      responseWindow: "Acknowledge within 4 hours; act within 24 hours",
      rationale: "The reporter explicitly reports immediate risk in a community or land conflict. Verify this report before deciding on action.",
      path: ["Terminal status? No", "Immediate harm? Yes", "Community or land conflict? Yes", "Critical escalation"],
      factors,
      dataGaps,
    };
  }

  if ((isDelay && ageDays !== null && ageDays >= 7) || (isLandConflict && hasEvidence)) {
    return {
      priority: "High",
      recommendedAction: isLandConflict
        ? "Order a joint Revenue–Forest record reconciliation and GIS/parcel verification."
        : "Request the SDLC movement register and set a dated joint-verification hearing.",
      responseWindow: "Assign within 1 working day; review within 3 days",
      rationale: isLandConflict
        ? "A land or boundary conflict has evidence references for staff to verify."
        : "A delayed FRA claim has remained in the registry beyond the seven-day triage threshold.",
      path: [
        "Terminal status? No",
        "Immediate critical combination? No",
        isLandConflict ? "Land conflict with unverified references? Yes" : "Delayed claim aged 7+ days? Yes",
        "High-priority investigation",
      ],
      factors,
      dataGaps,
    };
  }

  // "critical" is included deliberately: matching only "high" let a ticket
  // already flagged critical at intake fall through to the Routine branch.
  if (isCommunity || isDelay || isLandConflict || ticket.priority === "high" || ticket.priority === "critical") {
    return {
      priority: "Medium",
      recommendedAction: "Validate the filing, request missing evidence, and assign the appropriate SDLC case officer.",
      responseWindow: "Initial review within 3 working days",
      rationale: "The case has a recognized FRA risk factor but lacks the combination needed for urgent escalation.",
      path: ["Terminal status? No", "Critical/high branch? No", "Recognized FRA risk factor? Yes", "Standard investigation"],
      factors,
      dataGaps,
    };
  }

  return {
    priority: "Routine",
    recommendedAction: "Complete intake validation and route the ticket to the relevant district desk.",
    responseWindow: "Review within 5 working days",
    rationale: "No high-risk branch was triggered from the information currently recorded.",
    path: ["Terminal status? No", "Critical/high branch? No", "Recognized FRA risk factor? No", "Routine intake"],
    factors,
    dataGaps,
  };
}
