import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { signInStaff, signOutStaff, readableStaffAuthError, useStaffSession } from "./staffSession";
import type { LoginRedirectState } from "./ProtectedRoute";

/* ---------------- CAPTCHA GENERATOR HELPERS ---------------- */
function generateCaptchaCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Omit ambiguous characters like 0, O, 1, I
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Spoken letters like B/D/P/E/V sound alike, so the audio and text versions
// use phonetic words: "B as in Bravo, number seven, …".
const PHONETIC: Record<string, string> = {
  A: "Alpha", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo", F: "Foxtrot", G: "Golf", H: "Hotel",
  J: "Juliett", K: "Kilo", L: "Lima", M: "Mike", N: "November", P: "Papa", Q: "Quebec", R: "Romeo",
  S: "Sierra", T: "Tango", U: "Uniform", V: "Victor", W: "Whiskey", X: "X-ray", Y: "Yankee", Z: "Zulu",
};
const DIGIT_WORDS: Record<string, string> = { "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine" };
function spellCaptcha(code: string) {
  return code.split("").map(c => (PHONETIC[c] ? `${c} as in ${PHONETIC[c]}` : `number ${DIGIT_WORDS[c] ?? c}`)).join(", ");
}

/* ---------------- FAILED SIGN-IN BACKOFF ---------------- */
// Client-side friction on top of Firebase's own throttling: after a few wrong
// passwords each further attempt waits longer. Kept in sessionStorage so a page
// reload does not reset it; storage can be unavailable, so it degrades to memory.
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
export type LoginField = "email" | "password" | "captcha";
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

  // Security CAPTCHA state
  const [captchaCode, setCaptchaCode] = useState(() => generateCaptchaCode(6));
  const [captchaInput, setCaptchaInputValue] = useState("");
  // Text version of the code, shown only when the browser cannot speak it.
  const [captchaSpelled, setCaptchaSpelled] = useState<string | null>(null);
  const [canvasEl, canvasRef] = useState<HTMLCanvasElement | null>(null);

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
  const captchaRef = useRef<HTMLInputElement | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: LoginField; n: number } | null>(null);
  const requestFocus = (field: LoginField) => setFocusRequest(prev => ({ field, n: (prev?.n ?? 0) + 1 }));
  useEffect(() => {
    if (!focusRequest) return;
    const input = { email: emailRef, password: passwordRef, captcha: captchaRef }[focusRequest.field].current;
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
  const setCaptchaInput = (value: string) => { setCaptchaInputValue(value); clearFieldError("captcha"); };
  // Blur only reports a malformed address; an empty field is reported on submit.
  const handleEmailBlur = () => { if (email.trim()) setFieldErrors(prev => ({ ...prev, email: emailError(email) })); };

  const handlePasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));
  const handlePasswordBlur = () => setCapsLock(false);

  // Render Security CAPTCHA onto HTML5 Canvas. The canvas is a callback ref
  // because the form (and so the canvas) mounts only after the session check,
  // later than the first code is generated.
  useEffect(() => {
    const canvas = canvasEl;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background gradient with grid
    const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bgGrad.addColorStop(0, "#081324");
    bgGrad.addColorStop(1, "#030811");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle security grid
    ctx.strokeStyle = "rgba(123, 216, 159, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 12) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Noise dots
    for (let i = 0; i < 45; i++) {
      ctx.fillStyle = `rgba(123, 216, 159, ${Math.random() * 0.4})`;
      ctx.beginPath();
      ctx.arc(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        Math.random() * 1.6 + 0.4,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // Distorted crossing curves
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i % 2 === 0 ? "rgba(123, 216, 159, 0.35)" : "rgba(96, 165, 250, 0.35)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, Math.random() * canvas.height);
      ctx.bezierCurveTo(
        canvas.width * 0.3,
        Math.random() * canvas.height,
        canvas.width * 0.7,
        Math.random() * canvas.height,
        canvas.width,
        Math.random() * canvas.height
      );
      ctx.stroke();
    }

    // Draw stylized glyphs with jitter and rotation
    const chars = captchaCode.split("");
    const charSpacing = canvas.width / (chars.length + 1);
    ctx.textBaseline = "middle";

    chars.forEach((char, index) => {
      ctx.save();
      const x = charSpacing * (index + 1) + (Math.random() * 6 - 3);
      const y = canvas.height / 2 + (Math.random() * 6 - 3);
      const angle = (Math.random() * 32 - 16) * (Math.PI / 180);

      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.font = `bold ${Math.floor(Math.random() * 4 + 22)}px 'Courier New', monospace`;

      // Shadow
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillText(char, 2, 2);

      // Character fill
      ctx.fillStyle = index % 2 === 0 ? "#7bd89f" : "#93c5fd";
      ctx.fillText(char, 0, 0);

      ctx.restore();
    });
  }, [captchaCode, canvasEl]);

  // Regenerate the CAPTCHA image/input without touching any error message
  // that the caller just set (used on failed-login paths).
  const regenerateCaptcha = () => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setCaptchaCode(generateCaptchaCode(6));
    setCaptchaInputValue("");
    setCaptchaSpelled(null);
  };

  // "New code" button — also clears any stale error.
  const handleRefreshCaptcha = () => {
    regenerateCaptcha();
    setErrorMessage(null);
    setErrorField(null);
    clearFieldError("captcha");
  };

  // Stop any in-progress CAPTCHA readout when the page unmounts, so it does
  // not keep announcing a code that is no longer on screen.
  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // Audio CAPTCHA. Where speech is unavailable or fails, show the same
  // phonetic spelling as text instead of an alert().
  const handleSpeakCaptcha = () => {
    const spelled = spellCaptcha(captchaCode);
    if (!("speechSynthesis" in window)) { setCaptchaSpelled(spelled); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`The code is: ${spelled}.`);
    utterance.rate = 0.8;
    utterance.pitch = 1.0;
    utterance.onerror = (event) => { if (event.error !== "canceled" && event.error !== "interrupted") setCaptchaSpelled(spelled); };
    window.speechSynthesis.speak(utterance);
  };

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
      captcha: captchaInput.trim() ? undefined : "Type the 6 characters shown in the image.",
    };
    const firstInvalid = (["email", "password", "captcha"] as const).find(field => errors[field]);
    setFieldErrors(errors);
    setErrorMessage(null);
    setErrorField(null);
    if (firstInvalid) { requestFocus(firstInvalid); return; }

    // Validate CAPTCHA
    if (captchaInput.trim().toUpperCase() !== captchaCode.toUpperCase()) {
      regenerateCaptcha();
      setFieldErrors({ captcha: "Those characters did not match. A new code is shown; type it again." });
      requestFocus("captcha");
      return;
    }

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
      regenerateCaptcha();
      if (code === "auth/invalid-email") {
        setFieldErrors({ email: readableStaffAuthError(err) });
        requestFocus("email");
      } else {
        setErrorMessage(`${readableStaffAuthError(err)} A new security code is shown; type it again too.`);
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
    captchaInput,
    setCaptchaInput,
    captchaSpelled,
    canvasRef,
    emailRef,
    passwordRef,
    captchaRef,
    showForgotModal,
    setShowForgotModal,
    busy,
    waitSeconds,
    waitTotal,
    errorMessage,
    errorField,
    fieldErrors,
    handleRefreshCaptcha,
    handleSpeakCaptcha,
    handleEmailLogin,
    handleContinue,
    handleSignOut,
  };
}
