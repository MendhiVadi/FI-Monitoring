import { useSyncExternalStore } from "react";
import { browserLocalPersistence, browserSessionPersistence, onIdTokenChanged, setPersistence, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "../../shared/firebase/firebase";

const SHIFT_MS = 8 * 60 * 60 * 1000;
// Why the last session ended: "expired" when the eight-hour shift ran out,
// "manual" when staff signed out, null otherwise. The login page uses it to say
// why the officer was sent back there.
export type StaffSignOutReason = "expired" | "manual" | null;

// officers/{uid}.access (vault/Wave-2-Spec.md §1). Viewers pass the allow-list
// but only see masked data through the callables; the server enforces this,
// the client only hides controls it would refuse.
export type StaffAccess = "viewer" | "officer" | "admin";
const ACCESS_RANK: Record<StaffAccess, number> = { viewer: 0, officer: 1, admin: 2 };
export function hasAccess(access: StaffAccess | null | undefined, min: StaffAccess) {
  return Boolean(access) && ACCESS_RANK[access!] >= ACCESS_RANK[min];
}
// A missing level means "officer" (accounts created before access levels). An
// unrecognised value gets the least the server could grant, so no control is
// shown that the server would refuse.
function readAccess(value: unknown): StaffAccess {
  if (value === undefined || value === null) return "officer";
  return value === "viewer" || value === "officer" || value === "admin" ? value : "viewer";
}
const optionalText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;

interface StaffProfile { access: StaffAccess; role: string | null; displayName: string | null }
type StaffSessionState = {
  email: string | null; isStaff: boolean; ready: boolean;
  /** Epoch ms when the eight-hour session ends; null while signed out. */
  expiresAt: number | null;
  lastSignOutReason: StaffSignOutReason;
  uid: string | null;
  /** null while signed out. */
  access: StaffAccess | null;
  /** The officers/{uid} role label (free text) and display name, when set. */
  role: string | null;
  displayName: string | null;
};
const SIGNED_OUT = { uid: null, access: null, role: null, displayName: null } as const;
let state: StaffSessionState = { email: null, isStaff: false, ready: false, expiresAt: null, lastSignOutReason: null, ...SIGNED_OUT };
let expiresAt = 0, generation = 0, validatedUid: string | null = null;
let signOutReason: StaffSignOutReason = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;
function publish(email: string | null, ready = true, profile: StaffProfile | null = null) {
  const signedIn = email !== null && profile !== null;
  validatedUid = signedIn ? auth.currentUser?.uid ?? null : null;
  if (signedIn) signOutReason = null;
  state = {
    email: signedIn ? email : null, isStaff: signedIn, ready, expiresAt: signedIn && expiresAt ? expiresAt : null, lastSignOutReason: signOutReason,
    ...(signedIn ? { uid: validatedUid, ...profile } : SIGNED_OUT),
  };
  listeners.forEach(fn => fn());
}
// A sign-in runs this check twice at once (signInStaff and the onIdTokenChanged
// listener). Share one server read per uid for a few seconds instead of two.
// Resolves null when the account is not on the allow-list.
let officerCheck: { uid: string; at: number; result: Promise<StaffProfile | null> } | null = null;
function officerProfile(uid: string) {
  if (officerCheck && officerCheck.uid === uid && Date.now() - officerCheck.at < 5_000) return officerCheck.result;
  const result = (async (): Promise<StaffProfile | null> => {
    const [{ doc, getDocFromServer }, { db }] = await Promise.all([import("firebase/firestore"), import("../../shared/firebase/firestore")]);
    const officer = await getDocFromServer(doc(db, "officers", uid));
    if (!officer.exists()) return null;
    const data = officer.data();
    return { access: readAccess(data.access), role: optionalText(data.role), displayName: optionalText(data.displayName) };
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
    const profile = await officerProfile(user.uid);
    if (!profile) { if (mine === generation) { signOutReason = null; await signOut(auth); } return; }
    if (mine !== generation) return;
    expiresAt = expiry;
    // Republishing on each token refresh also picks up a changed access level.
    publish(user.email, true, profile);
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
    const profile = await officerProfile(credential.user.uid);
    if (!profile) throw new NotAnOfficerError("This account does not have staff access. Contact the administrator for this deployment.");
    expiresAt = await sessionExpiry(credential.user);
    if (Date.now() >= expiresAt) throw new Error("Your session expired. Sign in again.");
    publish(credential.user.email, true, profile);
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
