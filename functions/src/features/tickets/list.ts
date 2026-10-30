import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { appCheckOption } from "../../platform/appCheck";
import { requireOfficer } from "./authorization";
import { validStaffUid } from "./access";
import { NON_TERMINAL_STATUSES, OVERDUE_STATES, waitingCutoff } from "../cases/targets";
import { maskedListTicket } from "../cases/masking";

const fields = ["subject", "status", "waFrom", "source", "phoneVerified", "revision", "noteCount", "createdAt", "updatedAt",
  "dispute.reporterName", "dispute.otherPartyName", "dispute.reporterType", "dispute.otherPartyType", "dispute.disputeType", "dispute.state", "dispute.district", "dispute.village",
  "documents", "closedAt", "assignedTo", "assignedEmail", "assignedName", "assignedAt", "overdue", "overdueSince",
  "ackDueAt", "resolveDueAt", "firstActionAt", "openDocumentRequests"];
const wireDate = (date: any) => date && typeof date.seconds === "number" ? { seconds: date.seconds, nanoseconds: date.nanoseconds || 0 } : null;
function serialize(snapshot: admin.firestore.DocumentSnapshot) {
  const data = snapshot.data()!;
  return { ...data, id: snapshot.id, createdAt: wireDate(data.createdAt), updatedAt: wireDate(data.updatedAt) };
}
// "me" | "unassigned" | a staff uid; "all" or nothing means no filter.
export function parseAssignee(value: unknown, selfUid: string): string | null | undefined {
  if (value === undefined || value === null || value === "all" || value === "") return undefined;
  if (value === "me") return selfUid;
  if (value === "unassigned") return null;
  if (validStaffUid(value)) return value;
  throw new HttpsError("invalid-argument", "Choose a valid assignee filter.");
}
// Firestore Timestamp's own range; out-of-range values would otherwise throw an internal error.
const MAX_TIMESTAMP_SECONDS = 253_402_300_799;
export const listTickets = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 10 }, async request => {
  const officer = await requireOfficer(request.auth, "viewer");
  const viewer = officer.access === "viewer";
  const search = typeof request.data?.search === "string" ? request.data.search.trim().toLowerCase() : "";
  const status = typeof request.data?.status === "string" ? request.data.status : "all";
  const disputeType = typeof request.data?.disputeType === "string" ? request.data.disputeType : "all";
  if (search.length > 120 || status.length > 80 || disputeType.length > 80) throw new HttpsError("invalid-argument", "Search is too long.");
  const assignee = parseAssignee(request.data?.assignee, officer.uid);
  const overdueOnly = request.data?.overdue === true;
  const collection = db.collection("tickets");
  // A viewer searches what a viewer can see: masked names and no phone
  // numbers, so a search cannot confirm who filed or is named in a case.
  const searchable = (id: string, data: any): unknown[] => viewer
    ? (({ subject, dispute }) => [id, subject, dispute?.reporterName, dispute?.otherPartyName, dispute?.state, dispute?.district])(maskedListTicket(data))
    : [id, data.subject, data.waFrom, data.dispute?.reporterName, data.dispute?.otherPartyName, data.dispute?.state, data.dispute?.district];
  const matches = (id: string, data: any) =>
    (status === "all" || data.status === status) && (disputeType === "all" || data.dispute?.disputeType === disputeType) &&
    (assignee === undefined || (data.assignedTo ?? null) === assignee) &&
    (!overdueOnly || (OVERDUE_STATES as readonly unknown[]).includes(data.overdue)) &&
    (!search || searchable(id, data).some(value => typeof value === "string" && value.toLowerCase().includes(search)));
  const cursor = request.data?.cursor;
  // Assignee and overdue filters run in the query (composite indexes in
  // firestore.indexes.json), so those views are not limited to the 200 most
  // recently updated cases; the other filters still apply to each scanned page.
  let filtered: admin.firestore.Query = collection;
  if (assignee !== undefined) filtered = filtered.where("assignedTo", "==", assignee);
  if (overdueOnly) filtered = filtered.where("overdue", "in", [...OVERDUE_STATES]);
  let query = filtered.orderBy("updatedAt", "desc").orderBy(admin.firestore.FieldPath.documentId(), "desc").select(...fields);
  if (cursor) {
    if (typeof cursor !== "object" || !Number.isInteger(cursor.seconds) || cursor.seconds < 0 || cursor.seconds > MAX_TIMESTAMP_SECONDS ||
        !Number.isInteger(cursor.nanoseconds) || cursor.nanoseconds < 0 ||
        cursor.nanoseconds >= 1e9 || typeof cursor.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(cursor.id)) {
      throw new HttpsError("invalid-argument", "Invalid page reference.");
    }
    query = query.startAfter(new admin.firestore.Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id);
  }
  // The page scan, exact-ID lookup and registry counts are independent, so run them together.
  const rawSearch = typeof request.data?.search === "string" ? request.data.search : "";
  const exactId = !cursor && /^[a-zA-Z0-9_-]{20,128}$/.test(rawSearch) ? rawSearch : null;
  const count = (value: string | string[]) =>
    (Array.isArray(value) ? collection.where("status", "in", value) : collection.where("status", "==", value)).count().get();
  const now = Date.now();
  const waiting = (days: number) => collection.where("status", "in", NON_TERMINAL_STATUSES)
    .where("createdAt", "<", admin.firestore.Timestamp.fromMillis(waitingCutoff(now, days))).count().get();
  const [batch, exactSnapshots, counts] = await Promise.all([
    query.limit(201).get(),
    exactId ? db.getAll(collection.doc(exactId), { fieldMask: fields }) : Promise.resolve([]),
    // One `in` aggregation covers both "investigating" stages the dashboard reports together.
    cursor ? Promise.resolve(null) : Promise.all([collection.count().get(), count("open"),
      count(["investigating", "inspection_scheduled"]), count("resolved"), count("rejected"),
      collection.where("overdue", "in", [...OVERDUE_STATES]).count().get(), waiting(7), waiting(30)]),
  ]);
  const present = (snapshot: admin.firestore.DocumentSnapshot) => viewer ? maskedListTicket(serialize(snapshot)) : serialize(snapshot);
  const tickets: ReturnType<typeof serialize>[] = [];
  let last: admin.firestore.QueryDocumentSnapshot | undefined, examined = 0;
  for (const item of batch.docs.slice(0, 200)) {
    examined++; last = item;
    if (matches(item.id, item.data())) tickets.push(present(item));
    if (tickets.length === 50) break;
  }
  // Exact ID lookup is independent of pagination, so an old reference is immediately reachable.
  const [exact] = exactSnapshots;
  if (exact?.exists && matches(exact.id, exact.data()) && !tickets.some(t => t.id === exact.id)) tickets.unshift(present(exact));
  const hasMore = Boolean(last && (examined < batch.size || batch.size === 201));
  const lastTime = last?.get("updatedAt");
  const nextCursor = hasMore && lastTime ? { ...wireDate(lastTime), id: last!.id } : null;
  const stats = counts && { total: counts[0].data().count, open: counts[1].data().count,
    investigating: counts[2].data().count, resolved: counts[3].data().count, rejected: counts[4].data().count,
    overdue: counts[5].data().count, waiting7: counts[6].data().count, waiting30: counts[7].data().count };
  return { tickets, nextCursor, stats };
});
