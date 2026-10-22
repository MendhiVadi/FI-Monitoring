import { Link } from "react-router-dom";

// Shared by the lazy placeholder, accessible static view and animated hero:
// the main action remains available even while the 3D bundle is loading.
export function HeroContent({ animated = false }: { animated?: boolean }) {
  return (
    <div className="home-hero-content">
      <p className="home-eyebrow">LAND DISPUTE · LOCATION TO ACTION</p>
      <h1>Land disputes.<br />A clearer way forward.</h1>
      <p className="home-hero-description">
        Pinpoint the land, describe the dispute, and submit a report for staff review.
      </p>
      <div className="home-actions">
        <Link className="home-button" to="/report">Report a dispute</Link>
        <a className="home-text-link" href="#land-actions">
          {animated ? "Skip intro ↓" : "Explore the project ↓"}
        </a>
      </div>
      {animated && <p className="home-scroll-hint">Scroll to explore India ↓</p>}
    </div>
  );
}
