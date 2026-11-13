// routes/externalIntake.js
// External POST API to ingest cases from third-party/external systems and auto-assign team members.

const express = require('express');
const Case = require('../models/Case');
const User = require('../models/User');
const Rules = require('../public/allocation-rules.js');

function createExternalIntakeRouter({ distanceService, loadCache, notifyCasesUpdated }) {
  const router = express.Router();

  // Optional API Key guard (if EXTERNAL_API_KEY is set in .env, external caller must send x-api-key header)
  function checkExternalKey(req, res, next) {
    const expectedKey = String(process.env.EXTERNAL_API_KEY || '').trim();
    if (!expectedKey) return next();
    const providedKey = String(req.headers['x-api-key'] || req.query.apiKey || '').trim();
    if (providedKey !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing x-api-key' });
    }
    next();
  }

  // Resolve PIN to State/City via India Post API
  async function resolvePinMeta(pin) {
    const cleanPin = String(pin || '').replace(/\D/g, '');
    if (cleanPin.length !== 6) return { state: '', city: '', zone: 'North' };
    try {
      const resp = await fetch(`https://api.postalpincode.in/pincode/${cleanPin}`);
      const data = await resp.json();
      const po = Array.isArray(data) && data[0]?.Status === 'Success' && data[0]?.PostOffice?.[0];
      if (!po) return { state: '', city: '', zone: 'North' };
      const state = po.State || '';
      const city = po.District || po.Name || '';
      const southStates = ['Andhra Pradesh', 'Karnataka', 'Kerala', 'Tamil Nadu', 'Telangana', 'Puducherry', 'Lakshadweep', 'Andaman and Nicobar Islands'];
      const zone = southStates.some((s) => s.toLowerCase() === state.toLowerCase()) ? 'South' : 'North';
      return { state, city, zone };
    } catch (_) {
      return { state: '', city: '', zone: 'North' };
    }
  }

  // POST /api/external/cases - Ingests external case payload & runs autonomous allocation
  router.post('/cases', checkExternalKey, async (req, res) => {
    try {
      const payload = req.body || {};
      const claimNo = String(payload.claimNo || payload.claimNumber || '').trim();
      const userName = String(payload.userName || payload.patientName || '').trim();
      const clientName = String(payload.clientName || payload.insurer || 'HDFC ERGO General Insurance').trim();
      const pin = String(payload.pin || payload.patientPin || '').replace(/\D/g, '');
      const hospitalPin = String(payload.hospitalPin || pin).replace(/\D/g, '');
      const caseType = Rules.canonicalCaseType(payload.caseType || 'Cashless');

      if (!claimNo || !userName || pin.length !== 6) {
        return res.status(400).json({
          error: 'Missing required fields: claimNo, userName (patientName), and valid 6-digit pin are required.'
        });
      }

      // 1. Resolve Location Metadata
      const meta = await resolvePinMeta(hospitalPin || pin);
      const state = String(payload.state || meta.state || '').trim();
      const city = String(payload.city || meta.city || '').trim();
      const zone = String(payload.zone || meta.zone || 'North').trim();
      const isDigital = caseType === 'Digital';

      // 2. Load Active Roster & Current Workload
      const [staffDocs, loadData] = await Promise.all([
        User.find({ isActive: true }).lean(),
        loadCache.get()
      ]);

      const coordinators = staffDocs
        .filter((u) => u.role === 'Coordinator')
        .map((u) => ({
          id: u.employeeId,
          name: u.name,
          states: u.profile?.states || [],
          caseTypes: u.profile?.caseTypes || [],
          digitalZone: u.profile?.digitalZone || u.profile?.zone || '',
          isActive: u.profile?.isActive !== false
        }));

      const auditors = staffDocs
        .filter((u) => u.role === 'Auditor' && u.profile?.isActive !== false)
        .map((u) => ({
          id: u.employeeId,
          name: u.name,
          clients: u.profile?.clients || []
        }));

      const fieldOfficers = staffDocs
        .filter((u) => u.role === 'FieldOfficer' && u.profile?.isActive !== false)
        .map((u) => ({
          id: u.employeeId,
          name: u.name,
          basePin: String(u.profile?.basePin || '').replace(/\D/g, ''),
          onRoll: !!u.profile?.onRoll
        }));

      // 3. Pick Coordinator
      const coordPick = Rules.pickCoordinator({
        coordinators,
        state,
        caseType,
        isDigital,
        wantZone: zone,
        loadOf: (name) => Number(loadData?.coord?.[name] || 0)
      });
      const chosenCoord = coordPick.coordinator || coordinators[0] || { id: '', name: '' };

      // 4. Pick Auditor (match client carrier & lowest load)
      const clientAuditors = auditors.filter(
        (a) => !a.clients.length || a.clients.some((c) => c.toLowerCase() === clientName.toLowerCase())
      );
      const audPool = clientAuditors.length ? clientAuditors : auditors;
      audPool.sort((a, b) => Number(loadData?.aud?.[a.name] || 0) - Number(loadData?.aud?.[b.name] || 0));
      const chosenAud = audPool[0] || { id: '', name: '' };

      // 5. Pick Field Officer(s) using Road Distance + Weighted Score (skip for Digital)
      let fo1 = { id: '', name: '' };
      let fo2 = { id: '', name: '' };
      let isDualSpot = false;
      let foDistanceKm = 0;

      if (!isDigital && fieldOfficers.length > 0) {
        const targetHospPin = hospitalPin.length === 6 ? hospitalPin : pin;
        const candidatePins = [...new Set(fieldOfficers.map((o) => o.basePin).filter((p) => p.length === 6))];
        const distRes = await distanceService.distances(targetHospPin, candidatePins.slice(0, 60));
        const distMap = distRes?.distances || {};

        const rankedFo1 = fieldOfficers
          .map((o) => {
            const km = distMap[o.basePin]?.km ?? 999;
            const load = Number(loadData?.fo?.[o.id]?.total || 0);
            const score = 1000 - km * 2.5 + (o.onRoll ? 150 : 0) - load * 12;
            return { ...o, km, score };
          })
          .sort((a, b) => b.score - a.score);

        fo1 = rankedFo1[0] || { id: '', name: '' };
        foDistanceKm = Number.isFinite(fo1.km) && fo1.km < 999 ? fo1.km : 0;

        // Check Dual FO threshold (> 30 km between Patient PIN and Hospital PIN)
        if (pin !== targetHospPin) {
          const interRes = await distanceService.distances(targetHospPin, [pin]);
          const interKm = interRes?.distances?.[pin]?.km || 0;
          if (interKm > 30) {
            isDualSpot = true;
            const patDistRes = await distanceService.distances(pin, candidatePins.slice(0, 60));
            const patMap = patDistRes?.distances || {};
            const rankedFo2 = fieldOfficers
              .filter((o) => o.id !== fo1.id)
              .map((o) => {
                const km = patMap[o.basePin]?.km ?? 999;
                const load = Number(loadData?.fo?.[o.id]?.total || 0);
                const score = 1000 - km * 2.5 + (o.onRoll ? 150 : 0) - load * 12;
                return { ...o, score };
              })
              .sort((a, b) => b.score - a.score);
            fo2 = rankedFo2[0] || { id: '', name: '' };
          }
        }
      }

      // 6. Save Case Docket in MongoDB
      const id = String(payload.id || claimNo).trim();
      const caseDoc = {
        id,
        caseId: id,
        claimNo,
        claimKey: claimNo.toLowerCase(),
        clientName,
        caseType,
        userName,
        pin,
        hospitalPin: hospitalPin || pin,
        city,
        state,
        zone,
        coordinatorId: chosenCoord.id || '',
        coordinatorName: chosenCoord.name || '',
        fieldOfficerId: fo1.id || '',
        fieldOfficerName: fo1.name || '',
        fieldOfficerRole: isDualSpot ? 'Hospital & Others FO' : 'Primary FO',
        fieldOfficer2Id: isDualSpot ? fo2.id || '' : '',
        fieldOfficer2Name: isDualSpot ? fo2.name || '' : '',
        fieldOfficer2Role: isDualSpot ? 'Patient FO' : '',
        isDualSpot,
        foDeployment: isDigital ? 'digital' : isDualSpot ? 'dual' : 'single',
        foDistanceKm,
        auditorId: chosenAud.id || '',
        auditorName: chosenAud.name || '',
        approvals: { coordinator: 'Pending', fieldOfficer: 'Pending', auditor: 'Pending' },
        autoAllocation: {
          fieldOfficerId: fo1.id || null,
          fieldOfficer2Id: isDualSpot ? fo2.id || null : null,
          auditorId: chosenAud.id || null,
          foMode: isDualSpot ? 'dual' : 'single'
        },
        createdBy: { id: 'EXTERNAL_API', name: String(payload.sourceSystem || 'External System'), role: 'System' },
        status: 'In Progress'
      };

      const saved = await Case.findOneAndUpdate(
        { $or: [{ claimKey: caseDoc.claimKey }, { id: caseDoc.id }] },
        { $set: caseDoc },
        { new: true, upsert: true }
      );

      if (typeof notifyCasesUpdated === 'function') notifyCasesUpdated();

      return res.status(201).json({
        success: true,
        message: 'Case ingested and allocated automatically',
        case: saved
      });
    } catch (err) {
      console.error('POST /api/external/cases error:', err.message);
      return res.status(500).json({ error: 'Internal server error processing external case' });
    }
  });

  return router;
}

module.exports = createExternalIntakeRouter;