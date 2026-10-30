import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Step } from "./types";
import { callFunction, loadCallables, readableCallableError } from "./callables";
import { cardStyle, inputStyle, labelStyle, errorStyle } from "./reporting.styles";
import { OTP_TTL_MS, formatClock, useRemaining } from "./countdown";
import { useDraftField } from "./draftStore";
import { maskPhone } from "./maskPhone";

// Each send costs a WhatsApp message and one of the server's five sends per
// hour for this number, so repeated taps on "Send a fresh code" are held off.
const RESEND_COOLDOWN_MS = 30_000;

interface PhoneVerificationProps {
  step: "phone" | "otp";
  phone: string;
  onPhoneChange: (phone: string) => void;
  onVerified: (verificationToken: string) => void;
  onStepChange: (step: Step) => void;
  /** Re-verifying inside the form: a code goes to `phone` as soon as this
   *  mounts (unless one is still valid) and the code field takes focus. */
  reverify?: boolean;
  /** Replaces the card's heading (the re-verify heading by default). */
  heading?: string;
  /** Shown under the heading, e.g. which number to use. */
  intro?: ReactNode;
}

/** When the last code was sent and when another may be: the resend hold-off. */
export interface OtpTimers {
  otpSentAt: number | null;
  setOtpSentAt: (sentAt: number | null) => void;
  cooldownUntil: number;
  setCooldownUntil: (until: number) => void;
}

// A custom, database-backed OTP proves the reporter controls the phone
// number they give us: no password, no account, and — unlike Firebase phone
// sign-in — no auth token either. requestDisputeOtp generates and stores a
// fresh code server-side (see functions/src/features/otp/service.ts); verifyDisputeOtp checks
// it against that record. "submitDispute" later re-checks the same record.
//
// The report form keeps the resend hold-off in its draft; other pages (status
// tracking) pass their own timers to PhoneVerificationCard, so verifying there
// does not start or touch a report draft.
export function PhoneVerification(props: PhoneVerificationProps) {
  // In the draft rather than component state, so leaving the step (or the
  // form re-mounting this card) does not reset the resend hold-off.
  const [otpSentAt, setOtpSentAt] = useDraftField("otpSentAt");
  const [cooldownUntil, setCooldownUntil] = useDraftField("otpCooldownUntil");
  return <PhoneVerificationCard {...props} timers={{ otpSentAt, setOtpSentAt, cooldownUntil, setCooldownUntil }} />;
}

export function PhoneVerificationCard({ step, phone, onPhoneChange, onVerified, onStepChange, reverify = false, heading, intro, timers }: PhoneVerificationProps & { timers: OtpTimers }) {
  const { otpSentAt, setOtpSentAt, cooldownUntil, setCooldownUntil } = timers;
  const [countryCode, setCountryCode] = useState("+91");
  const [localNumber, setLocalNumber] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Refs, not just state: two taps inside one frame both see the old state.
  const inFlight = useRef(false);
  const cooldownMs = useRemaining(cooldownUntil > 0 ? cooldownUntil : null) ?? 0;
  const cooldownLeft = Math.ceil(cooldownMs / 1000);
  const codeLeft = useRemaining(otpSentAt === null ? null : otpSentAt + OTP_TTL_MS);
  const phoneInput = useRef<HTMLInputElement>(null);
  const otpInput = useRef<HTMLInputElement>(null);
  const shownStep = useRef(step);

  useEffect(() => { loadCallables().catch(() => {}); }, []);
  // The button that moved the reporter between steps unmounts with its form,
  // which used to leave focus on <body>.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    (step === "otp" ? otpInput : phoneInput).current?.focus();
  }, [step]);

  const digits = nationalDigits(countryCode, localNumber);
  const phoneError = validatePhoneNumber(countryCode, digits);
  const canSend = digits.length > 0 && !phoneError;

  async function send(resending: boolean) {
    if (sending || inFlight.current) return;
    if (resending && cooldownUntil > Date.now()) return;
    if (!resending && !canSend) {
      setError(phoneError ?? "Enter a valid phone number.");
      phoneInput.current?.focus();
      return;
    }
    const e164 = resending ? phone : `${countryCode}${digits}`;
    // "Change number" then re-entering the same number must not bypass the
    // cooldown; the code already sent is still valid, so just go back to it.
    if (!resending && e164 === phone && cooldownUntil > Date.now()) {
      setError(null);
      onStepChange("otp");
      return;
    }
    setError(null);
    setSending(true);
    inFlight.current = true;
    if (resending) setAnnouncement("Sending a fresh code…");
    try {
      await callFunction<{ phone: string }, { sent: boolean }>("requestDisputeOtp", { phone: e164 });
      setCode("");
      const t = Date.now();
      setOtpSentAt(t);
      setCooldownUntil(t + RESEND_COOLDOWN_MS);
      onPhoneChange(e164);
      onStepChange("otp");
      if (resending) setAnnouncement(`A fresh code was sent to ${maskPhone(e164)} on WhatsApp. It expires in 5 minutes.`);
      otpInput.current?.focus();
    } catch (err) {
      console.error("OTP send failed", (err as { code?: string })?.code ?? "unknown");
      setAnnouncement("");
      setError(readableCallableError(err, "The verification service is unavailable. Please try again shortly."));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  // Re-verification sends straight away: the reporter asked for it, and the
  // number is already known. A code from the last half-minute is reused.
  const autoSent = useRef(false);
  useEffect(() => {
    if (!reverify || autoSent.current || !phone) return;
    autoSent.current = true;
    otpInput.current?.focus();
    if (cooldownUntil > Date.now()) return;
    void send(true);
    // Mount-only: later prop changes must not send another message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sendFromPhoneStep(event: FormEvent) {
    event.preventDefault();
    void send(false);
  }

  async function verify(value: string) {
    if (verifying || inFlight.current) return;
    if (!/^\d{6}$/.test(value)) {
      setError("Enter the complete 6-digit code from WhatsApp.");
      otpInput.current?.focus();
      return;
    }
    setError(null);
    setVerifying(true);
    inFlight.current = true;
    try {
      const result = await callFunction<{ phone: string; code: string }, { verified: boolean; verificationToken: string }>("verifyDisputeOtp", { phone, code: value });
      onVerified(result.verificationToken);
    } catch (err) {
      console.error("OTP verification failed", (err as { code?: string })?.code ?? "unknown");
      setError(readableCallableError(err, "The verification service is unavailable. Please try again shortly."));
      otpInput.current?.focus();
    } finally {
      inFlight.current = false;
      setVerifying(false);
    }
  }

  const codeExpired = codeLeft !== null && codeLeft <= 0;
  const titled = reverify || Boolean(heading);
  const otpDescribedBy = ["otp-sent-status", error ? "otp-verification-error" : ""].filter(Boolean).join(" ");

  return (
    <section style={titled ? { ...cardStyle, marginTop: "1.25rem" } : cardStyle} aria-labelledby={titled ? "reverify-heading" : undefined}>
      {titled && <h2 id="reverify-heading" style={{ marginTop: 0, fontSize: "1.15rem" }}>{heading ?? "Verify your number again"}</h2>}
      {intro && <p className="report-hint" style={{ fontSize: "0.95rem" }}>{intro}</p>}
      <p role="status" className="report-sr-only">{announcement}</p>
      {step === "phone" ? (
        <form onSubmit={sendFromPhoneStep} noValidate>
          <fieldset className="report-fieldset" style={{ marginBottom: 0 }}>
            <legend className="report-legend">Your WhatsApp number</legend>
            <p id="dispute-phone-hint" className="report-hint">
              We'll send a 6-digit code on WhatsApp to check the number is yours. The code is only sent on WhatsApp, not by SMS.
            </p>
            <div className="phone-row">
              <div>
                <label htmlFor="dispute-country" style={{ ...labelStyle, fontSize: "0.85rem" }}>Country code</label>
                <select id="dispute-country" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={inputStyle}>
                  <option value="+91">IN +91</option>
                  <option value="+1">US/CA +1</option>
                  <option value="+44">UK +44</option>
                  <option value="+61">AU +61</option>
                  <option value="+971">AE +971</option>
                </select>
              </div>
              <div>
                <label htmlFor="dispute-phone" style={{ ...labelStyle, fontSize: "0.85rem" }}>Phone number</label>
                <input
                  ref={phoneInput}
                  id="dispute-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  enterKeyHint="send"
                  maxLength={24}
                  placeholder={countryCode === "+91" ? "98765 43210" : "Phone number"}
                  value={localNumber}
                  onChange={(e) => {
                    setLocalNumber(e.target.value.replace(/[^\d\s()+-]/g, ""));
                    setError(null);
                  }}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "dispute-phone-hint phone-verification-error" : "dispute-phone-hint"}
                  style={inputStyle}
                />
              </div>
            </div>
            {error && <p id="phone-verification-error" role="alert" style={errorStyle}>{error}</p>}
          </fieldset>
          <div className="report-actions">
            <button type="submit" className="report-btn" disabled={sending} aria-busy={sending}>
              {sending ? "Sending code…" : "Send verification code"}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void verify(code.trim()); }} noValidate>
          <label htmlFor="dispute-otp" style={labelStyle}>Enter the 6-digit code from WhatsApp</label>
          <p id="otp-sent-status" className="report-hint">
            {sending ? <>Sending a code to {maskPhone(phone)} on WhatsApp…</>
              : codeLeft === null ? <>We sent the code to {maskPhone(phone)} on WhatsApp.</>
              : codeExpired ? <strong>The code sent to {maskPhone(phone)} has expired. Send a fresh code below.</strong>
              : <>Code sent to {maskPhone(phone)} on WhatsApp. It expires in {formatClock(codeLeft)}.</>}
          </p>
          <p style={{ margin: "0 0 0.5rem" }}>
            <button
              type="button"
              className="report-link-btn"
              disabled={sending || verifying}
              onClick={() => {
                setCode("");
                setError(null);
                onStepChange("phone");
              }}
            >
              Change number
            </button>
          </p>
          <input
            ref={otpInput}
            id="dispute-otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="done"
            pattern="\d{6}"
            placeholder="123456"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            // No maxLength: it cut "123 456" to five digits before the
            // non-digits could be stripped. A pasted message still works.
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
              if (!pasted) return;
              e.preventDefault();
              const next = pasted.slice(0, 6);
              setCode(next);
              setError(null);
              if (next.length === 6) void verify(next);
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={otpDescribedBy}
            style={{ ...inputStyle, fontSize: "1.25rem", letterSpacing: "0.2em", maxWidth: "14rem" }}
          />
          {error && <p id="otp-verification-error" role="alert" style={errorStyle}>{error}</p>}
          <div className="report-actions">
            <button type="submit" className="report-btn" disabled={verifying} aria-busy={verifying}>
              {verifying ? "Verifying…" : "Verify and continue"}
            </button>
            <button type="button" className="report-btn report-btn--secondary" disabled={sending || verifying || cooldownLeft > 0} aria-busy={sending} onClick={() => void send(true)}>
              {sending ? "Sending fresh code…" : cooldownLeft > 0 ? `Send a fresh code in ${cooldownLeft}s` : "Send a fresh code"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// Reporters often paste "+91 98765 43210" or type a trunk "0" first; both
// used to fail validation even though the number itself was fine.
function nationalDigits(countryCode: string, raw: string): string {
  let digits = raw.replace(/\D/g, "");
  const cc = countryCode.slice(1);
  if (raw.trim().startsWith("+") && digits.startsWith(cc)) digits = digits.slice(cc.length);
  else if (countryCode === "+91" && digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (countryCode !== "+1" && digits.length > 7 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

function validatePhoneNumber(countryCode: string, digits: string): string | null {
  if (!digits) return "Enter your phone number.";
  if (countryCode === "+91" && !/^[6-9]\d{9}$/.test(digits)) {
    return "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.";
  }
  if (countryCode === "+1" && !/^[2-9]\d{9}$/.test(digits)) {
    return "Enter a valid 10-digit US or Canadian number.";
  }
  // E.164 caps the whole number, country code included, at 15 digits: the
  // same bound the server enforces.
  const maxLocal = 15 - (countryCode.length - 1);
  if (digits.length < 7 || digits.length > maxLocal) {
    return `Enter a valid phone number containing 7 to ${maxLocal} digits.`;
  }
  return null;
}
