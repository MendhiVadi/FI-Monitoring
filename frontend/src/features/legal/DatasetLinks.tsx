import { StaticPage } from "../../shared/ui/StaticPage";

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
        The FRA demonstration includes Mandla, Pune and Koraput from geoBoundaries
        gbOpen IND ADM2, representing 2021 boundaries (release 9469f09; boundary ID
        IND-ADM2-76128533). The source credits Pathways Data and India's Local
        Government Directory. The subset preserves the source geometries and is
        distributed under ODbL 1.0. These boundaries are historical context, not
        surveyed property limits. State forest-cover figures elsewhere in the app
        are illustrative placeholders, not official statistics.
      </p>

      <p><a href="https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/" target="_blank" rel="noreferrer">geoBoundaries metadata</a> · <a href="/geo/fra-demo-provenance.json">Pinned source and attribution</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL 1.0 licence</a></p>
      <h2 style={h2}>FRA claim records</h2>
      <p>
        All claim, approval, and land-record data shown on the map, anomaly
        layer, and decision-support panel is synthetic mock data authored for
        this demo. Sixty records cover three districts. Delay alerts use more than
        ninety pending days; area alerts use an absolute difference greater than
        twenty percent of the recorded area. These are demonstration thresholds,
        not statutory standards. Explanations use the rule and displayed evidence
        values. The records are not derived
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
