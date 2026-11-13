const test = require('node:test');
const assert = require('node:assert');
const { createDistanceService } = require('../utils/distanceService');
const { createGoogleProvider } = require('../utils/googleProvider');
const { createOsmProvider, haversineKm } = require('../utils/osmProvider');

const quiet = { error() {}, warn() {} };

// ------------------------------------------------------------------ Google
// fake Google: metres = |origin - destination| * 100
function fakeGoogle(calls) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, headers: opts.headers, body });
    const dest = Number(body.destinations[0].waypoint.address.slice(0, 6));
    const rows = body.origins.map((o, i) => ({ originIndex: i, destinationIndex: 0, distanceMeters: Math.abs(Number(o.waypoint.address.slice(0, 6)) - dest) * 100, condition: 'ROUTE_EXISTS' }));
    return { ok: true, status: 200, json: async () => rows, text: async () => '' };
  };
}
const google = (calls, extra = {}) => createDistanceService({ provider: createGoogleProvider({ apiKey: 'K', fetchImpl: fakeGoogle(calls), log: quiet }), log: quiet, ...extra });

test('google: one request per destination, kilometres with one decimal, quality "road"', async () => {
  const calls = [];
  const r = await google(calls).distances('700001', ['700091', '700045']);
  assert.deepStrictEqual(r.km, { '700091': 9, '700045': 4.4 });
  assert.deepStrictEqual(r.quality, { '700091': 'road', '700045': 'road' });
  assert.strictEqual(r.provider, 'Google Maps');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].headers['X-Goog-Api-Key'], 'K');
  assert.strictEqual(calls[0].body.origins[0].waypoint.address, '700091, India');
});

test('every pair is asked once: repeat and reverse requests come from the cache', async () => {
  const calls = [];
  const svc = google(calls);
  await svc.distances('700001', ['700091']);
  assert.strictEqual((await svc.distances('700091', ['700001'])).km['700001'], 9);
  assert.strictEqual(calls.length, 1);
});

test('persistent store is read before the provider and written after', async () => {
  const calls = []; const saved = {};
  const store = { getMany: async (keys) => Object.fromEntries(keys.filter((k) => k in saved).map((k) => [k, saved[k]])), setMany: async (e) => e.forEach((x) => { saved[x.key] = x.km; }) };
  await google(calls, { store }).distances('700001', ['700091']);
  assert.strictEqual(saved['700001>700091'], 9);
  const r = await google(calls, { store }).distances('700001', ['700091']);   // "restart"
  assert.strictEqual(r.km['700091'], 9); assert.strictEqual(calls.length, 1);
});

test('no provider configured: every distance is null and nothing is called', async () => {
  const r = await createDistanceService({ provider: null, log: quiet }).distances('700001', ['700091']);
  assert.strictEqual(r.enabled, false); assert.strictEqual(r.km['700091'], null);
});

test('provider failure gives null, never throws, and is not cached', async () => {
  let n = 0;
  const flaky = async () => { n++; if (n === 1) throw new Error('network down'); return { ok: true, status: 200, json: async () => [{ originIndex: 0, destinationIndex: 0, distanceMeters: 5000 }] }; };
  const svc = createDistanceService({ provider: createGoogleProvider({ apiKey: 'K', fetchImpl: flaky, log: quiet }), log: quiet });
  assert.strictEqual((await svc.distances('700001', ['700091'])).km['700091'], null);
  assert.strictEqual((await svc.distances('700001', ['700091'])).km['700091'], 5);
});

test('billable provider: the daily budget stops spending', async () => {
  const calls = [];
  const r = await google(calls, { dailyBudget: 2 }).distances('700001', ['700010', '700020', '700030']);
  assert.strictEqual(r.requested, 2);
  assert.strictEqual(Object.values(r.km).filter((v) => v === null).length, 1);
});

test('route-not-found and invalid PINs give null; same PIN is 0 km; origins are chunked', async () => {
  const calls = [];
  const odd = async (url, opts) => { calls.push(1); const b = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => b.origins.map((o, i) => (i === 0 ? { originIndex: i, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' } : { originIndex: i, destinationIndex: 0, distanceMeters: 1000, condition: 'ROUTE_EXISTS' })) }; };
  const svc = createDistanceService({ provider: createGoogleProvider({ apiKey: 'K', fetchImpl: odd, log: quiet }), maxPerRequest: 2, log: quiet });
  const r = await svc.distances('700001', ['700002', '700003', '700004', '700001', '12', 'abc']);
  assert.strictEqual(r.km['700002'], null); assert.strictEqual(r.km['700003'], 1); assert.strictEqual(r.km['700001'], 0);
  assert.strictEqual(calls.length, 2);
});

// ------------------------------------------------------------------ OpenStreetMap (free)
// fake Nominatim: PIN 7xxxxx -> lat = 22 + (pin-700000)/1000, lon = 88 ;  PIN 999999 -> not found
function fakeOsm(log) {
  return async (url, opts) => {
    log.push(String(url));
    assert(/ClaimDispatchPro/.test(opts.headers['User-Agent']), 'identifying User-Agent');
    if (String(url).includes('nominatim')) {
      const pin = Number(new URL(url).searchParams.get('postalcode'));
      if (pin === 999999) return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => [{ lat: String(22 + (pin - 700000) / 1000), lon: '88.0' }] };
    }
    // OSRM table: distance (m) = |lat difference| * 111000 * 1.2   (a "road" that is 20% longer than the straight line)
    const coords = decodeURIComponent(String(url).split('/driving/')[1].split('?')[0]).split(';').map((c) => c.split(',').map(Number));
    const dest = coords[coords.length - 1];
    return { ok: true, status: 200, json: async () => ({ code: 'Ok', distances: coords.slice(0, -1).map((c) => [Math.round(Math.abs(c[1] - dest[1]) * 111000 * 1.2)]) }) };
  };
}
const osm = (log, extra = {}) => createOsmProvider({ fetchImpl: fakeOsm(log), minGapMs: 0, sleep: async () => {}, contact: 't@t.in', log: quiet, ...extra });

test('osm: geocodes the destination, routes known origins, and queues unknown origins in the background', async () => {
  const log = []; const prov = osm(log);
  const svc = createDistanceService({ provider: prov, log: quiet });
  prov.warm(['700091']);                       // officer base PIN geocoded in the background
  await prov.idle();
  const r = await svc.distances('700001', ['700091', '700045']);   // 700045 is not geocoded yet
  assert.strictEqual(r.provider, 'OpenStreetMap');
  assert.strictEqual(r.km['700091'], 12);      // 0.090 degrees of latitude x 111 km x 1.2 (road factor of the fake OSRM)
  assert.strictEqual(r.quality['700091'], 'road');
  assert.strictEqual(r.km['700045'], null);    // not ready yet: the Intake Desk uses its estimate this time ...
  await prov.idle();
  const again = await svc.distances('700001', ['700045']);   // ... and the real distance next time
  assert.strictEqual(again.km['700045'], 5.9);   // 0.044 degrees x 111 km x 1.2
});

test('osm: a PIN is geocoded only once, even across requests, and the answer is stored', async () => {
  const log = []; const saved = {};
  const geoStore = { getMany: async (pins) => Object.fromEntries(pins.filter((p) => saved[p]).map((p) => [p, saved[p]])), setMany: async (rows) => rows.forEach((x) => { saved[x.pin] = x; }) };
  const prov = osm(log, { geoStore });
  await prov._geocodeNow('700001'); await prov._geocodeNow('700001');
  assert.strictEqual(log.filter((u) => u.includes('nominatim')).length, 1);
  assert.deepStrictEqual(Object.keys(saved), ['700001']);
  const fresh = osm(log, { geoStore });                       // after a restart the database answers
  await fresh._geocodeNow('700001');
  assert.strictEqual(log.filter((u) => u.includes('nominatim')).length, 1);
});

test('osm: Nominatim is called at most once per second (rate gate) and a PIN that is not found returns null', async () => {
  let t = 0; const waits = [];
  const prov = osm([], { minGapMs: 1100, now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  await prov._geocodeNow('700001'); await prov._geocodeNow('700002');
  assert(waits.some((w) => w >= 1000), 'a wait of about one second was inserted between lookups');
  assert.strictEqual(await prov._geocodeNow('999999'), null);
});

test('osm: if OSRM is down the answer is a straight-line x 1.3 approximation, flagged and never cached', async () => {
  const log = []; let osrmUp = false;
  const base = fakeOsm(log);
  const f = async (url, opts) => (String(url).includes('/table/v1') && !osrmUp ? { ok: false, status: 503, json: async () => ({}) } : base(url, opts));
  const prov = createOsmProvider({ fetchImpl: f, minGapMs: 0, sleep: async () => {}, log: quiet });
  const svc = createDistanceService({ provider: prov, log: quiet });
  prov.warm(['700091']); await prov.idle();
  const r = await svc.distances('700001', ['700091']);
  const expected = Math.round(haversineKm({ lat: 22.091, lon: 88 }, { lat: 22.001, lon: 88 }) * 1.3 * 10) / 10;
  assert.strictEqual(r.km['700091'], expected); assert.strictEqual(r.quality['700091'], 'approx');
  osrmUp = true;
  const later = await svc.distances('700001', ['700091']);       // not cached, so the real road distance is fetched now
  assert.strictEqual(later.quality['700091'], 'road');
});

test('osm: unreachable geocoder leaves distances null (estimate fallback) without throwing', async () => {
  const prov = createOsmProvider({ fetchImpl: async () => { throw new Error('offline'); }, minGapMs: 0, sleep: async () => {}, log: quiet });
  const r = await createDistanceService({ provider: prov, log: quiet }).distances('700001', ['700091']);
  assert.strictEqual(r.km['700091'], null);
});
