import { Link } from "react-router-dom";
import { LegalPage } from "./LegalPage";
import { SITE } from "./siteInfo";

export function FairUsePolicy() {
  return (
    <LegalPage title="Fair Use Policy">
      <p>
        {SITE.name} combines real geographic boundary data with clearly
        labelled synthetic Forest Rights Act (FRA) claim records. This page
        explains how each is meant to be used.
      </p>

      <h2>Real boundary data</h2>
      <p>
        District and state boundaries are sourced from publicly available
        geographic datasets and are used for mapping purposes only. See{" "}
        <Link to="/datasets">Dataset Links</Link>{" "}
        for provenance of each boundary layer in use.
      </p>

      <h2>Synthetic claim data</h2>
      <p>
        Claim, approval, and land-record data shown on the map, anomaly
        layer, and decision-support panel is generated mock data. It is
        always labelled as such in the interface. It exists to demonstrate
        how a real monitoring system could surface delayed claims and
        land-record mismatches — it is not, and must never be presented as,
        official government data.
      </p>

      <h2>Permitted use</h2>
      <p>
        You may explore, screenshot, and discuss this demo for evaluation,
        educational, and research purposes. You may not republish the
        synthetic claim data as if it were real, or use it to make claims
        about actual FRA implementation in any specific district or state.
      </p>

      <h2>Automated access</h2>
      <p>
        The public actions of the report form and the status page (verification codes, uploads, submitting a
        report and looking up a reference number) are meant for people using the site one case at a time. They are
        protected by App Check with Google reCAPTCHA Enterprise and limited per network address and phone number.
        Scripts and bots that try to get past these protections may be blocked.
      </p>

      <h2>Rule-based explanations</h2>
      <p>
        Explanations are produced by fixed, documented rules from the values
        shown; no AI model is connected. They describe the mock data and do
        not invent claim facts. Treat them as illustrative, not authoritative.
      </p>
    </LegalPage>
  );
}
