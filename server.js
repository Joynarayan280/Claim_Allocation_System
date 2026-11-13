// server.js
// Core application gateway: authentication guards, role scopes, socket notifications, and REST endpoints.

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('./config/db');

const Case = require('./models/Case');
const User = require('./models/User');
const { requireAuth, verifyToken, COOKIE_NAME } = require('./utils/auth');
const { ensureAdmin } = require('./utils/bootstrapAdmin');
const { applyCaseUpdate } = require('./utils/caseUpdate');
const { ensureIndexes } = require('./utils/ensureIndexes');
const { buildLoad } = require('./utils/loadMerge');
const { makeCache } = require('./utils/cache');
const { createDistanceService } = require('./utils/distanceService');
const PinDistance = require('./models/PinDistance');
const PinGeo = require('./models/PinGeo');
const { createGoogleProvider } = require('./utils/googleProvider');
const { createOsmProvider } = require('./utils/osmProvider');
const Rules = require('./public/allocation-rules.js'); // Shared allocation rules
const authRoutes = require('./routes/auth');
const rosterRoutes = require('./routes/roster');

const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);

const publicDir = path.join(__dirname, 'public');

// Reverse proxy real IP and protocol recognition
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.disable('x-powered-by');

// CORS configuration supporting dynamic domains
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : (IS_PROD ? false : true);

const io = new Server(server, { cors: { origin: corsOrigin, credentials: true } });
app.set('io', io);

// Socket connection authentication guard
io.use((socket, next) => {
  const raw = socket.handshake.headers.cookie || '';
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE_NAME + '='));
  const data = m ? verifyToken(decodeURIComponent(m.slice(COOKIE_NAME.length + 1))) : null;
  if (!data || data.mcp) return next(new Error('unauthorized'));
  socket.data.user = data;
  next();
});

// Throttled notification broadcaster to prevent socket flooding
let notifyTimer = null;
function notifyCasesUpdated() {
  loadCache.markDirty();
  statsCache.markDirty();
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => { notifyTimer = null; io.emit('cases_updated'); }, 1000);
}

// Basic security response headers
app.use((req, res, next) => {
  res.setHeader('X-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use('/api/admin/roster/import', express.json({ limit: '10mb' }));
app.use(express.json({ limit: '1mb' }));

// Helper to check user session from cookie
function getSessionUser(req) {
  const cookie = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE_NAME + '='));
  return cookie ? verifyToken(decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1))) : null;
}

// Clean root URL handler
app.get('/', (req, res) => {
  const data = getSessionUser(req);
  if (!data || data.mcp) {
    return res.sendFile(path.join(publicDir, 'login.html'));
  }
  if (data.role === 'Admin' || data.role === 'Coordinator') {
    return res.sendFile(path.join(publicDir, 'user-dashboard.html'));
  }
  if (data.role === 'Auditor') {
    return res.sendFile(path.join(publicDir, 'auditor.html'));
  }
  if (data.role === 'FieldOfficer') {
    return res.sendFile(path.join(publicDir, 'field-officer.html'));
  }
  res.sendFile(path.join(publicDir, 'login.html'));
});

// Portal page access guards
const PAGE_ROLES = {
  '/admin.html': ['Admin'],
  '/admin': ['Admin'],
  '/coordinator.html': ['Admin', 'Coordinator'],
  '/coordinator': ['Admin', 'Coordinator'],
  '/auditor.html': ['Admin', 'Auditor'],
  '/auditor': ['Admin', 'Auditor'],
  '/field-officer.html': ['Admin', 'FieldOfficer'],
  '/field-officer': ['Admin', 'FieldOfficer'],
  '/user-dashboard.html': ['Admin', 'Coordinator'],
  '/user-dashboard': ['Admin', 'Coordinator'],
  '/dashboard': ['Admin', 'Coordinator']
};

app.use((req, res, next) => {
  const roles = PAGE_ROLES[req.path];
  if (!roles) return next();
  const data = getSessionUser(req);
  if (!data) return res.redirect('/login.html');
  if (data.mcp) return res.redirect('/change-password.html');
  if (!roles.includes(data.role)) return res.redirect(authRoutes.HOME[data.role] || '/login.html');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Clean vanity URL support without .html extension
app.get('/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'user-dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/coordinator', (req, res) => res.sendFile(path.join(publicDir, 'coordinator.html')));
app.get('/auditor', (req, res) => res.sendFile(path.join(publicDir, 'auditor.html')));
app.get('/field-officer', (req, res) => res.sendFile(path.join(publicDir, 'field-officer.html')));

// Serve static assets from public directory
app.use(express.static(publicDir, { maxAge: IS_PROD ? '1h' : 0, index: false }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api', rosterRoutes);

// Role-based visibility filter for cases
function caseScope(user) {
  if (user.role === 'Admin') return {};
  const empId = user.pid || user.employeeId;
  if (user.role === 'Coordinator') {
    return { $or: [{ coordinatorId: empId }, { 'createdBy.id': empId }] };
  }
  if (user.role === 'FieldOfficer') {
    return { $or: [{ fieldOfficerId: empId }, { fieldOfficer2Id: empId }] };
  }
  if (user.role === 'Auditor') {
    return { auditorId: empId };
  }
  return { _id: null };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const OPEN_STATUSES = ['In Progress', 'Pending', 'Disputed / Coordinator Discrepancy', 'Disputed / Auditor Objection'];
const PAGE_MAX = 500;
const OPEN_CAP = 5000;
const ADMIN_OPEN_CAP = 2000;
const RECENT_CLOSED = 300;

// GET /api/cases - List open and settled cases based on role scope
app.get('/api/cases', requireAuth(), async (req, res) => {
  try {
    const scope = caseScope(req.user);
    const paged = ['page', 'limit', 'status', 'q'].some((k) => req.query[k] !== undefined);

    if (paged) {
      const filter = { ...scope };
      if (req.query.status) filter.status = String(req.query.status);
      if (req.query.q) {
        const q = escapeRe(String(req.query.q).trim().slice(0, 60));
        const search = { $or: [{ claimNo: { $regex: '^' + q, $options: 'i' } }, { id: { $regex: '^' + q, $options: 'i' } }] };
        filter.$and = [...(filter.$and || []), search];
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), PAGE_MAX);
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

      const [cases, total] = await Promise.all([
        Case.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Case.countDocuments(filter)
      ]);
      res.setHeader('X-Total-Count', String(total));
      res.setHeader('X-Total-Pages', String(Math.ceil(total / limit)));
      return res.json(cases);
    }

    const cap = req.user.role === 'Admin' ? ADMIN_OPEN_CAP : OPEN_CAP;
    const [open, closed] = await Promise.all([
      Case.find({ ...scope, status: { $in: OPEN_STATUSES } }).sort({ createdAt: -1 }).limit(cap).lean(),
      Case.find({ ...scope, status: 'Approved' }).sort({ createdAt: -1 }).limit(RECENT_CLOSED).lean()
    ]);
    const openTotal = open.length < cap ? open.length : await Case.countDocuments({ ...scope, status: { $in: OPEN_STATUSES } });
    const all = open.concat(closed).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.setHeader('X-Open-Total', String(openTotal));
    res.setHeader('X-Total-Count', String(openTotal + closed.length));
    res.setHeader('X-Truncated', openTotal > open.length ? '1' : '0');
    res.json(all);
  } catch (err) {
    console.error('GET /api/cases error:', err.message);
    res.status(500).json({ error: 'Server error retrieving cases' });
  }
});

// Aggregate workload calculation
async function computeLoad() {
  const nameLoad = (nameField, approvalKey) => Case.aggregate([
    { $match: { status: { $in: OPEN_STATUSES }, ['approvals.' + approvalKey]: 'Pending', [nameField]: { $type: 'string' } } },
    { $group: { _id: '$' + nameField, n: { $sum: 1 } } }
  ]);
  const foLoad = (idField) => Case.aggregate([
    { $match: { status: { $in: ['In Progress', 'Pending'] }, 'approvals.fieldOfficer': 'Pending', caseType: { $ne: 'Digital' }, [idField]: { $type: 'string' } } },
    { $group: {
      _id: '$' + idField,
      total: { $sum: 1 },
      cashless: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$caseType', ''] }, regex: 'cashless', options: 'i' } }, 1, 0] } }
    } }
  ]);

  const [aud, coord, fo1, fo2, staff] = await Promise.all([
    nameLoad('auditorName', 'auditor'),
    nameLoad('coordinatorName', 'coordinator'),
    foLoad('fieldOfficerId'),
    foLoad('fieldOfficer2Id'),
    User.find({ role: { $in: ['Auditor', 'FieldOfficer'] } }, 'role profile.employeeId profile.name profile.externalLoad').lean()
  ]);
  return { ...buildLoad({ aud, coord, fo1, fo2, staff }), asOf: new Date().toISOString() };
}

async function computeStats() {
  const rows = await Case.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  return {
    total: rows.reduce((a, r) => a + r.n, 0),
    byStatus: Object.fromEntries(rows.map((r) => [r._id || 'Unknown', r.n]))
  };
}

const loadCache = makeCache(computeLoad, { ttlMs: 5000, dirtyMinAgeMs: 700 });
const statsCache = makeCache(computeStats, { ttlMs: 10000 });

// Distance calculation service configuration
const mapsChoice = String(process.env.MAPS_PROVIDER || '').toLowerCase() || (process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'osm');
let mapProvider = null;
if (mapsChoice === 'google' && process.env.GOOGLE_MAPS_API_KEY) {
  mapProvider = createGoogleProvider({ apiKey: process.env.GOOGLE_MAPS_API_KEY });
} else if (mapsChoice === 'osm' || mapsChoice === 'google') {
  mapProvider = createOsmProvider({
    osrmUrl: process.env.OSRM_URL || undefined,
    geocoderUrl: process.env.GEOCODER_URL || undefined,
    geocoderKey: process.env.GEOCODER_KEY || '',
    contact: process.env.MAPS_CONTACT || process.env.ADMIN_EMAIL || 'admin@example.com',
    minGapMs: Number(process.env.GEOCODER_MIN_GAP_MS) || undefined,
    geoStore: {
      async getMany(pins) {
        const rows = await PinGeo.find({ pin: { $in: pins } }).lean();
        return Object.fromEntries(rows.map((r) => [r.pin, r.miss ? { miss: true, at: r.at } : { lat: r.lat, lon: r.lon }]));
      },
      async setMany(rows) {
        await PinGeo.bulkWrite(rows.map((r) => ({
          updateOne: { filter: { pin: r.pin }, update: { $set: { lat: r.lat, lon: r.lon, miss: !!r.miss, at: new Date() } }, upsert: true }
        })), { ordered: false });
      }
    }
  });
}
console.log('Road distance provider:', mapProvider ? mapProvider.name : 'off (PIN-based estimates only)');

const distanceService = createDistanceService({
  provider: mapProvider,
  dailyBudget: Number(process.env.MAPS_DAILY_ELEMENT_BUDGET) || 20000,
  store: {
    async getMany(keys) {
      const rows = await PinDistance.find({ key: { $in: keys } }).lean();
      return Object.fromEntries(rows.map((r) => [r.key, r.km]));
    },
    async setMany(entries) {
      await PinDistance.bulkWrite(entries.map((e) => ({
        updateOne: { filter: { key: e.key }, update: { $set: { km: e.km, at: new Date() } }, upsert: true }
      })), { ordered: false });
    }
  }
});

async function warmOfficerPins() {
  try {
    const officers = await User.find({ role: 'FieldOfficer' }, 'profile.basePin').lean();
    distanceService.warm(officers.map((o) => o.profile && o.profile.basePin).filter(Boolean));
  } catch (err) { console.warn('Officer PIN warm-up skipped:', err.message); }
}
app.set('onRosterChanged', warmOfficerPins);

app.post('/api/distance', requireAuth('Admin', 'Coordinator'), async (req, res) => {
  try {
    const { destination, origins } = req.body || {};
    if (!Array.isArray(origins) || origins.length > 60) {
      return res.status(400).json({ error: 'Send an "origins" list of at most 60 PIN codes.' });
    }
    res.json(await distanceService.distances(destination, origins));
  } catch (err) {
    console.error('POST /api/distance error:', err.message);
    res.status(500).json({ error: 'Distance lookup failed' });
  }
});

app.get('/api/load', requireAuth('Admin', 'Coordinator'), async (req, res) => {
  try {
    res.json(await loadCache.get());
  } catch (err) {
    console.error('GET /api/load error:', err.message);
    res.status(500).json({ error: 'Server error retrieving workload' });
  }
});
app.use('/api/external', require('./routes/externalIntake')({ distanceService, loadCache, notifyCasesUpdated }));

// POST /api/cases - Creates or updates a case docket safely
app.post('/api/cases', requireAuth('Admin', 'Coordinator'), async (req, res) => {
  try {
    const body = { ...req.body };
    delete body._id;
    delete body.__v;
    delete body.rev;

    const rawClaimNo = String(body.claimNo || '').trim();
    const rawId = String(body.id || rawClaimNo).trim();
    if (!rawClaimNo && !rawId) {
      return res.status(400).json({ error: 'Claim number or Case ID is required.' });
    }
    body.claimNo = rawClaimNo || rawId;
    body.id = rawId || rawClaimNo;
    body.caseId = body.id; // Satisfies legacy index to prevent null key collisions
    body.claimKey = body.claimNo.toLowerCase();

    // Exception remarks validation
    const auto = body.autoAllocation;
    if (auto && typeof auto === 'object') {
      const isDigital = Rules.canonicalCaseType(body.caseType) === 'Digital';
      const chosen = {
        fieldOfficerId: body.fieldOfficerId, fieldOfficer2Id: body.fieldOfficer2Id,
        auditorId: body.auditorId, foDeployment: body.foDeployment
      };
      const overrides = Rules.detectOverrides(auto, chosen, isDigital);
      const given = Array.isArray(body.allocationExceptions) ? body.allocationExceptions : [];
      const missing = Rules.missingRemarks(overrides, given);
      if (missing.length) {
        return res.status(400).json({
          error: `An exception remark (at least ${Rules.MIN_REMARK} characters) is mandatory when the automatic allocation is changed: ${missing.map((m) => m.label).join('; ')}.`,
          missing: missing.map((m) => m.field)
        });
      }
      const who = { id: req.user.pid || req.user.employeeId, name: req.user.name, role: req.user.role };
      const suggestedIdOf = { fieldOfficer: auto.fieldOfficerId, fieldOfficer2: auto.fieldOfficer2Id, auditor: auto.auditorId, foDeployment: auto.foMode };
      const chosenIdOf = { fieldOfficer: body.fieldOfficerId, fieldOfficer2: body.fieldOfficer2Id, auditor: body.auditorId, foDeployment: body.foDeployment };
      body.allocationExceptions = overrides.map((o) => {
        const e = given.find((x) => x && x.field === o.field) || {};
        return {
          field: o.field, label: o.label,
          suggestedId: suggestedIdOf[o.field] || null, suggestedName: String(e.suggestedName || '').slice(0, 120),
          chosenId: chosenIdOf[o.field] || null, chosenName: String(e.chosenName || '').slice(0, 120),
          remark: String(e.remark || '').trim().slice(0, 500),
          by: who, at: new Date().toISOString()
        };
      });
      body.autoAllocation = {
        fieldOfficerId: auto.fieldOfficerId || null, fieldOfficer2Id: auto.fieldOfficer2Id || null,
        auditorId: auto.auditorId || null, foMode: auto.foMode || null
      };
    } else {
      body.autoAllocation = {
        fieldOfficerId: body.fieldOfficerId || null,
        fieldOfficer2Id: body.fieldOfficer2Id || null,
        auditorId: body.auditorId || null,
        foMode: body.isDualSpot ? 'dual' : 'single'
      };
    }

    body.createdBy = { id: req.user.pid || req.user.employeeId, name: req.user.name, role: req.user.role };

    // Update existing docket if already present to prevent 409 collisions
    const existingCase = await Case.findOne({
      $or: [{ claimKey: body.claimKey }, { claimNo: body.claimNo }, { id: body.id }]
    });

    if (existingCase) {
      Object.assign(existingCase, body);
      await existingCase.save();
      notifyCasesUpdated();
      return res.status(200).json(existingCase);
    }

    const newCase = new Case(body);
    await newCase.save();
    notifyCasesUpdated();
    res.status(201).json(newCase);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: 'Case could not be saved. Missing or invalid: ' + Object.keys(err.errors).join(', ') });
    }
    console.error('POST /api/cases error:', err.message);
    res.status(500).json({ error: 'Server error creating case' });
  }
});

// PUT /api/cases/:id - Master Admin Case Reassign and Docket Update
app.put('/api/cases/:id', requireAuth('Admin'), async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!rawId) return res.status(400).json({ error: 'Case ID is required' });

    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.__v;

    const updated = await Case.findOneAndUpdate(
      { $or: [{ id: rawId }, { claimNo: rawId }] },
      { $set: updateData },
      { new: true, upsert: true }
    );

    notifyCasesUpdated();
    return res.json(updated);
  } catch (err) {
    console.error('PUT /api/cases/:id error:', err.message);
    res.status(500).json({ error: 'Server error updating/reassigning case' });
  }
});

// POST /api/members/sync - Master Admin Staff Roster Status & Capacity Sync
app.post('/api/members/sync', requireAuth('Admin'), async (req, res) => {
  try {
    const { employeeId, role, data } = req.body || {};
    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId is required for member sync' });
    }

    const updateFields = {};
    if (data && typeof data === 'object') {
      if (data.maxDailyVisits !== undefined) updateFields['profile.maxDailyVisits'] = data.maxDailyVisits;
      if (data.dailyCapacity !== undefined) updateFields['profile.dailyCapacity'] = data.dailyCapacity;
      if (data.leaveDays !== undefined) updateFields['profile.leaveDays'] = data.leaveDays;
      if (data.isActive !== undefined) updateFields['profile.isActive'] = data.isActive;
      if (data.clients !== undefined) updateFields['profile.clients'] = data.clients;
      if (data.schedule !== undefined) updateFields['profile.schedule'] = data.schedule;
    }

    await User.findOneAndUpdate(
      { 'profile.employeeId': String(employeeId) },
      { $set: updateFields }
    );

    loadCache.markDirty();
    res.json({ success: true, message: 'Member profile synced successfully' });
  } catch (err) {
    console.error('POST /api/members/sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync member profile data' });
  }
});

// PATCH /api/cases/:id - Approvals and document updates
app.patch('/api/cases/:id', requireAuth(), async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!rawId) return res.status(400).json({ error: 'Case ID is required' });

    const caseQuery = { $or: [{ id: rawId }, { claimNo: rawId }] };

    // Administrators have unrestricted update access
    if (req.user.role === 'Admin') {
      const updated = await Case.findOneAndUpdate(caseQuery, { $set: req.body }, { new: true });
      if (!updated) return res.status(404).json({ error: 'Case not found' });
      notifyCasesUpdated();
      return res.json(updated);
    }

    // Role-scoped update validation
    const filter = { ...caseQuery, ...caseScope(req.user) };
    const result = await applyCaseUpdate(Case, filter, req.user.role, req.body);
    if (result.notFound) {
      return res.status(404).json({ error: 'Case not found or unauthorized to update this file.' });
    }
    if (result.changed) notifyCasesUpdated();
    res.json(result.doc);
  } catch (err) {
    if (/several people/.test(err.message)) return res.status(409).json({ error: err.message });
    console.error('PATCH /api/cases error:', err.message);
    res.status(500).json({ error: 'Server error updating case' });
  }
});

// DELETE /api/cases/:id - Case removal
app.delete('/api/cases/:id', requireAuth('Admin'), async (req, res) => {
  try {
    await Case.findOneAndDelete({ id: req.params.id });
    notifyCasesUpdated();
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/cases error:', err.message);
    res.status(500).json({ error: 'Server error deleting case' });
  }
});

// GET /api/stats - Global system statistics
app.get('/api/stats', requireAuth('Admin', 'Coordinator'), async (req, res) => {
  try {
    res.json(await statsCache.get());
  } catch (err) {
    console.error('GET /api/stats error:', err.message);
    res.status(500).json({ error: 'Server error retrieving statistics' });
  }
});

io.on('connection', (socket) => {
  if (!IS_PROD) console.log('Socket client connected:', socket.id);
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

// Application start sequence
const PORT = process.env.PORT || 5000;

connectDB()
  .then(async () => {
    // Drop legacy index on caseId if it exists in the active MongoDB collection
    try {
      await Case.collection.dropIndex('caseId_1');
      console.log('✓ Successfully dropped problematic index: caseId_1');
    } catch (e) {
      // Safe to ignore if index does not exist
    }

    try { await ensureIndexes(); } catch (e) { console.error('Index maintenance warning:', e.message); }
    try {
      if (typeof Case.init === 'function') await Case.init();
      if (typeof User.init === 'function') await User.init();
    } catch (e) {
      // Suppress harmless build warnings as Mongoose builds indexes in the background
    }

    const admin = await ensureAdmin();
    if (admin) console.log(`Default administrator initialized: ${admin.employeeId}`);
    server.listen(PORT, '0.0.0.0', () => console.log(`Server listening on http://localhost:${PORT}`));
    warmOfficerPins();
  })
  .catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });

// Graceful termination handling
function shutdown() {
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);