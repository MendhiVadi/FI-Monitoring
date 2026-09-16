import { useState, type FormEvent } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../shared/firebase/functions";
import type { Step } from "./types";
import { cardStyle, inputStyle, labelStyle, primaryButtonStyle, errorStyle } from "./reporting.styles";

interface PhoneVerificationProps {
  step: "phone" | "otp";
  phone: string;
  onPhoneChange: (phone: string) => void;
  onVerified: (verificationToken: string) => void;
  onStepChange: (step: Step) => void;
}

// A custom, database-backed OTP proves the reporter controls the phone
// number they give us: no password, no account, and — unlike Firebase phone
// sign-in — no auth token either. requestDisputeOtp generates and stores a
// fresh code server-side (see functions/src/features/otp/service.ts); verifyDisputeOtp checks
// it against that record. "submitDispute" later re-checks the same record.
export function PhoneVerification({ step, phone, onPhoneChange, onVerified, onStepChange }: PhoneVerificationProps) {
  const [countryCode, setCountryCode] = useState("+91");
  const [localNumber, setLocalNumber] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const digits = localNumber.replace(/\D/g, "");
  const phoneError = validatePhoneNumber(countryCode, digits);
  const canSend = digits.length > 0 && !phoneError;

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (!canSend) {
      setError(phoneError ?? "Enter a valid phone number.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const e164 = `${countryCode}${digits}`;
      const requestDisputeOtp = httpsCallable<{ phone: string }, { sent: boolean }>(functions, "requestDisputeOtp");
      await requestDisputeOtp({ phone: e164 });
      setCode("");
      onPhoneChange(e164);
      onStepChange("otp");
    } catch (err) {
      console.error("OTP send failed", err);
      setError(readableCallableError(err));
    } finally {
      setSending(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (verifying) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the complete 6-digit OTP sent to your phone.");
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      const verifyDisputeOtp = httpsCallable<{ phone: string; code: string }, { verified: boolean; verificationToken: string }>(functions, "verifyDisputeOtp");
      const result = await verifyDisputeOtp({ phone, code: code.trim() });
      onVerified(result.data.verificationToken);
    } catch (err) {
      console.error("OTP verification failed", err);
      setError(readableCallableError(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <section style={cardStyle}>
      {step === "phone" ? (
        <form onSubmit={sendCode}>
          <label htmlFor="dispute-phone" style={labelStyle}>Your phone number</label>
          <p style={{ opacity: 0.6, fontSize: "0.85rem", marginTop: 0, marginBottom: "0.6rem" }}>
            We'll send a fresh one-time code on WhatsApp. Select your country code and enter your WhatsApp number.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 0.7fr) minmax(0, 1.3fr)", gap: "0.75rem" }}>
            <label>
              <span style={{ ...labelStyle, fontSize: "0.85rem" }}>Country code</span>
              <select
                aria-label="Country code"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                style={inputStyle}
              >
                <option value="+91">India (+91)</option>
                <option value="+1">United States / Canada (+1)</option>
                <option value="+44">United Kingdom (+44)</option>
                <option value="+61">Australia (+61)</option>
                <option value="+971">United Arab Emirates (+971)</option>
              </select>
            </label>
            <label>
              <span style={{ ...labelStyle, fontSize: "0.85rem" }}>Phone number</span>
              <input
                id="dispute-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder={countryCode === "+91" ? "98765 43210" : "Phone number"}
                value={localNumber}
                onChange={(e) => {
                  setLocalNumber(e.target.value.replace(/[^\d\s()-]/g, ""));
                  setError(null);
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "phone-verification-error" : undefined}
                style={inputStyle}
              />
            </label>
          </div>
          {error && <p id="phone-verification-error" role="alert" style={errorStyle}>⚠️ {error}</p>}
          <button type="submit" disabled={sending} style={{ ...primaryButtonStyle, marginTop: "1rem", opacity: sending ? 0.6 : 1 }}>
            {sending ? "Sending code…" : "Send verification code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <label htmlFor="dispute-otp" style={labelStyle}>Enter your WhatsApp verification code</label>
          <p style={{ opacity: 0.6, fontSize: "0.85rem", marginTop: 0, marginBottom: "0.6rem" }}>
            Sent to {phone}.{" "}
            <button
              type="button"
              disabled={sending || verifying}
              onClick={() => {
                setCode("");
                setError(null);
                onStepChange("phone");
              }}
              style={{ background: "none", border: "none", color: "#7bd89f", padding: 0, cursor: "pointer", font: "inherit" }}
            >
              Change number
            </button>
          </p>
          <input
            id="dispute-otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "otp-verification-error" : undefined}
            style={inputStyle}
          />
          {error && <p id="otp-verification-error" role="alert" style={errorStyle}>⚠️ {error}</p>}
          <button type="submit" disabled={verifying} style={{ ...primaryButtonStyle, marginTop: "1rem", opacity: verifying ? 0.6 : 1 }}>
            {verifying ? "Verifying…" : "Verify and continue"}
          </button>
          <button type="button" disabled={sending || verifying} onClick={sendCode}
            style={{ ...primaryButtonStyle, marginTop: "0.75rem" }}>
            {sending ? "Sending fresh code…" : "Send a fresh code"}
          </button>
        </form>
      )}
    </section>
  );
}

function validatePhoneNumber(countryCode: string, digits: string): string | null {
  if (!digits) return "Enter your phone number.";
  if (countryCode === "+91" && !/^[6-9]\d{9}$/.test(digits)) {
    return "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.";
  }
  if (countryCode !== "+91" && (digits.length < 7 || digits.length > 15)) {
    return "Enter a valid phone number containing 7 to 15 digits.";
  }
  return null;
}

function readableCallableError(err: unknown): string {
  const message = (err as { message?: string })?.message;
  if (!message || /^(internal|internal \[\d+\]|INTERNAL)$/i.test(message)) {
    return "The verification service is unavailable. Please try again shortly.";
  }
  return message || "Something went wrong. Please try again.";
}
