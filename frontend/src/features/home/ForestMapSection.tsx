import { memo, useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { FOREST_STATES, type ForestState } from "./forestStates";
import { LAND_USE_STOPS, dominantLandUse, landUseColor, type LandUseMix } from "./landUse";

const WIDTH = 480;
const HEIGHT = 540;
const PADDING = 12;
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
// accessible table — hovering, focusing or tapping either a marker or a row
// highlights both.
export function ForestMapSection() {
  const [indiaGeo, setIndiaGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // The section sits below the multi-screen globe intro, so the boundary file
  // is fetched as it approaches the viewport rather than competing with the
  // hero's 3D bundle and texture on first load.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchIndiaGeo().then((geo) => {
        if (!cancelled) setIndiaGeo(geo);
      });
    const node = sectionRef.current;
    if (indiaGeoCache || !node || typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        load();
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  // Fit the projection to the loaded boundary instead of hard-coding a scale,
  // so the whole country stays inside the viewBox at any aspect ratio. The
  // centered fallback only matters for the brief moment before the geojson
  // arrives (markers alone are drawn then).
  const projection = useMemo(() => {
    const base = geoMercator();
    if (indiaGeo) {
      return base.fitExtent(
        [
          [PADDING, PADDING],
          [WIDTH - PADDING, HEIGHT - PADDING],
        ],
        indiaGeo
      );
    }
    return base.center([82, 22]).scale(700).translate([WIDTH / 2, HEIGHT / 2]);
  }, [indiaGeo]);
  const path = useMemo(() => geoPath(projection), [projection]);

  // Projected geometry depends only on the boundary and the projection, so it
  // is computed once rather than on every render. Hovering a marker changes
  // `hovered`, which used to re-run geoPath over all 36 state polygons
  // (~5,000 coordinate pairs) and re-project every marker, per hover event.
  const statePaths = useMemo(
    () => (indiaGeo?.features ?? []).map((feature) => path(feature) ?? undefined),
    [indiaGeo, path]
  );

  const markers = useMemo(
    () =>
      FOREST_STATES.map((s) => {
        const point = projection([s.lon, s.lat]);
        return point ? { state: s, x: point[0], y: point[1], fill: landUseColor(s.landUse) } : null;
      }).filter((m): m is { state: ForestState; x: number; y: number; fill: string } => m !== null),
    [projection]
  );

  const maxCover = useMemo(
    () => Math.max(...FOREST_STATES.map((s) => s.forestCoverKm2)),
    []
  );

  return (
    <section ref={sectionRef} className="fw-section" aria-labelledby="fw-title">
      <h2 id="fw-title">Land-use context: illustrative forest cover</h2>
      <p className="fw-intro">
        Illustrative state-level forest cover and land-use mix provide background
        context. These are not property boundaries or verified dispute records.
        Tap, hover or tab to a marker or row for details.
      </p>

      <LandUseLegend />

      <div className="fw-map-grid">
        <div>
          {/* A group, not role="img": an image role would hide the focusable
              markers inside it from assistive technology. */}
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="fw-map"
            role="group"
            aria-labelledby="fw-title"
          >
            {statePaths.map((d, i) => (
              <path key={i} d={d} fill="#0d2818" stroke="#2f9e64" strokeWidth={1} aria-hidden="true" />
            ))}
            {markers.map(({ state: s, x, y, fill }) => {
              const r = 6 + (s.forestCoverKm2 / maxCover) * 20;
              const isHovered = hovered === s.state;
              return (
                <g
                  key={s.state}
                  className="fw-marker"
                  role="button"
                  tabIndex={0}
                  aria-label={`${s.state}: ${formatKm2(s.forestCoverKm2)} forest cover`}
                  // Hover, focus and tap all highlight the same state, so the
                  // label and table row are reachable by keyboard and touch.
                  onMouseEnter={() => setHovered(s.state)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(s.state)}
                  onBlur={() => setHovered(null)}
                  onClick={() => setHovered(s.state)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    setHovered(s.state);
                  }}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={fill}
                    fillOpacity={isHovered ? 0.95 : 0.75}
                    stroke={isHovered ? "white" : "rgba(255,255,255,0.4)"}
                    strokeWidth={isHovered ? 2 : 1}
                  />
                  {isHovered && (
                    <text
                      x={x}
                      y={y - r - 8}
                      textAnchor="middle"
                      fill="white"
                      fontSize={13}
                      fontWeight={600}
                      aria-hidden="true"
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
          <table>
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col" style={{ textAlign: "right" }}>Forest cover</th>
                <th scope="col">Land use</th>
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
      <div className="fw-landuse-bar">
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

// Memoised: a hover changes `isHovered` for at most two rows, so the rest of
// the table (and each row's land-use bar) skips re-rendering.
const ForestRow = memo(function ForestRow({
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
      className={`fw-row${isHovered ? " fw-row--active" : ""}`}
      tabIndex={0}
      onMouseEnter={() => onHover(state.state)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(state.state)}
      onBlur={() => onHover(null)}
      onClick={() => onHover(state.state)}
    >
      <td>{state.state}</td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatKm2(state.forestCoverKm2)}</td>
      <td>
        <LandUseBar mix={state.landUse} />
      </td>
    </tr>
  );
});
