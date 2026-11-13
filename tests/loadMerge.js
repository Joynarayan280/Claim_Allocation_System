const test = require('node:test');
const assert = require('node:assert');
const { buildLoad } = require('../utils/loadMerge');

test('system count and uploaded Excel load are added together (auditor)', () => {
  const out = buildLoad({
    aud: [{ _id: 'Dr A', n: 3 }],
    staff: [{ role: 'Auditor', profile: { name: 'Dr A', employeeId: '1', externalLoad: { total: 12, cashless: 0, ri: 0 } } },
            { role: 'Auditor', profile: { name: 'Dr B', employeeId: '2', externalLoad: { total: 5, cashless: 0, ri: 0 } } }]
  });
  assert.strictEqual(out.auditor['Dr A'], 15);
  assert.strictEqual(out.auditor['Dr B'], 5);
});

test('field officer: uploaded cashless / RI split feeds the type limits, total feeds the overall limit', () => {
  const out = buildLoad({
    fo1: [{ _id: 'F1', total: 2, cashless: 1 }],
    fo2: [{ _id: 'F1', total: 1, cashless: 0 }],
    staff: [{ role: 'FieldOfficer', profile: { employeeId: 'F1', name: 'X', externalLoad: { total: 8, cashless: 3, ri: 4 } } }]
  });
  assert.deepStrictEqual(out.fieldOfficer.F1, { total: 11, cashless: 4, other: 6 });   // system: 3 total (1 cashless, 2 other) + upload
});

test('total-only upload counts towards the overall limit but not towards a type limit', () => {
  const out = buildLoad({ staff: [{ role: 'FieldOfficer', profile: { employeeId: 'F9', name: 'Y', externalLoad: { total: 7, cashless: 0, ri: 0 } } }] });
  assert.deepStrictEqual(out.fieldOfficer.F9, { total: 7, cashless: 0, other: 0 });
});

test('people without uploaded load and coordinators are unaffected', () => {
  const out = buildLoad({ coord: [{ _id: 'C', n: 4 }], staff: [{ role: 'Auditor', profile: { name: 'Z', employeeId: '3' } }] });
  assert.strictEqual(out.coordinator.C, 4);
  assert.strictEqual(out.auditor.Z, undefined);
});
