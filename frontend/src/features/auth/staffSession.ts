import { useSyncExternalStore } from "react";
import { browserLocalPersistence, browserSessionPersistence, onIdTokenChanged, setPersistence, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "../../shared/firebase/firebase";

const SHIFT_MS = 8 * 60 * 60 * 1000;
// Why the last session ended: "expired" when the eight-hour shift ran out,
// "manual" when staff signed out, null otherwise. The login page uses it to say
// why the officer was sent back there.
export type StaffSignOutReason = "expired" | "manual" | null;
type StaffSessionState = {
  email: string | null; isStaff: boolean; ready: boolean;
  /** Epoch ms when the eight-hour session ends; null while signed out. */
  expiresAt: number | null;
  lastSignOutReason: StaffSignOutReason;
};
let state: StaffSessionState = { email: null, isStaff: false, ready: false, expiresAt: null, lastSignOutReason: null };
let expiresAt = 0, generation = 0, validatedUid: string | null = null;
let signOutReason: StaffSignOutReason = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;
function publish(email: string | null, ready = true) {
  validatedUid = email ? auth.currentUser?.uid ?? null : null;
  if (email) signOutReason = null;
  state = { email, isStaff: email !== null, ready, expiresAt: email && expiresAt ? expiresAt : null, lastSignOutReason: signOutReason };
  listeners.forEach(fn => fn());
}
// A sign-in runs this check twice at once (signInStaff and the onIdTokenChanged
// listener). Share one server read per uid for a few seconds instead of two.
let officerCheck: { uid: string; at: number; result: Promise<boolean> } | null = null;
function officerDocExists(uid: string) {
  if (officerCheck && officerCheck.uid === uid && Date.now() - officerCheck.at < 5_000) return officerCheck.result;
  const result = (async () => {
    const [{ doc, getDocFromServer }, { db }] = await Promise.all([import("firebase/firestore"), import("../../shared/firebase/firestore")]);
    return (await getDocFromServer(doc(db, "officers", uid))).exists();
  })();
  const entry = { uid, at: Date.now(), result };
  officerCheck = entry;
  // Never cache a failure: the next attempt must hit the server again.
  result.catch(() => { if (officerCheck === entry) officerCheck = null; });
  return result;
}
async function sessionExpiry(user: NonNullable<typeof auth.currentUser>) {
  const token = await user.getIdTokenResult();
  const seconds = token.claims.auth_time;
  return typeof seconds === "number" ? seconds * 1000 + SHIFT_MS : 0;
}
onIdTokenChanged(auth, async user => {
  const mine = ++generation;
  // Refreshing a token does not end the authenticated session. Keep the current
  // screen mounted while rechecking the same officer so unsaved notes survive.
  if (!user || validatedUid !== user.uid || Date.now() >= expiresAt) {
    expiresAt = 0;
    publish(null, !user);
  }
  if (!user) return;
  try {
    const expiry = await sessionExpiry(user);
    if (mine !== generation) return;
    if (Date.now() >= expiry) { signOutReason = "expired"; await signOut(auth); return; }
    if (!await officerDocExists(user.uid)) { if (mine === generation) { signOutReason = null; await signOut(auth); } return; }
    if (mine !== generation) return;
    expiresAt = expiry;
    publish(user.email);
  } catch { if (mine === generation) publish(null); }
});
setInterval(() => {
  if (auth.currentUser && expiresAt && Date.now() >= expiresAt) void signOutStaff("expired");
}, 15_000);

export class NotAnOfficerError extends Error {}
export async function signInStaff(email: string, password: string, remember = false) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  try {
    if (!await officerDocExists(credential.user.uid)) throw new NotAnOfficerError("This account does not have staff access. Contact the administrator for this deployment.");
    expiresAt = await sessionExpiry(credential.user);
    if (Date.now() >= expiresAt) throw new Error("Your session expired. Sign in again.");
    publish(credential.user.email);
  } catch (error) { await endSession(null); throw error; }
}
async function endSession(reason: StaffSignOutReason) {
  ++generation;
  expiresAt = 0;
  officerCheck = null;
  signOutReason = reason;
  publish(null);
  await signOut(auth);
}
/** Ends the staff session. Buttons call it with no argument ("manual"). */
export function signOutStaff(reason: Exclude<StaffSignOutReason, null> = "manual") { return endSession(reason); }
export function useStaffSession() { return useSyncExternalStore(subscribe, snapshot, snapshot); }
export function readableStaffAuthError(err: unknown) {
  if (err instanceof NotAnOfficerError) return err.message;
  const code = (err as { code?: string })?.code;
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code || "")) return "The email or password is incorrect.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/too-many-requests") return "Too many attempts from this device. Wait a few minutes, then try again.";
  if (code === "auth/network-request-failed") return "Check your connection and try again.";
  if (code === "auth/user-disabled") return "This account has been disabled. Contact the administrator for this deployment.";
  return "Sign-in or staff access check failed. Check your connection and try again.";
}
