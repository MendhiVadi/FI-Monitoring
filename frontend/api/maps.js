import osmtogeojson from 'osmtogeojson';

const BHUVAN = 'https://bhuvan-ras2.nrsc.gov.in/cgi-bin/LULC250K.exe';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const AGENT = 'ForestWatch/1.0 (https://forest-watch-eight.vercel.app; land-use map)';
const cache = new Map();
const inFlight = new Map();
export const config = { maxDuration: 60 };

function badRequest(message) { const error = new Error(message); error.status = 400; throw error; }
export function parseBounds(value, maxSpan = Infinity, maxCoordinate = 180) {
  if (typeof value !== 'string' || !/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(value)) badRequest('Invalid map bounds.');
  const bounds = value.split(',').map(Number);
  if (bounds.some((v) => !Number.isFinite(v) || Math.abs(v) > maxCoordinate) ||
      bounds[0] >= bounds[2] || bounds[1] >= bounds[3] ||
      bounds[2] - bounds[0] > maxSpan || bounds[3] - bounds[1] > maxSpan) badRequest('Zoom in to a smaller valid map area.');
  return bounds;
}

async function landUse(bounds, fetcher) {
  const box = bounds.join(',');
  const query = `[out:json][timeout:18];(way[landuse~"^(farmland|farmyard|orchard|vineyard|forest|commercial|retail)$"](${box});relation[landuse~"^(farmland|farmyard|orchard|vineyard|forest|commercial|retail)$"](${box});nwr[natural=wood](${box});nwr[leisure=park](${box});nwr[water=pond](${box}););out geom;`;
  for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try {
      const response = await fetcher(endpoint, {
        method: 'POST', headers: { 'User-Agent': AGENT, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(22000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (data.remark || !Array.isArray(data.elements)) continue;
      const geojson = osmtogeojson(data);
      geojson.features = geojson.features.filter((f) => ['Polygon', 'MultiPolygon'].includes(f.geometry.type));
      return { body: JSON.stringify(geojson), type: 'application/geo+json', ttl: 900 };
    } catch { /* Retry through the second published Overpass provider. */ }
  }
  throw new Error('Land-use providers are busy. Please try again shortly.');
}

export async function getMapResponse(params, fetcher = fetch) {
  const action = params.get('action');
  if (action === 'geocode') {
    const query = (params.get('q') || '').trim();
    if (query.length < 2 || query.length > 120) badRequest('Enter a place name to search.');
    const upstream = new URL(NOMINATIM);
    upstream.search = new URLSearchParams({ q: query, format: 'jsonv2', countrycodes: 'in', limit: '1' });
    const response = await fetcher(upstream, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Place search is temporarily unavailable.');
    const places = await response.json();
    if (!Array.isArray(places) || !places.length) return { body: JSON.stringify({}), type: 'application/json', ttl: 300 };
    const place = places[0];
    return { body: JSON.stringify({ latitude: Number(place.lat), longitude: Number(place.lon), displayName: place.display_name }), type: 'application/json', ttl: 3600 };
  }
  if (action === 'landuse') {
    // Overpass order is south, west, north, east.
    const bounds = parseBounds(params.get('bbox'), 0.12);
    if (Math.abs(bounds[0]) > 90 || Math.abs(bounds[2]) > 90) badRequest('Invalid latitude.');
    return landUse(bounds, fetcher);
  }
  if (action !== 'bhuvan') badRequest('Unknown map operation.');
  const request = (params.get('request') || 'GetCapabilities').toLowerCase();
  const upstream = new URL(BHUVAN);
  if (request === 'getcapabilities') {
    upstream.search = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetCapabilities' });
  } else if (request === 'getmap') {
    const layer = params.get('layers');
    if (!/^LULC250K_\d{4}(?:_1)?$/.test(layer || '')) badRequest('Invalid Bhuvan layer.');
    const bounds = parseBounds(params.get('bbox'), Infinity, 20037509);
    const width = Number(params.get('width')), height = Number(params.get('height'));
    if (![width, height].every((v) => Number.isInteger(v) && v >= 1 && v <= 512)) badRequest('Invalid tile size.');
    // Fix CRS and image format; no user-supplied host, style URL, or arbitrary query.
    upstream.search = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.1.1',
      LAYERS: layer, STYLES: '', SRS: 'EPSG:3857', BBOX: bounds.join(','), WIDTH: String(width),
      HEIGHT: String(height), FORMAT: 'image/png', TRANSPARENT: 'TRUE' });
  } else badRequest('Unsupported Bhuvan operation.');
  const response = await fetcher(upstream, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error('Bhuvan is temporarily unavailable.');
  const type = response.headers.get('content-type') || '';
  const body = Buffer.from(await response.arrayBuffer());
  if (request === 'getmap' && !type.includes('image/png')) throw new Error('Bhuvan could not render this layer.');
  if (request === 'getcapabilities' && !body.toString().includes('WMS_Capabilities')) throw new Error('Bhuvan returned an invalid layer list.');
  return { body, type: request === 'getmap' ? 'image/png' : 'application/xml', ttl: 86400 };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.statusCode = 405; return res.end(); }
  const params = new URL(req.url, 'https://forest-watch-eight.vercel.app').searchParams;
  // Leaflet uses uppercase WMS names; normalize to one form before validation.
  const normalized = new URLSearchParams();
  for (const [key, value] of params) normalized.set(key.toLowerCase(), value);
  const key = normalized.toString();
  try {
    let result = cache.get(key);
    if (!result || result.expires < Date.now()) {
      let pending = inFlight.get(key);
      if (!pending) { pending = getMapResponse(normalized); inFlight.set(key, pending); }
      try { result = await pending; } finally { inFlight.delete(key); }
      if (!cache.has(key) && cache.size >= 48) cache.delete(cache.keys().next().value);
      cache.set(key, { ...result, expires: Date.now() + result.ttl * 1000 });
    }
    res.setHeader('Content-Type', result.type);
    res.setHeader('Cache-Control', `public, max-age=60, s-maxage=${result.ttl}, stale-while-revalidate=86400`);
    res.statusCode = 200; res.end(result.body);
  } catch (error) {
    res.statusCode = error.status || 503;
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: error.status === 400 ? error.message : 'Map service temporarily unavailable. Please try again.' }));
  }
}
