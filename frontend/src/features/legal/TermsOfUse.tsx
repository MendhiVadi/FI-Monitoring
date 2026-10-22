import { Link } from "react-router-dom";
import { LegalPage } from "./LegalPage";
import { SITE } from "./siteInfo";

export function TermsOfUse() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        These terms govern your use of {SITE.name}, a prototype
        land-grievance reporting and staff-review tool with a supporting
        Forest Rights Act (FRA) demonstration. By using this site you agree to the terms below.
      </p>

      <h2>Prototype status</h2>
      <p>
        {SITE.name} is {SITE.status}, not a production
        government system. It is provided "as is," without warranty of any
        kind, and may change, break, or go offline without notice.
      </p>

      <h2>Not an official record</h2>
      <p>
        Claim, approval, and land-record data shown on the map is mock data
        created for demonstration and must not be treated as, cited as, or
        relied on in place of official FRA records maintained by government
        authorities. Any rule-based alerts and explanations are
        illustrative aids, not legal or administrative findings.
      </p>
      <p>
        A dispute report is a request for staff review. It is not a legal
        filing or government application, and staff do not decide who owns
        the land.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the site to submit false, abusive, or harassing dispute reports;</li>
        <li>attempt to disrupt, overload, or gain unauthorized access to the app or its backend;</li>
        <li>present the mock claim data as genuine government data; or</li>
        <li>use the site in a way that violates applicable law.</li>
      </ul>

      <h2>Disputes you submit</h2>
      <p>
        Content you submit through the dispute form is
        handled as described in our{" "}
        <Link to="/privacy-policy">Privacy Policy</Link>
        . You are responsible for the accuracy of what you submit.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent permitted by law, the {SITE.name} team is not liable
        for decisions made based on this prototype's mock data, rule-based
        alerts or explanations. Always verify against official
        records before taking administrative action.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as the project evolves. Continued use of
        the site after changes are posted constitutes acceptance of the
        updated terms.
      </p>
    </LegalPage>
  );
}
