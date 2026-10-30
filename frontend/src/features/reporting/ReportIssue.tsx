import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import disputeSettings from "../../../dispute-settings.json";
import contract from "../../shared/contracts/dispute.json";
import type { Step } from "./types";
import { PhoneVerification } from "./PhoneVerification";
import { DisputeForm } from "./DisputeForm";
import { Confirmation } from "./Confirmation";
import { useDraftField, clearReportDraft, useDraftExpiry, touchDraft, dismissDraftExpiredNotice } from "./draftStore";
import { formatClock, spokenMinutes, useRemaining } from "./countdown";
import { caseTypeFor } from "./documentUploads";
import { readLastTicket, writeLastTicket, type TrackLinkState } from "./lastTicket";
import "./reporting.css";


const EXPIRY_WARN_MS = 5 * 60 * 1000;
// From the contract, so the checklist follows the required documents. The
// first party type is a private person, the case type that needs the most.
const BASIC_DOCS = caseTypeFor("Not sure").required;
const PERSON_DOCS = caseTypeFor(contract.partyTypes[0]).required.filter((kind) => !BASIC_DOCS.includes(kind));

export function ReportIssue() {
  const [savedStep, setStep] = useDraftField("step");
  const step: Step = !disputeSettings.otpRequired && savedStep === "phone" ? "form" : savedStep;
  const [phone, setPhone] = useDraftField("phone");
  const [verificationToken, setVerificationToken] = useDraftField("verificationToken");
  const [verifiedAt, setVerifiedAt] = useDraftField("verifiedAt");
  const [ticketId, setTicketId] = useDraftField("ticketId");
  const [lastTicket, setLastTicket] = useState(readLastTicket);
  const heading = useRef<HTMLHeadingElement>(null);

  const onVerified = useCallback((token: string) => {
    setVerificationToken(token);
    setVerifiedAt(Date.now());
    setStep("form");
  }, [setVerificationToken, setVerifiedAt, setStep]);

  const startAgain = useCallback(() => {
    clearReportDraft();
    writeLastTicket(null);
    setLastTicket(null);
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main className="report-page">
      <div className="no-print">
        <p style={{ color: "#8ae0b7", letterSpacing: "0.12em", fontSize: "0.75rem", fontWeight: 700 }}>RAISE A DISPUTE</p>
        <h1 ref={heading} tabIndex={-1} style={{ fontSize: "clamp(2.25rem, 8vw, 4.5rem)", lineHeight: 1.05 }}>Report a land dispute</h1>
        <p style={{ opacity: 0.85, marginTop: "1rem", lineHeight: 1.7, maxWidth: 560 }}>
          Use this to report a dispute over land or a forest rights claim — between individuals, a
          community and a government body, or between government bodies.
        </p>
      </div>

      {(step === "phone" || step === "otp") && (
        <section className="report-note no-print" aria-labelledby="report-before-heading">
          <h2 id="report-before-heading">Before you start</h2>
          <p>You will need:</p>
          <ul>
            {disputeSettings.otpRequired && <li>a WhatsApp number to receive a 6-digit verification code;</li>}
            <li>the location of the land;</li>
            <li>a short description of the dispute; and</li>
            <li>
              photos or PDFs of your documents: {BASIC_DOCS.map((kind) => kind.label).join(", ")}
              {PERSON_DOCS.length > 0 && <>; for a dispute with a private person also {PERSON_DOCS.map((kind) => kind.label).join(", ")}</>}.
            </li>
          </ul>
          <p>
            This creates a report for staff review. It is not a legal filing or government
            application, and staff do not decide who owns the land.
          </p>
        </section>
      )}

      {lastTicket && step !== "done" && (
        <p className="report-note" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span>Your last reference: <strong style={{ fontFamily: "ui-monospace, Consolas, monospace" }}>{lastTicket}</strong></span>
          <Link to="/track" state={{ reference: lastTicket } satisfies TrackLinkState} style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 0.25rem" }}>Track it</Link>
          <button type="button" className="report-link-btn" onClick={() => { writeLastTicket(null); setLastTicket(null); }}>Hide</button>
        </p>
      )}

      <ExpiredNotice />

      {(step === "phone" || step === "otp") && (
        <PhoneVerification
          step={step === "otp" ? "otp" : "phone"}
          phone={phone}
          onPhoneChange={setPhone}
          onVerified={onVerified}
          onStepChange={setStep}
        />
      )}

      {step === "form" && (
        <DisputeForm
          phone={phone}
          onPhoneChange={setPhone}
          verificationToken={verificationToken}
          verifiedAt={verifiedAt}
          onVerified={onVerified}
          onSubmitted={(id) => {
            // The uploads now belong to the ticket, so they are not discarded.
            clearReportDraft({ discardUploads: false });
            writeLastTicket(id);
            setLastTicket(id);
            setTicketId(id);
            // Setting "done" last also stops the idle timer (draftStore).
            setStep("done");
          }}
        />
      )}

      {step === "done" && <Confirmation ticketId={ticketId} onStartAgain={startAgain} />}

      {step !== "done" && <ExpiryBanner />}
    </main>
  );
}

function ExpiredNotice() {
  const { expiredNotice } = useDraftExpiry();
  if (!expiredNotice) return null;
  return (
    <div role="status" className="report-warning" style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
      <span style={{ flex: "1 1 14rem" }}>For privacy, your previous draft was cleared after 30 minutes without activity. Please start again.</span>
      <button type="button" className="report-link-btn" style={{ color: "#fde68a" }} onClick={dismissDraftExpiredNotice}>Dismiss</button>
    </div>
  );
}

// Sticky at the bottom of the report so it is seen wherever the reporter is
// in the long form, not only at the top.
function ExpiryBanner() {
  const { expiresAt } = useDraftExpiry();
  const remaining = useRemaining(expiresAt, EXPIRY_WARN_MS);
  const left = remaining !== null && remaining > 0 && remaining <= EXPIRY_WARN_MS ? remaining : null;
  // The button removes its own banner; a keyboard user goes back to the
  // control they left rather than to <body>.
  const returnTo = useRef<HTMLElement | null>(null);
  function keep(button: HTMLButtonElement) {
    let keyboard = false;
    try { keyboard = button.matches(":focus-visible"); } catch { /* older browser: leave focus alone */ }
    const back = returnTo.current;
    touchDraft();
    if (keyboard && back?.isConnected) back.focus({ preventScroll: true });
  }
  return (
    <>
      {/* Mounted before it has anything to say, so the first warning is announced too.
          The visible clock ticks every second; the spoken copy changes once a minute. */}
      <p role="status" className="report-sr-only">{left !== null ? `For privacy, this draft will be cleared in about ${spokenMinutes(left)} without activity.` : ""}</p>
      {left !== null && (
        <div className="report-expiry-banner no-print" id="report-draft-expiry">
          <p aria-hidden="true">For privacy, this draft will be cleared in {formatClock(left)} without activity.</p>
          <button type="button" className="report-btn"
            onFocus={(e) => { returnTo.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null; }}
            onClick={(e) => keep(e.currentTarget)}>Keep my draft</button>
        </div>
      )}
    </>
  );
}
