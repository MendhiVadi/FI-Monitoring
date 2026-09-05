import { StaticPage } from "../StaticPage";

export function DatasetLinks() {
  return (
    <StaticPage title="Dataset Links">
      <p>
        Forest Watch combines real geographic boundary data with clearly
        labelled synthetic FRA claim records. This page lists where each
        layer comes from.
      </p>

      <h2 style={h2}>World and country boundaries</h2>
      <p>
        Country outlines used in the globe and world map views are built from{" "}
        <a
          href="https://github.com/topojson/world-atlas"
          target="_blank"
          rel="noreferrer"
          style={{ color: "inherit" }}
        >
          world-atlas
        </a>{" "}
        (Natural Earth data packaged as TopoJSON), converted to GeoJSON at
        build time.
      </p>

      <h2 style={h2}>Indian state and district boundaries</h2>
      <p>
        District-level India boundaries for the FRA claim map are not yet
        integrated — this is tracked as outstanding work. State-level
        forest-cover figures currently shown are placeholder values pending
        a sourced dataset; they are not official statistics.
      </p>

      <h2 style={h2}>FRA claim records</h2>
      <p>
        All claim, approval, and land-record data shown on the map, anomaly
        layer, and decision-support panel is synthetic mock data authored for
        this demo. It follows a documented mock schema and is not derived
        from any real FRA filing. See the{" "}
        <a href="/fair-use-policy" style={{ color: "inherit" }}>
          Fair Use Policy
        </a>{" "}
        for how this data may be used.
      </p>

      <h2 style={h2}>Suggesting a dataset</h2>
      <p>
        If you know of an open dataset we should use for district boundaries
        or forest-cover figures, let us know via{" "}
        <a href="/contact" style={{ color: "inherit" }}>
          Contact Us
        </a>
        .
      </p>
    </StaticPage>
  );
}

const h2: React.CSSProperties = { marginTop: "1.75rem", marginBottom: "0.5rem", fontSize: "1.1rem" };
