/* allocation-rules.js
   Pure allocation rules shared by the browser (Intake Desk) and the server (validation) and covered by unit tests.
   No DOM, no database. Loaded in the browser as window.CA_Rules and in Node with require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CA_Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ case types
  // The intake form has three case types: "Cashless", "Reimbursement" and "Digital".
  function canonicalCaseType(value) {
    var v = String(value || '').toLowerCase();
    if (v.indexOf('digital') > -1) return 'Digital';
    // "Non-Cashless Benefit", "PA" and "RI" are all reimbursement-type work
    if (v.indexOf('reimb') > -1 || v === 'ri' || v === 'pa' || /non[\s-]*cashless/.test(v)) return 'Reimbursement';
    if (v.indexOf('cashless') > -1 || v === 'cl') return 'Cashless';
    return '';
  }

  // Does a coordinator handle this type of case? A coordinator with no case types listed handles every type.
  function handlesCaseType(coordinator, caseType) {
    var wanted = canonicalCaseType(caseType);
    var listed = coordinator && coordinator.caseTypes;
    if (typeof listed === 'string') listed = listed.split(/[,;|]/);
    if (!Array.isArray(listed) || listed.length === 0 || !wanted) return true;
    return listed.some(function (t) {
      var x = String(t).toLowerCase().trim();
      if (!x) return false;
      if (x === 'all' || x === 'universal') return true;
      return canonicalCaseType(x) === wanted;
    });
  }

  // ------------------------------------------------------------------ coordinator choice
  // Order of preference for a PHYSICAL case:
  //   1. covers the hospital state AND handles this case type  (least loaded wins)
  //   2. covers the state but nobody there handles the type    (state owner, with a warning note)
  //   3. anybody active who handles the type                   (standby)
  //   4. anybody active                                        (standby)
  // For a DIGITAL case the zone lead (South / North) is used, preferring one who handles Digital cases.
  // opts: { coordinators, state, caseType, isDigital, wantZone ('South'|'North'), stateMatches(coordinator,state), loadOf(name) }
  function pickCoordinator(opts) {
    var live = (opts.coordinators || []).filter(function (c) { return c && c.isActive !== false; });
    var loadOf = opts.loadOf || function () { return 0; };
    var byLoad = function (list) {
      return list.slice().sort(function (a, b) { return loadOf(a.name) - loadOf(b.name); })[0] || null;
    };
    var typeOk = function (c) { return handlesCaseType(c, opts.caseType); };

    if (opts.isDigital) {
      var zone = String(opts.wantZone || '').toLowerCase();
      var leads = live.filter(function (c) {
        var dz = String(c.digitalZone || c.zone || '').toLowerCase();
        var nm = String(c.name || '').toLowerCase();
        return zone === 'south' ? (dz.indexOf('south') > -1 || nm.indexOf('suchismita') > -1)
                                : (dz.indexOf('north') > -1 || nm.indexOf('krishna') > -1);
      });
      var lead = byLoad(leads.filter(typeOk)) || byLoad(leads);
      if (lead) return { coordinator: lead, reason: 'digital-lead', note: '' };
      var any = byLoad(live.filter(typeOk)) || byLoad(live);
      return { coordinator: any, reason: 'standby', note: any ? '[Standby assigned: no ' + (opts.wantZone || '') + ' digital lead]' : '' };
    }

    var inState = live.filter(function (c) { return opts.stateMatches(c, opts.state); });
    var both = inState.filter(typeOk);
    if (both.length) return { coordinator: byLoad(both), reason: 'state+type', note: '' };

    if (inState.length) {
      return {
        coordinator: byLoad(inState),
        reason: 'state-only',
        note: '[No ' + (canonicalCaseType(opts.caseType) || 'matching') + ' coordinator for ' + opts.state + ': state coordinator assigned]'
      };
    }
    var typed = byLoad(live.filter(typeOk));
    if (typed) return { coordinator: typed, reason: 'standby', note: '[Standby assigned for ' + opts.state + ']' };
    var first = byLoad(live);
    return { coordinator: first, reason: 'standby', note: first ? '[Standby assigned for ' + opts.state + ']' : '' };
  }

  // ------------------------------------------------------------------ manual overrides of the automatic suggestion
  // suggestion: what the engine proposed  { fieldOfficerId, fieldOfficer2Id, auditorId, foMode: 'single'|'dual' }
  // chosen:     what the person confirmed { fieldOfficerId, fieldOfficer2Id, auditorId, foDeployment: 'single'|'dual'|'hospOnly'|'resOnly' }
  // Returns the list of places where a human changed the automatic decision: [{ field, label }]
  function detectOverrides(suggestion, chosen, isDigital) {
    var out = [];
    if (!suggestion || !chosen) return out;
    var norm = function (v) { return v === undefined || v === null || v === '' || v === 'N/A' ? '' : String(v); };

    if (!isDigital) {
      if (suggestion.foMode === 'dual') {
        var mode = chosen.foDeployment || 'dual';
        if (mode !== 'dual') out.push({ field: 'foDeployment', label: 'Field officer deployment (' + (mode === 'hospOnly' ? 'Hospital FO only' : 'Patient FO only') + ' instead of both)' });
        if (mode === 'resOnly') {
          if (norm(chosen.fieldOfficerId) !== norm(suggestion.fieldOfficer2Id)) out.push({ field: 'fieldOfficer2', label: 'Patient field officer' });
        } else {
          if (norm(chosen.fieldOfficerId) !== norm(suggestion.fieldOfficerId)) out.push({ field: 'fieldOfficer', label: 'Hospital field officer' });
          if (mode === 'dual' && norm(chosen.fieldOfficer2Id) !== norm(suggestion.fieldOfficer2Id)) out.push({ field: 'fieldOfficer2', label: 'Patient field officer' });
        }
      } else if (norm(chosen.fieldOfficerId) !== norm(suggestion.fieldOfficerId)) {
        out.push({ field: 'fieldOfficer', label: 'Field officer' });
      }
    }
    if (norm(chosen.auditorId) !== norm(suggestion.auditorId)) out.push({ field: 'auditor', label: 'Auditor' });
    return out;
  }

  var MIN_REMARK = 10;
  // Every override needs a written remark (at least MIN_REMARK characters). Returns the fields still missing a remark.
  function missingRemarks(overrides, exceptions) {
    var byField = {};
    (exceptions || []).forEach(function (e) { if (e && e.field) byField[e.field] = String(e.remark || '').trim(); });
    return (overrides || []).filter(function (o) { return (byField[o.field] || '').length < MIN_REMARK; });
  }

  return { canonicalCaseType: canonicalCaseType, handlesCaseType: handlesCaseType, pickCoordinator: pickCoordinator,
           detectOverrides: detectOverrides, missingRemarks: missingRemarks, MIN_REMARK: MIN_REMARK };
});
