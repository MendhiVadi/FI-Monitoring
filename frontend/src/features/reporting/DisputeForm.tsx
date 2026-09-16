import { useEffect, useMemo, useState, type FormEvent } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../shared/firebase/functions";
import { DisputeLocationMap } from "./DisputeLocationMap";
import disputeSettings from "../../../dispute-settings.json";
import { ALL_INDIAN_STATES, getDistrictsForState } from "./indiaDistricts";
import { cardStyle, inputStyle, labelStyle, primaryButtonStyle } from "./reporting.styles";
import contract from "../../shared/contracts/dispute.json";
import { useDraftField } from "./draftStore";

const DESCRIPTION_MIN = contract.descriptionMin;
const DESCRIPTION_MAX = contract.descriptionMax;
const REPORTER_TYPES = contract.reporterTypes;
const PARTY_TYPES = contract.partyTypes;
const DISPUTE_TYPES = contract.disputeTypes;

interface DisputeFormProps {
  phone: string;
  verificationToken: string;
  onReverify: () => void;
  onSubmitted: (ticketId: string) => void;
}

export function DisputeForm({ phone, verificationToken, onReverify, onSubmitted }: DisputeFormProps) {
  // Records WHICH token the server rejected, rather than a bare boolean. A
  // boolean cleared only by the re-verify button made that button its own
  // precondition, so it never rendered and the reporter was stuck. Comparing
  // tokens means a freshly issued one automatically restores the submit button.
  const [rejectedToken, setRejectedToken] = useState<string | null>(null);
  const needsReverify = rejectedToken !== null && rejectedToken === verificationToken;
  const [reporterName, setReporterName] = useDraftField("reporterName");
  const [reporterType, setReporterType] = useDraftField("reporterType");
  const [otherPartyName, setOtherPartyName] = useDraftField("otherPartyName");
  const [otherPartyType, setOtherPartyType] = useDraftField("otherPartyType");
  const [disputeType, setDisputeType] = useDraftField("disputeType");
  const [state, setState] = useDraftField("state");
  const [district, setDistrict] = useDraftField("district");
  const [village, setVillage] = useDraftField("village");
  const [description, setDescription] = useDraftField("description");
  const [immediateRisk, setImmediateRisk] = useDraftField("immediateRisk");
  const [evidenceText, setEvidenceText] = useDraftField("evidenceText");
  const [location, setLocation] = useDraftField("location");
  const [consent, setConsent] = useDraftField("consent");
  const [submissionId] = useDraftField("submissionId");
  const [locationConfirmed, setLocationConfirmed] = useDraftField("locationConfirmed");
  const [whatsappUpdates, setWhatsappUpdates] = useDraftField("whatsappUpdates");
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
      description.trim().length >= DESCRIPTION_MIN && location !== null &&
      consent && locationConfirmed,
    [reporterName, otherPartyName, state, district, description, consent, location, locationConfirmed]
  );

  useEffect(() => {
    if (!reporterName && !description) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [reporterName, description]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const submitDispute = httpsCallable<Record<string, unknown>, { ticketId: string }>(functions, "submitDispute");
      const result = await submitDispute({
        submissionId, consent, consentVersion: contract.version, whatsappUpdates, locationConfirmed,
        phone,
        verificationToken,
        reporterName: reporterName.trim(),
        reporterType,
        otherPartyName: otherPartyName.trim(),
        otherPartyType,
        disputeType,
        state: state.trim(),
        district: district.trim(),
        village: village.trim(),
        description: description.trim(),
        location, immediateRisk, evidenceReferences: evidenceText.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
      });
      onSubmitted(result.data.ticketId);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "functions/unauthenticated") {
        setRejectedToken(verificationToken);
        setError("Your phone verification expired. Verify your number again to submit — your answers below are kept.");
      } else {
        setError(err instanceof Error ? err.message : "Couldn't submit the dispute. Please try again.");
      }
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
          <input maxLength={contract.nameMax} value={reporterName} onChange={(e) => setReporterName(e.target.value)} placeholder="Full name" style={inputStyle} />
        </Field>
        <Field label="You are raising this as">
          <select value={reporterType} onChange={(e) => setReporterType(e.target.value)} style={inputStyle}>
            {REPORTER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Other party's name / department">
          <input maxLength={contract.nameMax} value={otherPartyName} onChange={(e) => setOtherPartyName(e.target.value)} placeholder="Who is the dispute with?" style={inputStyle} />
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
              setLocation(null); setLocationConfirmed(false);
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
            onChange={(e) => { setDistrict(e.target.value); setLocation(null); setLocationConfirmed(false); }}
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
        <input maxLength={contract.nameMax} value={village} onChange={(e) => setVillage(e.target.value)} placeholder="Nearest village or landmark" style={inputStyle} />
      </Field>

      <DisputeLocationMap value={location} onChange={(point) => { setLocation(point); setLocationConfirmed(false); }} state={state} district={district} />
      <label style={{ display: "flex", gap: "0.6rem", margin: "1rem 0" }}><input type="checkbox" disabled={!location || !district} checked={locationConfirmed} onChange={e => setLocationConfirmed(e.target.checked)} />This pin marks the disputed land in {district || "the selected district"}, {state || "state"}.</label>

      <Field label={<>Describe the dispute <span style={{ opacity: 0.55, fontWeight: 400 }}>(at least 20 characters)</span></>}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened, when, and what land or claim is involved? (minimum 20 characters)"
          rows={6}
          maxLength={DESCRIPTION_MAX}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", opacity: 0.6, textAlign: "right" }}>
          {description.length} / {DESCRIPTION_MAX}
        </p>
      </Field>

      <Field label="Is there an immediate threat of harm or displacement?">
        <select value={immediateRisk} onChange={e => setImmediateRisk(e.target.value as typeof immediateRisk)} style={inputStyle}><option value="unknown">Not sure / not assessed</option><option value="no">No</option><option value="yes">Yes</option></select>
      </Field>
      <Field label="Evidence references (optional, one per line, up to 10)">
        <textarea rows={3} maxLength={1209} value={evidenceText} onChange={e => setEvidenceText(e.target.value)} placeholder="For example, survey or claim reference numbers. These will need staff verification." style={inputStyle} />
      </Field>

      <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", marginTop: "1rem", fontSize: "0.85rem", opacity: 0.85 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: "0.2rem" }} />
        <span>
          I confirm these details are accurate to my knowledge, and I agree to the{" "}
          <a href="/privacy-policy" target="_blank" rel="noreferrer" style={{ color: "#7bd89f" }}>Privacy Policy</a> and{" "}
          <a href="/terms-of-use" target="_blank" rel="noreferrer" style={{ color: "#7bd89f" }}>Terms of Use</a>.
        </span>
      </label>

      <label style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}><input type="checkbox" checked={whatsappUpdates} onChange={e => setWhatsappUpdates(e.target.checked)} />Send updates about this report to my verified WhatsApp number. I can reply STOP to opt out.</label>
      <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>Drafts stay in this tab for 30 minutes without editing. Closing or refreshing the tab clears them.</p>
      {error && <p role="alert" style={{ color: "#f87171" }}>{error}</p>}

      {needsReverify ? (
        <button type="button" onClick={onReverify} style={{ ...primaryButtonStyle, marginTop: "1.25rem" }}>
          Verify my number again
        </button>
      ) : (
        <button type="submit" disabled={!canSubmit || submitting || (disputeSettings.otpRequired && !verificationToken)} style={{ ...primaryButtonStyle, marginTop: "1.25rem", opacity: !canSubmit || submitting ? 0.6 : 1 }}>
          {submitting ? "Submitting…" : "Submit dispute"}
        </button>
      )}
    </form>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>{children}</div>;
}

// Wrapping the control rather than rendering a sibling <label> is what
// actually associates the two: these controls carry no id to point htmlFor at,
// so a sibling label left every field unnamed for assistive tech.
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: "1rem" }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}
