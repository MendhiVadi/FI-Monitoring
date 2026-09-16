import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LocalBoundary } from "../../shared/ui/LocalBoundary";
import { ForestMapSection } from "./ForestMapSection";
import { WhatsAppCta } from "./WhatsAppCta";
const ScrollExperience = lazy(() => import("./ScrollExperience").then(m => ({ default: m.ScrollExperience })));
function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch { return false; }
}
function StaticHero() { return <section style={{ padding: "9rem 1.5rem 5rem", textAlign: "center", background: "#081428" }}><h1>Forest Watch</h1><p>Explore illustrative forest data and report land grievances.</p><Link to="/fra-monitoring">Explore the district FRA demonstration</Link></section>; }
export function Home() {
  const [hasWebGL] = useState(supportsWebGL);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { const media = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReducedMotion(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  return <main>{reducedMotion || !hasWebGL ? <StaticHero /> : <LocalBoundary fallback={<StaticHero />}><Suspense fallback={<StaticHero />}><ScrollExperience /></Suspense></LocalBoundary>}<section style={{ padding: "2rem", textAlign: "center" }}><h2>FRA progress by district</h2><p>Explore synthetic claims, investigate anomalies and compare state progress.</p><Link to="/fra-monitoring">Open the FRA demonstration →</Link></section><ForestMapSection /><WhatsAppCta /></main>;
}
