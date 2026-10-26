const BHUVAN = 'https://bhuvan-ras2.nrsc.gov.in/cgi-bin/LULC250K.exe';
const GEOCODE = process.env.MAP_GEOCODE_URL || 'https://us-central1-tree-top-d61c6.cloudfunctions.net/geocodePlace';
const AGENT = 'ForestWatch/1.0 (https://forest-watch-eight.vercel.app; land-use map)';
// Vercel rejects function responses above 4.5 MB, so a larger body would fail
// only after the upstream work had been paid for.
const MAX_RESPONSE_BYTES = 4_000_000;
// Bytes each upstream may send before the read is abandoned; an unbounded read
// of a dense Overpass area can exhaust the instance's memory.
const UPSTREAM_LIMITS = { overpass: 10_000_000, bhuvan: MAX_RESPONSE_BYTES, geocode: 64_000 };
const MAX_URL_LENGTH = 2048;
const AREA_TOO_DENSE = 'This area has too many mapped features. Zoom in further.';
const CACHE_MAX_ENTRIES = 200;
const CACHE_MAX_BYTES = 32_000_000;
const cache = new Map();
let cacheBytes = 0;
const inFlight = new Map();
export const config = { maxDuration: 60 };

// `expose` marks messages written for the reporter; anything else is replaced
// with a generic message so upstream details never reach the client.
function clientError(message, status = 400) { const error = new Error(message); error.status = status; error.expose = true; throw error; }
function badRequest(message) { clientError(message); }
export function parseBounds(value, maxSpan = Infinity, maxCoordinate = 180) {
  if (typeof value !== 'string' || !/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(value)) badRequest('Invalid map bounds.');
  const bounds = value.split(',').map(Number);
  if (bounds.some((v) => !Number.isFinite(v) || Math.abs(v) > maxCoordinate) ||
      bounds[0] >= bounds[2] || bounds[1] >= bounds[3] ||
      bounds[2] - bounds[0] > maxSpan || bounds[3] - bounds[1] > maxSpan) badRequest('Zoom in to a smaller valid map area.');
  return bounds;
}

// Release the connection of a response whose body will not be read.
function discard(response) { response.body?.cancel().catch(() => {}); }

async function readCapped(response, maxBytes) {
  const tooLarge = () => Object.assign(new Error('Upstream response too large.'), { tooLarge: true });
  if (Number(response.headers.get('content-length')) > maxBytes) { discard(response); throw tooLarge(); }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw tooLarge(); // leaving the loop cancels the stream
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

// Overpass grants each server address only a couple of query slots. Queueing
// more per instance just turns into 429s and 44-second retries that hold the
// function open, so excess land-use loads fail fast instead.
const OVERPASS_MAX_ACTIVE = 4;
let overpassActive = 0;

async function landUse(bounds, fetcher) {
  if (overpassActive >= OVERPASS_MAX_ACTIVE) { const error = new Error('Overpass slots busy.'); error.status = 503; error.retryAfter = 15; throw error; }
  overpassActive += 1;
  try {
    const box = bounds.join(',');
    const query = `[out:json][timeout:18];(way[landuse~"^(farmland|farmyard|orchard|vineyard|forest|commercial|retail)$"](${box});relation[landuse~"^(farmland|farmyard|orchard|vineyard|forest|commercial|retail)$"](${box});nwr[natural=wood](${box});nwr[leisure=park](${box});nwr[water=pond](${box}););out geom;`;
    for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
      try {
        const response = await fetcher(endpoint, {
          method: 'POST', headers: { 'User-Agent': AGENT, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(22000),
        });
        if (!response.ok) { discard(response); console.warn('Overpass endpoint returned %s: %s', response.status, endpoint); continue; }
        const raw = await readCapped(response, UPSTREAM_LIMITS.overpass).catch((error) => {
          if (error.tooLarge) clientError(AREA_TOO_DENSE, 413);
          throw error;
        });
        const data = JSON.parse(raw.toString('utf8'));
        if (data.remark || !Array.isArray(data.elements)) { console.warn('Overpass rejected the query at %s: %s', endpoint, data.remark || 'no elements'); continue; }
        // Loaded on first use so tile and geocode cold starts skip the parser.
        const { default: osmtogeojson } = await import('osmtogeojson');
        const geojson = osmtogeojson(data);
        geojson.features = geojson.features.filter((f) => ['Polygon', 'MultiPolygon'].includes(f.geometry?.type));
        const body = JSON.stringify(geojson);
        if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) clientError(AREA_TOO_DENSE, 413);
        return { body, type: 'application/geo+json', ttl: 900 };
      } catch (error) {
        // An oversized area is oversized at every provider; retrying would
        // only double the cost before failing the same way.
        if (error.expose) throw error;
        // Retry through the second published Overpass provider, but do not
        // swallow the reason — a silent fallback hides an outage until both
        // providers are down and the whole map goes dark with no explanation.
        console.warn('Overpass endpoint %s failed: %s', endpoint, error.message);
      }
    }
    throw new Error('Land-use providers are busy. Please try again shortly.');
  } finally {
    overpassActive -= 1;
  }
}

export async function getMapResponse(params, fetcher = fetch) {
  const action = params.get('action');
  if (action === 'geocode') {
    const query = (params.get('q') || '').trim();
    if (query.length < 2 || query.length > 120) badRequest('Enter a place name to search.');
    const upstream = new URL(GEOCODE);
    if (upstream.protocol !== 'https:') throw new Error('Configure an HTTPS geocoding endpoint.');
    upstream.search = new URLSearchParams({ q: query.replace(/\s+/g, ' ') });
    const response = await fetcher(upstream, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) { discard(response); const error = new Error('Place search is temporarily unavailable.'); error.status = response.status === 429 ? 429 : 503; throw error; }
    const place = JSON.parse((await readCapped(response, UPSTREAM_LIMITS.geocode)).toString('utf8'));
    return { body: JSON.stringify(place), type: 'application/json', ttl: 3600 };
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
  if (!response.ok) { discard(response); throw new Error('Bhuvan is temporarily unavailable.'); }
  const type = response.headers.get('content-type') || '';
  // Checked before the read so an HTML or XML error page is never downloaded.
  if (request === 'getmap' && !type.includes('image/png')) { discard(response); throw new Error('Bhuvan could not render this layer.'); }
  const body = await readCapped(response, UPSTREAM_LIMITS.bhuvan);
  if (request === 'getcapabilities' && !body.includes('WMS_Capabilities')) throw new Error('Bhuvan returned an invalid layer list.');
  return { body, type: request === 'getmap' ? 'image/png' : 'application/xml', ttl: 86400 };
}

// Bounded by entry count and by bytes, least recently used first, so a run of
// dense land-use areas cannot crowd the instance's memory.
function remember(key, result) {
  const size = Buffer.byteLength(result.body);
  const previous = cache.get(key);
  if (previous) { cache.delete(key); cacheBytes -= previous.size; }
  if (size > CACHE_MAX_BYTES / 4) return;
  for (const [oldKey, old] of cache) {
    if (cache.size < CACHE_MAX_ENTRIES && cacheBytes + size <= CACHE_MAX_BYTES) break;
    cache.delete(oldKey); cacheBytes -= old.size;
  }
  cache.set(key, { ...result, size, expires: Date.now() + result.ttl * 1000 });
  cacheBytes += size;
}

// This endpoint calls Overpass, Nominatim and Bhuvan under a single shared
// User-Agent. Left open, it is a free public proxy to all three, and their
// abuse policies attribute that traffic to this project. Bounded per source
// address; the counter is per warm instance, which is coarse but enough to
// stop one client saturating the shared quota.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
// Each land-use load is a heavy query against a volunteer-run service.
const LANDUSE_RATE_MAX = 12;
// Hard ceiling so a flood of distinct addresses cannot grow the table without
// bound; the oldest windows go first.
const RATE_MAX_KEYS = 10_000;
const hits = new Map();

export function overRateLimit(key, max = RATE_MAX, now = Date.now()) {
  const entry = hits.get(key);
  if (entry && entry.start >= now - RATE_WINDOW_MS) { entry.count += 1; return entry.count > max; }
  // Re-inserting keeps the map ordered by window start, so expired windows sit
  // at the front and the sweep stops at the first live one.
  hits.delete(key);
  hits.set(key, { start: now, count: 1 });
  for (const [k, v] of hits) {
    if (v.start >= now - RATE_WINDOW_MS && hits.size <= RATE_MAX_KEYS) break;
    hits.delete(k);
  }
  return false;
}
export function rateLimiterSize() { return hits.size; }

// One IPv6 subscriber controls a whole /64, so counting single addresses would
// let a client rotate past the limit; bucket by that prefix instead.
export function clientKey(ip) {
  const address = ip.split('%')[0].toLowerCase();
  if (!address.includes(':')) return address;
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(address)) return address.slice(7);
  const [head, tail] = address.split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const groups = tail === undefined ? front : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

const ALLOWED_ORIGINS = new Set([
  'https://forest-watch-eight.vercel.app',
  'https://tree-top-d61c6.web.app',
  'https://tree-top-d61c6.firebaseapp.com',
  // Capacitor serves the Android WebView from https://localhost (see
  // androidScheme in frontend/capacitor.config.ts), and apiUrl.ts points that
  // build at the Vercel origin — so the app is a genuine cross-origin caller
  // and omitting this silently breaks every map request inside the app.
  'https://localhost',
  'capacitor://localhost',
  'http://localhost:5173',
  'http://localhost:4173',
]);

function sameHost(origin, host) {
  try { return Boolean(host) && new URL(origin).host === host; } catch { return false; }
}

function sendError(res, status, message, retryAfter) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  res.end(JSON.stringify({ error: message }));
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  // Always vary: a CDN copy stored for a same-origin request (no CORS header)
  // must not be served to a cross-origin caller, or the reverse.
  res.setHeader('Vary', 'Origin');
  // Browsers attach Origin to every cross-origin fetch. Echoing only known
  // origins stops another site reading the result, but the upstream call would
  // still be made from its visitors' browsers, so refuse before any work.
  if (origin && !ALLOWED_ORIGINS.has(origin) && !sameHost(origin, req.headers.host)) {
    return sendError(res, 403, 'Map requests are only accepted from Forest Watch.');
  }
  if (origin && ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.statusCode = 405; return res.end(); }
  if ((req.url || '').length > MAX_URL_LENGTH) return sendError(res, 414, 'Map request is too long.');

  const ip = clientKey((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown');
  if (overRateLimit(ip)) return sendError(res, 429, 'Too many map requests. Please slow down.', 60);
  const params = new URL(req.url, 'https://forest-watch-eight.vercel.app').searchParams;
  // Leaflet uses uppercase WMS names; normalize to one form before validation.
  const lowered = new URLSearchParams();
  for (const [key, value] of params) lowered.set(key.toLowerCase(), value);
  // Rebuild from only the parameters this handler actually reads, in a fixed
  // order. Keying the cache on the raw query string instead would let anyone
  // append an ignored throwaway parameter (`&x=1`, `&x=2`, …) to miss the
  // cache on every request and drive an unbounded number of live calls to
  // Overpass, Nominatim and Bhuvan under this project's User-Agent.
  const normalized = new URLSearchParams();
  const action = lowered.get('action');
  const names = action === 'geocode' ? ['action', 'q'] : action === 'landuse' ? ['action', 'bbox'] : ['action', 'bbox', 'request', 'layers', 'width', 'height'];
  for (const name of names) {
    if (lowered.has(name)) normalized.set(name, lowered.get(name));
  }
  // The upstream sees the collapsed form anyway; share one cache entry.
  if (normalized.has('q')) normalized.set('q', normalized.get('q').trim().replace(/\s+/g, ' '));
  const key = normalized.toString();
  try {
    let result = cache.get(key);
    if (result && result.expires >= Date.now()) {
      cache.delete(key); cache.set(key, result);
    } else {
      let pending = inFlight.get(key);
      if (!pending) {
        // Only new upstream work counts against the tighter land-use budget;
        // cache hits and joins on an in-flight request are free.
        if (action === 'landuse' && overRateLimit(`${ip} landuse`, LANDUSE_RATE_MAX)) {
          return sendError(res, 429, 'Too many land-use loads. Please wait a minute.', 60);
        }
        pending = getMapResponse(normalized); inFlight.set(key, pending);
      }
      try { result = await pending; } finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
      remember(key, result);
    }
    res.setHeader('Content-Type', result.type);
    res.setHeader('Cache-Control', `public, max-age=${Math.min(result.ttl, 3600)}, s-maxage=${result.ttl}, stale-while-revalidate=86400`);
    res.statusCode = 200; res.end(result.body);
  } catch (error) {
    sendError(res, error.status || 503, error.expose ? error.message : 'Map service temporarily unavailable. Please try again.', error.retryAfter);
  }
}
