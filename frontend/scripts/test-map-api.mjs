import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { clientKey, getMapResponse, overRateLimit, parseBounds, rateLimiterSize } from '../api/maps.js';

test('place search uses the shared gateway and propagates busy responses', async () => {
  const params = new URLSearchParams({action:'geocode',q:' Pune   Maharashtra '});
  const result = await getMapResponse(params, async url => {
    assert.equal(url.hostname,'us-central1-tree-top-d61c6.cloudfunctions.net');
    assert.equal(url.searchParams.get('q'),'Pune Maharashtra');
    return Response.json({latitude:18.52,longitude:73.85,displayName:'Synthetic Pune'});
  });
  assert.equal(JSON.parse(result.body).latitude,18.52);
  await assert.rejects(getMapResponse(params,async()=>new Response('',{status:429})),{status:429});
});

test('map bounds reject injection, reversed coordinates and oversized areas', () => {
  for (const input of ['0,0,1,1;out;', '2,0,1,1', '0,0,1,1', 'NaN,0,1,1']) {
    assert.throws(() => parseBounds(input, 0.12));
  }
  assert.deepEqual(parseBounds('28.59,77.21,28.60,77.22', 0.12), [28.59,77.21,28.60,77.22]);
});
test('land-use API retries a failed provider with identification and returns polygons', async () => {
  const calls = [];
  const result = await getMapResponse(new URLSearchParams({action:'landuse',bbox:'28.59,77.21,28.60,77.22'}), async (url, options) => {
    calls.push(url);
    assert.match(options.headers['User-Agent'], /ForestWatch/);
    if (calls.length === 1) return new Response('', {status:429});
    return Response.json({elements:[{type:'way',id:1,tags:{landuse:'farmland'},nodes:[1,2,3,1],geometry:[
      {lat:28.59,lon:77.21},{lat:28.60,lon:77.21},{lat:28.60,lon:77.22},{lat:28.59,lon:77.21},
    ]}]});
  });
  assert.equal(calls.length,2);
  const geo = JSON.parse(result.body);
  assert.equal(geo.features[0].geometry.type,'Polygon');
  assert.equal(geo.features[0].properties.landuse,'farmland');
});
test('Bhuvan proxy fixes the upstream and CRS, and rejects service errors disguised as successful responses', async () => {
  const params = new URLSearchParams({action:'bhuvan',request:'GetMap',layers:'LULC250K_2425',bbox:'0,0,100,100',width:'256',height:'256'});
  await assert.rejects(getMapResponse(params,async(url)=>{
    assert.equal(url.hostname,'bhuvan-ras2.nrsc.gov.in');
    assert.equal(url.searchParams.get('SRS'),'EPSG:3857');
    return new Response('<ServiceException/>',{headers:{'Content-Type':'text/xml'}});
  }), /could not render/);
  params.set('layers','https://example.com/');
  await assert.rejects(getMapResponse(params),/Invalid Bhuvan layer/);
});

function exchange({ url = '/api/maps?action=bogus', method = 'GET', headers = {}, ip = '198.51.100.1' } = {}) {
  const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
  return [{ url, method, headers: { host: 'forest-watch-eight.vercel.app', 'x-forwarded-for': ip, ...headers }, socket: {} }, res];
}

test('handler refuses foreign origins and oversized URLs before any upstream work', async () => {
  let [req, res] = exchange({ headers: { origin: 'https://evil.example' }, ip: '198.51.100.2' });
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(res.headers.vary, 'Origin');

  [req, res] = exchange({ headers: { origin: 'https://tree-top-d61c6.web.app' }, ip: '198.51.100.2' });
  await handler(req, res);
  assert.equal(res.statusCode, 400); // reached validation: bogus action
  assert.equal(res.headers['access-control-allow-origin'], 'https://tree-top-d61c6.web.app');

  [req, res] = exchange({ headers: { origin: 'https://forest-watch-git-x.vercel.app', host: 'forest-watch-git-x.vercel.app' }, ip: '198.51.100.2' });
  await handler(req, res);
  assert.equal(res.statusCode, 400); // same-host preview origin is not a cross-site caller

  [req, res] = exchange({ url: `/api/maps?action=geocode&q=${'a'.repeat(3000)}`, ip: '198.51.100.2' });
  await handler(req, res);
  assert.equal(res.statusCode, 414);

  [req, res] = exchange({ method: 'POST', ip: '198.51.100.2' });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('handler rate-limits one address with an uncached 429', async () => {
  let last;
  for (let i = 0; i < 121; i += 1) {
    const [req, res] = exchange({ ip: '198.51.100.3' });
    await handler(req, res);
    last = res;
  }
  assert.equal(last.statusCode, 429);
  assert.equal(last.headers['retry-after'], '60');
  assert.equal(last.headers['cache-control'], 'no-store');
});

test('rate limiter stays bounded under address floods and resets each window', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 10_500; i += 1) overRateLimit(`flood-${i}`, 120, t0);
  assert.ok(rateLimiterSize() <= 10_000);
  assert.equal(overRateLimit('window', 2, t0), false);
  assert.equal(overRateLimit('window', 2, t0), false);
  assert.equal(overRateLimit('window', 2, t0), true);
  assert.equal(overRateLimit('window', 2, t0 + 61_000), false);
  overRateLimit('fresh', 120, t0 + 200_000);
  assert.ok(rateLimiterSize() < 10, 'expired windows are swept');
});

test('IPv6 clients are bucketed by /64 so address rotation does not reset the limit', () => {
  assert.equal(clientKey('2001:db8:1:2:aaaa::1'), clientKey('2001:db8:1:2:ffff:1:2:3'));
  assert.notEqual(clientKey('2001:db8:1:2::1'), clientKey('2001:db8:1:3::1'));
  assert.equal(clientKey('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(clientKey('203.0.113.5'), '203.0.113.5');
});

test('oversized upstream bodies are abandoned, and a dense area is not retried at the second provider', async () => {
  const calls = [];
  const huge = new Response(new Uint8Array(11_000_000));
  await assert.rejects(getMapResponse(new URLSearchParams({action:'landuse',bbox:'28.59,77.21,28.60,77.22'}), async () => { calls.push(1); return huge; }),
    { status: 413, expose: true });
  assert.equal(calls.length, 1);
  await assert.rejects(getMapResponse(new URLSearchParams({action:'geocode',q:'Pune'}),
    async () => new Response('{}', { headers: { 'content-length': '999999' } })), (error) => !error.expose);
});

test('land-use loads beyond the per-instance Overpass slot budget fail fast', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetcher = async () => { await gate; return Response.json({ elements: [] }); };
  const loads = [1, 2, 3, 4].map((i) => getMapResponse(new URLSearchParams({action:'landuse',bbox:`28.5${i},77.21,28.6${i},77.22`}), fetcher));
  await assert.rejects(getMapResponse(new URLSearchParams({action:'landuse',bbox:'28.55,77.21,28.56,77.22'}), fetcher), { status: 503 });
  release();
  for (const load of loads) assert.equal(JSON.parse((await load).body).type, 'FeatureCollection');
});
