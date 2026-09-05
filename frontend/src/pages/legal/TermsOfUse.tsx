import { StaticPage } from "../StaticPage";

export function TermsOfUse() {
  return (
    <StaticPage title="Terms of Use">
      <p>
        These terms govern your use of Forest Watch, a prototype
        decision-support tool for monitoring Forest Rights Act (FRA) claim
        implementation. By using this site you agree to the terms below.
      </p>

      <h2 style={h2}>Prototype status</h2>
      <p>
        Forest Watch is a hackathon demonstration, not a production
        government system. It is provided "as is," without warranty of any
        kind, and may change, break, or go offline without notice.
      </p>

      <h2 style={h2}>Not an official record</h2>
      <p>
        Claim, approval, and land-record data shown on the map is mock data
        created for demonstration and must not be treated as, cited as, or
        relied on in place of official FRA records maintained by government
        authorities. Any anomaly flags or AI-generated summaries are
        illustrative aids, not legal or administrative findings.
      </p>

      <h2 style={h2}>Acceptable use</h2>
      <p>You agree not to:</p>
      <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.8 }}>
        <li>use the site to submit false, abusive, or harassing dispute reports;</li>
        <li>attempt to disrupt, overload, or gain unauthorized access to the app or its backend;</li>
        <li>present the mock claim data as genuine government data; or</li>
        <li>use the site in a way that violates applicable law.</li>
      </ul>

      <h2 style={h2}>Disputes you submit</h2>
      <p>
        Content you submit through the dispute form or WhatsApp bot is
        handled as described in our{" "}
        <a href="/privacy-policy" style={{ color: "inherit" }}>
          Privacy Policy
        </a>
        . You are responsible for the accuracy of what you submit.
      </p>

      <h2 style={h2}>Limitation of liability</h2>
      <p>
        To the extent permitted by law, the Forest Watch team is not liable
        for decisions made based on this prototype's mock data, AI-generated
        explanations, or anomaly flags. Always verify against official
        records before taking administrative action.
      </p>

      <h2 style={h2}>Changes</h2>
      <p>
        We may update these terms as the project evolves. Continued use of
        the site after changes are posted constitutes acceptance of the
        updated terms.
      </p>
    </StaticPage>
  );
}

const h2: React.CSSProperties = { marginTop: "1.75rem", marginBottom: "0.5rem", fontSize: "1.1rem" };
