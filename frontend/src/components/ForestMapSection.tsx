import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { FOREST_STATES, type ForestState } from "../data/forestStates";
import { LAND_USE_STOPS, dominantLandUse, landUseColor, type LandUseMix } from "../lib/landUse";

const WIDTH = 480;
const HEIGHT = 560;
const LEGEND_CATEGORIES = ["forest", "farming", "residential", "industrial"] as const;

// Module-level cache: the India boundary geojson never changes at runtime,
// so re-mounting this section (e.g. client-side nav away and back) reuses
// the first fetch instead of re-requesting the 196K file every time.
let indiaGeoCache: Promise<GeoJSON.FeatureCollection | null> | null = null;
function fetchIndiaGeo(): Promise<GeoJSON.FeatureCollection | null> {
  if (!indiaGeoCache) {
    indiaGeoCache = fetch("/geo/india-national.geojson")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`geo fetch failed: ${r.status}`))))
      .catch((err) => {
        console.error("Failed to load India boundary geojson", err);
        indiaGeoCache = null;
        return null;
      });
  }
  return indiaGeoCache;
}

function formatKm2(n: number) {
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} km²`;
}

// Normal document-flow section (not part of the pinned 3D canvas) revealed
// once the globe's zoom-into-India sequence hands off. Shows India's top
// forest-cover states as markers on a map, plus the full dataset as an
// accessible table — hovering either a marker or a row highlights both.
export function ForestMapSection() {
  const [indiaGeo, setIndiaGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchIndiaGeo().then((geo) => {
      if (!cancelled) setIndiaGeo(geo);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const projection = useMemo(
    () => geoMercator().center([82, 22]).scale(1100).translate([WIDTH / 2, HEIGHT / 2]),
    []
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  const maxCover = useMemo(
    () => Math.max(...FOREST_STATES.map((s) => s.forestCoverKm2)),
    []
  );

  return (
    <section
      style={{
        padding: "5rem 1.5rem",
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <style>{`
        .fw-map-grid {
          display: grid;
          grid-template-columns: minmax(280px, 480px) 1fr;
          gap: 3rem;
          align-items: start;
        }
        @media (max-width: 860px) {
          .fw-map-grid { grid-template-columns: 1fr; }
        }
        .fw-table-scroll { overflow-x: auto; }
        .fw-table-scroll table { min-width: 480px; }
      `}</style>

      <h2 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>India's Forest Cover</h2>
      <p style={{ opacity: 0.75, marginBottom: "1.5rem", maxWidth: 640 }}>
        The states carrying India's largest forest cover, colored by their mock
        land-use mix. Hover a marker or a row for details.
      </p>

      <LandUseLegend />

      <div className="fw-map-grid" style={{ marginTop: "2rem" }}>
        <div>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width="100%"
            style={{ maxWidth: WIDTH, display: "block" }}
          >
            {indiaGeo?.features.map((feature, i) => (
              <path
                key={i}
                d={path(feature) ?? undefined}
                fill="#0d2818"
                stroke="#2f9e64"
                strokeWidth={1}
              />
            ))}
            {FOREST_STATES.map((s) => {
              const p = projection([s.lon, s.lat]);
              if (!p) return null;
              const r = 6 + (s.forestCoverKm2 / maxCover) * 20;
              const isHovered = hovered === s.state;
              const fill = landUseColor(s.landUse);
              return (
                <g key={s.state}>
                  <circle
                    cx={p[0]}
                    cy={p[1]}
                    r={r}
                    fill={fill}
                    fillOpacity={isHovered ? 0.95 : 0.75}
                    stroke={isHovered ? "white" : "rgba(255,255,255,0.4)"}
                    strokeWidth={isHovered ? 2 : 1}
                    style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
                    onMouseEnter={() => setHovered(s.state)}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {isHovered && (
                    <text
                      x={p[0]}
                      y={p[1] - r - 8}
                      textAnchor="middle"
                      fill="white"
                      fontSize={13}
                      fontWeight={600}
                    >
                      {s.state}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="fw-table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
                <th style={thStyle}>State</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Forest cover</th>
                <th style={thStyle}>Land use</th>
              </tr>
            </thead>
            <tbody>
              {FOREST_STATES.map((s) => (
                <ForestRow
                  key={s.state}
                  state={s}
                  isHovered={hovered === s.state}
                  onHover={setHovered}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// Green-to-red gradient bar with category labels, so the marker/table colors
// read as a scale (forest → farming → residential → industrial) rather than
// an arbitrary palette.
function LandUseLegend() {
  const gradient = LEGEND_CATEGORIES.map((c) => LAND_USE_STOPS[c].color).join(", ");
  return (
    <div style={{ maxWidth: 480 }}>
      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: `linear-gradient(to right, ${gradient})`,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.4rem" }}>
        {LEGEND_CATEGORIES.map((c) => (
          <span key={c} style={{ fontSize: "0.75rem", opacity: 0.75 }}>
            {LAND_USE_STOPS[c].label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Compact stacked bar showing the state's land-use mix (not color alone —
// each segment is proportional and the dominant share is also spelled out
// in text, so the same information survives without color).
function LandUseBar({ mix }: { mix: LandUseMix }) {
  const dominant = dominantLandUse(mix);
  return (
    <div>
      <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", minWidth: 140 }}>
        {LEGEND_CATEGORIES.map((c) => (
          <div
            key={c}
            style={{ width: `${mix[c]}%`, background: LAND_USE_STOPS[c].color }}
            title={`${LAND_USE_STOPS[c].label}: ${mix[c]}%`}
          />
        ))}
      </div>
      <div style={{ fontSize: "0.78rem", opacity: 0.7, marginTop: "0.25rem" }}>
        {LAND_USE_STOPS[dominant.category].label} {dominant.share}%
      </div>
    </div>
  );
}

function ForestRow({
  state,
  isHovered,
  onHover,
}: {
  state: ForestState;
  isHovered: boolean;
  onHover: (state: string | null) => void;
}) {
  return (
    <tr
      onMouseEnter={() => onHover(state.state)}
      onMouseLeave={() => onHover(null)}
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: isHovered ? "rgba(74,222,128,0.1)" : "transparent",
        transition: "background 0.15s",
        cursor: "default",
      }}
    >
      <td style={tdStyle}>{state.state}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{formatKm2(state.forestCoverKm2)}</td>
      <td style={tdStyle}>
        <LandUseBar mix={state.landUse} />
      </td>
    </tr>
  );
}

const thStyle: React.CSSProperties = { padding: "0.5rem 0.75rem", opacity: 0.7, fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "0.6rem 0.75rem" };
