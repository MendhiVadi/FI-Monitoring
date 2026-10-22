import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { requireOfficer } from "./authorization";

const fields = ["subject", "status", "waFrom", "source", "phoneVerified", "revision", "noteCount", "createdAt", "updatedAt",
  "dispute.reporterName", "dispute.otherPartyName", "dispute.reporterType", "dispute.otherPartyType", "dispute.disputeType", "dispute.state", "dispute.district", "dispute.village"];
const wireDate = (date: any) => date && typeof date.seconds === "number" ? { seconds: date.seconds, nanoseconds: date.nanoseconds || 0 } : null;
function serialize(snapshot: admin.firestore.DocumentSnapshot) {
  const data = snapshot.data()!;
  return { ...data, id: snapshot.id, createdAt: wireDate(data.createdAt), updatedAt: wireDate(data.updatedAt) };
}
// Firestore Timestamp's own range; out-of-range values would otherwise throw an internal error.
const MAX_TIMESTAMP_SECONDS = 253_402_300_799;
export const listTickets = onCall({ invoker: "public", maxInstances: 10 }, async request => {
  await requireOfficer(request.auth);
  const search = typeof request.data?.search === "string" ? request.data.search.trim().toLowerCase() : "";
  const status = typeof request.data?.status === "string" ? request.data.status : "all";
  const disputeType = typeof request.data?.disputeType === "string" ? request.data.disputeType : "all";
  if (search.length > 120 || status.length > 80 || disputeType.length > 80) throw new HttpsError("invalid-argument", "Search is too long.");
  const collection = db.collection("tickets");
  const matches = (id: string, data: any) =>
    (status === "all" || data.status === status) && (disputeType === "all" || data.dispute?.disputeType === disputeType) &&
    (!search || [id, data.subject, data.waFrom, data.dispute?.reporterName, data.dispute?.otherPartyName,
      data.dispute?.state, data.dispute?.district].some(value => typeof value === "string" && value.toLowerCase().includes(search)));
  const cursor = request.data?.cursor;
  let query = collection.orderBy("updatedAt", "desc").orderBy(admin.firestore.FieldPath.documentId(), "desc").select(...fields);
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
  const [batch, exactSnapshots, counts] = await Promise.all([
    query.limit(201).get(),
    exactId ? db.getAll(collection.doc(exactId), { fieldMask: fields }) : Promise.resolve([]),
    // One `in` aggregation covers both "investigating" stages the dashboard reports together.
    cursor ? Promise.resolve(null) : Promise.all([collection.count().get(), count("open"),
      count(["investigating", "inspection_scheduled"]), count("resolved"), count("rejected")]),
  ]);
  const tickets: ReturnType<typeof serialize>[] = [];
  let last: admin.firestore.QueryDocumentSnapshot | undefined, examined = 0;
  for (const item of batch.docs.slice(0, 200)) {
    examined++; last = item;
    if (matches(item.id, item.data())) tickets.push(serialize(item));
    if (tickets.length === 50) break;
  }
  // Exact ID lookup is independent of pagination, so an old reference is immediately reachable.
  const [exact] = exactSnapshots;
  if (exact?.exists && matches(exact.id, exact.data()) && !tickets.some(t => t.id === exact.id)) tickets.unshift(serialize(exact));
  const hasMore = Boolean(last && (examined < batch.size || batch.size === 201));
  const lastTime = last?.get("updatedAt");
  const nextCursor = hasMore && lastTime ? { ...wireDate(lastTime), id: last!.id } : null;
  const stats = counts && { total: counts[0].data().count, open: counts[1].data().count,
    investigating: counts[2].data().count, resolved: counts[3].data().count, rejected: counts[4].data().count };
  return { tickets, nextCursor, stats };
});
