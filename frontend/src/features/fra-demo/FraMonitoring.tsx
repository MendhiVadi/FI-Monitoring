import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import "leaflet/dist/leaflet.css";
import { claimAnomalies, DEMO_CLAIMS, DISTRICTS, progress, REFERENCE_DATE } from "./claims";
import "./fra.css";

const colours = { flagged: "#b45309", pending: "#2563eb", approved: "#15803d", empty: "#64748b" };
export function FraMonitoring() {
  const [state, setState] = useState("all"), [status, setStatus] = useState("all"), [onlyFlags, setOnlyFlags] = useState(false);
  const [district, setDistrict] = useState("Mandla"), [asOf, setAsOf] = useState(REFERENCE_DATE);
  const [geometry, setGeometry] = useState<FeatureCollection | null>(null), [mapError, setMapError] = useState("");
  const container = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/geo/fra-demo-districts.geojson", { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error(); return response.json();
    }).then(data => { if (data.type !== "FeatureCollection" || data.features.length !== 3) throw new Error(); setGeometry(data); })
      .catch(() => { if (!abort.signal.aborted) setMapError("District boundaries could not load. The claim tables remain available."); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!container.current) return;
    const view = L.map(container.current, { scrollWheelZoom: false }).setView([21, 78], 5); map.current = view;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 14, attribution: '&copy; OpenStreetMap contributors | Districts: geoBoundaries / Pathways Data, ODbL 1.0' }).addTo(view);
    return () => { view.remove(); map.current = null; };
  }, []);
  const filtered = useMemo(() => DEMO_CLAIMS.filter(claim => (state === "all" || claim.state === state) && (status === "all" || claim.status === status) && (!onlyFlags || claimAnomalies(claim, asOf).length > 0)), [state, status, onlyFlags, asOf]);
  const totals = progress(filtered, asOf);
  useEffect(() => {
    if (!map.current || !geometry) return;
    const layer = L.geoJSON(geometry, {
      filter: feature => state === "all" || feature.properties?.state === state,
      style: feature => {
        const stats = progress(filtered.filter(claim => claim.district === feature?.properties?.shapeName), asOf);
        return { color: feature?.properties?.shapeName === district ? "#f8fafc" : "#334155", weight: 3, fillOpacity: 0.75,
          fillColor: !stats.total ? colours.empty : stats.flagged ? colours.flagged : stats.pending ? colours.pending : colours.approved };
      },
      onEachFeature: (feature, shape) => {
        const name = feature.properties.shapeName;
        const label = document.createElement("span"); label.textContent = name + " — synthetic claims";
        shape.bindTooltip(label); shape.on("click", () => setDistrict(name));
      },
    }).addTo(map.current);
    if (layer.getBounds().isValid()) map.current.fitBounds(layer.getBounds(), { padding: [30, 30], animate: false, maxZoom: 8 });
    return () => { layer.remove(); };
  }, [geometry, state, district, filtered, asOf]);
  const selected = filtered.filter(claim => claim.district === district);
  return <main className="fra-page">
    <span className="fra-tag">SYNTHETIC DEMONSTRATION · 60 CLAIMS · 3 DISTRICTS</span>
    <h1>Where should the next review begin?</h1>
    <p className="fra-intro">Compare FRA progress, inspect district alerts and follow the evidence behind each suggested review.</p>
    <aside className="fra-notice"><strong>Demonstration only.</strong> Every claim and land record below is fictional. Boundaries represent a 2021 dataset. Delay and area thresholds are illustrative review rules; they do not establish legal deadlines, ownership or entitlement. <Link to="/datasets">Sources and methods</Link></aside>
    <section className="fra-filters" aria-label="Claim filters">
      <label>State<select value={state} onChange={e => { setState(e.target.value); setDistrict(DISTRICTS.find(place => e.target.value === "all" || place.state === e.target.value)!.district); }}><option value="all">All three states</option>{DISTRICTS.map(place => <option key={place.state}>{place.state}</option>)}</select></label>
      <label>Claim status<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
      <label>Review date<input type="date" value={asOf} onChange={e => { if (e.target.value) setAsOf(e.target.value); }} /></label>
      <label className="fra-check"><input type="checkbox" checked={onlyFlags} onChange={e => setOnlyFlags(e.target.checked)} />Only claims with alerts</label>
    </section>
    <section className="fra-metrics" aria-label="Filtered claim totals">{[["Matching claims", totals.total], ["Pending", totals.pending], ["Approved", totals.approved], ["Claims with alerts", totals.flagged]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="fra-grid">
      <div className="fra-card"><h2>District alert map</h2><p>Shading summarizes the matching claims in each district.</p><div ref={container} className="fra-map" aria-label="District FRA claim map" />{mapError && <p role="alert">{mapError}</p>}<div className="fra-legend">{[["At least one alert", colours.flagged], ["Pending without alerts", colours.pending], ["No pending or alerted claims", colours.approved], ["No matching claims", colours.empty]].map(([label, colour]) => <span key={label}><i style={{ background: colour }} />{label}</span>)}</div><small>District polygons provide context; no synthetic parcel locations are implied.</small></div>
      <div className="fra-card"><h2>State progress</h2><p>All 20 synthetic claims per state. Status and alert filters do not change these totals.</p><div className="fra-table"><table><thead><tr><th>State</th><th>Approved</th><th>Pending</th><th>Rejected</th><th>Alerts</th></tr></thead><tbody>{DISTRICTS.map(place => { const stats = progress(DEMO_CLAIMS.filter(claim => claim.state === place.state), asOf); return <tr key={place.state}><th><button onClick={() => { setState(place.state); setDistrict(place.district); }}>{place.state}</button><small>{place.district} only</small></th><td>{stats.approved}/20</td><td>{stats.pending}</td><td>{stats.rejected}</td><td>{stats.flagged}</td></tr>; })}</tbody></table></div><p>Start with districts with the most alerts, then check each claim’s records. Counts cover the demonstration districts, not the whole state.</p><Link to="/report">Report an actual land grievance →</Link></div>
    </section>
    <section className="fra-card"><h2>District review</h2><label>Choose a district<select value={district} onChange={e => setDistrict(e.target.value)}>{DISTRICTS.filter(place => state === "all" || place.state === state).map(place => <option key={place.district}>{place.district}</option>)}</select></label><p>{selected.length} matching synthetic claims in {district}. Explanations come from the displayed rules and record values.</p>
      <div className="fra-table"><table><thead><tr><th>Claim / evidence</th><th>Status / filed</th><th>Claimed / recorded area</th><th>Review explanation and next action</th></tr></thead><tbody>{selected.map(claim => { const flags = claimAnomalies(claim, asOf); return <tr key={claim.id}><th>{claim.id}<small>{claim.evidenceRef}</small></th><td>{claim.status}<small>{claim.filedOn}</small></td><td>{claim.claimedHa} / {claim.recordedHa} ha</td><td>{flags.length ? flags.map(flag => <div key={flag.kind} className="fra-alert"><strong>{flag.kind === "delay" ? "Delay" : flag.kind === "area" ? "Area mismatch" : "Check data"}</strong><p>{flag.explanation}</p><p><strong>Next:</strong> {flag.action}</p></div>) : "No rule triggered. This does not confirm the claim is valid."}</td></tr>; })}</tbody></table></div>{!selected.length && <p role="status">No claims match these filters. Choose another district or clear the alert filter.</p>}
    </section>
  </main>;
}
