import { Link } from "react-router-dom";

// Closing landing-page section: points at the WhatsApp ticketing flow that
// backs /report, so the page ends with a clear call to action rather than
// just trailing off into the footer. The action uses the same label and
// primary button style as the hero and #land-actions entry points.
export function WhatsAppCta() {
  return (
    <section className="home-cta" aria-labelledby="home-cta-title">
      <h2 id="home-cta-title">Have a land dispute to report?</h2>
      <p>
        Use the reporting form to describe the land dispute and select its location. You verify your phone with a WhatsApp code; status updates are optional.
      </p>
      <Link className="home-button" to="/report">
        Report a dispute
      </Link>
      <p className="home-cta-legal">
        Before submitting, review our <Link to="/privacy-policy">Privacy Policy</Link> and{" "}
        <Link to="/terms-of-use">Terms of Use</Link>.
      </p>
    </section>
  );
}
