import { Vector3 } from "three";

// Converts lat/lon into an XYZ position on a sphere of the given radius,
// using the same convention as three.js's default SphereGeometry UVs so it
// lines up with an equirectangular texture applied via `map`.
export function latLonToSpherePosition(lat: number, lon: number, radius: number): Vector3 {
  const u = (lon + 180) / 360;
  const v = (90 - lat) / 180;
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  const x = -radius * Math.cos(phi) * Math.sin(theta);
  const y = radius * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new Vector3(x, y, z);
}

// Roughly the geographic center of India.
export const INDIA_LAT_LON: [number, number] = [22, 79];
