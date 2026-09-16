// The pinned 3D sequence has a single stage: the globe locks its rotation
// onto India while the camera dollies in through the surface, dissolving
// the globe as it arrives — then the pin releases into normal page scroll
// (the India forest map below is regular document flow, not part of this
// canvas, but the fade makes the hand-off read as one continuous zoom).
export const STAGES = ["globe"] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_RANGES: Record<Stage, [number, number]> = {
  globe: [0, 1],
};

// Ease-in-out: brisk through the middle of a stage, gentle at both ends —
// so motion doesn't track scroll pixels 1:1, it eases up and settles,
// converging smoothly rather than snapping to a stop.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// Remaps a global progress value to an eased [0,1] local progress within one
// stage's range.
export function localProgress(progress: number, stage: Stage): number {
  const [start, end] = STAGE_RANGES[stage];
  if (end === start) return 0;
  const linear = Math.min(1, Math.max(0, (progress - start) / (end - start)));
  return easeInOutCubic(linear);
}
