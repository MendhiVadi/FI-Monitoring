// Land-use color scale for the India forest-cover map: green (forest) through
// yellow (farming) and orange (residential) to red (industrial-only land).
// A state's marker color is a weighted blend of these four stops using its
// land-use mix, so a state that's mostly forest but with rising industrial
// share visibly shifts off pure green rather than jumping between buckets.

export interface LandUseMix {
  forest: number;
  farming: number;
  residential: number;
  industrial: number;
}

export type LandUseCategory = keyof LandUseMix;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const LAND_USE_STOPS: Record<LandUseCategory, { label: string; color: string; rgb: Rgb }> = {
  forest: { label: "Forest", color: "#2f9e64", rgb: { r: 47, g: 158, b: 100 } },
  farming: { label: "Farming", color: "#eab308", rgb: { r: 234, g: 179, b: 8 } },
  residential: { label: "Residential", color: "#f97316", rgb: { r: 249, g: 115, b: 22 } },
  industrial: { label: "Industrial", color: "#ef4444", rgb: { r: 239, g: 68, b: 68 } },
};

const CATEGORIES: LandUseCategory[] = ["forest", "farming", "residential", "industrial"];

// Weighted average of the four stop colors by their share of the mix (0-100
// each, summing to 100) — a state that's 100% one category renders as that
// category's pure color; a mix blends smoothly between them.
export function landUseColor(mix: LandUseMix): string {
  const total = CATEGORIES.reduce((sum, key) => sum + mix[key], 0) || 1;
  const blended = CATEGORIES.reduce(
    (acc, key) => {
      const weight = mix[key] / total;
      const { rgb } = LAND_USE_STOPS[key];
      return { r: acc.r + rgb.r * weight, g: acc.g + rgb.g * weight, b: acc.b + rgb.b * weight };
    },
    { r: 0, g: 0, b: 0 }
  );
  return `rgb(${Math.round(blended.r)}, ${Math.round(blended.g)}, ${Math.round(blended.b)})`;
}

export function dominantLandUse(mix: LandUseMix): { category: LandUseCategory; share: number } {
  const [category, share] = CATEGORIES.map((key) => [key, mix[key]] as const).reduce((a, b) =>
    b[1] > a[1] ? b : a
  );
  return { category, share };
}
