import { lazy, Suspense, useEffect, useState } from "react";
import { preload } from "react-dom";
import { Link } from "react-router-dom";
import { LocalBoundary } from "../../shared/ui/LocalBoundary";
import { ForestMapSection } from "./ForestMapSection";
import { WhatsAppCta } from "./WhatsAppCta";
import { HeroContent } from "./HeroContent";
import "./home.css";
const ScrollExperience = lazy(() => import("./ScrollExperience").then(m => ({ default: m.ScrollExperience })));
function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch { return false; }
}
// The loading placeholder keeps the sticky layout the 3D scene will take over.
// The settled static view (reduced motion, no WebGL, or a scene error) is a
// content-height panel over the earth image, so those visitors do not land on
// an empty full-screen block with the text pinned to its bottom edge.
function StaticHero({ loading = false }: { loading?: boolean }) {
  const hero = <section className={`home-hero${loading ? " home-hero--sticky" : " home-hero--static"}`}><HeroContent animated={loading} /></section>;
  return loading ? <div className="home-scroll">{hero}</div> : hero;
}
export function Home() {
  const [hasWebGL] = useState(supportsWebGL);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { const media = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReducedMotion(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const animated = hasWebGL && !reducedMotion;
  // The globe texture is otherwise requested only after the ~1MB 3D chunk has
  // downloaded and run. Start it alongside that chunk; crossOrigin matches
  // three's TextureLoader so the browser reuses this response.
  if (animated) preload("/earth.jpg", { as: "image", crossOrigin: "anonymous" });
  return (
    <main>
      {!animated ? <StaticHero /> : (
        <LocalBoundary fallback={<StaticHero />}>
          <Suspense fallback={<StaticHero loading />}><ScrollExperience /></Suspense>
        </LocalBoundary>
      )}
      <section id="land-actions" className="home-land-actions" tabIndex={-1}>
        <h2>Start with the land in question</h2>
        <p>Choose the location, explain what happened, and create a report for staff review. A 6-digit verification code is sent to your WhatsApp number first; status updates on WhatsApp are optional.</p>
        <Link className="home-button" to="/report">Report a dispute</Link>
        <div className="home-demo-link">
          <h3>Explore a land-rights demonstration</h3>
          <p>Our FRA example uses synthetic claims across three districts to show delays, land-record mismatches and state progress.</p>
          <Link className="home-text-link" to="/fra-monitoring">Open the FRA demonstration →</Link>
        </div>
      </section>
      <ForestMapSection />
      <WhatsAppCta />
    </main>
  );
}
