import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import { PhoneVerificationCard, type OtpTimers } from "../reporting/PhoneVerification";
import { readLastTicket, type TrackLinkState } from "../reporting/lastTicket";
import { VERIFIED_WINDOW_MS, VERIFY_WARN_MS, formatClock, spokenMinutes, useNow, useRemaining } from "../reporting/countdown";
import { maskPhone } from "../reporting/maskPhone";
import { inputStyle, labelStyle } from "../reporting/reporting.styles";
import { STATUS_GLYPHS, TERMINAL_STATUSES } from "../tickets/ticketStatus";
import { formatDateTimeIST } from "../../shared/format/formatDate";
import contract from "../../shared/contracts/dispute.json";
import { RequestUpload } from "./RequestUpload";
import { lookupCaseStatus, lookupFailure, normaliseReference, referenceError, type CaseStatus } from "./caseStatus";
import "../reporting/reporting.css";
import "./tracking.css";

const REFERENCE_ID = "track-reference";

// Public status page: a reference number shows the case's status, its
// timeline and any document staff asked for again. Uploading a replacement
// needs the WhatsApp number used for the report, verified with the same OTP
// flow as the report form. Nothing here is written to browser storage.
export function TrackCase() {
  const location = useLocation();
  const passed = (location.state as TrackLinkState | null)?.reference;
  const arrivedWith = typeof passed === "string" ? passed : null;
  const [reference, setReference] = useState(() => arrivedWith ?? readLastTicket() ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<CaseStatus | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const focusResult = useRef(false);

  async function lookup(raw: string) {
    if (inFlight.current) return;
    const value = normaliseReference(raw);
    const problem = referenceError(value);
    if (problem) {
      setFieldError(problem);
      input.current?.focus();
      return;
    }
    setFieldError(null);
    setPageError(null);
    inFlight.current = true;
    setLoading(true);
    setAnnouncement("Checking the status…");
    try {
      const result = await lookupCaseStatus(value);
      focusResult.current = true;
      setStatus(result);
      setAnnouncement("");
    } catch (err) {
      console.error("Status lookup failed", (err as { code?: string })?.code ?? "unknown");
      setStatus(null);
      setAnnouncement("");
      const failure = lookupFailure(err);
      if (failure.atField) {
        setFieldError(failure.message);
        input.current?.focus();
      } else {
        setPageError(failure.message);
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  // Moves screen-reader and keyboard users to the answer, as the confirmation page does.
  useEffect(() => {
    if (!status || !focusResult.current) return;
    focusResult.current = false;
    resultHeading.current?.focus({ preventScroll: true });
    resultHeading.current?.scrollIntoView({ block: "start" });
  }, [status]);

  // Arriving from the confirmation page ("Track this report") looks it up at once.
  const autoLookup = useRef(false);
  useEffect(() => {
    if (autoLookup.current || !arrivedWith) return;
    autoLookup.current = true;
    void lookup(arrivedWith);
    // Mount-only: one automatic lookup per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    void lookup(reference);
  }

  const describedBy = [`${REFERENCE_ID}-hint`, fieldError && `${REFERENCE_ID}-error`].filter(Boolean).join(" ");

  return (
    <main className="track-page">
      <p className="track-eyebrow">TRACK A REPORT</p>
      <h1 className="track-title">Check your report's status</h1>
      <p className="track-lead">
        Enter the reference number from your confirmation to see the status of your report and any
        document staff asked you to send again. This page never shows names, phone numbers, the description
        or the location.
      </p>

      <form className="track-card" onSubmit={submit} noValidate aria-label="Look up a report">
        <label htmlFor={REFERENCE_ID} style={labelStyle}>Reference number</label>
        <p id={`${REFERENCE_ID}-hint`} className="report-hint">
          20 letters and numbers, shown on the confirmation after you submitted. Capital and small letters are different.
        </p>
        <div className="track-lookup-row">
          <input
            ref={input}
            id={REFERENCE_ID}
            name="reference"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={40}
            value={reference}
            onChange={(e) => { setReference(e.target.value); setFieldError(null); }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={describedBy}
            className="track-reference-input"
            style={inputStyle}
          />
          <button type="submit" className="report-btn" disabled={loading} aria-busy={loading}>
            {loading ? "Checking…" : "Check status"}
          </button>
        </div>
        {fieldError && <p id={`${REFERENCE_ID}-error`} role="alert" className="report-field-error">{fieldError}</p>}
        <p className="report-hint report-hint--after">
          Lost your reference? <Link to="/contact">Contact the project team</Link>. Keep it private: anyone with it can see this status.
        </p>
      </form>

      <p role="status" className="report-sr-only">{announcement}</p>
      {pageError && <p role="alert" className="report-warning" style={{ marginTop: "1.5rem" }}>{pageError}</p>}

      {status && <StatusResult key={status.reference} status={status} headingRef={resultHeading} />}
    </main>
  );
}

function StatusResult({ status, headingRef }: { status: CaseStatus; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const closed = TERMINAL_STATUSES.has(status.statusId);
  const latest = status.timeline.length - 1;
  return (
    <>
      <section className="track-card" aria-labelledby="track-status-heading">
        <h2 id="track-status-heading" ref={headingRef} tabIndex={-1} className="track-status">
          <span className="track-status__glyph" aria-hidden="true">{STATUS_GLYPHS[status.statusId] ?? "•"}</span>
          <span><span className="report-sr-only">Status: </span>{status.statusLabel}</span>
        </h2>
        <dl className="track-facts">
          <div>
            <dt>Reference</dt>
            <dd className="track-mono">{status.reference}</dd>
          </div>
          {status.filedAt !== null && (
            <div>
              <dt>Submitted</dt>
              <dd><time dateTime={new Date(status.filedAt).toISOString()}>{formatDateTimeIST(status.filedAt)}</time></dd>
            </div>
          )}
          {status.lastUpdatedAt !== null && (
            <div>
              <dt>Last updated</dt>
              <dd><time dateTime={new Date(status.lastUpdatedAt).toISOString()}>{formatDateTimeIST(status.lastUpdatedAt)}</time></dd>
            </div>
          )}
        </dl>
        {closed && (
          <p className="report-hint">
            This case is closed. Documents attached to it are deleted {contract.documents.retentionDaysAfterClose} days after closing.
          </p>
        )}

        <h3 className="track-subheading">Timeline</h3>
        {status.timeline.length === 0 ? (
          <p className="report-hint">No status changes have been recorded yet.</p>
        ) : (
          <ol className="track-timeline">
            {status.timeline.map((entry, i) => (
              <li key={`${entry.at}-${i}`} aria-current={i === latest ? "step" : undefined}>
                <span className="track-timeline__label">
                  {entry.statusLabel}
                  {i === latest && <span className="track-timeline__now"> Latest</span>}
                </span>
                <time dateTime={new Date(entry.at).toISOString()}>{formatDateTimeIST(entry.at)}</time>
              </li>
            ))}
          </ol>
        )}
        <p className="report-hint report-hint--after">
          A status shows where staff review has reached. It is not a legal decision, and staff do not decide who owns the land.
        </p>
      </section>

      <DocumentRequests status={status} />
    </>
  );
}

function DocumentRequests({ status }: { status: CaseStatus }) {
  const requests = status.documentRequests;
  // Phone verification for uploads, in memory only (never the report draft).
  const [phone, setPhone] = useState("");
  const [verification, setVerification] = useState<{ token: string; verifiedAt: number } | null>(null);
  const [refusedToken, setRefusedToken] = useState<string | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyStep, setVerifyStep] = useState<"phone" | "otp">("phone");
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const verifiedRef = useRef<HTMLParagraphElement>(null);
  const verifyButton = useRef<HTMLButtonElement>(null);
  const focusVerified = useRef(false);
  const now = useNow();
  const verified = Boolean(verification && verification.token !== refusedToken);
  const lapsed = Boolean(verification) && !verified;
  const timers: OtpTimers = { otpSentAt, setOtpSentAt, cooldownUntil, setCooldownUntil };

  useEffect(() => {
    if (verified && focusVerified.current) {
      focusVerified.current = false;
      verifiedRef.current?.focus({ preventScroll: true });
    }
  }, [verified]);

  // Opening the card puts the reporter straight into its first field.
  useEffect(() => {
    if (!verifyOpen) return;
    const id = window.requestAnimationFrame(() => document.getElementById(verifyStep === "otp" ? "dispute-otp" : "dispute-phone")?.focus());
    return () => window.cancelAnimationFrame(id);
    // Only on opening: the card moves focus itself between its steps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyOpen]);

  const token = verification?.token ?? null;
  // The client clock ran out: treated like a refusal, so the page asks for a fresh code.
  const onExpired = useCallback(() => { if (token) setRefusedToken(token); }, [token]);

  function onVerified(token: string) {
    focusVerified.current = true;
    setVerification({ token, verifiedAt: Date.now() });
    setRefusedToken(null);
    setVerifyOpen(false);
    setVerifyStep("otp");
    setAnnouncement("Phone verified. You can upload the requested documents now.");
  }

  function openVerify() {
    setVerifyStep(lapsed && phone ? "otp" : "phone");
    setVerifyOpen(true);
  }

  function cancelVerify() {
    setVerifyOpen(false);
    window.requestAnimationFrame(() => verifyButton.current?.focus());
  }

  const onUnauthenticated = useCallback((token: string) => setRefusedToken(token), []);

  return (
    <section className="track-card" aria-labelledby="track-requests-heading">
      <h2 id="track-requests-heading" className="track-subheading" style={{ marginTop: 0 }}>Documents staff asked for</h2>
      <p role="status" className="report-sr-only">{announcement}</p>
      {requests.length === 0 ? (
        <p style={{ marginBottom: 0 }}>Nothing is waiting for you. If staff ask for a new copy of a document, it will be listed here.</p>
      ) : (
        <>
          <p>
            Staff asked for a new copy of {requests.length === 1 ? "this document" : `these ${requests.length} documents`}.
            The new file replaces the old one on your case and is checked in the same way. Each request can be answered once.
          </p>

          {verified && verification ? (
            <VerifiedNote phone={phone} deadline={verification.verifiedAt + VERIFIED_WINDOW_MS} onExpired={onExpired} noteRef={verifiedRef} />
          ) : verifyOpen ? (
            <>
              <PhoneVerificationCard
                heading={lapsed ? "Verify your phone again" : "Verify your phone to upload"}
                intro="Use the WhatsApp number you verified when you made this report. Reports sent without phone verification cannot receive uploads here."
                reverify={lapsed && Boolean(phone) && verifyStep === "otp"}
                step={verifyStep}
                phone={phone}
                onPhoneChange={setPhone}
                onStepChange={(next) => setVerifyStep(next === "phone" ? "phone" : "otp")}
                onVerified={onVerified}
                timers={timers}
              />
              <p style={{ margin: "0.5rem 0 0" }}>
                <button type="button" className="report-link-btn" onClick={cancelVerify}>Cancel verification</button>
              </p>
            </>
          ) : (
            <>
              {lapsed && (
                <p role="alert" className="report-warning">
                  Your phone verification expired or was not accepted. Verify again to upload; files already uploaded are kept.
                </p>
              )}
              <div className="report-actions" style={{ marginTop: lapsed ? "0.75rem" : 0 }}>
                <button ref={verifyButton} type="button" className="report-btn" onClick={openVerify} aria-describedby="track-verify-hint">
                  {lapsed && phone ? `Verify ${maskPhone(phone)} again` : "Verify your phone to upload"}
                </button>
              </div>
              <p id="track-verify-hint" className="report-hint report-hint--after">
                We send a 6-digit code on WhatsApp to the number you give. It must be the number you used for the report.
              </p>
            </>
          )}

          <ul className="track-requests">
            {requests.map((request) => (
              <li key={request.requestId}>
                <RequestUpload
                  request={request}
                  reference={status.reference}
                  phone={phone}
                  verificationToken={verified && verification ? verification.token : ""}
                  blocked={!verified}
                  now={now}
                  onUnauthenticated={onUnauthenticated}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function VerifiedNote({ phone, deadline, onExpired, noteRef }: {
  phone: string; deadline: number; onExpired: () => void; noteRef: RefObject<HTMLParagraphElement | null>;
}) {
  // Sleeps until the warning window, then ticks each second.
  const left = useRemaining(deadline, VERIFY_WARN_MS);
  useEffect(() => { if (left === 0) onExpired(); }, [left, onExpired]);
  const warn = left !== null && left <= VERIFY_WARN_MS;
  return (
    <>
      <p ref={noteRef} tabIndex={-1} className={warn ? "report-warning" : "track-verified"}>
        {warn && left !== null
          ? `Your phone verification expires in ${formatClock(left)}. Upload soon, or verify again afterwards.`
          : `Phone verified: ${maskPhone(phone)}. You can upload for about 15 minutes.`}
      </p>
      <p role="status" className="report-sr-only">{warn && left !== null ? `Your phone verification expires in about ${spokenMinutes(left)}.` : ""}</p>
    </>
  );
}
