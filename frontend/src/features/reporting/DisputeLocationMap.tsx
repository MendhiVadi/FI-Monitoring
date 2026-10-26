import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import "leaflet/dist/leaflet.css";
import "./DisputeLocationMap.css";
import { apiUrl } from "../../shared/http/apiUrl";

export interface DisputeLocation { latitude: number; longitude: number }
const categories = {
  farm: { label: "Farmland", color: "#a17b00", fillColor: "#facc15" },
  public: { label: "Parks / ponds", color: "#25843c", fillColor: "#86efac" },
  commercial: { label: "Commercial", color: "#b91c1c", fillColor: "#f87171" },
  forest: { label: "Forest", color: "#12452c", fillColor: "#23854c" },
};
// The proxy rejects queries over 120 characters, so the input stops there too.
const SEARCH_MAX = 120;
// Thousands of farmland plots in one view freeze low-end phones; the pin is
// what matters, so only this many polygons are drawn.
const MAX_FEATURES = 1500;
// The server's bounding box for "land in India" (disputes/service.ts).
const inIndia = (lat: number, lng: number) => lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;
// On a phone, one-finger drag panning trapped the page scroll inside a map
// that fills most of the screen. Touch users pan with two fingers or "Move map".
const coarsePointer = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

// Small, bounded, per-tab caches. Switching district back and forth or
// zooming in after loading shading reuses what was already fetched instead of
// spending the proxy's per-address rate limit and Overpass quota again.
type Place = { latitude: number; longitude: number; displayName?: string };
const geocodeCache = new Map<string, Place>();
type LandUseEntry = { s: number; w: number; n: number; e: number; geojson: FeatureCollection };
const landUseCache: LandUseEntry[] = [];
function remember<K, V>(cache: Map<K, V>, key: K, value: V, max: number) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > max) cache.delete(cache.keys().next().value as K);
}

function category(tags: Record<string, string> = {}) {
  if (tags.landuse === "forest" || tags.natural === "wood") return categories.forest;
  if (["farmland", "farmyard", "orchard", "vineyard"].includes(tags.landuse)) return categories.farm;
  if (["commercial", "retail"].includes(tags.landuse)) return categories.commercial;
  if (tags.leisure === "park" || tags.water === "pond") return categories.public;
  return undefined;
}

export function DisputeLocationMap({ value, onChange, state, district }: {
  value: DisputeLocation | null; onChange: (value: DisputeLocation | null) => void;
  state?: string; district?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const polygonsRef = useRef<L.GeoJSON | null>(null);
  const changeRef = useRef(onChange);
  const selectionVersion = useRef(0);
  const searchVersion = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const bhuvanAbort = useRef<AbortController | null>(null);
  const shownLandUse = useRef<FeatureCollection | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  useEffect(() => { changeRef.current = (point) => { selectionVersion.current++; onChange(point); }; }, [onChange]);
  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("Zoom in to a village or neighbourhood, then load land-use shading.");
  const [busy, setBusy] = useState(false);
  const [bhuvanStatus, setBhuvanStatus] = useState("");
  const [bhuvanLayer, setBhuvanLayer] = useState("");
  const [layers, setLayers] = useState<{ name: string; title: string }[]>([]);
  const [search, setSearch] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [coarse] = useState(coarsePointer);
  const [panning, setPanning] = useState(() => !coarse);
  const [locating, setLocating] = useState(false);
  const [locateStatus, setLocateStatus] = useState("");
  // The last text the state/district picker put in the box. Picking a
  // district no longer overwrites something the reporter typed themselves.
  const autoSearchText = useRef("");

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { scrollWheelZoom: false, dragging: !coarse }).setView([22.5, 79], 5);
    mapRef.current = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.on("click", (event: L.LeafletMouseEvent) => changeRef.current({
      latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.wrap().lng.toFixed(6)),
    }));
    return () => {
      // searchVersion is a counter, not a DOM ref: cleanup must bump the live value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      searchAbort.current?.abort(); searchVersion.current++; abortRef.current?.abort(); bhuvanAbort.current?.abort();
      map.remove(); mapRef.current = null; markerRef.current = null; polygonsRef.current = null; shownLandUse.current = null; rendererRef.current = null;
    };
  }, [coarse]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (panning) map.dragging.enable(); else map.dragging.disable();
  }, [panning]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) { markerRef.current?.remove(); markerRef.current = null; return; }
    const position: L.LatLngExpression = [value.latitude, value.longitude];
    if (markerRef.current) markerRef.current.setLatLng(position);
    else {
      const marker = L.marker(position, { draggable: true, title: "Dispute location — drag to move", icon: L.divIcon({
        className: "dispute-map-pin", html: "<span></span>", iconSize: [44, 44], iconAnchor: [22, 22],
      }) }).addTo(map);
      marker.on("dragend", () => { const p = marker.getLatLng().wrap(); changeRef.current({ latitude: Number(p.lat.toFixed(6)), longitude: Number(p.lng.toFixed(6)) }); });
      markerRef.current = marker;
    }
    if (!map.getBounds().contains(position)) map.panTo(position);
  }, [value]);

  const searchPlace = useCallback(async (query: string, automatic = false) => {
    const text = query.trim().replace(/\s+/g, " ").slice(0, SEARCH_MAX);
    if (text.length < 2) return;
    const mine = ++searchVersion.current;
    const selectedAtStart = selectionVersion.current;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const cacheKey = text.toLowerCase();
    setSearchStatus(automatic ? `Locating ${text}…` : "Searching…");
    try {
      let place = geocodeCache.get(cacheKey);
      if (!place) {
        const response = await fetch(apiUrl(`/api/maps?action=geocode&q=${encodeURIComponent(text)}`), { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !Number.isFinite(body?.latitude) || !Number.isFinite(body?.longitude)) {
          if (mine !== searchVersion.current || selectedAtStart !== selectionVersion.current) return;
          throw new Error();
        }
        place = { latitude: body.latitude, longitude: body.longitude, displayName: typeof body.displayName === "string" ? body.displayName : undefined };
        remember(geocodeCache, cacheKey, place, 32);
      }
      if (mine !== searchVersion.current || selectedAtStart !== selectionVersion.current) return;
      const point = { latitude: Number(place.latitude.toFixed(6)), longitude: Number(place.longitude.toFixed(6)) };
      // An automatic lookup (triggered by picking a state/district) only moves
      // the map. Dropping the pin there too would silently replace a spot the
      // reporter had already chosen with a district centroid, and the ticket
      // would carry coordinates they never picked. An explicit search still
      // sets the pin, because that is what the reporter asked for.
      if (!automatic) changeRef.current(point);
      mapRef.current?.setView([point.latitude, point.longitude], automatic && text.includes(",") ? 13 : 11);
      const name = place.displayName || text;
      // A search pin sits on the place's centre, which for a district or a
      // common village name can be far from the land itself.
      setSearchStatus(automatic
        ? `Showing ${name}. Tap the disputed land to place the pin.`
        : `Pin placed at the centre of ${name}. Check it is the right place, then tap the exact land to move it.`);
    } catch { if (mine === searchVersion.current) setSearchStatus("Place search is unavailable. You can select the disputed land directly on the map."); }
    finally { clearTimeout(timeout); }
  }, []);

  useEffect(() => {
    const place = [district, state].filter(Boolean).join(", ");
    if (place) {
      const previous = autoSearchText.current;
      setSearch((current) => (!current.trim() || current === previous ? place : current));
      autoSearchText.current = place;
      void searchPlace(place, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter, read live on purpose
    return () => { searchAbort.current?.abort(); searchVersion.current++; };
  }, [state, district, searchPlace]);

  useEffect(() => {
    if (!bhuvanLayer || !mapRef.current) return;
    setBhuvanStatus("Loading Bhuvan land-use imagery…");
    let failed = false;
    const layer = L.tileLayer.wms(apiUrl("/api/maps?action=bhuvan"), {
      layers: bhuvanLayer, format: "image/png", transparent: true, opacity: 0.5,
      attribution: '<a href="https://bhuvan.nrsc.gov.in/">Bhuvan / NRSC / ISRO</a>',
    }).addTo(mapRef.current);
    layer.on("tileerror", () => { failed = true; setBhuvanStatus("Bhuvan imagery is unavailable. The location picker still works."); });
    layer.on("load", () => { if (!failed) setBhuvanStatus("Bhuvan layer loaded using its original classification colours."); });
    return () => { layer.remove(); };
  }, [bhuvanLayer]);

  function locateMe() {
    if (locating) return;
    if (!("geolocation" in navigator)) { setLocateStatus("This browser cannot share your location. Search or tap the map instead."); return; }
    setLocating(true);
    setLocateStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition((position) => {
      setLocating(false);
      if (!mapRef.current) return;
      const point = { latitude: Number(position.coords.latitude.toFixed(6)), longitude: Number(position.coords.longitude.toFixed(6)) };
      if (!inIndia(point.latitude, point.longitude)) { setLocateStatus("Your location appears to be outside India, so no pin was placed. Search or tap the map instead."); return; }
      changeRef.current(point);
      mapRef.current.setView([point.latitude, point.longitude], 17);
      const accuracy = Math.round(position.coords.accuracy);
      setLocateStatus(`Pin placed at your current location${Number.isFinite(accuracy) ? ` (accurate to about ${accuracy} m)` : ""}. Move it if the land is elsewhere.`);
    }, (failure) => {
      setLocating(false);
      setLocateStatus(failure.code === failure.PERMISSION_DENIED
        ? "Location access was denied or is blocked on this site. Search or tap the map instead."
        : failure.code === failure.TIMEOUT
          ? "Finding your location took too long. Try again outdoors, or search or tap the map."
          : "Your location is unavailable right now. Search or tap the map instead.");
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
  }

  async function discoverBhuvan() {
    // The capabilities document is large and the list does not change within a
    // session; re-clicking used to refetch it every time.
    if (layers.length) { if (!bhuvanLayer) setBhuvanLayer(layers[0].name); return; }
    if (bhuvanAbort.current) return;
    const controller = new AbortController();
    bhuvanAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    setBhuvanStatus("Checking available Bhuvan layers…");
    try {
      const response = await fetch(apiUrl("/api/maps?action=bhuvan&request=GetCapabilities"), { signal: controller.signal });
      if (!response.ok) throw new Error();
      const xml = new DOMParser().parseFromString(await response.text(), "text/xml");
      const available = Array.from(xml.querySelectorAll("Layer")).flatMap((layer) => {
        const name = layer.querySelector(":scope > Name")?.textContent || "";
        const year = name.match(/^LULC250K_(\d{2})(\d{2})$/);
        const title = year ? `Land use 20${year[1]}–20${year[2]} (1:250,000)` : name;
        return year ? [{ name, title }] : [];
      }).sort((a, b) => b.name.localeCompare(a.name));
      if (!available.length) throw new Error();
      if (!mapRef.current) return;
      setLayers(available); setBhuvanLayer(available[0].name);
    } catch { if (mapRef.current) setBhuvanStatus("Bhuvan is temporarily unavailable. You can still choose coordinates and load OpenStreetMap shading."); }
    finally { clearTimeout(timeout); if (bhuvanAbort.current === controller) bhuvanAbort.current = null; }
  }

  async function loadShading() {
    const map = mapRef.current;
    if (!map || busy) return;
    if (map.getZoom() < 14) { setStatus("Zoom in further (use +) before loading land-use areas."); return; }
    const b = map.getBounds();
    if (b.getNorth() - b.getSouth() > 0.12 || b.getEast() - b.getWest() > 0.12) { setStatus("Zoom in further to load a smaller area."); return; }
    const view = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
    const cached = landUseCache.find((c) => c.s <= view.s && c.w <= view.w && c.n >= view.n && c.e >= view.e);
    if (cached && cached.geojson === shownLandUse.current && polygonsRef.current) {
      setStatus("Land-use areas for this view are already shown.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setStatus("Loading mapped land-use boundaries…");
    const bounds = [view.s, view.w, view.n, view.e].map((n) => n.toFixed(5)).join(',');
    const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      let geojson = cached?.geojson;
      if (!geojson) {
        const response = await fetch(apiUrl(`/api/maps?action=landuse&bbox=${encodeURIComponent(bounds)}`), { signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json() as FeatureCollection;
        if (body.type !== "FeatureCollection" || !Array.isArray(body.features)) throw new Error();
        geojson = body;
        // A truncated result is not reused: the status below tells the
        // reporter to zoom in and reload for full detail, which must refetch.
        if (body.features.length <= MAX_FEATURES) {
          landUseCache.unshift({ ...view, geojson });
          if (landUseCache.length > 4) landUseCache.pop();
        }
      }
      if (!mapRef.current) return;
      const total = geojson.features.length;
      const drawn: FeatureCollection = total > MAX_FEATURES ? { ...geojson, features: geojson.features.slice(0, MAX_FEATURES) } : geojson;
      polygonsRef.current?.remove();
      // One canvas instead of an SVG node per polygon keeps panning smooth
      // when a view holds hundreds of plots.
      rendererRef.current ??= L.canvas({ padding: 0.5 });
      shownLandUse.current = geojson;
      polygonsRef.current = L.geoJSON(drawn, {
        // Not in GeoJSONOptions' type, but Leaflet passes these options on to
        // every Polygon it creates, which is where the renderer is read.
        ...({ renderer: rendererRef.current } as L.GeoJSONOptions),
        style: (feature) => ({ ...category(feature?.properties?.tags || feature?.properties), weight: 2, fillOpacity: 0.22 }),
        onEachFeature: (feature, layer) => {
          const tags = feature.properties?.tags || feature.properties;
          const text = document.createElement("span");
          text.textContent = `${category(tags)?.label || "Land use"}${tags?.name ? ` — ${tags.name}` : ""}`;
          layer.bindTooltip(text);
          layer.on("click", (event: L.LeafletMouseEvent) => changeRef.current({ latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.lng.toFixed(6)) }));
        },
      }).addTo(map);
      setStatus(total > MAX_FEATURES
        ? `Showing ${MAX_FEATURES} of ${total} mapped areas. Zoom in and reload for full detail.`
        : `${total} mapped areas loaded for this view. Reload after moving the map. Unshaded land may have no mapped classification.`);
    } catch { if (mapRef.current) setStatus("Land-use data is unavailable. Try again; you can still place your dispute pin."); }
    finally { clearTimeout(timeout); if (mapRef.current) setBusy(false); }
  }

  return <section className="dispute-location" aria-labelledby="dispute-location-heading">
    <h2 id="dispute-location-heading">Pin the disputed land</h2>
    <p>Search for a place, tap the map, or drag the pin.{coarse ? " Use two fingers, or turn on Move map, to pan." : ""}</p>
    <div className="dispute-map-search" role="search">
      <label htmlFor="dispute-map-search-input">Search India by state, district, city, or village</label>
      <input id="dispute-map-search-input" type="search" enterKeyHint="search" maxLength={SEARCH_MAX} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchPlace(search); } }} placeholder="e.g. Maharashtra, Pune" />
      <button type="button" onClick={() => void searchPlace(search)}>Search map</button>
    </div>
    <p role="status">{searchStatus}</p>
    <div className="dispute-map-tools">
      <button type="button" onClick={locateMe} disabled={locating} aria-busy={locating}>{locating ? "Finding your location…" : "Use my current location"}</button>
      {coarse && <button type="button" aria-pressed={panning} onClick={() => setPanning((on) => !on)}>{panning ? "Stop moving map" : "Move map"}</button>}
    </div>
    <p role="status">{locateStatus}</p>
    <div className="dispute-map-frame">
      <div ref={container} className="dispute-location-map" aria-label="Interactive dispute location map" />
      {coarse && !panning && <p className="dispute-map-hint" aria-hidden="true">Tap to place the pin · use two fingers or Move map to pan</p>}
    </div>
    <p aria-live="polite" className={value ? "dispute-map-selected" : undefined}>{value ? <><strong>Pin set:</strong> {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}. Check it before confirming below.</> : "No pin yet. Choose a location before submitting."}</p>
    <button type="button" onClick={() => { const point = mapRef.current?.getCenter().wrap(); if (point) changeRef.current({ latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6)) }); }}>Use the centre of the map as my selected point</button>
    <p><small>The pin marks a point. It is not a surveyed property boundary.</small></p>
    <details><summary>Optional map layers</summary>
      <h3>Land-use shading (OpenStreetMap)</h3>
      <div className="dispute-map-legend">{Object.entries(categories).map(([key, item]) => <span key={key}><i style={{ background: item.fillColor, borderColor: item.color }} />{item.label}</span>)}</div>
      <button type="button" onClick={loadShading} disabled={busy} aria-busy={busy}>{busy ? "Loading…" : "Load land-use shading in this view"}</button>
      <p role="status">{status}</p>
      <small>Coloured boundaries: OpenStreetMap contributors. Parks and ponds are grouped visually; this does not establish public ownership. Mapped land use is not a surveyed property boundary.</small>
      <h3>Bhuvan / ISRO land-use overlay</h3>
      <p>Show Bhuvan’s national land-use imagery in its original colours. This overview is at 1:250,000 scale and does not define individual property boundaries.</p>
      <button type="button" onClick={discoverBhuvan}>Load Bhuvan / ISRO imagery</button>
      {!!layers.length && <label>Bhuvan layer<select value={bhuvanLayer} onChange={(e) => setBhuvanLayer(e.target.value)}><option value="">Off</option>{layers.map((layer) => <option key={layer.name} value={layer.name}>{layer.title}</option>)}</select></label>}
      <p role="status">{bhuvanStatus}</p>
    </details>
  </section>;
}
