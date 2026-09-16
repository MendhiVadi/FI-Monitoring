import { useSyncExternalStore } from "react";
import { browserLocalPersistence, browserSessionPersistence, onIdTokenChanged, setPersistence, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "../../shared/firebase/firebase";

const SHIFT_MS = 8 * 60 * 60 * 1000;
let state = { email: null as string | null, isStaff: false, ready: false };
let expiresAt = 0, generation = 0, validatedUid: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;
function publish(email: string | null, ready = true) {
  validatedUid = email ? auth.currentUser?.uid ?? null : null;
  state = { email, isStaff: email !== null, ready };
  listeners.forEach(fn => fn());
}
async function officerDocExists(uid: string) {
  const [{ doc, getDocFromServer }, { db }] = await Promise.all([import("firebase/firestore"), import("../../shared/firebase/firestore")]);
  return (await getDocFromServer(doc(db, "officers", uid))).exists();
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
    if (Date.now() >= expiry) { await signOut(auth); return; }
    if (!await officerDocExists(user.uid)) { if (mine === generation) await signOut(auth); return; }
    if (mine !== generation) return;
    expiresAt = expiry;
    publish(user.email);
  } catch { if (mine === generation) publish(null); }
});
setInterval(() => {
  if (auth.currentUser && expiresAt && Date.now() >= expiresAt) void signOutStaff();
}, 15_000);

export class NotAnOfficerError extends Error {}
export async function signInStaff(email: string, password: string, remember = false) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  try {
    if (!await officerDocExists(credential.user.uid)) throw new NotAnOfficerError("This account is not on the officer allow-list. Contact the project administrator.");
    expiresAt = await sessionExpiry(credential.user);
    if (Date.now() >= expiresAt) throw new Error("Your session expired. Sign in again.");
    publish(credential.user.email);
  } catch (error) { await signOutStaff(); throw error; }
}
export async function signOutStaff() {
  ++generation;
  expiresAt = 0;
  publish(null);
  await signOut(auth);
}
export function useStaffSession() { return useSyncExternalStore(subscribe, snapshot, snapshot); }
export function readableStaffAuthError(err: unknown) {
  if (err instanceof NotAnOfficerError) return err.message;
  const code = (err as { code?: string })?.code;
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code || "")) return "The email or password is incorrect.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait before trying again.";
  if (code === "auth/network-request-failed") return "Check your connection and try again.";
  if (code === "auth/user-disabled") return "This account has been disabled. Contact the administrator.";
  return "Sign-in or officer verification failed. Check your connection and try again.";
}
