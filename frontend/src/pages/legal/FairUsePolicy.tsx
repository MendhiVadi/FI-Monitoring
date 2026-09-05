import { StaticPage } from "../StaticPage";

export function FairUsePolicy() {
  return (
    <StaticPage title="Fair Use Policy">
      <p>
        Forest Watch combines real geographic boundary data with clearly
        labelled synthetic Forest Rights Act (FRA) claim records. This page
        explains how each is meant to be used.
      </p>

      <h2 style={h2}>Real boundary data</h2>
      <p>
        District and state boundaries are sourced from publicly available
        geographic datasets and are used for mapping purposes only. See{" "}
        <a href="/datasets" style={{ color: "inherit" }}>
          Dataset Links
        </a>{" "}
        for provenance of each boundary layer in use.
      </p>

      <h2 style={h2}>Synthetic claim data</h2>
      <p>
        Claim, approval, and land-record data shown on the map, anomaly
        layer, and decision-support panel is generated mock data. It is
        always labelled as such in the interface. It exists to demonstrate
        how a real monitoring system could surface delayed claims and
        land-record mismatches — it is not, and must never be presented as,
        official government data.
      </p>

      <h2 style={h2}>Permitted use</h2>
      <p>
        You may explore, screenshot, and discuss this demo for evaluation,
        educational, and research purposes. You may not republish the
        synthetic claim data as if it were real, or use it to make claims
        about actual FRA implementation in any specific district or state.
      </p>

      <h2 style={h2}>AI-generated explanations</h2>
      <p>
        Anomaly explanations produced by the AI assistant are generated to
        describe patterns in the mock data using deterministic rules as
        evidence; the AI explains the evidence, it does not invent claim
        facts. Treat these explanations as illustrative, not authoritative.
      </p>
    </StaticPage>
  );
}

const h2: React.CSSProperties = { marginTop: "1.75rem", marginBottom: "0.5rem", fontSize: "1.1rem" };
