// utils/googleProvider.js
// Google Routes API "computeRouteMatrix" (driving). Billed per origin x destination pair.
const ROUTES_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

function createGoogleProvider({ apiKey, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 8000, log = console }) {
  async function road(destPin, originPins) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(ROUTES_URL, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,condition,status'
        },
        body: JSON.stringify({
          origins: originPins.map((p) => ({ waypoint: { address: `${p}, India` } })),
          destinations: [{ waypoint: { address: `${destPin}, India` } }],
          travelMode: 'DRIVE',
          regionCode: 'IN',
          languageCode: 'en'
        })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        log.error(`Google Routes API error ${res.status}: ${text.slice(0, 200)}`);
        return {};
      }
      const rows = await res.json();
      const out = {};
      for (const el of Array.isArray(rows) ? rows : []) {
        const pin = originPins[el.originIndex];
        if (!pin) continue;
        const failed = el.status && el.status.code && el.status.code !== 0;
        if (failed || el.condition === 'ROUTE_NOT_FOUND') continue;
        out[pin] = { km: Math.round(((el.distanceMeters || 0) / 1000) * 10) / 10, quality: 'road' };   // distanceMeters is omitted when 0
      }
      return out;
    } catch (err) {
      log.error('Google Routes API call failed: ' + (err.name === 'AbortError' ? 'timeout' : err.message));
      return {};
    } finally {
      clearTimeout(timer);
    }
  }
  return { name: 'Google Maps', billable: true, road };
}

module.exports = { createGoogleProvider };
