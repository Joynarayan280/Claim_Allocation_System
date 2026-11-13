// public/allocation-rules.js
// Shared allocation rules, override detection, case canonicalization, and coordinator matching.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CA_Rules = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_REMARK = 10;

  function canonicalCaseType(caseType) {
    const raw = String(caseType || '').trim().toLowerCase();
    if (!raw) return 'Cashless';
    if (raw.includes('digital')) return 'Digital';
    if (raw.includes('non-cashless') || raw.includes('non cashless') || raw.includes('pa') || raw.includes('reimbursement') || raw.includes('ri')) {
      return 'Reimbursement';
    }
    if (raw.includes('cashless')) return 'Cashless';
    return 'Reimbursement';
  }

  function pickCoordinator(opts) {
    const {
      coordinators = [],
      stateMatches = (c, st) => (c.states || []).map((s) => s.toLowerCase()).includes(String(st).toLowerCase()),
      state = '',
      caseType = '',
      isDigital = false,
      wantZone = 'North',
      loadOf = () => 0
    } = opts;

    const activeCoords = coordinators.filter((c) => c.isActive !== false);
    const targetType = canonicalCaseType(caseType);

    // 1. Digital Routing: match digitalZone and caseType (if specified)
    if (isDigital) {
      const zoneMatches = activeCoords.filter((c) => {
        const zone = String(c.digitalZone || c.zone || '').trim().toLowerCase();
        return zone === String(wantZone).trim().toLowerCase();
      });

      const typedZoneMatches = zoneMatches.filter((c) => {
        if (!c.caseTypes || c.caseTypes.length === 0) return true;
        return c.caseTypes.map((t) => t.toLowerCase()).includes(targetType.toLowerCase());
      });

      const pool = typedZoneMatches.length > 0 ? typedZoneMatches : zoneMatches;
      const chosen = pool.sort((a, b) => loadOf(a.name) - loadOf(b.name))[0] || null;

      return {
        coordinator: chosen,
        reason: 'digital-zone',
        note: chosen ? '' : `No digital coordinator found for zone: ${wantZone}`
      };
    }

    // 2. Physical Routing by State
    const stateMatched = activeCoords.filter((c) => stateMatches(c, state));

    if (stateMatched.length > 0) {
      const stateAndTypeMatched = stateMatched.filter((c) => {
        if (!c.caseTypes || c.caseTypes.length === 0) return true;
        return c.caseTypes.map((t) => t.toLowerCase()).includes(targetType.toLowerCase());
      });

      if (stateAndTypeMatched.length > 0) {
        stateAndTypeMatched.sort((a, b) => loadOf(a.name) - loadOf(b.name));
        return {
          coordinator: stateAndTypeMatched[0],
          reason: 'state+type',
          note: ''
        };
      }

      // State is covered, but nobody explicitly handles this caseType
      stateMatched.sort((a, b) => loadOf(a.name) - loadOf(b.name));
      return {
        coordinator: stateMatched[0],
        reason: 'state-only',
        note: `No ${targetType} coordinator whitelisted for state ${state}. Assigning state owner.`
      };
    }

    // 3. Standby Fallback: unknown state
    const standbyPool = [...activeCoords].sort((a, b) => loadOf(a.name) - loadOf(b.name));
    return {
      coordinator: standbyPool[0] || null,
      reason: 'standby',
      note: `State "${state}" not covered. Fallback to standby coordinator.`
    };
  }

  function detectOverrides(suggested, chosen, isDigital = false) {
    const overrides = [];
    if (!suggested || !chosen) return overrides;

    // Digital checks only Auditor
    if (isDigital) {
      if (chosen.auditorId && suggested.auditorId && chosen.auditorId !== suggested.auditorId) {
        overrides.push({ field: 'auditor', label: 'Clinical Claims Auditor' });
      }
      return overrides;
    }

    // Dual FO vs Single FO Deployment changes
    if (suggested.foMode === 'dual') {
      const modeChanged = chosen.foDeployment && chosen.foDeployment !== 'dual';
      if (modeChanged) {
        overrides.push({ field: 'foDeployment', label: 'Field Officer Deployment Mode' });
      } else {
        if (chosen.fieldOfficerId && suggested.fieldOfficerId && chosen.fieldOfficerId !== suggested.fieldOfficerId) {
          overrides.push({ field: 'fieldOfficer', label: 'Hospital Field Officer' });
        }
        if (chosen.fieldOfficer2Id && suggested.fieldOfficer2Id && chosen.fieldOfficer2Id !== suggested.fieldOfficer2Id) {
          overrides.push({ field: 'fieldOfficer2', label: 'Patient Field Officer' });
        }
      }
    } else {
      // Single FO case
      if (chosen.fieldOfficerId && suggested.fieldOfficerId && chosen.fieldOfficerId !== suggested.fieldOfficerId) {
        overrides.push({ field: 'fieldOfficer', label: 'Field Officer' });
      }
    }

    // Auditor Check
    if (chosen.auditorId && suggested.auditorId && chosen.auditorId !== suggested.auditorId) {
      overrides.push({ field: 'auditor', label: 'Clinical Claims Auditor' });
    }

    return overrides;
  }

  function missingRemarks(overrides = [], remarks = []) {
    return overrides.filter((o) => {
      const found = remarks.find((r) => r && r.field === o.field);
      return !found || !found.remark || String(found.remark).trim().length < MIN_REMARK;
    });
  }

  return {
    MIN_REMARK,
    canonicalCaseType,
    pickCoordinator,
    detectOverrides,
    missingRemarks
  };
}));