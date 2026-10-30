import * as admin from "firebase-admin";
import contract from "../../platform/contracts/dispute.json";
import { TICKET_STATUSES } from "../tickets/status";
import { NON_TERMINAL_STATUSES, waitingCutoff } from "../cases/targets";
import { isFlaggedRisk, REVIEW_DECISIONS } from "../documents/rules";
import { ageingBuckets, foldStates, freshCache, partyTypesByCaseType, recentWeekStarts, WEEK_MS } from "./buckets";

export const INSIGHTS_TTL_MS = 10 * 60 * 1000;
const FLAGGED_RISKS = ["low", "medium", "high", "altered"].filter(isFlaggedRisk);
const CASE_TYPES = ["citizen_vs_government", "person_vs_person"] as const;

export interface Insights {
  generatedAt: number;
  byStatus: Record<string, number>;
  byCategory: { label: string; count: number }[];
  byState: { state: string; count: number }[];
  byCaseType: { citizen_vs_government: number; person_vs_person: number; unknown: number };
  ageing: { d0_7: number; d8_30: number; d31_90: number; d90p: number };
  weeklyIntake: { weekStart: number; count: number }[];
  overdue: { acknowledge: number; resolve: number };
  documents: { uploaded: number; flagged: number; reviewed: number };
}

// Registry-wide figures from count() aggregations only: no document is read,
// so nothing personal can reach the response, and the cost grows with the
// number of buckets rather than the number of cases.
export async function computeInsights(db: admin.firestore.Firestore, now: number): Promise<Insights> {
  const tickets = db.collection("tickets"), documents = db.collection("caseDocuments");
  const count = async (query: admin.firestore.Query) => (await query.count().get()).data().count;
  const before = (ms: number) => admin.firestore.Timestamp.fromMillis(ms);
  const open = () => tickets.where("status", "in", NON_TERMINAL_STATUSES);
  const olderThan = (days: number) => count(open().where("createdAt", "<", before(waitingCutoff(now, days))));
  const statuses = Object.keys(TICKET_STATUSES), categories = contract.disputeTypes, states = Object.keys(contract.districts);
  const partyGroups = partyTypesByCaseType(contract.documents.caseTypeByPartyType, CASE_TYPES);
  const caseTypeCount = (caseType: string) => partyGroups[caseType].length
    ? count(tickets.where("dispute.otherPartyType", "in", partyGroups[caseType])) : Promise.resolve(0);
  const weeks = recentWeekStarts(now, 12);
  const attached = documents.where("status", "==", "attached");

  const [total, byStatus, byCategory, byState, citizen, person, ageing, weekly, acknowledge, resolve, uploaded, flagged, reviewed] = await Promise.all([
    count(tickets),
    Promise.all(statuses.map(status => count(tickets.where("status", "==", status)))),
    Promise.all(categories.map(label => count(tickets.where("dispute.disputeType", "==", label)))),
    Promise.all(states.map(state => count(tickets.where("dispute.state", "==", state)))),
    caseTypeCount("citizen_vs_government"),
    caseTypeCount("person_vs_person"),
    Promise.all([count(open()), olderThan(7), olderThan(30), olderThan(90)]),
    Promise.all(weeks.map(start => count(tickets.where("createdAt", ">=", before(start)).where("createdAt", "<", before(start + WEEK_MS))))),
    count(tickets.where("overdue", "==", "acknowledge")),
    count(tickets.where("overdue", "==", "resolve")),
    count(attached),
    count(attached.where("screening.risk", "in", FLAGGED_RISKS)),
    count(attached.where("review.decision", "in", [...REVIEW_DECISIONS])),
  ]);
  return {
    generatedAt: now,
    byStatus: Object.fromEntries(statuses.map((status, index) => [status, byStatus[index]])),
    byCategory: categories.map((label, index) => ({ label, count: byCategory[index] })),
    // Small per-state counts can point to one household, so they are folded into "Other".
    byState: foldStates(states.map((state, index) => ({ state, count: byState[index] }))),
    byCaseType: { citizen_vs_government: citizen, person_vs_person: person, unknown: Math.max(0, total - citizen - person) },
    ageing: ageingBuckets(...ageing),
    weeklyIntake: weeks.map((weekStart, index) => ({ weekStart, count: weekly[index] })),
    overdue: { acknowledge, resolve },
    documents: { uploaded, flagged, reviewed },
  };
}

// One shared snapshot in the server-only `insightsCache/current`, so repeated
// dashboard loads within ten minutes cost one document read. Concurrent
// misses may each recompute; the last write wins and the figures agree.
export async function cachedInsights(db: admin.firestore.Firestore, now: number): Promise<Insights> {
  const ref = db.collection("insightsCache").doc("current");
  const cached = freshCache<Insights>((await ref.get()).data(), now, INSIGHTS_TTL_MS);
  if (cached) return cached;
  const insights = await computeInsights(db, now);
  try {
    await ref.set({ generatedAt: insights.generatedAt, insights });
  } catch (err) {
    // A failed cache write only costs the next caller a recompute.
    console.warn("Insights cache write failed", { code: (err as { code?: unknown })?.code ?? "unknown" });
  }
  return insights;
}
