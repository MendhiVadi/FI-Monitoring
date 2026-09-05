import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMapResponse, parseBounds } from '../api/maps.js';

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
