import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  BackSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Texture,
} from "three";
import { localProgress, smoothstep } from "./scrollStore";
import { latLonToSpherePosition, INDIA_LAT_LON } from "./geoSphere";

interface GlobeProps {
  progressRef: React.RefObject<number>;
}

const AXIAL_TILT = (23.5 * Math.PI) / 180;
const ROTATION_SPEED = 0.18; // rad/s while free-spinning, before the India lock begins
const LOCK_START = 0.025;
const LOCK_END = 0.65;
const RADIUS = 2;
const FORWARD = new Vector3(0, 0, 1); // toward the camera
const NORTH = new Vector3(0, 1, 0);
const UP_AXIS = new Vector3(0, 1, 0);
// Lift the globe behind the heading while keeping the initial silhouette below
// the fixed header. The portrait camera fit keeps it within narrow viewports.
const VERTICAL_OFFSET = 0.4;

// drei re-runs this callback whenever its identity changes, and each run flags
// the texture for another GPU upload. A module-level function keeps it stable
// across Globe re-renders (e.g. the hero scrolling in and out of view).
function applyEarthColorSpace(texture: Texture | Texture[]) {
  for (const t of Array.isArray(texture) ? texture : [texture]) {
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
  }
}

// Rotation that brings `indiaDir` (a point on the unit sphere, in the mesh's
// own un-rotated frame) to face the camera at +Z, while keeping the sphere's
// north pole as close to world-up as the forward constraint allows — avoids
// landing on India rolled sideways or upside down.
function computeIndiaFacingQuat(indiaDir: Vector3): Quaternion {
  const q = new Quaternion().setFromUnitVectors(indiaDir.clone().normalize(), FORWARD);
  const rotatedNorth = NORTH.clone().applyQuaternion(q);
  const projected = rotatedNorth.clone();
  projected.z = 0;
  if (projected.lengthSq() > 1e-6) {
    projected.normalize();
    const rollAngle = Math.atan2(projected.x, projected.y);
    const correction = new Quaternion().setFromAxisAngle(FORWARD, rollAngle);
    q.premultiply(correction);
  }
  return q;
}

// Opening scene: a globe with real continent outlines, on a fixed axial
// tilt. It free-spins counter-clockwise, then — as scroll progresses through
// the stage — hands off cleanly (no overlap between spin and lock, so the
// axis never wobbles) into a locked orientation facing India toward the
// camera. A restrained zoom leaves the globe visible through the hand-off.
export function Globe({ progressRef }: GlobeProps) {
  const groupRef = useRef<Group>(null);
  const orientRef = useRef<Group>(null);
  const sphereRef = useRef<Mesh>(null);
  const atmosphereRef = useRef<Mesh>(null);
  const spinAngle = useRef(0);
  const frozenSpinQuat = useRef<Quaternion | null>(null);
  const scratchQuat = useRef(new Quaternion());
  const outQuat = useRef(new Quaternion());
  // colorSpace is applied in the loader callback, before three uploads the
  // texture to the GPU. Setting it in an effect ran after the first upload, so
  // it needed a needsUpdate flag to take effect and silently never did —
  // the earth rendered with linear-interpreted sRGB data (washed out).
  const earthTexture = useTexture("/earth.jpg", applyEarthColorSpace);
  // Phones and tablets spin at half rate: every other display frame is still
  // smooth for a slow rotation, and halves the GPU work (and battery drain)
  // while someone reads the hero without scrolling.
  const [halfRateSpin] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const spinFrameRequest = useRef(0);
  useEffect(() => () => cancelAnimationFrame(spinFrameRequest.current), []);

  const targetQuat = useMemo(() => {
    const [lat, lon] = INDIA_LAT_LON;
    return computeIndiaFacingQuat(latLonToSpherePosition(lat, lon, 1));
  }, []);

  // Everything here is driven by refs, not React state — the group scale,
  // material opacities, and orientation are all set directly on the three.js
  // objects each frame, so scrubbing the scroll never triggers a React
  // re-render of this component.
  useFrame(({ invalidate }, delta) => {
    const local = localProgress(progressRef.current, "globe");
    const lockT = smoothstep(LOCK_START, LOCK_END, local);

    if (lockT <= 0) {
      // The canvas renders on demand; only the free spin needs a continuous
      // loop. Once locked, frames come from scroll updates alone. At half rate
      // the next frame is requested one display frame later, so the loop
      // keeps going (the spin never stalls) without drawing every vsync.
      if (halfRateSpin) {
        cancelAnimationFrame(spinFrameRequest.current);
        spinFrameRequest.current = requestAnimationFrame(() => invalidate());
      } else {
        invalidate();
      }
      // Freely spinning: this is the only phase driven by real time, so the
      // globe reads as "alive" before the user starts scrolling toward India.
      // Avoid a jump when the tab or offscreen renderer resumes after a pause.
      // The half-rate cap is looser so a 30Hz-capped phone (15fps here)
      // keeps the same spin speed instead of being clamped to 75%.
      spinAngle.current -= Math.min(delta, halfRateSpin ? 0.1 : 0.05) * ROTATION_SPEED;
      frozenSpinQuat.current = null;
      outQuat.current.setFromAxisAngle(UP_AXIS, spinAngle.current);
    } else {
      // Locking: a pure function of scroll progress, not accumulated frame
      // state, so it's fully reversible and never drifts off its axis.
      if (!frozenSpinQuat.current) {
        frozenSpinQuat.current = scratchQuat.current
          .setFromAxisAngle(UP_AXIS, spinAngle.current)
          .clone();
      }
      outQuat.current.copy(frozenSpinQuat.current).slerp(targetQuat, lockT);
    }
    orientRef.current?.quaternion.copy(outQuat.current);

    const opacity = 1 - 0.55 * smoothstep(0.7, 1, local);

    // Remove the opening axial tilt while locking, so India ends north-up.
    if (groupRef.current) groupRef.current.rotation.z = AXIAL_TILT * (1 - lockT);
    if (sphereRef.current) {
      (sphereRef.current.material as MeshStandardMaterial).opacity = opacity;
    }
    if (atmosphereRef.current) {
      (atmosphereRef.current.material as MeshBasicMaterial).opacity = opacity * 0.1;
    }
  });

  return (
    <group ref={groupRef} position={[0, VERTICAL_OFFSET, 0]} rotation={[0, 0, AXIAL_TILT]}>
      <group ref={orientRef}>
        <mesh ref={sphereRef}>
          <sphereGeometry args={[RADIUS, 64, 64]} />
          <meshStandardMaterial map={earthTexture} roughness={0.7} metalness={0.05} transparent />
        </mesh>
      </group>
      <mesh ref={atmosphereRef} scale={1.08}>
        <sphereGeometry args={[RADIUS, 48, 48]} />
        <meshBasicMaterial color="#4da6ff" transparent side={BackSide} />
      </mesh>
    </group>
  );
}
