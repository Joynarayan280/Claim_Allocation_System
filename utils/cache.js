// utils/cache.js
// Tiny "compute once, share with everybody" cache used for the expensive dashboard numbers (workload, statistics).
//  - many simultaneous requests share ONE database computation (single flight)
//  - a result is reused for `ttlMs`
//  - markDirty() says "the data changed": the next request recomputes, but never more often than every
//    `dirtyMinAgeMs` (it waits that long if needed), so a burst of new cases cannot flood the database.

function makeCache(compute, { ttlMs = 5000, dirtyMinAgeMs = 0 } = {}) {
  let value = null;
  let at = 0;
  let dirty = false;
  let seq = 0;
  let inflight = null;

  function refresh() {
    if (!inflight) {
      const startSeq = seq;
      inflight = compute()
        .then((v) => {
          value = v;
          at = Date.now();
          if (seq === startSeq) dirty = false;   // changed while computing: still dirty
          return v;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  async function get() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const age = Date.now() - at;
      if (value && !dirty && age < ttlMs) return value;
      if (value && dirty && age < dirtyMinAgeMs) await new Promise((r) => setTimeout(r, dirtyMinAgeMs - age));
      await refresh();
      if (!dirty) break;
    }
    return value;
  }

  return { get, markDirty() { dirty = true; seq++; } };
}

module.exports = { makeCache };
