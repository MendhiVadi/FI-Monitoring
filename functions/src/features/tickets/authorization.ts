import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";

export const SHIFT_SECONDS = 8 * 60 * 60;
export interface StaffAuth { uid: string; token: { auth_time?: number; email?: string } }
export function assertFreshSession(auth: StaffAuth | undefined, now = Date.now()) {
  const signedIn = auth?.token?.auth_time;
  if (!auth || typeof signedIn !== "number" || !Number.isInteger(signedIn) ||
      signedIn <= 0 || signedIn > now / 1000 + 60 || now / 1000 - signedIn >= SHIFT_SECONDS) {
    throw new HttpsError("unauthenticated", "Your eight-hour staff session ended. Sign in again.");
  }
  return auth;
}
export async function requireOfficer(auth: StaffAuth | undefined) {
  const current = assertFreshSession(auth);
  const officer = await db.collection("officers").doc(current.uid).get();
  if (!officer.exists) throw new HttpsError("permission-denied", "This account is not on the staff allow-list.");
  return { ...officer.data(), uid: current.uid, email: current.token.email || "" };
}
