const test = require('node:test');
const assert = require('node:assert');
const { makeCache } = require('../utils/cache');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('simultaneous requests share one computation', async () => {
  let calls = 0;
  const c = makeCache(async () => { calls++; await sleep(30); return { n: calls }; }, { ttlMs: 1000 });
  const results = await Promise.all([c.get(), c.get(), c.get(), c.get()]);
  assert.strictEqual(calls, 1);
  assert(results.every((r) => r.n === 1));
});

test('a fresh result is reused until it expires', async () => {
  let calls = 0;
  const c = makeCache(async () => ({ n: ++calls }), { ttlMs: 60 });
  await c.get(); await c.get();
  assert.strictEqual(calls, 1);
  await sleep(80);
  assert.strictEqual((await c.get()).n, 2);
});

test('markDirty forces a recompute, but not more often than dirtyMinAgeMs', async () => {
  let calls = 0;
  const c = makeCache(async () => ({ n: ++calls }), { ttlMs: 10000, dirtyMinAgeMs: 80 });
  await c.get();                      // computed at t=0
  c.markDirty();
  const t0 = Date.now();
  const v = await c.get();            // must wait until 80 ms old, then recompute
  assert.strictEqual(v.n, 2);
  assert(Date.now() - t0 >= 60, 'waited for the minimum age');
});

test('a change that happens while computing is not lost', async () => {
  let calls = 0;
  const c = makeCache(async () => { const n = ++calls; await sleep(40); return { n }; }, { ttlMs: 10000, dirtyMinAgeMs: 0 });
  const p = c.get();
  await sleep(10); c.markDirty();     // data changed after the computation started
  const v = await p;
  assert.strictEqual(v.n, 2, 'recomputed once more so the change is included');
});
