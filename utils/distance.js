// utils/distance.js
// Real driving distances between two PIN codes, so the kilometres shown in the system match what Google Maps
// shows when you type the same two PIN codes.
//
// How it works
//   1. Every PIN code is turned into a point on the map once (geocoding) and remembered in the database.
//   2. For a case, the straight-line distance to every field officer's base PIN is calculated locally (free).
//      Only officers that are plausibly near (straight line <= PREFILTER_KM) get a real road distance.
//   3. Road distances come from the configured provider and are remembered per PIN pair FOREVER, so a pair is
//      paid for / requested only once.
//
// Providers (DISTANCE_PROVIDER):
//   google  Google Geocoding API + Routes API (computeRouteMatrix). Same data as Google Maps. Needs GOOGLE_MAPS_API_KEY.
//   osm     Nominatim (geocoding) + OSRM (road routing). Free, but the public servers are for light use only;
//           host your own OSRM for production (OSRM_URL).
//   If a provider cannot answer, the system falls back to "straight line x 1.3" and marks the result as an estimate.
//
// The service is dependency-injected (fetch and stores are passed in) so it can be unit tested without a network.

const ROAD_FACTOR = 1.3;          // straight line -> typical road distance, used only when no routing provider answers
const PREFILTER_KM = 40;          // officers farther than this in a straight line are never routed (road >= straight line)
const GOOGLE_MATRIX_MAX = 25;     // origins per Routes request we use (limit is 625 elements, 25 keeps responses small)

const clean = (pin) => String(pin || '').replace(/\D/g, '').slice(0, 6);
const pairKey = (a, b) => { const x = clean(a), y = clean(b); return x < y ? x + '|' + y : y + '|' + x; };

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const round1 = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createDistanceService({ fetchImpl, geoStore, distStore, env = {}, log = console }) {
  const googleKey = env.GOOGLE_MAPS_API_KEY || '';
  const provider = (env.DISTANCE_PROVIDER || (googleKey ? 'google' : 'osm')).toLowerCase();
  const osrmUrl = (env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
  const nominatimUrl = (env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
  const userAgent = 'ClaimDispatchPro/1.0 ' + (env.NOMINATIM_EMAIL ? '(' + env.NOMINATIM_EMAIL + ')' : '');
  const maxLiveGeocodes = Number(env.MAX_LIVE_GEOCODES || 30);

  let nominatimChain = Promise.resolve();     // public Nominatim allows 1 request per second

  async function getJson(url, init) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 12000) : null;
    try {
      const res = await fetchImpl(url, Object.assign({}, init || {}, ctl ? { signal: ctl.signal } : {}));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      return JSON.parse(text);
    } finally { if (t) clearTimeout(t); }
  }

  // ------------------------------------------------------------ geocoding
  async function geocodeGoogle(pin) {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json?components=' + encodeURIComponent('postal_code:' + pin + '|country:IN') + '&key=' + encodeURIComponent(googleKey);
    const j = await getJson(url);
    const loc = j && j.results && j.results[0] && j.results[0].geometry && j.results[0].geometry.location;
    if (!loc) return null;
    return { lat: loc.lat, lng: loc.lng, source: 'google' };
  }

  function geocodeNominatim(pin) {
    nominatimChain = nominatimChain.then(async () => {
      try {
        const url = nominatimUrl + '/search?format=json&limit=1&countrycodes=in&postalcode=' + encodeURIComponent(pin);
        const j = await getJson(url, { headers: { 'User-Agent': userAgent } });
        await sleep(env.NOMINATIM_DELAY_MS !== undefined ? Number(env.NOMINATIM_DELAY_MS) : 1100);
        if (Array.isArray(j) && j[0] && j[0].lat) return { lat: Number(j[0].lat), lng: Number(j[0].lon), source: 'osm' };
        return null;
      } catch (e) { return { error: e.message }; }
    });
    return nominatimChain.then((r) => { if (r && r.error) throw new Error(r.error); return r; });
  }

  async function geocode(pin) {
    const p = clean(pin);
    if (p.length !== 6) return null;
    const cached = await geoStore.get(p);
    if (cached) return cached;
    let point = null;
    try {
      point = provider === 'google' ? await geocodeGoogle(p) : await geocodeNominatim(p);
    } catch (e) {
      log.warn && log.warn('Geocoding ' + p + ' failed: ' + e.message);
      return null;
    }
    if (point) await geoStore.set(p, point);
    return point;
  }

  // ------------------------------------------------------------ routing
  async function routeGoogle(origins, dest) {
    // origins: [{pin, lat, lng}], dest: {pin, lat, lng}  ->  Map pin -> km
    const out = new Map();
    for (let i = 0; i < origins.length; i += GOOGLE_MATRIX_MAX) {
      const chunk = origins.slice(i, i + GOOGLE_MATRIX_MAX);
      const body = {
        origins: chunk.map((o) => ({ waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } } })),
        destinations: [{ waypoint: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } } }],
        travelMode: 'DRIVE'
      };
      const j = await getJson('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey, 'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,status,condition' },
        body: JSON.stringify(body)
      });
      const elements = Array.isArray(j) ? j : (j && j.elements) || [];
      for (const el of elements) {
        if (el.condition && el.condition !== 'ROUTE_EXISTS') continue;
        if (typeof el.distanceMeters !== 'number') continue;
        const o = chunk[el.originIndex || 0];
        if (o) out.set(o.pin, round1(el.distanceMeters / 1000));
      }
    }
    return out;
  }

  async function routeOsrm(origins, dest) {
    const out = new Map();
    for (let i = 0; i < origins.length; i += 80) {
      const chunk = origins.slice(i, i + 80);
      const coords = chunk.concat([dest]).map((p) => p.lng + ',' + p.lat).join(';');
      const sources = chunk.map((_, k) => k).join(';');
      const url = osrmUrl + '/table/v1/driving/' + coords + '?annotations=distance&sources=' + sources + '&destinations=' + chunk.length;
      const j = await getJson(url);
      const rows = (j && j.distances) || [];
      rows.forEach((row, k) => { if (row && typeof row[0] === 'number') out.set(chunk[k].pin, round1(row[0] / 1000)); });
    }
    return out;
  }

  async function routeMany(origins, dest) {
    if (!origins.length) return { km: new Map(), method: provider };
    try {
      const km = provider === 'google' ? await routeGoogle(origins, dest) : await routeOsrm(origins, dest);
      return { km, method: provider };
    } catch (e) {
      log.warn && log.warn('Routing failed (' + provider + '): ' + e.message);
      return { km: new Map(), method: provider, error: e.message };
    }
  }

  // ------------------------------------------------------------ public API
  // Distances from each target PIN (case PINs) to each candidate PIN (field officer base PINs), plus between the targets.
  // Returns { distances: { "a|b": { km, m } }, prepared: [targets that were fully handled], unknownPins: [...] }
  async function prepare({ targets = [], candidates = [] }) {
    const T = [...new Set(targets.map(clean).filter((p) => p.length === 6))];
    const C = [...new Set(candidates.map(clean).filter((p) => p.length === 6))];
    const distances = {};
    const unknown = new Set();
    let liveGeocodes = 0;

    const points = new Map();
    for (const pin of [...T, ...C]) {
      if (points.has(pin)) continue;
      let pt = await geoStore.get(pin);
      if (!pt && liveGeocodes < maxLiveGeocodes) { liveGeocodes++; pt = await geocode(pin); }
      if (pt) points.set(pin, pt); else unknown.add(pin);
    }

    const wanted = [];                                  // pairs that need a road distance
    const add = (a, b, straight) => { if (a !== b) wanted.push({ a, b, straight }); };

    for (const t of T) {
      const tp = points.get(t);
      if (!tp) continue;
      for (const c of C) {
        const cp = points.get(c);
        if (!cp) continue;
        const straight = haversineKm(tp, cp);
        if (c === t) { distances[pairKey(t, c)] = { km: 0, m: 'same' }; continue; }
        if (straight <= PREFILTER_KM) add(t, c, straight);
      }
    }
    for (let i = 0; i < T.length; i++) for (let k = i + 1; k < T.length; k++) {
      const a = points.get(T[i]), b = points.get(T[k]);
      if (a && b) add(T[i], T[k], haversineKm(a, b));
    }

    // unique pairs, answer from the permanent cache first
    const uniq = new Map();
    wanted.forEach((w) => { const key = pairKey(w.a, w.b); if (!uniq.has(key)) uniq.set(key, w); });
    const cached = await distStore.getMany([...uniq.keys()]);
    const missing = [];
    for (const [key, w] of uniq) {
      if (cached[key]) distances[key] = cached[key];
      else missing.push([key, w]);
    }

    // group the missing pairs by destination so one request covers many origins
    const byDest = new Map();
    for (const [key, w] of missing) {
      if (!byDest.has(w.b)) byDest.set(w.b, []);
      byDest.get(w.b).push({ key, origin: w.a, straight: w.straight });
    }
    const toStore = {};
    for (const [destPin, list] of byDest) {
      const dest = Object.assign({ pin: destPin }, points.get(destPin));
      const origins = list.map((x) => Object.assign({ pin: x.origin }, points.get(x.origin)));
      const { km, method } = await routeMany(origins, dest);
      for (const x of list) {
        const got = km.get(x.origin);
        if (typeof got === 'number') {
          const rec = { km: got, m: method };
          distances[x.key] = rec; toStore[x.key] = rec;
        } else {
          distances[x.key] = { km: round1(x.straight * ROAD_FACTOR), m: 'estimate' };   // not stored: retried next time
        }
      }
    }
    if (Object.keys(toStore).length) await distStore.setMany(toStore);

    return { distances, prepared: T.filter((t) => points.has(t)), unknownPins: [...unknown], provider };
  }

  // Geocode all given PINs in the background (after a field officer import); never throws.
  async function warm(pins) {
    const list = [...new Set(pins.map(clean).filter((p) => p.length === 6))];
    let done = 0, failed = 0;
    for (const pin of list) {
      try { (await geocode(pin)) ? done++ : failed++; } catch (e) { failed++; }
    }
    return { total: list.length, geocoded: done, failed };
  }

  return { prepare, warm, geocode, provider, pairKey };
}

module.exports = { createDistanceService, haversineKm, pairKey, ROAD_FACTOR, PREFILTER_KM };
