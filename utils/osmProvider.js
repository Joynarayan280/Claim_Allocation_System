// utils/osmProvider.js
// FREE road distances from OpenStreetMap data: Nominatim turns a PIN code into a point, OSRM gives the driving distance.
//
//  - Each PIN is geocoded ONCE and remembered forever (memory + database). Nominatim's public server allows
//    at most 1 request per second and asks for an identifying User-Agent, so geocoding runs through a 1 request/second
//    gate; the Intake Desk never waits for more than the destination PIN. Officers' base PINs are geocoded in the background.
//  - OSRM "table" answers many origins for one destination in a single request.
//  - If OSRM is down, the straight-line distance x 1.3 is returned and flagged quality "approx" (never cached).
//  - Includes India Post fallback lookup when direct PIN geocoding misses rural/semi-urban Indian PINs.

const INDIA = { latMin: 6, latMax: 38, lonMin: 67, lonMax: 98 };
const MISS_RETRY_MS = 60 * 60 * 1000; // Retry missed PINs after 1 hour

const toRad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function createOsmProvider({
  fetchImpl = (...a) => globalThis.fetch(...a),
  osrmUrl = 'https://router.project-osrm.org',
  geocoderUrl = 'https://nominatim.openstreetmap.org/search',
  geocoderKey = '',
  contact = 'admin@example.com',
  geoStore = null,             // { getMany(pins) -> {pin: {lat, lon} | {miss: true, at}}, setMany([{pin, lat, lon} | {pin, miss: true}]) }
  minGapMs = 1100,
  timeoutMs = 8000,
  roadFactor = 1.3,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  log = console
} = {}) {
  const userAgent = `ClaimDispatchPro/1.0 (${contact})`;
  const geo = new Map();       // pin -> {lat, lon} | null (null = not found, retry later)
  const missAt = new Map();    // pin -> time of the last failed lookup
  const queue = [];
  let pumping = false;
  let lastAt = 0;
  let chain = Promise.resolve();

  const gate = () => (chain = chain.then(async () => {
    const wait = Math.max(0, lastAt + minGapMs - now());
    if (wait) await sleep(wait);
    lastAt = now();
  }));

  async function fetchJson(url, opts = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': userAgent, 'Accept-Language': 'en', ...(opts.headers || {}) } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  async function loadFromStore(pins) {
    const need = pins.filter((p) => !geo.has(p));
    if (!need.length || !geoStore) return;
    try {
      const found = await geoStore.getMany(need);
      for (const p of need) {
        const v = found[p];
        if (v && typeof v.lat === 'number') geo.set(p, { lat: v.lat, lon: v.lon });
        // Old miss:true records are ignored so they re-geocode fresh with India Post fallback
      }
    } catch (err) { log.warn('Geocode cache lookup skipped: ' + err.message); }
  }

  const known = (p) => geo.get(p) || null;
  const recentlyMissed = (p) => missAt.has(p) && now() - missAt.get(p) < MISS_RETRY_MS;

  function extractIndiaHit(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((r) => ({ lat: Number(r.lat), lon: Number(r.lon) }))
      .find((p) => p.lat >= INDIA.latMin && p.lat <= INDIA.latMax && p.lon >= INDIA.lonMin && p.lon <= INDIA.lonMax);
  }

  // Fallback: Resolve PIN to Post Office / District via India Post API and geocode by area name
  async function geocodeViaIndiaPost(pin) {
    try {
      const ipData = await fetchJson(`https://api.postalpincode.in/pincode/${encodeURIComponent(pin)}`);
      const postOffice = Array.isArray(ipData) && ipData[0]?.Status === 'Success' && ipData[0]?.PostOffice?.[0];
      if (!postOffice) return null;

      const locality = postOffice.Block && postOffice.Block !== 'NA' ? postOffice.Block : postOffice.Name;
      const district = postOffice.District || '';
      const state = postOffice.State || '';
      const queryText = [locality, district, state, 'India'].filter(Boolean).join(', ');

      await gate();
      const qs = new URLSearchParams({ q: queryText, countrycodes: 'in', format: 'jsonv2', limit: '1' });
      if (geocoderKey) qs.set('key', geocoderKey);
      const rows = await fetchJson(`${geocoderUrl}?${qs.toString()}`);
      return extractIndiaHit(rows) || null;
    } catch (_) {
      return null;
    }
  }

  // One Nominatim lookup (rate limited). Returns {lat, lon} or null.
  async function geocodeNow(pin) {
    if (known(pin)) return known(pin);
    await loadFromStore([pin]);
    if (known(pin)) return known(pin);
    if (recentlyMissed(pin)) return null;

    await gate();
    try {
      const qs = new URLSearchParams({ postalcode: pin, country: 'India', format: 'jsonv2', limit: '1' });
      if (geocoderKey) qs.set('key', geocoderKey);
      const rows = await fetchJson(`${geocoderUrl}?${qs.toString()}`);
      let hit = extractIndiaHit(rows);

      // Step 2: If direct PIN search misses in OSM, resolve area name via India Post and retry
      if (!hit && /^\d{6}$/.test(String(pin))) {
        hit = await geocodeViaIndiaPost(pin);
      }

      if (hit) {
        geo.set(pin, hit);
        if (geoStore) geoStore.setMany([{ pin, lat: hit.lat, lon: hit.lon }]).catch(() => {});
        return hit;
      }
      missAt.set(pin, now());
      if (geoStore) geoStore.setMany([{ pin, miss: true }]).catch(() => {});
      return null;
    } catch (err) {
      log.warn(`Geocoding ${pin} failed: ${err.message}`);   // network problem: do not remember it as "not found"
      return null;
    }
  }

  // Background geocoding of PINs that are not known yet (officers' base PINs). Never blocks a request.
  function warm(pins) {
    for (const p of pins || []) {
      const pin = String(p || '').replace(/\D/g, '');
      if (pin.length === 6 && !known(pin) && !queue.includes(pin) && !recentlyMissed(pin)) queue.push(pin);
    }
    pump();
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const pin = queue.shift();
        await geocodeNow(pin);
      }
    } finally { pumping = false; }
  }
  const idle = async () => { while (pumping || queue.length) await sleep(5); await chain; };

  async function road(destPin, originPins) {
    const dest = await geocodeNow(destPin);
    if (!dest) { warm(originPins); return {}; }

    await loadFromStore(originPins);
    const ready = [];
    const later = [];
    for (const p of originPins) (known(p) ? ready : later).push(p);
    if (later.length) warm(later);          // geocode in the background; these officers get a distance next time
    if (!ready.length) return {};

    const coords = ready.map((p) => known(p)).concat([dest]).map((c) => `${c.lon},${c.lat}`).join(';');
    const sources = ready.map((_, i) => i).join(';');
    const out = {};
    try {
      const url = `${osrmUrl.replace(/\/$/, '')}/table/v1/driving/${coords}?sources=${sources}&destinations=${ready.length}&annotations=distance`;
      const data = await fetchJson(url);
      if (data.code !== 'Ok' || !Array.isArray(data.distances)) throw new Error('OSRM answered ' + data.code);
      ready.forEach((p, i) => {
        const m = data.distances[i] && data.distances[i][0];
        if (typeof m === 'number') out[p] = { km: Math.round(m / 100) / 10, quality: 'road' };
      });
    } catch (err) {
      log.warn('OSRM routing failed, using straight-line approximation: ' + err.message);
    }
    // anything OSRM could not answer: straight line x 1.3, clearly flagged
    for (const p of ready) {
      if (!out[p]) out[p] = { km: Math.round(haversineKm(known(p), dest) * roadFactor * 10) / 10, quality: 'approx' };
    }
    return out;
  }

  return { name: 'OpenStreetMap', billable: false, road, warm, idle, _geo: geo, _geocodeNow: geocodeNow };
}

module.exports = { createOsmProvider, haversineKm };