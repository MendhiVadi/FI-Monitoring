import { onCall } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { appCheckOption } from "../../platform/appCheck";
import { requireOfficer, normalizeAccess } from "./authorization";

const MAX_OFFICERS = 200;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;

// The staff directory for the assignment picker (officer+; viewers never see
// staff emails). The allow-list is small, so one bounded read is enough.
export const listOfficers = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 5 }, async (request) => {
  await requireOfficer(request.auth);
  const snapshot = await db.collection("officers").select("email", "displayName", "role", "access").limit(MAX_OFFICERS).get();
  const officers = snapshot.docs.map(doc => ({ uid: doc.id, email: text(doc.get("email")), displayName: text(doc.get("displayName")),
    role: text(doc.get("role")), access: normalizeAccess(doc.get("access")) }));
  officers.sort((a, b) => (a.displayName ?? a.email ?? a.uid).localeCompare(b.displayName ?? b.email ?? b.uid));
  return { officers };
});
