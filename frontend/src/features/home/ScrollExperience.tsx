import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Globe } from "./Globe";
import { localProgress } from "./scrollStore";

gsap.registerPlugin(ScrollTrigger);

const SCROLL_LENGTH_VH = 260; // pinned scroll length for the globe-to-India sequence
const CAMERA_START_Z = 6;
const CAMERA_END_Z = 0.35; // inside the globe's radius (2) — reads as diving through the surface into India

// Dollies the camera from a wide view down toward the globe's surface as
// scroll progresses through the sequence.
function CameraRig({ progressRef }: { progressRef: React.RefObject<number> }) {
  useFrame(({ camera }, delta) => {
    const local = localProgress(progressRef.current, "globe");
    const targetZ = CAMERA_START_Z + (CAMERA_END_Z - CAMERA_START_Z) * local;
    // Frame-rate independent critical damping toward the target distance.
    camera.position.setZ(camera.position.z + (targetZ - camera.position.z) * Math.min(1, delta * 4));
  });
  return null;
}

// A pinned, full-viewport <Canvas> hero: GSAP ScrollTrigger scrubs a 0..1
// "progress" value while the section is pinned, then releases the pin once
// the globe has locked onto India — from there the page continues as a
// normal scrolling landing page.
//
// Progress is written to a ref (not React state) so scrubbing the scrollbar
// never triggers a React re-render — the R3F scene reads the ref directly
// inside useFrame, and the hero copy's opacity is set imperatively on the
// DOM node, matching the frame rate of the scroll without fighting it.
export function ScrollExperience() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  // The globe used to keep rendering at full frame rate for the whole life of
  // the route, including once the hero had scrolled away and nothing was
  // visible. On the bundled Android app that is a constant GPU/battery drain.
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;
    const trigger = ScrollTrigger.create({
      trigger: containerRef.current,
      start: "top top",
      end: "bottom bottom",
      scrub: 0.5,
      onUpdate: (self) => {
        progressRef.current = self.progress;
        if (heroRef.current) {
          heroRef.current.style.opacity = String(1 - Math.min(1, self.progress * 6));
        }
      },
    });
    return () => trigger.kill();
  }, []);

  useEffect(() => {
    const node = stickyRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ height: `${SCROLL_LENGTH_VH}vh`, position: "relative" }}>
      <div ref={stickyRef} style={{ position: "sticky", top: 0, height: "100vh", width: "100%", background: "#081428" }}>
        <Canvas fallback={<p>3D view unavailable. Continue to the maps below.</p>} frameloop={onScreen ? "always" : "never"} camera={{ position: [0, 0, CAMERA_START_Z], fov: 50 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 5, 5]} intensity={1} />
          <CameraRig progressRef={progressRef} />
          <Globe progressRef={progressRef} />
        </Canvas>
        <HeroCopy heroRef={heroRef} />
      </div>
    </div>
  );
}

function HeroCopy({ heroRef }: { heroRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={heroRef}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "0 1.5rem 4rem",
        textAlign: "center",
        pointerEvents: "none",
        opacity: 1,
      }}
    >
      <h1 style={{ fontSize: "clamp(1.75rem, 5vw, 3rem)", margin: 0, fontWeight: 700 }}>
        Track India's Forests
      </h1>
      <p style={{ fontSize: "1.05rem", opacity: 0.8, marginTop: "0.75rem", maxWidth: 480 }}>
        Explore illustrative forest data and submit land grievances for staff review.
      </p>
      <div style={{ marginTop: "2rem", fontSize: "0.85rem", opacity: 0.6, letterSpacing: "0.05em" }}>
        SCROLL TO EXPLORE
      </div>
    </div>
  );
}
