import { Link } from "react-router-dom";
import { LegalPage } from "./LegalPage";
import { SITE } from "./siteInfo";

export function ContactUs() {
  return (
    <LegalPage title="Contact Us">
      <p>
        {SITE.name} is {SITE.summary}. For questions, feedback, data
        corrections, or accessibility issues, reach the project team:
      </p>

      <p style={{ marginTop: "1.25rem" }}>
        <strong>Email:</strong>{" "}
        <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
      </p>

      <h2>Field issues and disputes</h2>
      <p>
        To raise a dispute about a specific claim or land record, use{" "}
        <Link to="/report">Raise a Dispute</Link>, which routes to our
        ticket-tracking system rather than email, so it can be followed up on
        directly. If you already submitted a report, quote its reference number.
      </p>

      <h2>Response time</h2>
      <p>
        {SITE.name} is {SITE.status}. It is maintained on a best-effort basis
        and is not staffed by a government agency or official helpdesk.
      </p>
    </LegalPage>
  );
}
