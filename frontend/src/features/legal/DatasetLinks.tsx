import { Link } from "react-router-dom";
import { ExternalLink, LegalPage } from "./LegalPage";
import { SITE } from "./siteInfo";

export function DatasetLinks() {
  return (
    <LegalPage title="Dataset Links">
      <p>
        {SITE.name} combines real geographic boundary data with clearly
        labelled synthetic FRA claim records. This page lists where each
        layer comes from.
      </p>

      <h2>World and country boundaries</h2>
      <p>
        Country outlines used in the globe and world map views are built from{" "}
        <ExternalLink href="https://github.com/topojson/world-atlas">world-atlas</ExternalLink>{" "}
        (Natural Earth data packaged as TopoJSON), converted to GeoJSON at
        build time.
      </p>

      <h2>Indian state and district boundaries</h2>
      <p>
        The FRA demonstration includes Mandla, Pune and Koraput from geoBoundaries
        gbOpen IND ADM2, representing 2021 boundaries (release 9469f09; boundary ID
        IND-ADM2-76128533). The source credits Pathways Data and India's Local
        Government Directory. The subset preserves the source geometries and is
        distributed under ODbL 1.0. These boundaries are historical context, not
        surveyed property limits. State forest-cover figures elsewhere in the app
        are illustrative placeholders, not official statistics.
      </p>

      {/* The provenance file is a static asset, not an app route, so it stays a plain link. */}
      <p><ExternalLink href="https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/">geoBoundaries metadata</ExternalLink> · <a href="/geo/fra-demo-provenance.json">Pinned source and attribution</a> · <ExternalLink href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL 1.0 licence</ExternalLink></p>
      <h2>FRA claim records</h2>
      <p>
        All claim, approval, and land-record data shown on the map, anomaly
        layer, and decision-support panel is synthetic mock data authored for
        this demo. Sixty records cover three districts. Delay alerts use more than
        ninety pending days; area alerts use an absolute difference greater than
        twenty percent of the recorded area. These are demonstration thresholds,
        not statutory standards. Explanations use the rule and displayed evidence
        values. The records are not derived
        from any real FRA filing. See the{" "}
        <Link to="/fair-use-policy">Fair Use Policy</Link>{" "}
        for how this data may be used.
      </p>

      <h2>Suggesting a dataset</h2>
      <p>
        If you know of an open dataset we should use for district boundaries
        or forest-cover figures, let us know via{" "}
        <Link to="/contact">Contact Us</Link>
        .
      </p>
    </LegalPage>
  );
}
