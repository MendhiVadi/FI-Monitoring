import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { addressBucket, hashId } from "../otp/identity";
import { chargeLookup, projectCaseStatus, STATUS_LOOKUPS_PER_HOUR } from "./rules";

// Status changes per case are few; the cap only bounds a pathological history.
const MAX_STATUS_EVENTS = 200;
const MAX_REQUESTS = 50;
export const NOT_FOUND = "No case matches this reference. Check it against your confirmation and try again.";

// Every lookup is charged first, found or not, so the reference space cannot
// be walked faster than the hourly cap per connection.
export async function lookupCaseStatus(db: admin.firestore.Firestore, reference: string, address: string, limit = STATUS_LOOKUPS_PER_HOUR) {
  const limitRef = db.collection("statusLookupLimits").doc(hashId(addressBucket(address)));
  await db.runTransaction(async tx => {
    const window = chargeLookup((await tx.get(limitRef)).data(), Date.now(), limit);
    if (!window) throw new HttpsError("resource-exhausted", "Too many status lookups from this connection. Try again in an hour.");
    tx.set(limitRef, window);
  });
  const ticketRef = db.collection("tickets").doc(reference);
  // Only the fields the public card shows are read at all.
  const [ticket] = await db.getAll(ticketRef, { fieldMask: ["status", "createdAt", "updatedAt"] });
  if (!ticket.exists) throw new HttpsError("not-found", NOT_FOUND);
  const [events, requests] = await Promise.all([
    ticketRef.collection("events").where("kind", "==", "status").select("after", "at").limit(MAX_STATUS_EVENTS).get(),
    db.collection("documentRequests").where("ticketId", "==", reference).select("kind", "requestedAt", "expiresAt", "fulfilledAt").limit(MAX_REQUESTS).get(),
  ]);
  return projectCaseStatus(reference, ticket.data()!, events.docs.map(doc => doc.data()),
    requests.docs.map(doc => ({ id: doc.id, ...doc.data() })), Date.now());
}
