import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import type { ConfirmationResult } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { Link } from "react-router-dom";
import { auth, functions } from "../lib/firebase";
import { DisputeLocationMap } from "../components/DisputeLocationMap";
import type { DisputeLocation } from "../components/DisputeLocationMap";
import disputeSettings from "../../dispute-settings.json";
import { ALL_INDIAN_STATES, getDistrictsForState } from "../data/indiaDistricts";

type Step = "phone" | "otp" | "form" | "done";


export function ReportIssue() {
  const [step, setStep] = useState<Step>(disputeSettings.otpRequired ? "phone" : "form");
  const [phone, setPhone] = useState("");
  const [ticketId, setTicketId] = useState<string | null>(null);

  return (
    <main style={{ minHeight: "70vh", padding: "8rem 2rem 4rem", maxWidth: 700, margin: "0 auto" }}>
      <p style={{ color: "#7bd89f", letterSpacing: "0.12em", fontSize: "0.75rem", fontWeight: 700 }}>RAISE A DISPUTE</p>
      <h1 style={{ fontSize: "clamp(2.5rem, 8vw, 4.5rem)", lineHeight: 1.05 }}>Report a land dispute</h1>
      <p style={{ opacity: 0.8, marginTop: "1rem", lineHeight: 1.7, maxWidth: 560 }}>
        Use this to report a dispute over land or a forest rights claim — between individuals, a
        community and a government body, or between government bodies.
      </p>

      {(step === "phone" || step === "otp") && (
        <PhoneVerification
          step={step}
          phone={phone}
          onPhoneChange={setPhone}
          onVerified={() => setStep("form")}
          onStepChange={setStep}
        />
      )}

      {step === "form" && (
        <DisputeForm
          onSubmitted={(id) => {
            setTicketId(id);
            setStep("done");
          }}
        />
      )}

      {step === "done" && <Confirmation ticketId={ticketId} />}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.85rem",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "#071126",
  color: "white",
  font: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 600,
  marginBottom: "0.4rem",
};

const primaryButtonStyle: React.CSSProperties = {
  background: "#2f9e64",
  color: "white",
  border: "none",
  padding: "0.8rem 1.4rem",
  borderRadius: 999,
  fontWeight: 700,
  cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  marginTop: "2.5rem",
  padding: "1.5rem",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.04)",
};

interface PhoneVerificationProps {
  step: "phone" | "otp";
  phone: string;
  onPhoneChange: (phone: string) => void;
  onVerified: () => void;
  onStepChange: (step: Step) => void;
}

// Firebase phone-auth OTP flow stands in for identity verification: no
// password, no account — just proof the reporter controls the number they
// give us, which the "submitDispute" function later checks for.
function PhoneVerification({ step, phone, onPhoneChange, onVerified, onStepChange }: PhoneVerificationProps) {
  const [countryCode, setCountryCode] = useState("+91");
  const [localNumber, setLocalNumber] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  // Clear the reCAPTCHA widget on unmount regardless of why it unmounts
  // (successful verification or the user navigating away) — the error-path
  // cleanup in sendCode() only covers the send-failed case.
  useEffect(() => {
    return () => {
      verifierRef.current?.clear();
      verifierRef.current = null;
    };
  }, []);

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
      if (!verifierRef.current) {
        verifierRef.current = new RecaptchaVerifier(auth, "dispute-recaptcha", { size: "normal" });
      }
      const e164 = `${countryCode}${digits}`;
      onPhoneChange(e164);
      confirmationRef.current = await signInWithPhoneNumber(auth, e164, verifierRef.current);
      onStepChange("otp");
    } catch (err) {
      console.error("OTP send failed", err);
      setError(readableAuthError(err));
      verifierRef.current?.clear();
      verifierRef.current = null;
    } finally {
      setSending(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (verifying) return;
    if (!confirmationRef.current) {
      setError("Request a new verification code before continuing.");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the complete 6-digit OTP sent to your phone.");
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      await confirmationRef.current.confirm(code.trim());
      onVerified();
    } catch (err) {
      console.error("OTP verification failed", err);
      setError(readableAuthError(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <section style={cardStyle}>
      <div id="dispute-recaptcha" />
      {step === "phone" ? (
        <form onSubmit={sendCode}>
          <label htmlFor="dispute-phone" style={labelStyle}>Your phone number</label>
          <p style={{ opacity: 0.6, fontSize: "0.85rem", marginTop: 0, marginBottom: "0.6rem" }}>
            We'll text you a one-time code. Select your country code and enter your phone number.
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
          <label htmlFor="dispute-otp" style={labelStyle}>Enter the code we texted you</label>
          <p style={{ opacity: 0.6, fontSize: "0.85rem", marginTop: 0, marginBottom: "0.6rem" }}>
            Sent to {phone}.{" "}
            <button
              type="button"
              onClick={() => onStepChange("phone")}
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

const errorStyle: React.CSSProperties = {
  color: "#fecaca",
  background: "rgba(239, 68, 68, 0.12)",
  border: "1px solid rgba(248, 113, 113, 0.35)",
  borderRadius: 10,
  padding: "0.75rem 0.9rem",
  marginBottom: 0,
  marginTop: "0.75rem",
};

function readableAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "auth/invalid-phone-number") return "That phone number doesn't look valid.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a bit before trying again.";
  if (code === "auth/invalid-verification-code") return "That code isn't right. Check it and try again.";
  if (code === "auth/code-expired") return "That code expired — send a new one.";
  if (code === "auth/operation-not-allowed") return "Phone verification is disabled for the Firebase project configured for this app.";
  if (code === "auth/quota-exceeded") return "The SMS quota has been reached. Try again later.";
  if (code === "auth/captcha-check-failed") return "The security check failed. Reload the page and try again.";
  if (code === "auth/unauthorized-domain") return "This website is not authorized for Firebase phone verification.";
  if (code === "auth/network-request-failed") return "The Firebase request failed. Check your internet connection and try again.";
  if (code === "auth/invalid-api-key") return "The Firebase API configuration is invalid.";
  if (code === "auth/invalid-app-credential") return "The security check could not verify this app. Tick the reCAPTCHA box and try again.";
  if (code === "auth/app-not-authorized") return "This app is not authorized for Firebase Phone Auth. Check the Firebase web app configuration.";
  if (code === "auth/missing-phone-number") return "Enter a phone number before requesting a code.";
  if (code === "auth/internal-error") return "Firebase could not send the code. Check the number and try again in a moment.";
  return "Something went wrong. Please try again.";
}

const REPORTER_TYPES = [
  "Individual / private person",
  "Community or Gram Sabha",
  "Government department or body",
];

const PARTY_TYPES = [
  "Individual / private person",
  "Forest Department",
  "Revenue Department",
  "Gram Panchayat / local government",
  "Other government body",
  "Not sure",
];

const DISPUTE_TYPES = [
  "Boundary or encroachment dispute",
  "Ownership dispute",
  "Delayed or stalled FRA claim",
  "Land record mismatch",
  "Compensation or rehabilitation dispute",
  "Other",
];

interface DisputeFormProps {
  onSubmitted: (ticketId: string) => void;
}

function DisputeForm({ onSubmitted }: DisputeFormProps) {
  const [reporterName, setReporterName] = useState("");
  const [reporterType, setReporterType] = useState(REPORTER_TYPES[0]);
  const [otherPartyName, setOtherPartyName] = useState("");
  const [otherPartyType, setOtherPartyType] = useState(PARTY_TYPES[0]);
  const [disputeType, setDisputeType] = useState(DISPUTE_TYPES[0]);
  const [state, setState] = useState("");
  const [district, setDistrict] = useState("");
  const [village, setVillage] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState<DisputeLocation | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableDistricts = useMemo(() => {
    return getDistrictsForState(state);
  }, [state]);

  const canSubmit = useMemo(
    () =>
      reporterName.trim().length > 1 &&
      otherPartyName.trim().length > 1 &&
      state.trim().length > 0 &&
      district.trim().length > 0 &&
      description.trim().length > 20 && location !== null &&
      consent,
    [reporterName, otherPartyName, state, district, description, consent, location]
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const submitDispute = httpsCallable<Record<string, unknown>, { ticketId: string }>(functions, "submitDispute");
      const result = await submitDispute({
        reporterName: reporterName.trim(),
        reporterType,
        otherPartyName: otherPartyName.trim(),
        otherPartyType,
        disputeType,
        state: state.trim(),
        district: district.trim(),
        village: village.trim(),
        description: description.trim(),
        location,
      });
      onSubmitted(result.data.ticketId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't submit the dispute. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} style={cardStyle}>
      <p style={{ marginTop: 0, marginBottom: "1.5rem", color: "#7bd89f", fontWeight: 600 }}>
        {disputeSettings.otpRequired ? "Phone verified. Now tell us about the dispute." : "Phone verification is temporarily paused. You can submit without an SMS code."}
      </p>

      <FieldRow>
        <Field label="Your name / department">
          <input value={reporterName} onChange={(e) => setReporterName(e.target.value)} placeholder="Full name" style={inputStyle} />
        </Field>
        <Field label="You are raising this as">
          <select value={reporterType} onChange={(e) => setReporterType(e.target.value)} style={inputStyle}>
            {REPORTER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Other party's name / department">
          <input value={otherPartyName} onChange={(e) => setOtherPartyName(e.target.value)} placeholder="Who is the dispute with?" style={inputStyle} />
        </Field>
        <Field label="Other party is">
          <select value={otherPartyType} onChange={(e) => setOtherPartyType(e.target.value)} style={inputStyle}>
            {PARTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </FieldRow>

      <Field label="Type of dispute">
        <select value={disputeType} onChange={(e) => setDisputeType(e.target.value)} style={inputStyle}>
          {DISPUTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>

      <FieldRow>
        <Field label="State / Union Territory">
          <select
            value={state}
            onChange={(e) => {
              const nextState = e.target.value;
              setState(nextState);
              setDistrict("");
            }}
            style={inputStyle}
          >
            <option value="">— Select State / UT —</option>
            {ALL_INDIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="District">
          <select
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            disabled={!state}
            style={{
              ...inputStyle,
              opacity: state ? 1 : 0.6,
              cursor: state ? "pointer" : "not-allowed",
            }}
          >
            <option value="">
              {state ? "— Select District —" : "Select a State first"}
            </option>
            {availableDistricts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      </FieldRow>


      <Field label={<>Village / landmark <span style={{ opacity: 0.55, fontWeight: 400 }}>(optional)</span></>}>
        <input value={village} onChange={(e) => setVillage(e.target.value)} placeholder="Nearest village or landmark" style={inputStyle} />
      </Field>

      <DisputeLocationMap value={location} onChange={setLocation} state={state} district={district} />

      <Field label={<>Describe the dispute <span style={{ opacity: 0.55, fontWeight: 400 }}>(at least 20 characters)</span></>}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened, when, and what land or claim is involved? (minimum 20 characters)"
          rows={6}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", marginTop: "1rem", fontSize: "0.85rem", opacity: 0.85 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: "0.2rem" }} />
        <span>
          I confirm these details are accurate to my knowledge, and I agree to the{" "}
          <Link to="/privacy-policy" style={{ color: "#7bd89f" }}>Privacy Policy</Link> and{" "}
          <Link to="/terms-of-use" style={{ color: "#7bd89f" }}>Terms of Use</Link>.
        </span>
      </label>

      {error && <p style={{ color: "#f87171" }}>{error}</p>}

      <button type="submit" disabled={!canSubmit || submitting} style={{ ...primaryButtonStyle, marginTop: "1.25rem", opacity: !canSubmit || submitting ? 0.6 : 1 }}>
        {submitting ? "Submitting…" : "Submit dispute"}
      </button>
    </form>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>{children}</div>;
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function Confirmation({ ticketId }: { ticketId: string | null }) {
  return (
    <section style={{ ...cardStyle, textAlign: "center" }}>
      <h2 style={{ marginTop: 0, color: "#7bd89f" }}>Thank you!</h2>
      {ticketId && (
        <p style={{ opacity: 0.8, marginTop: "0.75rem" }}>
          Your reference number: <strong>{ticketId}</strong>
        </p>
      )}
    </section>
  );
}
