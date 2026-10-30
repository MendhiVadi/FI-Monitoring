import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { hasAccess, normalizeAccess, type StaffAccess } from "./access";

export { STAFF_ACCESS, hasAccess, normalizeAccess, type StaffAccess } from "./access";
export const SHIFT_SECONDS = 8 * 60 * 60;
export interface StaffAuth { uid: string; token: { auth_time?: number; email?: string } }
export interface StaffIdentity { uid: string; email: string; access: StaffAccess; role: string | null; displayName: string | null }
export function assertFreshSession(auth: StaffAuth | undefined, now = Date.now()) {
  const signedIn = auth?.token?.auth_time;
  if (!auth || typeof signedIn !== "number" || !Number.isInteger(signedIn) ||
      signedIn <= 0 || signedIn > now / 1000 + 60 || now / 1000 - signedIn >= SHIFT_SECONDS) {
    throw new HttpsError("unauthenticated", "Your eight-hour staff session ended. Sign in again.");
  }
  return auth;
}
const label = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
// Allow-listed staff with at least `min` access (viewer < officer < admin).
export async function requireOfficer(auth: StaffAuth | undefined, min: StaffAccess = "officer"): Promise<StaffIdentity> {
  const current = assertFreshSession(auth);
  const officer = await db.collection("officers").doc(current.uid).get();
  if (!officer.exists) throw new HttpsError("permission-denied", "This account is not on the staff allow-list.");
  const data = officer.data()!, access = normalizeAccess(data.access);
  if (!hasAccess(access, min)) {
    throw new HttpsError("permission-denied", min === "admin" ? "This action needs administrator access." : "Your account has read-only access.");
  }
  return { uid: current.uid, email: current.token.email || "", access, role: label(data.role), displayName: label(data.displayName) };
}
// Identity stored on every new staff write (status event, note, review,
// assignment, staff-triggered escalation). The UI shows the name, else the
// email, plus the role. Without a role label the access level stands in, as
// for document reviews (documents/service.ts officerFields).
export function staffStamp(officer: StaffIdentity) {
  return { officerUid: officer.uid, officerEmail: officer.email || null, officerName: officer.displayName, officerRole: officer.role ?? officer.access };
}
