// Run with: npm test   (uses Node's built-in test runner, no extra packages)
const test = require('node:test');
const assert = require('node:assert');
const { computeCaseUpdate, applyCaseUpdate } = require('../utils/caseUpdate');

const baseCase = () => ({
  id: 'CLM1', claimNo: 'CLM1', status: 'In Progress',
  approvals: { coordinator: 'Pending', fieldOfficer: 'Pending', auditor: 'Pending' }
});

test('a role can only change its own approval key', () => {
  const r = computeCaseUpdate(baseCase(), 'Auditor', { approvals: { coordinator: 'Approved', fieldOfficer: 'Approved', auditor: 'Approved' } });
  assert.deepStrictEqual(Object.keys(r.set).sort(), ['approvals.auditor']);
});

test('stale copy cannot roll an approval back to Pending', () => {
  const doc = baseCase(); doc.approvals.coordinator = 'Approved';
  const r = computeCaseUpdate(doc, 'Coordinator', { approvals: { coordinator: 'Pending' } });
  assert.strictEqual(r.changed, false);
});

test('case settles only when coordinator, field officer (or Bypassed) and auditor all approve', () => {
  const doc = baseCase(); doc.approvals = { coordinator: 'Approved', fieldOfficer: 'Bypassed', auditor: 'Pending' };
  const r = computeCaseUpdate(doc, 'Auditor', { approvals: { auditor: 'Approved' } });
  assert.strictEqual(r.set.status, 'Approved');
  assert.strictEqual(r.set.referenceId, 'REF-SETTLE-CLM1');
  assert(r.set.settledAt);
});

test('client supplied status / referenceId are ignored', () => {
  const r = computeCaseUpdate(baseCase(), 'FieldOfficer', { status: 'Approved', referenceId: 'HACK', approvals: { fieldOfficer: 'Approved' } });
  assert.strictEqual(r.set.status, undefined);
  assert.strictEqual(r.set.referenceId, undefined);
});

test('rejections produce the right disputed status, and re-approval clears it', () => {
  let r = computeCaseUpdate(baseCase(), 'Auditor', { approvals: { auditor: 'Rejected' }, auditorRejectionReason: 'Tariff mismatch' });
  assert.strictEqual(r.set.status, 'Disputed / Auditor Objection');
  assert.strictEqual(r.set.auditorRejectionReason, 'Tariff mismatch');
  const doc = baseCase(); doc.status = 'Disputed / Auditor Objection'; doc.approvals.auditor = 'Rejected';
  r = computeCaseUpdate(doc, 'Auditor', { approvals: { auditor: 'Approved' } });
  assert.strictEqual(r.set.status, 'In Progress');
});

test('spot verification flags can be switched on but never off by a stale copy', () => {
  const doc = baseCase(); doc.foSpot1Verified = true;
  const r = computeCaseUpdate(doc, 'FieldOfficer', { foSpot1Verified: false, foSpot2Verified: true });
  assert.strictEqual(r.set.foSpot1Verified, undefined);
  assert.strictEqual(r.set.foSpot2Verified, true);
});

test('other roles cannot touch field officer data or assignment fields', () => {
  const r = computeCaseUpdate(baseCase(), 'Coordinator', { foSpot1Verified: true, foDistanceKm: 99, auditorId: 'X', fieldOfficerId: 'Y' });
  assert.strictEqual(r.changed, false);
});

// ---- concurrency: two people approve at the same moment on stale copies ----
function fakeModel(initial) {
  let doc = JSON.parse(JSON.stringify(initial));
  let hook = null;
  return {
    onFirstRead(fn) { hook = fn; },
    findOne() { const snap = JSON.parse(JSON.stringify(doc)); const p = Promise.resolve(snap); p.lean = () => Promise.resolve(snap); return { lean: async () => { const s = JSON.parse(JSON.stringify(doc)); if (hook) { const h = hook; hook = null; await h(); } return s; } }; },
    findOneAndUpdate(filter, update) {
      const ok = filter.rev && filter.rev.$exists === false ? doc.rev === undefined : filter.rev === doc.rev;
      return { lean: async () => {
        if (!ok) return null;
        for (const [k, v] of Object.entries(update.$set)) {
          if (k.startsWith('approvals.')) { doc.approvals = doc.approvals || {}; doc.approvals[k.split('.')[1]] = v; } else doc[k] = v;
        }
        doc.rev = (doc.rev || 0) + update.$inc.rev;
        return JSON.parse(JSON.stringify(doc));
      } };
    },
    get doc() { return doc; }
  };
}

test('simultaneous approvals by auditor and coordinator are both kept (no lost update)', async () => {
  const M = fakeModel(Object.assign(baseCase(), { approvals: { coordinator: 'Pending', fieldOfficer: 'Bypassed', auditor: 'Pending' } }));
  // while the auditor's request has read the case but not yet written, the coordinator's request completes
  M.onFirstRead(async () => { await applyCaseUpdate(M, { id: 'CLM1' }, 'Coordinator', { approvals: { coordinator: 'Approved' } }); });
  await applyCaseUpdate(M, { id: 'CLM1' }, 'Auditor', { approvals: { coordinator: 'Pending', auditor: 'Approved' } });
  assert.strictEqual(M.doc.approvals.coordinator, 'Approved');
  assert.strictEqual(M.doc.approvals.auditor, 'Approved');
  assert.strictEqual(M.doc.status, 'Approved');
});

test('unknown case returns notFound', async () => {
  const M = { findOne: () => ({ lean: async () => null }) };
  const r = await applyCaseUpdate(M, { id: 'NOPE' }, 'Admin', {});
  assert.strictEqual(r.notFound, true);
});
