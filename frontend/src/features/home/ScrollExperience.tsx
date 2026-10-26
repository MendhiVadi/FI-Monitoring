import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, type RootState } from "@react-three/fiber";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Globe } from "./Globe";
import { HeroContent } from "./HeroContent";
import { localProgress, smoothstep } from "./scrollStore";

gsap.registerPlugin(ScrollTrigger);

const CAMERA_START_Z = 7;
const CAMERA_END_Z = 4.6;

function CameraRig({ progressRef }: { progressRef: React.RefObject<number> }) {
  useFrame(({ camera, size }) => {
    const progress = localProgress(progressRef.current, "globe");
    const zoom = smoothstep(0.12, 0.92, progress);
    // Portrait screens need a wider view. Stay outside the radius-2 globe;
    // entering its front-facing surface made the old scene vanish abruptly.
    const portraitDistance = Math.max(1, 0.85 / (size.width / size.height));
    camera.position.setZ((CAMERA_START_Z + (CAMERA_END_Z - CAMERA_START_Z) * zoom) * portraitDistance);
  });
  return null;
}

// Native scrolling and CSS sticky own the document. One GSAP tween smooths
// visual progress only; camera, rotation and fading read that same value.
export function ScrollExperience() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const invalidateRef = useRef<RootState["invalidate"] | null>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    const sticky = stickyRef.current;
    if (!container || !sticky) return;
    const tween = gsap.fromTo(progressRef, { current: 0 }, {
      current: 1,
      ease: "none",
      // Scroll drives every frame after the free spin, so the GPU idles while
      // the page is still instead of redrawing an unchanged scene at 60fps.
      onUpdate: () => invalidateRef.current?.(),
      scrollTrigger: {
        trigger: container,
        start: "top top",
        // Match actual sticky travel, including stable mobile viewport sizing.
        end: () => `+=${Math.max(1, container.offsetHeight - sticky.offsetHeight)}`,
        scrub: 0.12,
        invalidateOnRefresh: true,
      },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
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
    <div ref={containerRef} className="home-scroll">
      <div ref={stickyRef} className="home-hero home-hero--sticky">
        <div className="home-hero-scene" aria-hidden="true">
          <Canvas
            fallback={null}
            dpr={[1, 1.5]}
            frameloop={onScreen ? "demand" : "never"}
            camera={{ position: [0, 0, CAMERA_START_Z], fov: 50 }}
            onCreated={(state) => { invalidateRef.current = state.invalidate; }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={1} />
            <CameraRig progressRef={progressRef} />
            <Globe progressRef={progressRef} />
          </Canvas>
        </div>
        <HeroContent animated />
      </div>
    </div>
  );
}
