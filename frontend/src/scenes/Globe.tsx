import { useEffect, useMemo, useRef } from "react";
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
} from "three";
import { localProgress } from "../store/scrollStore";
import { latLonToSpherePosition, INDIA_LAT_LON } from "../lib/geoSphere";

interface GlobeProps {
  progressRef: React.RefObject<number>;
}

const AXIAL_TILT = (23.5 * Math.PI) / 180;
const ROTATION_SPEED = 0.18; // rad/s while free-spinning, before the India lock begins
const LOCK_START = 0.6; // local progress at which free-spin stops and the lock slerp begins
const RADIUS = 2;
const FORWARD = new Vector3(0, 0, 1); // toward the camera
const NORTH = new Vector3(0, 1, 0);
const UP_AXIS = new Vector3(0, 1, 0);
// Clears the fixed translucent header bar, which otherwise sits over the
// canvas and visually crops the globe's top.
const VERTICAL_OFFSET = -0.35;

// Smoothstep, used to ease the hand-off from free spin to India lock.
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
// camera, continuing into the India-zoom stage.
export function Globe({ progressRef }: GlobeProps) {
  const groupRef = useRef<Group>(null);
  const orientRef = useRef<Group>(null);
  const sphereRef = useRef<Mesh>(null);
  const atmosphereRef = useRef<Mesh>(null);
  const spinAngle = useRef(0);
  const frozenSpinQuat = useRef<Quaternion | null>(null);
  const scratchQuat = useRef(new Quaternion());
  const outQuat = useRef(new Quaternion());
  const earthTexture = useTexture("/earth.jpg");

  useEffect(() => {
    earthTexture.colorSpace = SRGBColorSpace;
  }, [earthTexture]);

  const targetQuat = useMemo(() => {
    const [lat, lon] = INDIA_LAT_LON;
    return computeIndiaFacingQuat(latLonToSpherePosition(lat, lon, 1));
  }, []);

  // Everything here is driven by refs, not React state — the group scale,
  // material opacities, and orientation are all set directly on the three.js
  // objects each frame, so scrubbing the scroll never triggers a React
  // re-render of this component.
  useFrame((_, delta) => {
    const local = localProgress(progressRef.current, "globe");
    const lockT = smoothstep(LOCK_START, 1, local);

    if (lockT <= 0) {
      // Freely spinning: this is the only phase driven by real time, so the
      // globe reads as "alive" before the user starts scrolling toward India.
      spinAngle.current -= delta * ROTATION_SPEED;
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

    const scale = 1 - local * 0.15;
    const opacity = 1 - smoothstep(0.75, 1, local);

    groupRef.current?.scale.setScalar(scale);
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
