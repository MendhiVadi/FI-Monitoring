import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import disputeSettings from "../../../dispute-settings.json";
import { cardStyle } from "./reporting.styles";
import type { TrackLinkState } from "./lastTicket";

export function Confirmation({ ticketId, onStartAgain }: { ticketId: string | null; onStartAgain: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const reference = useRef<HTMLElement>(null);
  const [copyStatus, setCopyStatus] = useState("");

  // The long form unmounts underneath the reporter, which left focus on
  // <body> and the viewport near the footer, so the result went unseen.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, []);

  async function copyReference() {
    if (!ticketId) return;
    try {
      await navigator.clipboard.writeText(ticketId);
      setCopyStatus("Copied");
    } catch {
      // Clipboard access is blocked on plain-http and some in-app browsers:
      // select the text so the reporter can copy it by hand.
      const node = reference.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setCopyStatus("Selected. Copy it with your device's copy command.");
    }
  }

  return (
    <section className="report-confirmation" style={cardStyle} aria-labelledby="report-confirmation-heading">
      <h2 id="report-confirmation-heading" ref={heading} tabIndex={-1} style={{ marginTop: 0, color: "#8ae0b7" }}>Report submitted</h2>
      <p style={{ marginBottom: 0 }}>Your report has been saved for staff review.</p>
      {ticketId && (
        <>
          <p style={{ margin: "1rem 0 0", fontWeight: 600 }}>Your reference number</p>
          <code ref={reference} className="report-reference">{ticketId}</code>
          <div className="report-actions no-print" style={{ marginTop: 0 }}>
            <button type="button" className="report-btn report-btn--secondary" onClick={() => void copyReference()}>Copy reference</button>
            <button type="button" className="report-btn report-btn--secondary" onClick={() => window.print()}>Print or save</button>
          </div>
          <p role="status" style={{ minHeight: "1.5em", margin: "0.5rem 0 0", fontSize: "0.9rem" }}>{copyStatus}</p>
          <p style={{ fontSize: "0.9rem", color: "#b8c4cc" }}>
            Keep this number private. Use it to <Link to="/track" state={{ reference: ticketId } satisfies TrackLinkState}>track this report</Link>,
            and quote it if you contact the project team about this report.
          </p>
        </>
      )}
      <h3 style={{ marginBottom: "0.25rem", fontSize: "1.05rem" }}>What happens next</h3>
      <ol>
        <li>Staff review the location and the details you gave.</li>
        <li>
          You can check the status at any time on <Link to="/track">Track a report</Link> with your reference number.
          If staff ask for a new copy of a document, you can upload it there after verifying your phone.
        </li>
        {/* With verification paused no number is collected, so nothing to promise. */}
        {disputeSettings.otpRequired && <li>Staff may contact you on your verified number if they need more information.</li>}
        <li>You get WhatsApp updates only if you chose them on the form. A delayed message does not mean your report was lost.</li>
      </ol>
      <p className="report-warning">
        This report is not a legal filing or government application, and staff do not decide who owns the land.
      </p>
      <div className="report-actions no-print">
        {ticketId && <Link to="/track" state={{ reference: ticketId } satisfies TrackLinkState} className="report-btn">Track this report</Link>}
        <button type="button" className={ticketId ? "report-btn report-btn--secondary" : "report-btn"} onClick={onStartAgain}>Report another dispute</button>
        <Link to="/" className="report-btn report-btn--secondary">Return home</Link>
      </div>
    </section>
  );
}
