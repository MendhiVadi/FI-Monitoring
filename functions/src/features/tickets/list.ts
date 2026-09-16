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
export const listTickets = onCall({ invoker: "public" }, async request => {
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
    if (!Number.isInteger(cursor.seconds) || !Number.isInteger(cursor.nanoseconds) || cursor.nanoseconds < 0 ||
        cursor.nanoseconds >= 1e9 || typeof cursor.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(cursor.id)) {
      throw new HttpsError("invalid-argument", "Invalid page reference.");
    }
    query = query.startAfter(new admin.firestore.Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id);
  }
  const batch = await query.limit(201).get();
  const tickets: ReturnType<typeof serialize>[] = [];
  let last: admin.firestore.QueryDocumentSnapshot | undefined, examined = 0;
  for (const item of batch.docs.slice(0, 200)) {
    examined++; last = item;
    if (matches(item.id, item.data())) tickets.push(serialize(item));
    if (tickets.length === 50) break;
  }
  // Exact ID lookup is independent of pagination, so an old reference is immediately reachable.
  if (!cursor && /^[a-zA-Z0-9_-]{20,128}$/.test(request.data?.search || "")) {
    const [exact] = await db.getAll(collection.doc(request.data.search), { fieldMask: fields });
    if (exact.exists && matches(exact.id, exact.data()) && !tickets.some(t => t.id === exact.id)) tickets.unshift(serialize(exact));
  }
  const hasMore = Boolean(last && (examined < batch.size || batch.size === 201));
  const lastTime = last?.get("updatedAt");
  const nextCursor = hasMore && lastTime ? { ...wireDate(lastTime), id: last!.id } : null;
  let stats = null;
  if (!cursor) {
    const statuses = ["open", "investigating", "inspection_scheduled", "resolved", "rejected"];
    const [total, ...counts] = await Promise.all([collection.count().get(), ...statuses.map(value => collection.where("status", "==", value).count().get())]);
    stats = { total: total.data().count, open: counts[0].data().count,
      investigating: counts[1].data().count + counts[2].data().count, resolved: counts[3].data().count, rejected: counts[4].data().count };
  }
  return { tickets, nextCursor, stats };
});
