import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { callFunction, readableCallableError } from "./callables";
import { LocalBoundary } from "../../shared/ui/LocalBoundary";
import type { DisputeLocation } from "./DisputeLocationMap";
import disputeSettings from "../../../dispute-settings.json";
import { ALL_INDIAN_STATES, getDistrictsForState } from "./indiaDistricts";
import { cardStyle, inputStyle, labelStyle } from "./reporting.styles";
import contract from "../../shared/contracts/dispute.json";
import { useDraftField } from "./draftStore";
import { PhoneVerification } from "./PhoneVerification";
import { maskPhone } from "./maskPhone";
import { VERIFIED_WINDOW_MS, VERIFY_WARN_MS, formatClock, spokenMinutes, useRemaining } from "./countdown";

const DESCRIPTION_MIN = contract.descriptionMin;
const DESCRIPTION_MAX = contract.descriptionMax;
const REPORTER_TYPES = contract.reporterTypes;
const PARTY_TYPES = contract.partyTypes;
const DISPUTE_TYPES = contract.disputeTypes;
// Mirrors validateDisputeInput on the server, so an over-long list is caught
// here with a specific message instead of a rejected round trip.
const EVIDENCE_MAX_ITEMS = 10;
const EVIDENCE_ITEM_MAX = 120;
// The server's bounding box for "land in India" (disputes/service.ts).
const INDIA_BOUNDS = { latMin: 6, latMax: 38, lngMin: 68, lngMax: 98 };

// Leaflet, its CSS and the map code are only needed once the reporter reaches
// this form (after OTP), so they load as a separate chunk instead of with the
// report route. memo keeps keystrokes elsewhere in the form from re-rendering it.
const loadMap = () => import("./DisputeLocationMap").then((m) => ({ default: memo(m.DisputeLocationMap) }));

type FieldName = "reporterName" | "otherPartyName" | "state" | "district" | "location" | "locationConfirmed" | "description" | "evidence" | "consent";
// Summary order follows the page, so "first error" means the first one seen.
const IDS: Record<FieldName, string> = {
  reporterName: "dispute-reporter-name",
  otherPartyName: "dispute-other-party",
  state: "dispute-state",
  district: "dispute-district",
  location: "dispute-location",
  locationConfirmed: "dispute-location-confirmed",
  description: "dispute-description",
  evidence: "dispute-evidence",
  consent: "dispute-consent",
};
const ORDER = Object.keys(IDS) as FieldName[];

interface DisputeFormProps {
  phone: string;
  onPhoneChange: (phone: string) => void;
  verificationToken: string;
  verifiedAt: number | null;
  onVerified: (verificationToken: string) => void;
  onSubmitted: (ticketId: string) => void;
}

export function DisputeForm({ phone, onPhoneChange, verificationToken, verifiedAt, onVerified, onSubmitted }: DisputeFormProps) {
  // Records WHICH token the server rejected (or the client saw run out),
  // rather than a bare boolean. Comparing tokens means a freshly issued one
  // automatically restores the submit button.
  const [rejectedToken, setRejectedToken] = useState<string | null>(null);
  const needsReverify = disputeSettings.otpRequired && (!verificationToken || rejectedToken === verificationToken);
  const [reverifying, setReverifying] = useState(false);
  const [reverifyStep, setReverifyStep] = useState<"phone" | "otp">("otp");
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
  const submitLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<FieldName>>(() => new Set());
  const [attempts, setAttempts] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const reverifyRef = useRef<HTMLButtonElement>(null);
  const focusSubmitNext = useRef(false);
  const focusReverifyNext = useRef(false);
  // React.lazy caches a rejected import, so a retry needs a new lazy component.
  const [mapAttempt, setMapAttempt] = useState(0);
  const [MapComponent, setMapComponent] = useState(() => lazy(loadMap));
  const [mapFailed, setMapFailed] = useState(false);
  const evidenceReferences = useMemo(() => evidenceText.split(/\r?\n/).map(line => line.trim()).filter(Boolean), [evidenceText]);
  const evidenceError = evidenceReferences.length > EVIDENCE_MAX_ITEMS
    ? `List at most ${EVIDENCE_MAX_ITEMS} evidence references.`
    : evidenceReferences.some(line => line.length > EVIDENCE_ITEM_MAX)
      ? `Keep each evidence reference to ${EVIDENCE_ITEM_MAX} characters.`
      : null;
  const onLocationChange = useCallback((point: DisputeLocation | null) => { setLocation(point); setLocationConfirmed(false); }, [setLocation, setLocationConfirmed]);

  const availableDistricts = useMemo(() => {
    return getDistrictsForState(state);
  }, [state]);

  const descriptionLength = description.trim().length;
  const errors = useMemo(() => {
    const found: Partial<Record<FieldName, string>> = {};
    if (reporterName.trim().length < 2) found.reporterName = "Enter your name or department (at least 2 characters).";
    if (otherPartyName.trim().length < 2) found.otherPartyName = "Enter the other party's name or department (at least 2 characters).";
    if (!state.trim()) found.state = "Select the state or union territory.";
    // Without a state the district list is disabled; the state error covers it.
    if (state && !district.trim()) found.district = "Select the district.";
    if (!location) found.location = "Place a pin on the map.";
    else if (district && !locationConfirmed) found.locationConfirmed = "Confirm the pin marks the disputed land.";
    if (descriptionLength < DESCRIPTION_MIN) {
      found.description = descriptionLength === 0
        ? `Describe the dispute (at least ${DESCRIPTION_MIN} characters).`
        : `Add ${DESCRIPTION_MIN - descriptionLength} more characters to the description.`;
    }
    if (evidenceError) found.evidence = evidenceError;
    if (!consent) found.consent = "Tick the box to confirm the details and agree to the Privacy Policy and Terms of Use.";
    return found;
  }, [reporterName, otherPartyName, state, district, location, locationConfirmed, descriptionLength, evidenceError, consent]);
  // A field's error shows once it has been left, or after a submit attempt,
  // and then follows the value live so fixing it clears the message at once.
  // Evidence limits show immediately: they are about what was just typed.
  const shown = (name: FieldName) => (attempts > 0 || touched.has(name) || name === "evidence") ? errors[name] : undefined;
  const summary = attempts > 0 ? ORDER.filter((name) => errors[name]) : [];
  const touch = useCallback((name: FieldName) => {
    setTouched((prev) => prev.has(name) ? prev : new Set(prev).add(name));
  }, []);
  const control = (name: FieldName, hint = false) => ({
    id: IDS[name],
    "aria-required": true as const,
    "aria-invalid": shown(name) ? true : undefined,
    "aria-describedby": [hint && `${IDS[name]}-hint`, shown(name) && `${IDS[name]}-error`].filter(Boolean).join(" ") || undefined,
    onBlur: () => touch(name),
  });

  useEffect(() => {
    if (attempts > 0) summaryRef.current?.focus();
  }, [attempts]);

  // Submit and the re-verify button replace each other in place; focus moves
  // to whichever is shown instead of dropping to <body> when one unmounts.
  useEffect(() => {
    if (reverifying) return;
    if (needsReverify && focusReverifyNext.current) {
      focusReverifyNext.current = false;
      reverifyRef.current?.focus();
    } else if (!needsReverify && focusSubmitNext.current) {
      focusSubmitNext.current = false;
      submitRef.current?.focus();
    }
  }, [needsReverify, reverifying]);

  // Keyed on a boolean so the listener is not torn down and re-added on
  // every keystroke in the name or description.
  const dirty = Boolean(reporterName || description);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const onMapFailed = useCallback(() => setMapFailed(true), []);
  const onVerificationExpired = useCallback(() => {
    if (document.activeElement === submitRef.current) focusReverifyNext.current = true;
    setRejectedToken(verificationToken);
  }, [verificationToken]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // A ref, because Enter plus a click can both arrive before `submitting`
    // re-renders. Retrying after a failure is safe: submissionId is unchanged,
    // so the server replays the original ticket instead of creating a second.
    if (submitting || submitLock.current || needsReverify) return;
    if (Object.keys(errors).length > 0) {
      setError(null);
      setAttempts((n) => n + 1);
      return;
    }
    submitLock.current = true;
    setError(null);
    setSubmitting(true);
    try {
      const result = await callFunction<Record<string, unknown>, { ticketId: string }>("submitDispute", {
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
        location, immediateRisk, evidenceReferences,
      });
      onSubmitted(result.ticketId);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "functions/unauthenticated") {
        // The disabled Submit may already have handed focus to <body>.
        const active = document.activeElement;
        if (!active || active === document.body || active === submitRef.current) focusReverifyNext.current = true;
        setRejectedToken(verificationToken);
      } else {
        setError(readableCallableError(err, "Couldn't submit the dispute. Please try again."));
      }
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function jumpTo(name: FieldName) {
    const target = document.getElementById(IDS[name]);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
  }

  const descriptionHint = descriptionLength < DESCRIPTION_MIN
    ? `${DESCRIPTION_MIN - descriptionLength} more characters needed`
    : `${description.length} / ${DESCRIPTION_MAX}`;
  const pinHint = !location ? "Place a pin on the map first." : !district ? "Select the district first." : null;

  return (
    // The submit area sits outside <form> (the button joins it through the
    // form attribute) so the inline re-verification card, which has forms of
    // its own, is not nested inside this one.
    <div style={cardStyle}>
      <form id="dispute-form" onSubmit={submit} noValidate>
        {summary.length > 0 && (
          <div ref={summaryRef} role="alert" tabIndex={-1} className="report-error-summary" aria-labelledby="dispute-error-summary-heading">
            <h2 id="dispute-error-summary-heading">Check {summary.length === 1 ? "this answer" : `these ${summary.length} answers`}</h2>
            <ul>
              {summary.map((name) => (
                <li key={name}>
                  <a href={`#${IDS[name]}`} onClick={(e) => { e.preventDefault(); jumpTo(name); }}>{errors[name]}</a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p style={{ marginTop: 0, marginBottom: "1.5rem", color: "#8ae0b7", fontWeight: 600, lineHeight: 1.5 }}>
          {disputeSettings.otpRequired
            ? "Phone verified. Now tell us about the dispute. Your verification lasts 15 minutes; if it runs out, you can verify again here without losing your answers."
            : "Phone verification is temporarily paused. You can submit without a verification code."}
        </p>

        <fieldset className="report-fieldset">
          <legend className="report-legend">About you</legend>
          <div className="report-row">
            <Field id={IDS.reporterName} label="Your name / department" marker="required" error={shown("reporterName")}>
              <input {...control("reporterName")} autoComplete="name" maxLength={contract.nameMax} value={reporterName} onChange={(e) => setReporterName(e.target.value)} placeholder="Full name" style={inputStyle} />
            </Field>
            <Field id="dispute-reporter-type" label="You are raising this as">
              <select id="dispute-reporter-type" value={reporterType} onChange={(e) => setReporterType(e.target.value)} style={inputStyle}>
                {REPORTER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="report-fieldset">
          <legend className="report-legend">Other party</legend>
          <div className="report-row">
            <Field id={IDS.otherPartyName} label="Their name / department" marker="required" error={shown("otherPartyName")}>
              <input {...control("otherPartyName")} maxLength={contract.nameMax} value={otherPartyName} onChange={(e) => setOtherPartyName(e.target.value)} placeholder="Who is the dispute with?" style={inputStyle} />
            </Field>
            <Field id="dispute-other-party-type" label="Other party is">
              <select id="dispute-other-party-type" value={otherPartyType} onChange={(e) => setOtherPartyType(e.target.value)} style={inputStyle}>
                {PARTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="report-fieldset">
          <legend className="report-legend">Location of the land</legend>
          <div className="report-row">
            <Field id={IDS.state} label="State / Union Territory" marker="required" error={shown("state")}>
              <select
                {...control("state")}
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
            <Field id={IDS.district} label="District" marker="required" error={shown("district")}>
              <select
                {...control("district")}
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
          </div>

          <Field id="dispute-village" label="Village / landmark" marker="optional">
            <input id="dispute-village" maxLength={contract.nameMax} value={village} onChange={(e) => setVillage(e.target.value)} placeholder="Nearest village or landmark" style={inputStyle} />
          </Field>

          <div id={IDS.location} tabIndex={-1} role="group" aria-label="Map pin" aria-describedby={shown("location") ? `${IDS.location}-error` : undefined}>
            <LocalBoundary key={mapAttempt} fallback={
              <MapFallback
                onShown={onMapFailed}
                onRetry={() => { setMapFailed(false); setMapAttempt((n) => n + 1); setMapComponent(() => lazy(loadMap)); }}
              />
            }>
              <Suspense fallback={<p role="status" style={{ minHeight: "min(380px, 55svh)" }}>Loading map…</p>}>
                <MapComponent value={location} onChange={onLocationChange} state={state} district={district} />
              </Suspense>
            </LocalBoundary>
            {shown("location") && <p id={`${IDS.location}-error`} className="report-field-error" role="alert">{shown("location")}</p>}
          </div>
          <ManualCoordinates open={mapFailed} value={location} onChange={onLocationChange} />

          <div className="report-field">
            <label className="report-check">
              <input
                type="checkbox"
                {...control("locationConfirmed", Boolean(pinHint))}
                disabled={Boolean(pinHint)}
                checked={locationConfirmed}
                onChange={e => { setLocationConfirmed(e.target.checked); touch("locationConfirmed"); }}
              />
              <span>This pin marks the disputed land in {district || "the selected district"}, {state || "state"}. <span className="report-required">(required)</span></span>
            </label>
            {pinHint && <p id={`${IDS.locationConfirmed}-hint`} className="report-hint" style={{ marginLeft: "1.85rem" }}>{pinHint}</p>}
            {shown("locationConfirmed") && <p id={`${IDS.locationConfirmed}-error`} className="report-field-error" role="alert">{shown("locationConfirmed")}</p>}
          </div>
        </fieldset>

        <fieldset className="report-fieldset">
          <legend className="report-legend">What happened</legend>
          <Field id="dispute-type" label="Type of dispute">
            <select id="dispute-type" value={disputeType} onChange={(e) => setDisputeType(e.target.value)} style={inputStyle}>
              {DISPUTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          <Field id={IDS.description} label="Describe the dispute" marker="required" error={shown("description")}
            hintAfter={<span style={{ display: "block", textAlign: "right" }}>{descriptionHint}</span>}>
            <textarea
              {...control("description", true)}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`What happened, when, and what land or claim is involved? (at least ${DESCRIPTION_MIN} characters)`}
              rows={6}
              maxLength={DESCRIPTION_MAX}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Field>

          <Field id="dispute-risk" label="Is there an immediate threat of harm or displacement?">
            <select id="dispute-risk" value={immediateRisk} onChange={e => setImmediateRisk(e.target.value as typeof immediateRisk)} style={inputStyle}><option value="unknown">Not sure / not assessed</option><option value="no">No</option><option value="yes">Yes</option></select>
          </Field>
          <Field id={IDS.evidence} label="Evidence references" marker="optional" error={shown("evidence")}
            hint="One per line, up to 10. For example, survey or claim reference numbers. Staff will need to verify them.">
            <textarea {...control("evidence", true)} aria-required={undefined} rows={3} maxLength={1209} value={evidenceText} onChange={e => setEvidenceText(e.target.value)} style={inputStyle} />
          </Field>
        </fieldset>

        <fieldset className="report-fieldset" style={{ marginBottom: 0 }}>
          <legend className="report-legend">Consent</legend>
          <p id={`${IDS.consent}-hint`} className="report-hint">
            This report is for staff review. It is not a legal filing or government application, and staff do not decide who owns the land.
          </p>
          <div className="report-field">
            <label className="report-check">
              <input type="checkbox" {...control("consent", true)} checked={consent} onChange={(e) => { setConsent(e.target.checked); touch("consent"); }} />
              <span>
                I confirm these details are accurate to my knowledge, and I agree to the{" "}
                <a href="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy<span className="report-sr-only"> (opens in new tab)</span></a> and{" "}
                <a href="/terms-of-use" target="_blank" rel="noreferrer">Terms of Use<span className="report-sr-only"> (opens in new tab)</span></a>.{" "}
                <span className="report-required">(required)</span>
              </span>
            </label>
            {shown("consent") && <p id={`${IDS.consent}-error`} className="report-field-error" role="alert">{shown("consent")}</p>}
          </div>

          <label className="report-check">
            <input type="checkbox" checked={whatsappUpdates} onChange={e => setWhatsappUpdates(e.target.checked)} />
            <span>Send updates about this report to my verified WhatsApp number. I can reply STOP to opt out. <span className="report-optional">(optional)</span></span>
          </label>
        </fieldset>

        <p id="dispute-draft-note" style={{ fontSize: "0.85rem", color: "#b8c4cc", lineHeight: 1.5 }}>
          For privacy, drafts stay only in this tab and are cleared after 30 minutes without editing; a warning appears 5 minutes before. Closing or refreshing the tab clears them.
        </p>
        {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
      </form>

      {disputeSettings.otpRequired && verificationToken && !needsReverify && verifiedAt !== null && (
        <VerificationTimer deadline={verifiedAt + VERIFIED_WINDOW_MS} onExpired={onVerificationExpired} />
      )}

      {needsReverify ? (
        <>
          <p role="alert" className="report-warning" style={{ marginTop: "1.25rem" }}>
            Your phone verification expired. Verify your number again to submit — your answers are kept.
          </p>
          {reverifying ? (
            <PhoneVerification
              reverify
              step={reverifyStep}
              phone={phone}
              onPhoneChange={onPhoneChange}
              onStepChange={(next) => setReverifyStep(next === "phone" ? "phone" : "otp")}
              onVerified={(token) => {
                focusSubmitNext.current = true;
                setReverifying(false);
                setReverifyStep("otp");
                onVerified(token);
              }}
            />
          ) : (
            <div className="report-actions">
              <button ref={reverifyRef} type="button" className="report-btn" onClick={() => { setReverifyStep(phone ? "otp" : "phone"); setReverifying(true); }}>
                {phone ? `Send a new code to ${maskPhone(phone)}` : "Verify my number again"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="report-actions">
          <button ref={submitRef} type="submit" form="dispute-form" className="report-btn" disabled={submitting} aria-busy={submitting} aria-describedby="dispute-draft-note">
            {submitting ? "Submitting…" : "Submit dispute"}
          </button>
        </div>
      )}
    </div>
  );
}

function VerificationTimer({ deadline, onExpired }: { deadline: number; onExpired: () => void }) {
  const left = useRemaining(deadline);
  useEffect(() => { if (left === 0) onExpired(); }, [left, onExpired]);
  if (left === null || left <= 0) return null;
  const warn = left <= VERIFY_WARN_MS;
  return (
    <>
      <p aria-hidden="true" className={warn ? "report-warning" : "report-timer"} style={{ marginTop: "1.25rem" }}>
        {warn
          ? `Your phone verification expires in ${formatClock(left)}. Submit soon. If it runs out, you can verify again here without losing your answers.`
          : `Phone verification valid for ${formatClock(left)}.`}
      </p>
      {/* Spoken only inside the warning window, and once a minute rather than every second. */}
      <p role="status" className="report-sr-only">
        {warn ? `Your phone verification expires in about ${spokenMinutes(left)}. Submit soon.` : ""}
      </p>
    </>
  );
}

function MapFallback({ onShown, onRetry }: { onShown: () => void; onRetry: () => void }) {
  useEffect(() => { onShown(); }, [onShown]);
  return (
    <div role="alert" className="report-warning" style={{ margin: "1rem 0" }}>
      <p style={{ marginTop: 0 }}>The map could not load. Your answers are kept.</p>
      <p>Try again, or enter the coordinates of the land below.</p>
      <button type="button" className="report-btn report-btn--secondary" onClick={onRetry}>Try loading the map again</button>
    </div>
  );
}

// Keyboard users, people with GPS or survey coordinates, and anyone whose map
// failed to load can still set the location the server requires.
function ManualCoordinates({ open, value, onChange }: { open: boolean; value: DisputeLocation | null; onChange: (point: DisputeLocation) => void }) {
  const [latitude, setLatitude] = useState(value ? String(value.latitude) : "");
  const [longitude, setLongitude] = useState(value ? String(value.longitude) : "");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  function apply() {
    const lat = Number(latitude.trim().replace(",", "."));
    const lng = Number(longitude.trim().replace(",", "."));
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setStatus("");
      setError("Enter both latitude and longitude as decimal numbers, for example 18.520430 and 73.856743.");
      return;
    }
    if (lat < INDIA_BOUNDS.latMin || lat > INDIA_BOUNDS.latMax || lng < INDIA_BOUNDS.lngMin || lng > INDIA_BOUNDS.lngMax) {
      setStatus("");
      setError(`Those coordinates are outside India. Latitude must be ${INDIA_BOUNDS.latMin} to ${INDIA_BOUNDS.latMax} and longitude ${INDIA_BOUNDS.lngMin} to ${INDIA_BOUNDS.lngMax}.`);
      return;
    }
    setError(null);
    const point = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
    onChange(point);
    setStatus(`Pin set at ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}. Confirm it below.`);
  }
  const onEnter = (event: KeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); apply(); } };
  const describedBy = error ? "dispute-coordinates-error" : undefined;

  return (
    <details open={open} style={{ margin: "0 0 1rem", padding: "0.75rem 1rem", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10 }}>
      <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Enter coordinates instead</summary>
      <div className="report-row" style={{ marginTop: "0.5rem" }}>
        <div className="report-field">
          <label htmlFor="dispute-latitude" style={labelStyle}>Latitude</label>
          <input id="dispute-latitude" inputMode="decimal" autoComplete="off" placeholder="e.g. 18.520430" value={latitude}
            onChange={(e) => { setLatitude(e.target.value); setError(null); }} onKeyDown={onEnter}
            aria-invalid={error ? true : undefined} aria-describedby={describedBy} style={inputStyle} />
        </div>
        <div className="report-field">
          <label htmlFor="dispute-longitude" style={labelStyle}>Longitude</label>
          <input id="dispute-longitude" inputMode="decimal" autoComplete="off" placeholder="e.g. 73.856743" value={longitude}
            onChange={(e) => { setLongitude(e.target.value); setError(null); }} onKeyDown={onEnter}
            aria-invalid={error ? true : undefined} aria-describedby={describedBy} style={inputStyle} />
        </div>
      </div>
      {error && <p id="dispute-coordinates-error" className="report-field-error" role="alert" style={{ marginTop: 0 }}>{error}</p>}
      <button type="button" className="report-btn report-btn--secondary" onClick={apply}>Set pin from coordinates</button>
      <p role="status" className="report-hint report-hint--after">{status}</p>
    </details>
  );
}

// A sibling <label htmlFor> plus ids on the controls, so hints and errors can
// be tied to them with aria-describedby (a wrapping label cannot do that).
function Field({ id, label, marker, hint, hintAfter, error, children }: {
  id: string; label: ReactNode; marker?: "required" | "optional";
  hint?: ReactNode; hintAfter?: ReactNode; error?: string; children: ReactNode;
}) {
  return (
    <div className="report-field">
      <label htmlFor={id} style={labelStyle}>
        {label}
        {marker && <span className={marker === "required" ? "report-required" : "report-optional"}> ({marker})</span>}
      </label>
      {hint && <p id={`${id}-hint`} className="report-hint">{hint}</p>}
      {children}
      {hintAfter && <p id={`${id}-hint`} className="report-hint report-hint--after">{hintAfter}</p>}
      {error && <p id={`${id}-error`} className="report-field-error" role="alert">{error}</p>}
    </div>
  );
}
