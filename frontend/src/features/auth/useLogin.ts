import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { signInStaff, signOutStaff, readableStaffAuthError, useStaffSession } from "./staffSession";
import type { LoginRedirectState } from "./ProtectedRoute";

/* ---------------- FAILED SIGN-IN BACKOFF ---------------- */
// Client-side friction on top of Firebase's own throttling: after a few wrong
// passwords each further attempt waits longer. This is a courtesy to a typing
// officer, not a security control: anything in this file can be bypassed by a
// script, so brute-force protection is Firebase Auth's job (and MFA, once it is
// enabled for the project). Kept in sessionStorage so a page reload does not
// reset it; storage can be unavailable, so it degrades to memory.
const BACKOFF_KEY = "staff-login-backoff";
const FREE_ATTEMPTS = 3, BASE_DELAY_MS = 5_000, MAX_DELAY_MS = 5 * 60_000;
let backoffMemory = { failures: 0, until: 0 };
function readBackoff() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(BACKOFF_KEY) || "null");
    if (parsed && Number.isFinite(parsed.failures) && Number.isFinite(parsed.until)) backoffMemory = parsed;
  } catch { /* fall back to the in-memory copy */ }
  return backoffMemory;
}
function writeBackoff(next: { failures: number; until: number }) {
  backoffMemory = next;
  try {
    if (next.failures) sessionStorage.setItem(BACKOFF_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(BACKOFF_KEY);
  } catch { /* memory copy still applies */ }
}
function recordFailedSignIn() {
  const failures = readBackoff().failures + 1;
  const delay = failures < FREE_ATTEMPTS ? 0 : Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (failures - FREE_ATTEMPTS));
  writeBackoff({ failures, until: delay ? Date.now() + delay : 0 });
  return backoffMemory;
}
const CREDENTIAL_ERRORS = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"];

/* ---------------- FIELD VALIDATION ---------------- */
export type LoginField = "email" | "password";
type FieldErrors = Partial<Record<LoginField, string>>;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailError(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Enter your work email, e.g. name@example.org.";
  if (!EMAIL_PATTERN.test(trimmed)) return "Enter a complete email address, e.g. name@example.org.";
  return undefined;
}

// Only return to an in-app path. Location state comes from ProtectedRoute,
// but anything that is not a plain "/path" falls back to the portal.
const DEFAULT_RETURN = "/officer-portal";
function safeReturnPath(from: unknown) {
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//") || from.includes("\\")) return DEFAULT_RETURN;
  return from.startsWith("/login") ? DEFAULT_RETURN : from;
}

export function useLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirect = (location.state ?? null) as LoginRedirectState | null;
  const returnTo = safeReturnPath(redirect?.from);
  const signOutNotice = redirect?.reason === "expired"
    ? "Your 8-hour staff session ended, so you were signed out. Sign in again to return to the page you were on. Anything you had not saved may need to be entered again."
    : redirect?.reason === "manual" ? "You have signed out." : null;

  // Active session state, from the front-end-only staff session store.
  const { email: sessionOfficer, ready } = useStaffSession();

  // Email login state
  const [email, setEmailValue] = useState("");
  const [password, setPasswordValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberOfficer, setRememberOfficer] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  // Account recovery explainer
  const [showForgotModal, setShowForgotModal] = useState(false);

  // UI status
  const [busy, setBusy] = useState(false);
  // busy is a render behind; the ref blocks a second submit fired in the same tick.
  const submitting = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The field the form-level error is about, so its input can point at it.
  const [errorField, setErrorField] = useState<LoginField | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Inputs that receive focus after an error. A counter lets the same field be
  // focused again after a second identical error.
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: LoginField; n: number } | null>(null);
  const requestFocus = (field: LoginField) => setFocusRequest(prev => ({ field, n: (prev?.n ?? 0) + 1 }));
  useEffect(() => {
    if (!focusRequest) return;
    const input = { email: emailRef, password: passwordRef }[focusRequest.field].current;
    input?.focus();
    if (focusRequest.field === "password") input?.select();
  }, [focusRequest]);

  // Failed sign-in backoff, shown as a live countdown. `now` only ticks while
  // a wait is in progress.
  const [backoffUntil, setBackoffUntil] = useState(() => readBackoff().until);
  // Length of the current wait, read once by screen readers.
  const [waitTotal, setWaitTotal] = useState(() => Math.max(0, Math.ceil((readBackoff().until - Date.now()) / 1000)));
  const [now, setNow] = useState(() => Date.now());
  const startWait = (until: number) => {
    const t = Date.now();
    setBackoffUntil(until);
    setNow(t);
    setWaitTotal(Math.max(0, Math.ceil((until - t) / 1000)));
  };
  useEffect(() => {
    if (backoffUntil <= Date.now()) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= backoffUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [backoffUntil]);
  const waitSeconds = Math.max(0, Math.ceil((backoffUntil - now) / 1000));

  useEffect(() => {
    const previous = document.title;
    document.title = "Staff sign-in · Land Dispute";
    return () => { document.title = previous; };
  }, []);

  // Editing a field clears its own error message.
  const clearFieldError = (field: LoginField) => setFieldErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev));
  const setEmail = (value: string) => { setEmailValue(value); clearFieldError("email"); };
  const setPassword = (value: string) => { setPasswordValue(value); clearFieldError("password"); };
  // Blur only reports a malformed address; an empty field is reported on submit.
  const handleEmailBlur = () => { if (email.trim()) setFieldErrors(prev => ({ ...prev, email: emailError(email) })); };

  const handlePasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));
  const handlePasswordBlur = () => setCapsLock(false);

  // Submit Email & Password login against real Firebase Auth, gated by the
  // officers/{uid} allow-list — see ./staffSession for how that boundary
  // is enforced.
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;

    const until = readBackoff().until;
    if (until > Date.now()) {
      // The alert already shows the countdown and the button reads "Wait …".
      startWait(until);
      return;
    }

    const errors: FieldErrors = {
      email: emailError(email),
      password: password ? undefined : "Enter your password.",
    };
    const firstInvalid = (["email", "password"] as const).find(field => errors[field]);
    setFieldErrors(errors);
    setErrorMessage(null);
    setErrorField(null);
    if (firstInvalid) { requestFocus(firstInvalid); return; }

    submitting.current = true;
    setBusy(true);
    let signedIn = false;
    try {
      await signInStaff(email, password, rememberOfficer);
      writeBackoff({ failures: 0, until: 0 });
      signedIn = true;
      navigate(returnTo, { replace: true });
    } catch (err) {
      const code = (err as { code?: string })?.code || "";
      // Only a rejected credential is a guess; a dropped connection or a failed
      // allow-list read (Firestore "unavailable") must not lock out an officer.
      if (CREDENTIAL_ERRORS.includes(code)) startWait(recordFailedSignIn().until);
      if (code === "auth/invalid-email") {
        setFieldErrors({ email: readableStaffAuthError(err) });
        requestFocus("email");
      } else {
        setErrorMessage(readableStaffAuthError(err));
        if (CREDENTIAL_ERRORS.includes(code)) { setErrorField("password"); requestFocus("password"); }
      }
    } finally {
      submitting.current = false;
      // On success keep the busy label until the portal replaces this page,
      // instead of flashing the "already signed in" card.
      if (!signedIn) setBusy(false);
    }
  };

  const handleContinue = () => navigate(returnTo, { replace: true });

  // "Sign in with a different account": end this session, then show the form.
  const handleSignOut = () => {
    void signOutStaff();
    requestFocus("email");
  };

  return {
    ready,
    sessionOfficer,
    signOutNotice,
    email,
    setEmail,
    handleEmailBlur,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    capsLock,
    handlePasswordKey,
    handlePasswordBlur,
    rememberOfficer,
    setRememberOfficer,
    emailRef,
    passwordRef,
    showForgotModal,
    setShowForgotModal,
    busy,
    waitSeconds,
    waitTotal,
    errorMessage,
    errorField,
    fieldErrors,
    handleEmailLogin,
    handleContinue,
    handleSignOut,
  };
}
