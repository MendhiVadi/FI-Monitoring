import { Link } from "react-router-dom";
import contract from "../../shared/contracts/dispute.json";
import { LegalPage } from "./LegalPage";
import { SITE } from "./siteInfo";

const REPLACEMENT_DAYS = contract.documents.replacementTtlDays;

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
        <li>upload forged or altered documents, or another person's identity documents without their permission;</li>
        <li>use another person's face, a photo of a photo or a recording for the selfie check;</li>
        <li>attempt to disrupt, overload, or gain unauthorized access to the app or its backend;</li>
        <li>use scripts or bots to request verification codes, upload files, submit reports or look up reference numbers, or try to get around App Check, reCAPTCHA or the request limits;</li>
        <li>guess other people's reference numbers to read their status;</li>
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
      <p>
        Documents you upload are screened automatically for signs of tampering. A flag
        only asks staff to look more closely; it is not a finding that a document is
        false, and it does not reject your report.
      </p>
      <p>
        The selfie check and the second, tilted photo of an Aadhaar card are optional. By taking the selfie check
        you confirm the photos are of you and agree to them being used, as the{" "}
        <Link to="/privacy-policy">Privacy Policy</Link> describes, only to screen your documents. Skipping either
        one does not affect your report.
      </p>

      <h2>Status lookup and replacement documents</h2>
      <p>
        The <Link to="/track">Track a report</Link> page shows a report's status, dates and any document requests to
        anyone who has its reference number. Share the number only with people you trust. The page is
        a convenience, not an official record or notice.
      </p>
      <p>
        When staff ask for a new copy of a document, you can send it from that page only after verifying the same
        phone number that was verified on the report, and only within {REPLACEMENT_DAYS} days of the request. Once the
        request ends, or if the report was filed without a verified phone,{" "}
        <Link to="/contact">contact the project team</Link>.
      </p>

      <h2>Updates by WhatsApp</h2>
      <p>
        Report updates by WhatsApp are optional and sent only if you chose them. They are capped per phone number
        (6 an hour and 20 a day), delivery is not guaranteed, and they never replace checking the status page. You can
        stop them at any time by replying STOP.
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
