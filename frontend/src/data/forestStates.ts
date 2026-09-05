import type { LandUseMix } from "../lib/landUse";

// Top forest-cover states, per the India State of Forest Report figures
// supplied for this project. `lat`/`lon` are approximate state centroids,
// used to place markers on the map until real state-boundary GeoJSON is
// available (see frontend/public/geo/india-national.geojson). `landUse` is
// an illustrative mock mix (percentages sum to 100), not a sourced dataset —
// it exists to demonstrate the forest/farming/residential/industrial color
// scale until a real land-use dataset is available.
export interface ForestState {
  state: string;
  forestCoverKm2: number;
  commercialStatus: string;
  regulatedProducts: string[];
  landUse: LandUseMix;
  lat: number;
  lon: number;
}

export const FOREST_STATES: ForestState[] = [
  {
    state: "Madhya Pradesh",
    forestCoverKm2: 77073.44,
    commercialStatus: "Conditional",
    regulatedProducts: ["Teak", "Bamboo", "Tendu leaves", "Mahua"],
    landUse: { forest: 68, farming: 22, residential: 7, industrial: 3 },
    lat: 23.5,
    lon: 78.5,
  },
  {
    state: "Arunachal Pradesh",
    forestCoverKm2: 65881.57,
    commercialStatus: "Conditional",
    regulatedProducts: ["Bamboo", "Cane", "Timber", "Medicinal plants"],
    landUse: { forest: 82, farming: 12, residential: 4, industrial: 2 },
    lat: 28.2,
    lon: 94.7,
  },
  {
    state: "Chhattisgarh",
    forestCoverKm2: 55811.75,
    commercialStatus: "Conditional",
    regulatedProducts: ["Sal", "Bamboo", "Tendu leaves", "Lac"],
    landUse: { forest: 60, farming: 24, residential: 9, industrial: 7 },
    lat: 21.3,
    lon: 81.8,
  },
  {
    state: "Odisha",
    forestCoverKm2: 52433.56,
    commercialStatus: "Conditional",
    regulatedProducts: ["Sal", "Bamboo", "Kendu leaves", "Sal seed"],
    landUse: { forest: 55, farming: 27, residential: 10, industrial: 8 },
    lat: 20.9,
    lon: 85.1,
  },
  {
    state: "Maharashtra",
    forestCoverKm2: 50858.53,
    commercialStatus: "Conditional",
    regulatedProducts: ["Teak", "Bamboo", "Tendu leaves", "Mahua"],
    landUse: { forest: 42, farming: 30, residential: 16, industrial: 12 },
    lat: 19.7,
    lon: 75.7,
  },
  {
    state: "Karnataka",
    forestCoverKm2: 39254.27,
    commercialStatus: "Conditional",
    regulatedProducts: ["Teak", "Sandalwood", "Bamboo", "NTFPs"],
    landUse: { forest: 45, farming: 32, residential: 14, industrial: 9 },
    lat: 15.3,
    lon: 75.7,
  },
  {
    state: "Andhra Pradesh",
    forestCoverKm2: 30084.96,
    commercialStatus: "Conditional",
    regulatedProducts: ["Teak", "Bamboo", "Red sanders"],
    landUse: { forest: 38, farming: 34, residential: 17, industrial: 11 },
    lat: 15.9,
    lon: 79.7,
  },
  {
    state: "Assam",
    forestCoverKm2: 28313.55,
    commercialStatus: "Conditional",
    regulatedProducts: ["Bamboo", "Cane", "Agarwood", "NTFPs"],
    landUse: { forest: 58, farming: 28, residential: 10, industrial: 4 },
    lat: 26.2,
    lon: 92.9,
  },
  {
    state: "Tamil Nadu",
    forestCoverKm2: 26450.22,
    commercialStatus: "Conditional",
    regulatedProducts: ["Teak", "Sandalwood", "Bamboo", "NTFPs"],
    landUse: { forest: 34, farming: 30, residential: 20, industrial: 16 },
    lat: 11.1,
    lon: 78.6,
  },
  {
    state: "Uttarakhand",
    forestCoverKm2: 24303.83,
    commercialStatus: "Conditional",
    regulatedProducts: ["Pine resin", "Timber", "Medicinal plants"],
    landUse: { forest: 65, farming: 20, residential: 12, industrial: 3 },
    lat: 30.1,
    lon: 79.0,
  },
];
