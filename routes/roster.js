// routes/roster.js
// Handles Coordinator / Auditor / Field Officer master roster imports, password resets, and real-time synchronization.

const express = require('express');
const User = require('../models/User');
const { hashPassword, randomPassword, requireAuth } = require('../utils/auth');

const router = express.Router();

const ROLE_KEY = { Coordinator: 'coords', FieldOfficer: 'fieldOfficers', Auditor: 'auditors' };
const MAX_ROWS = 5000;

// ---------- Helper Functions ----------
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const list = (v) => (Array.isArray(v) ? v : str(v).split(/[,;|]/)).map((x) => str(x)).filter(Boolean);
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
const bool = (v, d = true) => {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  if (!s) return d;
  return ['yes', 'y', 'true', '1', 'active', 'present'].includes(s);
};

// Cases a person already carries that are NOT in this system yet (taken from the client's Excel).
// Headers accepted: currentLoad / TotalActiveLoad / OnHandLoad / Active Load, currentCashless, currentRI.
function pickFirst(r, names) {
  for (const n of names) if (r[n] !== undefined && r[n] !== null && String(r[n]).trim() !== '') return r[n];
  return undefined;
}
function externalLoadFrom(r) {
  const total = pickFirst(r, ['currentLoad', 'TotalActiveLoad', 'Total Active Load', 'OnHandLoad', 'On Hand Load', 'Active Load', 'Current Load']);
  const cl = pickFirst(r, ['currentCashless', 'Current Cashless', 'CashlessLoad', 'Cashless Load']);
  const ri = pickFirst(r, ['currentRI', 'Current RI', 'RILoad', 'RI Load']);
  if (total === undefined && cl === undefined && ri === undefined) return undefined;
  const c = int(cl, 0), i = int(ri, 0);
  return { total: Math.max(int(total, 0), c + i), cashless: c, ri: i };
}

const DEFAULT_SCHEDULE = { Mon: 'Both', Tue: 'Both', Wed: 'Both', Thu: 'Both', Fri: 'Both', Sat: 'Both' };

// Excel row -> portal expected profile object
function normalize(role, r, idx) {
  const employeeId = str(r.employeeId || r['EMPLOYEE ID'] || r['Employee ID'] || r.empId);
  const name = str(r.name || r['Full Name'] || r['Name'] || r.fullName);
  if (!employeeId) throw new Error(`Row ${idx + 2}: Missing employeeId`);
  if (!name) throw new Error(`Row ${idx + 2} (${employeeId}): Missing name`);

  if (role === 'Coordinator') {
    const states = list(r.states || r['State'] || r['States'] || r.state);
    return {
      id: str(r.id) || `COORD-${employeeId}`,
      employeeId,
      name,
      role: 'Coordinator',
      zone: str(r.zone || r['Zone']) || (states.length ? 'Multi-State' : ''),
      designation: str(r.designation || r['Designation']) || 'Coordinator',
      digitalZone: ['south', 'north'].includes(str(r.digitalZone || r['Digital Zone']).toLowerCase())
        ? (str(r.digitalZone || r['Digital Zone']).toLowerCase() === 'south' ? 'South' : 'North')
        : '',
      states,
      languages: list(r.languages || r['Languages']),
      // Types of case this coordinator handles (Cashless, Reimbursement, Digital). Blank = all types.
      caseTypes: list(r.caseTypes || r['CaseTypes'] || r['Case Types'] || r['Case Type']),
      email: str(r.email || r['Email']),
      phone: str(r.phone || r['Phone']),
      maxCapacity: int(r.maxCapacity || r['Max Capacity'], 4),
      isActive: bool(r.isActive !== undefined ? r.isActive : r['Active']),
      isApprovedByAdmin: true
    };
  }

  if (role === 'FieldOfficer') {
    // Explicit mapping to handle PIN Code, basePin, Base PIN, or PIN headers from Excel
    const rawPin = r.basePin || r['PIN Code'] || r['pin code'] || r['PIN'] || r.pin || r['Base PIN'] || '';
    const basePin = str(rawPin).replace(/\D/g, '').slice(0, 6);

    // Read employment type from Employee_Type or employmentType
    const empType = str(r.employmentType || r['Employee_Type'] || r['employee_type'] || r['Employee Type']) || 'Off-Roll';

    return {
      employeeId,
      name,
      role: 'FieldOfficer',
      employmentType: empType,
      grade: str(r.grade || r['Grade']) || 'C',
      basePin: basePin || '',
      state: str(r.state || r['State']),
      district: str(r.district || r['District']),
      phone: str(r.phone || r['Phone']),
      email: str(r.email || r['Email']),
      maxDailyVisits: int(r.maxDailyVisits || r['Daily Visits'], 5),
      maxCashless: int(r.maxCashless || r['Max Cashless'], 3),
      maxRI: int(r.maxRI || r['Max RI'], 2),
      ...(externalLoadFrom(r) ? { externalLoad: externalLoadFrom(r) } : {}),
      isActive: bool(r.isActive !== undefined ? r.isActive : r['Active'])
    };
  }

  // Auditor profile
  const specialization = list(r.specialization || r['Specialization']);
  const spLow = specialization.join(' ').toLowerCase();
  // CaseTypes: does the auditor handle Cashless, Reimbursement (RI / PA) or both? Blank means both.
  const caseTypes = list(r.caseTypes || r['CaseTypes'] || r['Case Types'] || r['Case Type']);
  const ctLow = caseTypes.map((x) => x.toLowerCase()).concat(spLow);
  const hasCL = ctLow.some((x) => /cashless|^cl$/.test(x));
  const hasRI = ctLow.some((x) => /reimb|^ri$|^pa$|\bpa\b|\bri\b/.test(x));
  const neitherType = !hasCL && !hasRI;
  return {
    employeeId,
    name,
    role: 'Auditor',
    employmentType: str(r.employmentType || r['Employee_Type'] || r['Employment Type']) || 'Off-Roll (FL)',
    languages: list(r.languages || r['Languages']),
    clients: list(r.clients || r['Clients']).length ? list(r.clients || r['Clients']) : ['Universal'],
    specialization,
    isDigital: spLow.includes('digital') || spLow.includes('vi'),
    isPhysical: spLow.includes('physical'),
    caseTypes,
    doesCashless: neitherType ? true : hasCL,
    doesRI: neitherType ? true : hasRI,
    monthlyCapacity: int(r.monthlyCapacity || r['Monthly Capacity'], 30),
    dailyCapacity: int(r.dailyCapacity || r['Daily Capacity'], 1),
    phone: str(r.phone || r['Phone']),
    email: str(r.email || r['Email']),
    isActive: bool(r.isActive !== undefined ? r.isActive : r['Active']),
    leaveDays: int(r.leaveDays || r['Leave Days'], 0),
    ...(externalLoadFrom(r) ? { externalLoad: externalLoadFrom(r) } : {}),
    schedule: { ...DEFAULT_SCHEDULE }
  };
}

// ---------- GET /api/roster ----------
router.get('/roster', requireAuth(), async (req, res) => {
  try {
    const filter = { role: { $in: Object.keys(ROLE_KEY) } };
    if (req.user.role === 'FieldOfficer' || req.user.role === 'Auditor') {
      filter.employeeId = req.user.employeeId;
      filter.role = req.user.role;
    }
    const users = await User.find(filter, 'role profile').lean();
    const out = { coords: [], fieldOfficers: [], auditors: [] };
    for (const u of users) {
      if (out[ROLE_KEY[u.role]] && u.profile) {
        out[ROLE_KEY[u.role]].push(u.profile);
      }
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'Server error retrieving roster' });
  }
});

// ---------- POST /api/admin/roster/import ----------
router.post('/admin/roster/import', requireAuth('Admin'), async (req, res) => {
  try {
    const { role, mode, rows } = req.body || {};
    if (!ROLE_KEY[role]) return res.status(400).json({ error: 'Invalid role specified' });
    if (!['replace', 'merge'].includes(mode)) return res.status(400).json({ error: 'Mode must be "replace" or "merge"' });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No data rows provided in upload.' });
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Maximum allowable rows exceeded (${MAX_ROWS})` });

    // 1) Validate and normalize each row
    const profiles = [];
    const seen = new Set();
    const problems = [];
    rows.forEach((r, i) => {
      try {
        const p = normalize(role, r || {}, i);
        const key = p.employeeId.toUpperCase();
        if (seen.has(key)) throw new Error(`Row ${i + 2}: Duplicate employee ID ${p.employeeId} in uploaded sheet`);
        seen.add(key);
        profiles.push(p);
      } catch (e) {
        problems.push(e.message);
      }
    });
    if (problems.length) {
      return res.status(400).json({
        error: 'Validation errors encountered in Excel dataset',
        problems: problems.slice(0, 50),
        totalProblems: problems.length
      });
    }

    // 2) Identify existing records for this specific role (Enables multi-role support)
    const ids = profiles.map((p) => p.employeeId.toUpperCase());
    const existing = await User.find({ employeeId: { $in: ids }, role }, 'employeeId role profile.externalLoad profile.externalLoadUpdatedAt').lean();
    const existingSet = new Set(existing.map((u) => u.employeeId));
    const existingLoad = new Map(existing.map((u) => [u.employeeId, u.profile || {}]));
    const nowIso = new Date().toISOString();

    // 3) Construct bulk operations
    const credentials = [];
    const ops = profiles.map((p) => {
      const empKey = p.employeeId.toUpperCase();
      if (p.externalLoad) p.externalLoadUpdatedAt = nowIso;
      else if (existingLoad.get(empKey) && existingLoad.get(empKey).externalLoad) {
        p.externalLoad = existingLoad.get(empKey).externalLoad;                      // sheet has no load column: keep the stored load
        p.externalLoadUpdatedAt = existingLoad.get(empKey).externalLoadUpdatedAt;
      }
      if (existingSet.has(empKey)) {
        return {
          updateOne: {
            filter: { employeeId: empKey, role },
            update: { $set: { name: p.name, profile: p, isActive: p.isActive !== false } }
          }
        };
      }
      const temp = randomPassword();
      credentials.push({ employeeId: p.employeeId, name: p.name, role, tempPassword: temp });
      return {
        insertOne: {
          document: {
            employeeId: empKey,
            role,
            name: p.name,
            passwordHash: hashPassword(temp),
            mustChangePassword: true,
            isActive: p.isActive !== false,
            profile: p
          }
        }
      };
    });

    let removed = 0;
    if (mode === 'replace') {
      const del = await User.deleteMany({ role, employeeId: { $nin: ids } });
      removed = del.deletedCount || 0;
    }

    if (ops.length > 0) {
      await User.bulkWrite(ops, { ordered: false });
    }

    req.app.get('io')?.emit('members_updated');
    if (role === 'FieldOfficer') req.app.get('onRosterChanged')?.();   // geocode the new base PINs in the background

    const warnings = [];
    if (role === 'FieldOfficer') {
      const noPin = profiles.filter((p) => !p.basePin).map((p) => p.name);
      if (noPin.length) warnings.push(`${noPin.length} field officer(s) have no base PIN (the default 700001 will be used): ${noPin.slice(0, 8).join(', ')}${noPin.length > 8 ? ' ...' : ''}`);
    }
    if (role === 'Coordinator') {
      const noRoute = profiles.filter((p) => !p.states.length && !p.digitalZone).map((p) => p.name);
      if (noRoute.length) warnings.push(`${noRoute.length} coordinator(s) have neither States nor a Digital Zone, so no case will be routed to them automatically: ${noRoute.join(', ')}`);
      if (!profiles.some((p) => p.states.length)) warnings.push('No coordinator has any States filled in: all physical cases will fall back to the first active coordinator.');
    }

    res.json({
      ok: true,
      role,
      mode,
      warnings,
      total: profiles.length,
      created: credentials.length,
      updated: profiles.length - credentials.length,
      removed,
      credentials
    });
  } catch (err) {
    console.error('Roster import error:', err.message);
    res.status(500).json({ error: 'Import operation failed: ' + err.message });
  }
});

// ---------- POST /api/admin/roster/load ----------
// Updates ONLY the "current load" (cases a person already carries outside this system) for Field Officers or Auditors.
// body: { role: 'FieldOfficer' | 'Auditor', zeroMissing: boolean, rows: [{ employeeId, currentLoad, currentCashless, currentRI }] }
router.post('/admin/roster/load', requireAuth('Admin'), async (req, res) => {
  try {
    const { role, rows, zeroMissing } = req.body || {};
    if (role !== 'FieldOfficer' && role !== 'Auditor') return res.status(400).json({ error: 'Role must be FieldOfficer or Auditor' });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No data rows provided in upload.' });
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Maximum allowable rows exceeded (${MAX_ROWS})` });

    const problems = [];
    const loads = new Map();
    rows.forEach((row, i) => {
      const id = str(row.employeeId || row['EmployeeId'] || row['Employee ID']).toUpperCase();
      if (!id) { problems.push(`Row ${i + 2}: Missing employeeId`); return; }
      const ext = externalLoadFrom(row);
      if (!ext) { problems.push(`Row ${i + 2} (${id}): no load column found (use currentLoad / TotalActiveLoad / OnHandLoad)`); return; }
      if (ext.total > 999) { problems.push(`Row ${i + 2} (${id}): load ${ext.total} looks wrong`); return; }
      if (loads.has(id)) { problems.push(`Row ${i + 2}: Duplicate employee ID ${id}`); return; }
      loads.set(id, ext);
    });
    if (problems.length) return res.status(400).json({ error: 'Validation errors encountered in Excel dataset', problems: problems.slice(0, 50), totalProblems: problems.length });

    const ids = [...loads.keys()];
    const found = await User.find({ employeeId: { $in: ids }, role }, 'employeeId').lean();
    const foundSet = new Set(found.map((u) => u.employeeId));
    const now = new Date().toISOString();

    const ops = ids.filter((id) => foundSet.has(id)).map((id) => ({
      updateOne: { filter: { employeeId: id, role }, update: { $set: { 'profile.externalLoad': loads.get(id), 'profile.externalLoadUpdatedAt': now } } }
    }));
    if (ops.length) await User.bulkWrite(ops, { ordered: false });

    let zeroed = 0;
    if (zeroMissing) {
      const z = await User.updateMany(
        { role, employeeId: { $nin: ids } },
        { $set: { 'profile.externalLoad': { total: 0, cashless: 0, ri: 0 }, 'profile.externalLoadUpdatedAt': now } }
      );
      zeroed = z.modifiedCount || 0;
    }

    req.app.get('io')?.emit('members_updated');
    res.json({
      ok: true, role,
      updated: ops.length,
      notFound: ids.filter((id) => !foundSet.has(id)),
      zeroed,
      totalLoad: [...loads.entries()].filter(([id]) => foundSet.has(id)).reduce((a, [, v]) => a + v.total, 0)
    });
  } catch (err) {
    console.error('Load update error:', err.message);
    res.status(500).json({ error: 'Load update failed: ' + err.message });
  }
});

// ---------- Password reset (Admin) ----------
router.post('/admin/users/:employeeId/reset-password', requireAuth('Admin'), async (req, res) => {
  try {
    const query = { employeeId: String(req.params.employeeId).toUpperCase() };
    if (req.body && req.body.role) query.role = String(req.body.role);
    const matches = await User.find(query);
    if (!matches.length) return res.status(404).json({ error: 'Target user could not be located' });
    if (matches.length > 1) {
      return res.status(400).json({ error: 'This employee ID exists in several roles. Specify which role to reset.', roles: matches.map((u) => u.role) });
    }
    const user = matches[0];
    const temp = randomPassword();
    user.passwordHash = hashPassword(temp);
    user.mustChangePassword = true;
    await user.save();
    res.json({ ok: true, employeeId: user.employeeId, name: user.name, role: user.role, tempPassword: temp });
  } catch (err) {
    res.status(500).json({ error: 'Password reset procedure failed' });
  }
});

// ---------- Member sync (leave, capacity, duty status) ----------
const SYNC_BLOCKED = new Set(['employeeId', 'role', 'passwordHash', 'password', 'externalLoad', 'externalLoadUpdatedAt']);
const SELF_ALLOWED = new Set(['isActive', 'isPresent', 'leaveDays']);

router.post('/members/sync', requireAuth(), async (req, res) => {
  try {
    const { employeeId, role, data } = req.body || {};
    if (!employeeId || typeof data !== 'object' || !data) {
      return res.status(400).json({ error: 'Target employeeId and data payload are required.' });
    }
    const target = String(employeeId).toUpperCase();
    const isManager = req.user.role === 'Admin' || req.user.role === 'Coordinator';
    if (!isManager && (target !== req.user.employeeId || (role && role !== req.user.role))) {
      return res.status(403).json({ error: 'Unauthorized profile update attempt' });
    }

    const query = { employeeId: target };
    if (!isManager) query.role = req.user.role;      // staff may only edit their own role's profile
    else if (role) query.role = role;

    const user = await User.findOne(query);
    if (!user || user.role === 'Admin') return res.status(404).json({ error: 'Record not found' });

    const next = { ...(user.profile || {}) };
    for (const [k, v] of Object.entries(data)) {
      if (SYNC_BLOCKED.has(k)) continue;
      if (!isManager && !SELF_ALLOWED.has(k)) continue;
      next[k] = v;
    }
    user.profile = next;
    user.markModified('profile');
    await user.save();

    req.app.get('io')?.emit('members_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Profile synchronization failed' });
  }
});

module.exports = router;