// utils/distanceService.js
// Real ROAD distances between Indian PIN codes, from a pluggable map provider.

const cleanPin = (p) => {
  const d = String(p || '').split('.')[0].replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
  return d.length === 6 ? d : null;
};
const pairKey = (a, b) => [a, b].sort().join('>');

// Sanity check to avoid remembering corrupted metro routes (> 25 km within same metro prefix)
function isPlausibleDistance(p1, p2, km) {
  if (typeof km !== 'number' || km <= 0) return false;
  const pref1 = p1.slice(0, 3);
  const pref2 = p2.slice(0, 3);
  if (pref1 === pref2 && ['500', '700', '110', '400', '560', '600'].includes(pref1)) {
    return km <= 28.0; // Two metro pins in same city circle cannot realistically exceed 28 km
  }
  return true;
}

function createDistanceService({
  provider = null,
  store = null,
  dailyBudget = 20000,
  maxPerRequest = 50,
  now = () => Date.now(),
  log = console
} = {}) {
  const memory = new Map();
  let budgetDay = '';
  let used = 0;
  const enabled = Boolean(provider);

  function budgetLeft() {
    if (!provider || !provider.billable) return Infinity;
    const day = new Date(now()).toISOString().slice(0, 10);
    if (day !== budgetDay) { budgetDay = day; used = 0; }
    return Math.max(0, dailyBudget - used);
  }

  async function distances(destination, origins) {
    const dest = cleanPin(destination);
    const km = {};
    const quality = {};
    let requested = 0;
    const result = () => ({ enabled, provider: provider ? provider.name : null, km, quality, requested });
    if (!dest) return result();

    const wanted = [...new Set((origins || []).map(cleanPin).filter(Boolean))];
    const missing = [];
    
    for (const o of wanted) {
      if (o === dest) { km[o] = 0; quality[o] = 'road'; continue; }
      const key = pairKey(o, dest);
      const v = memory.get(key);
      if (v !== undefined && isPlausibleDistance(o, dest, v)) {
        km[o] = v;
        quality[o] = 'road';
      } else {
        missing.push(o);
      }
    }

    // Check store only if valid and plausible
    if (missing.length && store) {
      try {
        const found = await store.getMany(missing.map((o) => pairKey(o, dest)));
        for (const o of [...missing]) {
          const key = pairKey(o, dest);
          const v = found[key];
          if (typeof v === 'number' && isPlausibleDistance(o, dest, v)) {
            memory.set(key, v);
            km[o] = v;
            quality[o] = 'road';
            missing.splice(missing.indexOf(o), 1);
          }
        }
      } catch (err) {
        log.warn('Distance cache lookup skipped: ' + err.message);
      }
    }

    if (missing.length && provider) {
      const left = budgetLeft();
      const allowed = left === Infinity ? missing : missing.slice(0, left);
      if (allowed.length < missing.length) log.warn(`Daily map budget reached (${dailyBudget} elements). Estimates are used for the rest.`);
      const fresh = [];
      for (let i = 0; i < allowed.length; i += maxPerRequest) {
        const chunk = allowed.slice(i, i + maxPerRequest);
        if (provider.billable) used += chunk.length;
        requested += chunk.length;
        let got = {};
        try {
          got = await provider.road(dest, chunk);
        } catch (err) {
          log.error(`${provider.name} lookup failed: ${err.message}`);
        }
        for (const [pin, v] of Object.entries(got || {})) {
          if (!v || typeof v.km !== 'number') continue;
          
          // Clamp and validate
          let finalKm = v.km;
          const prefD = dest.slice(0, 3);
          const prefP = pin.slice(0, 3);
          if (prefD === prefP && ['500', '700', '110', '400', '560', '600'].includes(prefD)) {
            finalKm = Math.min(finalKm, 20.0);
          }

          km[pin] = finalKm;
          quality[pin] = v.quality || 'road';
          if (quality[pin] === 'road' && isPlausibleDistance(pin, dest, finalKm)) {
            const key = pairKey(pin, dest);
            memory.set(key, finalKm);
            fresh.push({ key, km: finalKm });
          }
        }
      }
      if (fresh.length && store) {
        try { await store.setMany(fresh); } catch (err) { log.warn('Distance cache write skipped: ' + err.message); }
      }
    }

    for (const o of wanted) if (km[o] === undefined) { km[o] = null; }
    return result();
  }

  function warm(pins) {
    if (provider && typeof provider.warm === 'function') provider.warm(pins);
  }

  return { distances, warm, enabled, providerName: provider ? provider.name : null };
}

module.exports = { createDistanceService, cleanPin, pairKey };