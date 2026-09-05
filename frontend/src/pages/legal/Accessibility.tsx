import { StaticPage } from "../StaticPage";

export function Accessibility() {
  return (
    <StaticPage title="Accessibility">
      <p>
        We want Forest Watch to be usable by as many people as possible,
        including officials, field workers, and citizens using assistive
        technology or low-bandwidth connections.
      </p>

      <h2 style={h2}>Current state</h2>
      <p>
        This is an early-stage hackathon build. Interactive map and 3D globe
        views rely heavily on visual and pointer interaction, and full
        keyboard and screen-reader support for those views is not yet
        complete. Text content, forms, and navigation are built with
        semantic HTML and standard links wherever possible.
      </p>

      <h2 style={h2}>What we're working toward</h2>
      <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.8 }}>
        <li>keyboard-navigable alternatives to map and globe interactions;</li>
        <li>sufficient color contrast for anomaly and status indicators, not color alone;</li>
        <li>screen-reader labels for charts, map layers, and dashboard metrics; and</li>
        <li>a lightweight, low-bandwidth view of district-level data for slow connections.</li>
      </ul>

      <h2 style={h2}>Reporting an accessibility issue</h2>
      <p>
        If you run into a barrier using this site, please tell us via the{" "}
        <a href="/contact" style={{ color: "inherit" }}>
          Contact Us
        </a>{" "}
        page so we can prioritize a fix.
      </p>
    </StaticPage>
  );
}

const h2: React.CSSProperties = { marginTop: "1.75rem", marginBottom: "0.5rem", fontSize: "1.1rem" };
