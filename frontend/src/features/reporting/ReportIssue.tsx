import { useState } from "react";
import disputeSettings from "../../../dispute-settings.json";
import type { Step } from "./types";
import { PhoneVerification } from "./PhoneVerification";
import { DisputeForm } from "./DisputeForm";
import { Confirmation } from "./Confirmation";
import { useDraftField, clearReportDraft } from "./draftStore";

export function ReportIssue() {
  const [savedStep, setStep] = useDraftField("step");
  const step: Step = !disputeSettings.otpRequired && savedStep === "phone" ? "form" : savedStep;
  const [phone, setPhone] = useDraftField("phone");
  const [verificationToken, setVerificationToken] = useDraftField("verificationToken");
  const [ticketId, setTicketId] = useDraftField("ticketId");
  // Re-verification is tracked separately from `step` so the filled-in dispute
  // form stays mounted underneath and the reporter does not retype it.
  const [reverifyStep, setReverifyStep] = useState<"phone" | "otp" | null>(null);

  const showVerification = step === "phone" || step === "otp" || reverifyStep !== null;
  const verificationStep = reverifyStep ?? (step === "otp" ? "otp" : "phone");

  return (
    <main style={{ minHeight: "70vh", padding: "8rem 2rem 4rem", maxWidth: 700, margin: "0 auto" }}>
      <p style={{ color: "#7bd89f", letterSpacing: "0.12em", fontSize: "0.75rem", fontWeight: 700 }}>RAISE A DISPUTE</p>
      <h1 style={{ fontSize: "clamp(2.5rem, 8vw, 4.5rem)", lineHeight: 1.05 }}>Report a land dispute</h1>
      <p style={{ opacity: 0.8, marginTop: "1rem", lineHeight: 1.7, maxWidth: 560 }}>
        Use this to report a dispute over land or a forest rights claim — between individuals, a
        community and a government body, or between government bodies.
      </p>

      {showVerification && (
        <PhoneVerification
          step={verificationStep}
          phone={phone}
          onPhoneChange={setPhone}
          onVerified={(token) => {
            setVerificationToken(token);
            setReverifyStep(null);
            setStep("form");
          }}
          onStepChange={(next) => {
            if (reverifyStep) setReverifyStep(next === "otp" ? "otp" : "phone");
            else setStep(next);
          }}
        />
      )}

      {step === "form" && (
        <DisputeForm
          phone={phone}
          verificationToken={verificationToken}
          onReverify={() => {
            setVerificationToken("");
            setReverifyStep("phone");
          }}
          onSubmitted={(id) => {
            clearReportDraft();
            setTicketId(id);
            setStep("done");
          }}
        />
      )}

      {step === "done" && <Confirmation ticketId={ticketId} />}
    </main>
  );
}
