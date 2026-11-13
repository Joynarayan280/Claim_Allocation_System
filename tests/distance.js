const test = require('node:test');
const assert = require('node:assert');
const { createDistanceService, haversineKm, pairKey } = require('../utils/distance');

// A tiny map: A and B are about 8 km apart, C is about 12 km from A, D is ~200 km away
const POINTS = { '700001': { lat: 22.5726, lng: 88.3639 }, '700091': { lat: 22.5726, lng: 88.4400 }, '700150': { lat: 22.4800, lng: 88.3639 }, '713103': { lat: 23.5, lng: 87.5 } };

function memStores() {
  const geo = new Map(), dist = new Map();
  return {
    geo, dist,
    geoStore: { get: async (p) => geo.get(p) || null, set: async (p, v) => { geo.set(p, v); } },
    distStore: { getMany: async (keys) => Object.fromEntries(keys.filter((k) => dist.has(k)).map((k) => [k, dist.get(k)])), setMany: async (m) => { Object.entries(m).forEach(([k, v]) => dist.set(k, v)); } }
  };
}

function fakeFetch(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), body: init && init.body });
    const u = String(url);
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (u.includes('geocode/json')) {
      const pin = decodeURIComponent(u).match(/postal_code:(\d{6})/)[1];
      return json(POINTS[pin] ? { status: 'OK', results: [{ geometry: { location: POINTS[pin] } }] } : { status: 'ZERO_RESULTS', results: [] });
    }
    if (u.includes('computeRouteMatrix')) {
      const body = JSON.parse(init.body);
      // pretend every road distance is 10 km + 1 km per origin index
      return json(body.origins.map((_, i) => ({ originIndex: i, destinationIndex: 0, distanceMeters: 10000 + i * 1000, condition: 'ROUTE_EXISTS' })));
    }
    if (u.includes('/table/v1/driving/')) {
      const n = u.split('/table/v1/driving/')[1].split('?')[0].split(';').length - 1;
      return json({ code: 'Ok', distances: Array.from({ length: n }, (_, i) => [16200 + i * 1000]) });
    }
    if (u.includes('nominatim')) {
      const pin = u.match(/postalcode=(\d{6})/)[1];
      return json(POINTS[pin] ? [{ lat: String(POINTS[pin].lat), lon: String(POINTS[pin].lng) }] : []);
    }
    throw new Error('unexpected url ' + u);
  };
}

test('haversine gives a sensible straight-line distance', () => {
  const d = haversineKm(POINTS['700001'], POINTS['700091']);
  assert(d > 7 && d < 9, 'got ' + d);
  assert.strictEqual(pairKey('700091', '700001'), '700001|700091');
});

test('Google provider: road km come from the routing API and are cached for ever', async () => {
  const calls = []; const s = memStores();
  const svc = createDistanceService({ fetchImpl: fakeFetch(calls), geoStore: s.geoStore, distStore: s.distStore, env: { GOOGLE_MAPS_API_KEY: 'k' }, log: {} });
  const r = await svc.prepare({ targets: ['700091'], candidates: ['700001', '700150', '713103', '700091'] });
  assert.strictEqual(svc.provider, 'google');
  assert.strictEqual(r.distances['700001|700091'].m, 'google');
  assert.strictEqual(r.distances['700001|700091'].km, 10);                       // from the matrix reply, not from the formula
  assert.strictEqual(r.distances['700091|700091'].km, 0);                        // same PIN = 0 km, no API call needed
  assert.strictEqual(r.distances['700091|713103'], undefined);                   // 100+ km away: never routed, client treats as far
  assert.deepStrictEqual(r.prepared, ['700091']);
  const routeCalls = calls.filter((c) => c.url.includes('computeRouteMatrix')).length;
  assert.strictEqual(routeCalls, 1);                                             // one request covers all nearby officers

  const before = calls.length;
  const r2 = await svc.prepare({ targets: ['700091'], candidates: ['700001', '700150', '713103'] });
  assert.strictEqual(calls.length, before);                                      // everything answered from the cache
  assert.strictEqual(r2.distances['700001|700091'].km, 10);
});

test('same PIN is 0 km and both case PINs are measured against each other', async () => {
  const calls = []; const s = memStores();
  const svc = createDistanceService({ fetchImpl: fakeFetch(calls), geoStore: s.geoStore, distStore: s.distStore, env: { GOOGLE_MAPS_API_KEY: 'k' }, log: {} });
  const r = await svc.prepare({ targets: ['700001', '700091'], candidates: ['700001'] });
  assert.strictEqual(r.distances['700001|700001'].km, 0);
  assert(r.distances['700001|700091'], 'patient <-> hospital pair is calculated');
});

test('OpenStreetMap provider (no key): Nominatim + OSRM', async () => {
  const calls = []; const s = memStores();
  const svc = createDistanceService({ fetchImpl: fakeFetch(calls), geoStore: s.geoStore, distStore: s.distStore, env: { NOMINATIM_DELAY_MS: '0' }, log: {} });
  assert.strictEqual(svc.provider, 'osm');
  const r = await svc.prepare({ targets: ['700091'], candidates: ['700001'] });
  assert.strictEqual(r.distances['700001|700091'].m, 'osm');
  assert.strictEqual(r.distances['700001|700091'].km, 16.2);
});

test('when routing fails the result is a marked estimate (straight line x 1.3) and is not cached', async () => {
  const s = memStores();
  const base = fakeFetch([]);
  const fetchImpl = async (u, i) => { if (String(u).includes('computeRouteMatrix')) throw new Error('quota'); return base(u, i); };
  const svc = createDistanceService({ fetchImpl, geoStore: s.geoStore, distStore: s.distStore, env: { GOOGLE_MAPS_API_KEY: 'k' }, log: {} });
  const r = await svc.prepare({ targets: ['700091'], candidates: ['700001'] });
  const rec = r.distances['700001|700091'];
  assert.strictEqual(rec.m, 'estimate');
  const straight = haversineKm(POINTS['700001'], POINTS['700091']);
  assert(Math.abs(rec.km - straight * 1.3) < 0.2);
  assert.strictEqual(s.dist.size, 0);
});

test('PINs that cannot be geocoded are reported, never guessed', async () => {
  const calls = []; const s = memStores();
  const svc = createDistanceService({ fetchImpl: fakeFetch(calls), geoStore: s.geoStore, distStore: s.distStore, env: { GOOGLE_MAPS_API_KEY: 'k' }, log: {} });
  const r = await svc.prepare({ targets: ['700091'], candidates: ['999999'] });
  assert.deepStrictEqual(r.unknownPins, ['999999']);
});

test('warm() geocodes every field officer PIN once', async () => {
  const calls = []; const s = memStores();
  const svc = createDistanceService({ fetchImpl: fakeFetch(calls), geoStore: s.geoStore, distStore: s.distStore, env: { GOOGLE_MAPS_API_KEY: 'k' }, log: {} });
  const w = await svc.warm(['700001', '700001', '700091', '999999']);
  assert.deepStrictEqual(w, { total: 3, geocoded: 2, failed: 1 });
  assert.strictEqual(s.geo.size, 2);
});
