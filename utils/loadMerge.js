// utils/loadMerge.js
// Combines the workload counted from cases inside this system with the load the Admin uploaded from Excel
// (cases a person already carries that are NOT entered in this system). Pure function, unit tested.
//
//   aud, coord : [{ _id: name, n }]                       open cases per auditor / coordinator name
//   fo1, fo2   : [{ _id: employeeId, total, cashless }]   open physical cases per field officer (primary / second spot)
//   staff      : [{ role, profile: { employeeId, name, externalLoad: { total, cashless, ri } } }]
//
// Returns { auditor: {name: n}, coordinator: {name: n}, fieldOfficer: {employeeId: {total, cashless, other}} }

function buildLoad({ aud = [], coord = [], fo1 = [], fo2 = [], staff = [] }) {
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const auditor = toMap(aud);
  const coordinator = toMap(coord);

  const fieldOfficer = {};
  for (const r of fo1.concat(fo2)) {
    const cur = fieldOfficer[r._id] || { total: 0, cashless: 0, other: 0 };
    cur.total += r.total;
    cur.cashless += r.cashless;
    cur.other = cur.total - cur.cashless;
    fieldOfficer[r._id] = cur;
  }

  for (const u of staff) {
    const ext = u && u.profile && u.profile.externalLoad;
    if (!ext || !(ext.total > 0)) continue;
    if (u.role === 'Auditor') {
      auditor[u.profile.name] = (auditor[u.profile.name] || 0) + ext.total;
    } else if (u.role === 'FieldOfficer') {
      const id = String(u.profile.employeeId);
      const cur = fieldOfficer[id] || { total: 0, cashless: 0, other: 0 };
      cur.total += ext.total;                  // everything counts towards the overall limit
      cur.cashless += ext.cashless || 0;       // known split counts towards the Cashless / RI limits
      cur.other += ext.ri || 0;
      fieldOfficer[id] = cur;
    }
  }
  return { auditor, coordinator, fieldOfficer };
}

module.exports = { buildLoad };
