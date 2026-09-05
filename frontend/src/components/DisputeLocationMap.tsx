import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import "leaflet/dist/leaflet.css";
import "./DisputeLocationMap.css";
import { apiUrl } from "../lib/apiUrl";

export interface DisputeLocation { latitude: number; longitude: number }
const categories = {
  farm: { label: "Farmland", color: "#a17b00", fillColor: "#facc15" },
  public: { label: "Parks / ponds", color: "#25843c", fillColor: "#86efac" },
  commercial: { label: "Commercial", color: "#b91c1c", fillColor: "#f87171" },
  forest: { label: "Forest", color: "#12452c", fillColor: "#23854c" },
};
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
  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("Zoom in to a village or neighbourhood, then load land-use shading.");
  const [busy, setBusy] = useState(false);
  const [bhuvanStatus, setBhuvanStatus] = useState("");
  const [bhuvanLayer, setBhuvanLayer] = useState("");
  const [layers, setLayers] = useState<{ name: string; title: string }[]>([]);
  const [search, setSearch] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const lastPlaceRef = useRef("");

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { scrollWheelZoom: false }).setView([22.5, 79], 5);
    mapRef.current = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.on("click", (event: L.LeafletMouseEvent) => changeRef.current({
      latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.wrap().lng.toFixed(6)),
    }));
    return () => { abortRef.current?.abort(); map.remove(); mapRef.current = null; markerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) { markerRef.current?.remove(); markerRef.current = null; return; }
    const position: L.LatLngExpression = [value.latitude, value.longitude];
    if (markerRef.current) markerRef.current.setLatLng(position);
    else {
      const marker = L.marker(position, { draggable: true, title: "Dispute location — drag to move", icon: L.divIcon({
        className: "dispute-map-pin", html: "<span></span>", iconSize: [26, 26], iconAnchor: [13, 13],
      }) }).addTo(map);
      marker.on("dragend", () => { const p = marker.getLatLng().wrap(); changeRef.current({ latitude: Number(p.lat.toFixed(6)), longitude: Number(p.lng.toFixed(6)) }); });
      markerRef.current = marker;
    }
    if (!map.getBounds().contains(position)) map.panTo(position);
  }, [value]);

  async function searchPlace(query: string, automatic = false) {
    const text = query.trim();
    if (text.length < 2) return;
    setSearchStatus(automatic ? `Locating ${text}…` : "Searching…");
    try {
      const response = await fetch(apiUrl(`/api/maps?action=geocode&q=${encodeURIComponent(text)}`), { signal: AbortSignal.timeout(15000) });
      const place = await response.json();
      if (!response.ok || !place.latitude || !place.longitude) throw new Error();
      const point = { latitude: Number(place.latitude.toFixed(6)), longitude: Number(place.longitude.toFixed(6)) };
      onChange(point);
      mapRef.current?.setView([point.latitude, point.longitude], automatic && text.includes(",") ? 13 : 11);
      setSearchStatus(place.displayName ? `Showing ${place.displayName}` : "Location found.");
    } catch { setSearchStatus("Location not found. Try a state or district name in India."); }
  }

  useEffect(() => {
    const place = [district, state].filter(Boolean).join(", ");
    if (place && place !== lastPlaceRef.current) {
      lastPlaceRef.current = place;
      setSearch(place);
      void searchPlace(place, true);
    }
  }, [state, district]);

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

  async function discoverBhuvan() {
    setBhuvanStatus("Checking available Bhuvan layers…");
    try {
      const response = await fetch(apiUrl("/api/maps?action=bhuvan&request=GetCapabilities"), { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error();
      const xml = new DOMParser().parseFromString(await response.text(), "text/xml");
      const available = Array.from(xml.querySelectorAll("Layer")).flatMap((layer) => {
        const name = layer.querySelector(":scope > Name")?.textContent || "";
        const year = name.match(/^LULC250K_(\d{2})(\d{2})$/);
        const title = year ? `Land use 20${year[1]}–20${year[2]} (1:250,000)` : name;
        return year ? [{ name, title }] : [];
      }).sort((a, b) => b.name.localeCompare(a.name));
      if (!available.length) throw new Error();
      setLayers(available); setBhuvanLayer(available[0].name);
    } catch { setBhuvanStatus("Bhuvan is temporarily unavailable. You can still choose coordinates and load OpenStreetMap shading."); }
  }

  async function loadShading() {
    const map = mapRef.current;
    if (!map || busy) return;
    if (map.getZoom() < 14) { setStatus("Zoom in further (use +) before loading land-use areas."); return; }
    const b = map.getBounds();
    if (b.getNorth() - b.getSouth() > 0.12 || b.getEast() - b.getWest() > 0.12) { setStatus("Zoom in further to load a smaller area."); return; }
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setStatus("Loading mapped land-use boundaries…");
    const bounds = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(5)).join(',');
    const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetch(apiUrl(`/api/maps?action=landuse&bbox=${encodeURIComponent(bounds)}`), { signal: controller.signal });
      if (!response.ok) throw new Error();
      const geojson = await response.json() as FeatureCollection;
      if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) throw new Error();
      polygonsRef.current?.remove();
      polygonsRef.current = L.geoJSON(geojson, {
        style: (feature) => ({ ...category(feature?.properties?.tags || feature?.properties), weight: 2, fillOpacity: 0.22 }),
        onEachFeature: (feature, layer) => {
          const tags = feature.properties?.tags || feature.properties;
          const text = document.createElement("span");
          text.textContent = `${category(tags)?.label || "Land use"}${tags?.name ? ` — ${tags.name}` : ""}`;
          layer.bindTooltip(text);
          layer.on("click", (event: L.LeafletMouseEvent) => changeRef.current({ latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.lng.toFixed(6)) }));
        },
      }).addTo(map);
      setStatus(`${geojson.features.length} mapped areas loaded for this view. Reload after moving the map. Unshaded land may have no mapped classification.`);
    } catch { if (mapRef.current) setStatus("Land-use data is unavailable. Try again; you can still place your dispute pin."); }
    finally { clearTimeout(timeout); if (mapRef.current) setBusy(false); }
  }

  return <section className="dispute-location" aria-label="Dispute location">
    <h2>Where is the disputed land?</h2>
    <p>Search for a place, click the map, or drag the pin.</p>
    <div className="dispute-map-search" role="search">
      <label>Search India by state, district, city, or village<input aria-label="Search map" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchPlace(search); } }} placeholder="e.g. Maharashtra, Pune" /></label>
      <button type="button" onClick={() => void searchPlace(search)}>Search map</button>
    </div>
    <p role="status">{searchStatus}</p>
    <div ref={container} className="dispute-location-map" aria-label="Interactive dispute location map" />
    <p aria-live="polite">{value ? "Location selected. Click the map or drag the pin to change it." : "Choose a location before submitting."}</p>
    <div className="dispute-map-legend">{Object.entries(categories).map(([key, item]) => <span key={key}><i style={{ background: item.fillColor, borderColor: item.color }} />{item.label}</span>)}</div>
    <button type="button" onClick={loadShading} disabled={busy}>{busy ? "Loading…" : "Load land-use shading in this view"}</button>
    <p role="status">{status}</p>
    <small>Coloured boundaries: OpenStreetMap contributors. Parks and ponds are grouped visually; this does not establish public ownership. Mapped land use and the pin are not surveyed property boundaries.</small>
    <details><summary>Bhuvan / ISRO land-use overlay</summary>
      <p>Show Bhuvan’s national land-use imagery in its original colours. This overview is at 1:250,000 scale and does not define individual property boundaries.</p>
      <button type="button" onClick={discoverBhuvan}>Load Bhuvan / ISRO imagery</button>
      {!!layers.length && <label>Bhuvan layer<select aria-label="Bhuvan layer" value={bhuvanLayer} onChange={(e) => setBhuvanLayer(e.target.value)}><option value="">Off</option>{layers.map((layer) => <option key={layer.name} value={layer.name}>{layer.title}</option>)}</select></label>}
      <p role="status">{bhuvanStatus}</p>
    </details>
  </section>;
}
