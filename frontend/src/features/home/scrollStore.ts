// Shared scroll coordinates. The single GSAP tween supplies temporal smoothing;
// each visual phase uses this same value so rotation, zoom and fading agree.
export const STAGES = ["globe"] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_RANGES: Record<Stage, [number, number]> = {
  globe: [0, 1],
};

export function smoothstep(start: number, end: number, progress: number): number {
  const t = Math.min(1, Math.max(0, (progress - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

// Do not apply another ease to the whole sequence: it creates long dead zones
// at either end and compresses most of the movement into the middle.
export function localProgress(progress: number, stage: Stage): number {
  const [start, end] = STAGE_RANGES[stage];
  if (end === start) return 0;
  return Math.min(1, Math.max(0, (progress - start) / (end - start)));
}
