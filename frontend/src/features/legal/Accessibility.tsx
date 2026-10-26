import { Link } from "react-router-dom";
import { LegalPage } from "./LegalPage";
import { SITE } from "./siteInfo";

export function Accessibility() {
  return (
    <LegalPage title="Accessibility">
      <p>
        We want {SITE.name} to be usable by as many people as possible,
        including staff, field workers, and members of the public using
        assistive technology, phones, or low-bandwidth connections.
      </p>

      <h2>Current state</h2>
      <p>
        This is {SITE.status}. Text content, forms, and navigation are built
        with semantic HTML and standard links wherever possible. On the report
        form, the location can be set without dragging the map: search for a
        place, use your current location, use the centre of the map, or enter
        coordinates. The 3D globe and some map layers still rely heavily on
        visual and pointer interaction, and full keyboard and screen-reader
        support for those views is not yet complete.
      </p>

      <h2>What we're working toward</h2>
      <ul>
        <li>keyboard-navigable alternatives to map and globe interactions;</li>
        <li>sufficient color contrast for anomaly and status indicators, not color alone;</li>
        <li>screen-reader labels for charts, map layers, and dashboard metrics; and</li>
        <li>a lightweight, low-bandwidth view of district-level data for slow connections.</li>
      </ul>

      <h2>Reporting an accessibility issue</h2>
      <p>
        If you run into a barrier using this site, please tell us via the{" "}
        <Link to="/contact">Contact Us</Link>{" "}
        page so we can prioritize a fix.
      </p>
    </LegalPage>
  );
}
