document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const STORAGE_KEY_FO = 'ca_registered_field_officers';
  const STORAGE_KEY_CASES = 'ca_shared_cases';

  let currentFO = null;
  let activeGpsCoords = { latitude: "22.5726", longitude: "88.3639" };

  // DOM Elements
  const topRoleTag = document.getElementById('topRoleTag');
  const dispFoName = document.getElementById('dispFoName');
  const dispFoSubtitle = document.getElementById('dispFoSubtitle');
  const dispEmpId = document.getElementById('dispEmpId');
  const dispType = document.getElementById('dispType');
  const dispGrade = document.getElementById('dispGrade');
  const dispBasePin = document.getElementById('dispBasePin');
  const dispCapLimit = document.getElementById('dispCapLimit');
  const dispAttendance = document.getElementById('dispAttendance');

  const dispTotalAssigned = document.getElementById('dispTotalAssigned');
  const dispActiveLoad = document.getElementById('dispActiveLoad');
  const dispApprovedCount = document.getElementById('dispApprovedCount');
  const dispTotalTa = document.getElementById('dispTotalTa');

  const dutyToggle = document.getElementById('dutyToggle');
  const dutyStatusText = document.getElementById('dutyStatusText');
  const btnAcquireGps = document.getElementById('btnAcquireGps');
  const gpsCoordText = document.getElementById('gpsCoordText');
  const tableHeadingTitle = document.getElementById('tableHeadingTitle');

  const officersDirectoryBody = document.getElementById('officersDirectoryBody');
  const foTableBody = document.getElementById('foTableBody');
  const btnSyncQueue = document.getElementById('btnSyncQueue');
  const searchOfficerInput = document.getElementById('searchOfficerInput');

  // Modal Elements
  const addOfficerModal = document.getElementById('addOfficerModal');
  const btnOpenAddModal = document.getElementById('btnOpenAddModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const newOfficerForm = document.getElementById('newOfficerForm');

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function getFieldOfficers() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY_FO));
      if (Array.isArray(list)) return list;
    } catch (e) { }
    return [];
  }

  function saveOfficers(list) {
    localStorage.setItem(STORAGE_KEY_FO, JSON.stringify(list));
  }

  function getCases() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_CASES)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveCases(cases) {
    localStorage.setItem(STORAGE_KEY_CASES, JSON.stringify(cases));
  }

  // 50-point dynamic scoring engine with dual quota
  function computeFOScore(officer, allCases) {
    const officerCases = allCases.filter(c =>
      c.caseType !== 'Digital' &&
      ((c.assignedTeam && (c.assignedTeam.fieldOfficer === officer.name || c.assignedTeam.fieldOfficer2 === officer.name)) ||
        c.fieldOfficerId === officer.employeeId || c.fieldOfficer2Id === officer.employeeId)
    );

    const pendingCases = officerCases.filter(c =>
      (c.status === 'In Progress' || c.status === 'Pending') &&
      c.approvals?.fieldOfficer === 'Pending'
    );

    // + cases the officer already carries outside this system (uploaded from Excel by the Admin)
    const ext = officer.externalLoad || { total: 0, cashless: 0, ri: 0 };
    const cashlessCount = pendingCases.filter(c => String(c.caseType).toLowerCase().includes('cashless')).length + ext.cashless;
    const nonCashlessCount = pendingCases.filter(c => !String(c.caseType).toLowerCase().includes('cashless')).length + ext.ri;
    const totalActive = pendingCases.length + ext.total;

    const limitCL = officer.maxCashless !== undefined ? officer.maxCashless : 3;
    const limitRI = officer.maxRI !== undefined ? officer.maxRI : 2;
    const totalCap = officer.maxDailyVisits !== undefined ? officer.maxDailyVisits : (limitCL + limitRI);

    const isOnline = officer.isActive !== false;
    const proximityScore = isOnline ? 15 : 0;

    let loadScore = 15;
    if (totalActive === 1 || totalActive === 2) loadScore = 10;
    else if (totalActive === 3 || totalActive === 4) loadScore = 5;
    else if (totalActive >= totalCap) loadScore = 0;

    const isOnRoll = /on-?roll/i.test(officer.employmentType || '');
    const empTypeScore = isOnRoll ? 10 : 5;

    const gradeStr = String(officer.grade || 'C').toUpperCase();
    const gradeScore = gradeStr.includes('A') ? 10 : (gradeStr.includes('B') ? 8 : 6);

    const total50 = Math.min(50, proximityScore + loadScore + empTypeScore + gradeScore);
    const scorePct = Math.round((total50 / 50) * 100);

    let tier = 'Tier B';
    let tierColor = '#d97706';
    if (total50 >= 42) { tier = 'Tier A+ (Top)'; tierColor = '#10b981'; }
    else if (total50 >= 35) { tier = 'Tier A'; tierColor = '#059669'; }
    else if (total50 < 25) { tier = 'Tier C'; tierColor = '#dc2626'; }

    return {
      score50: total50,
      scorePct: scorePct,
      tier: tier,
      tierColor: tierColor,
      cashlessCount,
      nonCashlessCount,
      totalActive,
      limitCL,
      limitRI,
      totalCap,
      isCashlessFull: cashlessCount >= limitCL,
      isNonCashlessFull: nonCashlessCount >= limitRI,
      isFull: totalActive >= totalCap
    };
  }

  // Realistic routing and travel allowance calculation calibrated with actual road networks
  function calculateRouteAndTA(foBasePin, patientPin, hospitalPin, caseType) {
    const pPinRaw = String(patientPin || '').replace(/\D/g, '').padEnd(6, '0');
    const hPinRaw = String(hospitalPin || pPinRaw).replace(/\D/g, '').padEnd(6, '0') || pPinRaw;
    const fPinRaw = String(foBasePin || '').replace(/\D/g, '').padEnd(6, '0');

    function calcLegKm(pinA, pinB) {
      if (!pinA || !pinB) return 6.0;
      const strA = String(pinA).replace(/\D/g, '').padEnd(6, '0');
      const strB = String(pinB).replace(/\D/g, '').padEnd(6, '0');
      if (strA === strB) return 3.5;

      const prefixA = strA.slice(0, 3);
      const prefixB = strB.slice(0, 3);

      // Same sorting district or metropolitan head (e.g., both 721xxx or 110xxx)
      if (prefixA === prefixB) {
        const subA = parseInt(strA.slice(3), 10);
        const subB = parseInt(strB.slice(3), 10);
        const diff = Math.abs(subA - subB);

        // Level 1: Adjacent delivery beats
        if (diff <= 4) return +(5.0 + diff * 1.5).toFixed(1);

        // Level 2: Inter-block / Taluk transit (e.g. 721436 vs 721445, diff=9 -> 23.0 km)
        if (diff <= 15) return +(15.0 + (diff - 4) * 1.6).toFixed(1);

        // Level 3: Distant district borders
        return +(26.0 + Math.min((diff - 15) * 0.9, 24.0)).toFixed(1);
      }

      // Same state cross-district transit
      if (strA.slice(0, 2) === strB.slice(0, 2) || (strA[0] === '7' && strB[0] === '7')) {
        const headDiff = Math.abs(parseInt(prefixA, 10) - parseInt(prefixB, 10));
        return +(32.0 + (headDiff * 14.0)).toFixed(1);
      }

      // Inter-state road transit
      const zoneDiff = Math.abs(parseInt(strA[0], 10) - parseInt(strB[0], 10));
      return +(240.0 + zoneDiff * 160.0).toFixed(1);
    }

    let totalKm = 0;
    const isRI = String(caseType).toLowerCase().includes('reimbursement');

    if (isRI) {
      const leg1 = calcLegKm(fPinRaw, pPinRaw);
      const leg2 = calcLegKm(pPinRaw, hPinRaw);
      totalKm = +(leg1 + leg2).toFixed(1);
    } else {
      totalKm = calcLegKm(fPinRaw, hPinRaw);
    }

    const extraKm = Math.max(0, +(totalKm - 50.0).toFixed(1));
    const extraTa = +(extraKm * 2.50).toFixed(2);

    return { totalKm, isExtraTa: extraKm > 0, extraKm, extraTa };
  }

  function fetchLiveGps() {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          activeGpsCoords = { latitude: pos.coords.latitude.toFixed(5), longitude: pos.coords.longitude.toFixed(5) };
          if (gpsCoordText) gpsCoordText.textContent = `Live Telemetry Locked: Lat ${activeGpsCoords.latitude}, Long ${activeGpsCoords.longitude}`;
        },
        () => {
          const livePin = currentFO?.basePin || currentFO?.pin || '';
          if (gpsCoordText) gpsCoordText.textContent = `Regional Base GPS Active: Lat ${activeGpsCoords.latitude}, Long ${activeGpsCoords.longitude}${livePin ? ` (Base PIN: ${livePin})` : ''}`;
        }
      );
    }
  }
  btnAcquireGps?.addEventListener('click', fetchLiveGps);

  const officers = getFieldOfficers();
  currentFO = (window.CA_pickMe && window.CA_pickMe(officers, 0)) ||
    { employeeId: '-', name: 'No field officer loaded', role: 'FieldOfficer', employmentType: '-', grade: '-', basePin: '', state: '', district: '', maxDailyVisits: 0, maxCashless: 0, maxRI: 0, isActive: false };

  updateTopProfileView();
  fetchLiveGps();
  renderAll();

  window.selectOfficer = function (empId) {
    if (window.CA_isAdmin && !window.CA_isAdmin()) return;
    const list = getFieldOfficers();
    const found = list.find(o => o.employeeId === empId);
    if (found) {
      currentFO = found;
      updateTopProfileView();
      renderAll();
    }
  };

  window.adjustSpecificCapacity = function (empId, quotaType, delta, event) {
    if (event) event.stopPropagation();
    const list = getFieldOfficers();
    const target = list.find(o => o.employeeId === empId);
    if (target) {
      if (quotaType === 'CL') {
        const cur = target.maxCashless !== undefined ? target.maxCashless : 3;
        target.maxCashless = Math.max(1, cur + delta);
      } else if (quotaType === 'RI') {
        const cur = target.maxRI !== undefined ? target.maxRI : 2;
        target.maxRI = Math.max(1, cur + delta);
      }

      target.maxDailyVisits = (target.maxCashless || 3) + (target.maxRI || 2);

      saveOfficers(list);
      if (currentFO && currentFO.employeeId === empId) {
        currentFO.maxCashless = target.maxCashless;
        currentFO.maxRI = target.maxRI;
        currentFO.maxDailyVisits = target.maxDailyVisits;
        updateTopProfileView();
      }
      renderAll();
    }
  };

  window.toggleOfficerDuty = function (empId, event) {
    if (event) event.stopPropagation();
    const list = getFieldOfficers();
    const target = list.find(o => o.employeeId === empId);
    if (target) {
      target.isActive = !target.isActive;
      saveOfficers(list);
      if (currentFO && currentFO.employeeId === empId) {
        currentFO.isActive = target.isActive;
        updateTopProfileView();
      }
      renderAll();
    }
  };

  function updateTopProfileView() {
    if (!currentFO) return;
    const allCases = getCases();
    const metrics = computeFOScore(currentFO, allCases);

    if (topRoleTag) topRoleTag.textContent = `Field Officer · ${currentFO.name} (Score: ${metrics.score50}/50)`;
    if (dispFoName) {
      dispFoName.innerHTML = `
        <span>${esc(currentFO.name)}</span>
        <span style="font-size:12px; font-weight:800; background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:12px; border:1px solid #bae6fd; margin-left:8px;">
          Score: ${metrics.score50}/50 (${metrics.scorePct}% · ${metrics.tier})
        </span>
      `;
    }
    if (dispEmpId) dispEmpId.textContent = currentFO.employeeId || '-';

    const empType = currentFO.employmentType || 'Off-Roll';
    if (dispType) {
      dispType.innerHTML = /on-?roll/i.test(empType)
        ? '<span style="color:#059669; font-weight:800;">On-Roll Inspector</span>'
        : '<span style="color:#2563eb; font-weight:800;">Off-Roll Partner</span>';
    }

    const currentBasePin = currentFO.basePin || currentFO.pin || '';
    if (dispGrade) dispGrade.textContent = `Grade ${currentFO.grade || 'C'} (${metrics.tier})`;
    if (dispBasePin) dispBasePin.textContent = `${currentBasePin || '-'} (${currentFO.district || 'Hub'})`;

    if (dispCapLimit) {
      dispCapLimit.innerHTML = `
        <div><strong>${metrics.totalCap} Cases / Day</strong> <small style="color:var(--ink-soft); font-size:11px;">(Total Quota)</small></div>
        <div style="font-size:11px; margin-top:3px; color:#475569;">
          <span style="color:${metrics.isCashlessFull ? '#dc2626' : '#059669'}; font-weight:700;">Cashless: ${metrics.cashlessCount}/${metrics.limitCL}</span> · 
          <span style="color:${metrics.isNonCashlessFull ? '#dc2626' : '#2563eb'}; font-weight:700;">RI: ${metrics.nonCashlessCount}/${metrics.limitRI}</span>
        </div>
      `;
    }

    if (dispFoSubtitle) dispFoSubtitle.textContent = `${empType} Ground Forensic Investigator · ${currentFO.state || 'West Bengal'} · Daily Load: ${metrics.totalActive}/${metrics.totalCap}`;

    if (dutyToggle) dutyToggle.checked = currentFO.isActive !== false;
    updateAttendanceDisplay(currentFO.isActive !== false);

    if (tableHeadingTitle) {
      tableHeadingTitle.textContent = `Assigned Inspection Table: ${currentFO.name} (${currentFO.employeeId})`;
    }
  }

  function updateAttendanceDisplay(isPresent) {
    if (isPresent) {
      if (dutyStatusText) dutyStatusText.textContent = 'Active on Duty (Present)';
      if (dispAttendance) dispAttendance.innerHTML = '<span class="status-pill active">Present</span>';
    } else {
      if (dutyStatusText) dutyStatusText.textContent = 'Off Duty (Absent)';
      if (dispAttendance) dispAttendance.innerHTML = '<span class="status-pill inactive">Absent</span>';
    }
  }

  dutyToggle?.addEventListener('change', () => {
    const isPresent = dutyToggle.checked;
    currentFO.isActive = isPresent;
    updateAttendanceDisplay(isPresent);

    const list = getFieldOfficers();
    const idx = list.findIndex(o => o.employeeId === currentFO.employeeId);
    if (idx !== -1) {
      list[idx].isActive = isPresent;
      saveOfficers(list);
    }
    renderOfficersDirectory();
  });

  function renderAll() {
    renderOfficersDirectory();
    renderDocketsTable();
  }

  function renderOfficersDirectory() {
    if (!officersDirectoryBody) return;
    const list = getFieldOfficers();
    const allCases = getCases().filter(c => c.caseType !== 'Digital');

    const searchVal = document.getElementById('searchOfficerInput')?.value.trim().toLowerCase() || '';

    const scoredList = list.map(officer => {
      const perf = computeFOScore(officer, allCases);
      return { ...officer, ...perf };
    });

    scoredList.sort((a, b) => {
      if (a.isActive !== b.isActive) return b.isActive ? 1 : -1;
      return b.score50 - a.score50;
    });

    const filteredList = scoredList.filter(officer => {
      if (!searchVal) return true;
      const name = String(officer.name || '').toLowerCase();
      const empId = String(officer.employeeId || '').toLowerCase();
      return name.includes(searchVal) || empId.includes(searchVal);
    });

    if (filteredList.length === 0) {
      officersDirectoryBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:24px; color:var(--ink-soft);">
            No field officers match "<strong>${esc(searchVal)}</strong>".
          </td>
        </tr>
      `;
      return;
    }

    officersDirectoryBody.innerHTML = filteredList.map(officer => {
      const isSelected = officer.employeeId === currentFO.employeeId;
      const isOnline = officer.isActive !== false;
      const officerPin = officer.basePin || officer.pin || '-';

      return `
        <tr class="officer-row ${isSelected ? 'selected-officer' : ''}" onclick="selectOfficer('${officer.employeeId}')">
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <strong>${officer.name}</strong>
              <span style="font-size:10.5px; font-weight:800; background:#f0fdf4; color:${officer.tierColor}; border:1px solid #bbf7d0; padding:1px 6px; border-radius:10px;">
                ${officer.score50}/50 (${officer.scorePct}%)
              </span>
            </div>
            <span style="font-family:monospace; font-size:11px; color:var(--accent); font-weight:700;">${officer.employeeId}</span>
            ${isSelected ? '<span class="status-pill active" style="font-size:9.5px; margin-left:4px;">Viewing</span>' : ''}
          </td>
          <td>
            <span style="font-weight:700; color:${/on-?roll/i.test(officer.employmentType) ? '#059669' : '#2563eb'};">
              ${officer.employmentType || 'Off-Roll'}
            </span><br>
            <small style="color:var(--ink-soft);">Grade ${officer.grade || 'C'} · ${officer.tier}</small>
          </td>
          <td>
            <strong>${officerPin}</strong><br>
            <small style="color:var(--ink-soft);">${officer.district || officer.state || 'Jurisdiction'}</small>
          </td>
          <td>
            <button type="button" class="btn small ${isOnline ? 'ghost' : 'reject'}" style="padding:2px 8px; font-size:11px;" onclick="toggleOfficerDuty('${officer.employeeId}', event)">
              ${isOnline ? 'Present' : 'Absent'}
            </button>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="color:${officer.isFull ? '#dc2626' : 'var(--ink)'}; font-size:13px;">
                ${officer.totalActive} / ${officer.totalCap}
              </strong>
              ${officer.isFull ? '<span style="font-size:10px; background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:1px 5px; border-radius:4px; font-weight:700;">Quota Full</span>' : ''}
            </div>
            <div style="font-size:10.5px; margin-top:2px; color:var(--ink-soft);">
              <span style="color:${officer.isCashlessFull ? '#dc2626' : '#059669'}; font-weight:700;">CL: ${officer.cashlessCount}/${officer.limitCL}</span> · 
              <span style="color:${officer.isNonCashlessFull ? '#dc2626' : '#2563eb'}; font-weight:700;">RI: ${officer.nonCashlessCount}/${officer.limitRI}</span>
            </div>
          </td>
          <td>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <div style="display:inline-flex; align-items:center; gap:4px; font-size:11px;">
                <span style="font-weight:700; color:#059669; width:22px;">CL:</span>
                <button class="btn small ghost" style="padding:1px 5px; font-size:10px;" onclick="adjustSpecificCapacity('${officer.employeeId}', 'CL', -1, event)" title="Decrease Cashless Quota">-</button>
                <strong style="font-size:11.5px; min-width:14px; text-align:center;">${officer.limitCL}</strong>
                <button class="btn small ghost" style="padding:1px 5px; font-size:10px;" onclick="adjustSpecificCapacity('${officer.employeeId}', 'CL', 1, event)" title="Increase Cashless Quota">+</button>
              </div>
              <div style="display:inline-flex; align-items:center; gap:4px; font-size:11px;">
                <span style="font-weight:700; color:#2563eb; width:22px;">RI:</span>
                <button class="btn small ghost" style="padding:1px 5px; font-size:10px;" onclick="adjustSpecificCapacity('${officer.employeeId}', 'RI', -1, event)" title="Decrease RI Quota">-</button>
                <strong style="font-size:11.5px; min-width:14px; text-align:center;">${officer.limitRI}</strong>
                <button class="btn small ghost" style="padding:1px 5px; font-size:10px;" onclick="adjustSpecificCapacity('${officer.employeeId}', 'RI', 1, event)" title="Increase RI Quota">+</button>
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderDocketsTable() {
    const allCases = getCases();
    const physicalCases = allCases.filter(c => c.caseType !== 'Digital');

    const myCases = physicalCases.filter(c =>
      (c.assignedTeam && (c.assignedTeam.fieldOfficer === currentFO.name || c.assignedTeam.fieldOfficer2 === currentFO.name)) ||
      (c.fieldOfficerId === currentFO.employeeId || c.fieldOfficer2Id === currentFO.employeeId)
    );

    const pendingCases = myCases.filter(c =>
      (c.status === 'In Progress' || c.status === 'Pending') &&
      c.approvals?.fieldOfficer === 'Pending'
    );
    const approvedCases = myCases.filter(c => c.approvals?.fieldOfficer === 'Approved');

    const limitCL = currentFO.maxCashless !== undefined ? currentFO.maxCashless : 3;
    const limitRI = currentFO.maxRI !== undefined ? currentFO.maxRI : 2;
    const maxCapacity = currentFO.maxDailyVisits !== undefined ? currentFO.maxDailyVisits : (limitCL + limitRI);

    const extLoad = currentFO.externalLoad || { total: 0, cashless: 0, ri: 0 };   // uploaded from Excel
    const activeLoad = pendingCases.length + extLoad.total;
    const approvedCount = approvedCases.length;

    const cashlessCount = pendingCases.filter(c => String(c.caseType).toLowerCase().includes('cashless')).length + extLoad.cashless;
    const nonCashlessCount = pendingCases.filter(c => !String(c.caseType).toLowerCase().includes('cashless')).length + extLoad.ri;

    if (dispTotalAssigned) dispTotalAssigned.textContent = myCases.length;
    if (dispActiveLoad) {
      dispActiveLoad.innerHTML = `
        <span style="color:${activeLoad >= maxCapacity ? '#dc2626' : '#d97706'}; font-weight:800;">${activeLoad} / ${maxCapacity}</span>
        <span style="font-size:11px; color:var(--ink-soft); font-weight:600;"> (CL: ${cashlessCount}/${limitCL} | RI: ${nonCashlessCount}/${limitRI})</span>
      `;
    }
    if (dispApprovedCount) dispApprovedCount.textContent = approvedCount;

    let totalTa = 0;
    const officerBasePin = currentFO.basePin || currentFO.pin || '';

    myCases.forEach(c => {
      const metrics = calculateRouteAndTA(officerBasePin, c.pin, c.hospitalPin, c.caseType);
      totalTa += (c.extraTaAmount !== undefined ? c.extraTaAmount : metrics.extraTa);
    });
    if (dispTotalTa) dispTotalTa.textContent = `₹${totalTa.toFixed(2)}`;

    if (!foTableBody) return;
    if (myCases.length === 0) {
      foTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:32px; color:var(--ink-soft);">
            No ground investigations currently assigned to <strong>${currentFO.name}</strong> (${currentFO.employeeId}).
          </td>
        </tr>
      `;
      return;
    }

    foTableBody.innerHTML = myCases.map(c => {
      const decision = c.approvals?.fieldOfficer || 'Pending';
      const isRI = String(c.caseType).toLowerCase().includes('reimbursement');

      const routeMetrics = calculateRouteAndTA(officerBasePin, c.pin, c.hospitalPin, c.caseType);
      const totalKm = c.foDistanceKm !== undefined ? c.foDistanceKm : routeMetrics.totalKm;
      const extraTa = c.extraTaAmount !== undefined ? c.extraTaAmount : routeMetrics.extraTa;
      const isOver = totalKm > 50.0;

      const spot1Done = !!c.foSpot1Verified;
      const spot2Done = !!c.foSpot2Verified;

      return `
        <tr>
          <td>
            <strong>${c.id}</strong><br>
            <small style="color:var(--ink-soft); font-family:monospace;">${esc(c.claimNo)}</small>
            ${c.referenceId ? `<br><span class="status-pill active" style="font-size:9.5px;">✓ Settled</span>` : ''}
          </td>
          <td>
            <strong>${esc(c.userName)}</strong><br>
            <span style="color:var(--accent); font-weight:600;">${esc(c.clientName || 'General Insurer')}</span>
          </td>
          <td>
            <strong style="color:${isRI ? '#b45309' : '#059669'};">${c.caseType}</strong><br>
            ${isRI ? `
              <div class="waypoint-chip ${spot1Done ? 'verified' : ''}">
                ${spot1Done ? '✓ Res Geotagged' : '• Spot 1: Res PIN (' + esc(c.pin) + ')'}
              </div><br>
              <div class="waypoint-chip ${spot2Done ? 'verified' : ''}">
                ${spot2Done ? '✓ Hosp Records Geotagged' : '• Spot 2: Hosp PIN (' + esc(c.hospitalPin || 'Facility') + ')'}
              </div>
            ` : `
              <div class="waypoint-chip ${spot2Done ? 'verified' : ''}">
                ${spot2Done ? '✓ Bedside Geotagged' : '• Spot: Bedside PIN (' + esc(c.hospitalPin || c.pin) + ')'}
              </div>
            `}
          </td>
          <td>
            <strong>${totalKm} km</strong><br>
            <small style="color:var(--ink-soft); font-size:10px;">Base PIN: ${officerBasePin || '-'}</small><br>
            ${isOver
          ? `<span style="color:#b91c1c; font-weight:700; font-size:11px;">+₹${extraTa} TA (>50km)</span>`
          : `<span style="color:#059669; font-size:11px;">Standard Logistics</span>`
        }
          </td>
          <td>
            <span class="status-pill ${decision === 'Approved' ? 'active' : (decision === 'Rejected' ? 'inactive' : 'pending')}">
              ${decision === 'Approved' ? 'Completed' : decision}
            </span>
            ${c.foRejectionReason ? `<br><small style="color:var(--red); font-size:10.5px;">"${esc(c.foRejectionReason)}"</small>` : ''}
          </td>
          <td>
            ${decision !== 'Pending' ? `
              <div style="font-size:11px; color:var(--ink-soft);">
                ✓ Verification Completed<br>
                <small>${esc(c.foVerifiedGps || 'GPS Logged')}</small>
              </div>
            ` : `
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${isRI ? `
                  ${!spot1Done ? `<button class="btn small ghost" onclick="verifySpot('${c.id}', 1)">Tag Res</button>` : ''}
                  ${!spot2Done ? `<button class="btn small ghost" onclick="verifySpot('${c.id}', 2)">Tag Hosp</button>` : ''}
                ` : `
                  ${!spot2Done ? `<button class="btn small ghost" onclick="verifySpot('${c.id}', 2)">Tag Bedside</button>` : ''}
                `}
                <button class="btn small approve" onclick="handleFoDecision('${c.id}', 'Approved',${isRI ? 'true' : 'false'}, ${totalKm},${extraTa})">
                  ✓ Complete &amp; Release
                </button>
              </div>
            `}
          </td>
        </tr>
      `;
    }).join('');
  }

  window.verifySpot = function (caseId, spotNum) {
    const cases = getCases();
    const target = cases.find(c => c.id === caseId);
    if (!target) return;

    const gpsStr = `Lat ${activeGpsCoords.latitude}, Long ${activeGpsCoords.longitude}`;
    if (spotNum === 1) target.foSpot1Verified = true;
    else target.foSpot2Verified = true;
    target.foVerifiedGps = gpsStr;
    saveCases(cases);

    try {
      fetch('/api/cases/' + caseId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target)
      }).catch(function () { });
    } catch (e) { }

    renderAll();
    alert(`Spot ${spotNum} successfully geotagged!`);
  };

  window.handleFoDecision = function (caseId, decision, isRI, totalKm, extraTa) {
    const cases = getCases();
    const target = cases.find(c => c.id === caseId);
    if (!target) return;

    if (isRI && (!target.foSpot1Verified || !target.foSpot2Verified)) {
      if (!confirm('Reimbursement inspection requires verification of both Residence & Hospital. Mark both verified and release capacity slot?')) return;
      target.foSpot1Verified = true;
      target.foSpot2Verified = true;
    }

    target.approvals = target.approvals || {};
    target.approvals.fieldOfficer = decision;
    target.foDistanceKm = totalKm || 12;
    target.extraTaAmount = extraTa || 0;
    target.foVerifiedGps = `Lat ${activeGpsCoords.latitude}, Long ${activeGpsCoords.longitude}`;
    target.foSpot2Verified = true;
    if (isRI) target.foSpot1Verified = true;

    if (target.approvals.coordinator === 'Approved' && target.approvals.auditor === 'Approved') {
      target.status = 'Approved';
      target.referenceId = 'REF-SETTLE-' + Math.floor(100000 + Math.random() * 900000);
      target.settledAt = new Date().toLocaleString();
    } else {
      target.status = 'In Progress';
    }

    saveCases(cases);

    try {
      fetch('/api/cases/' + caseId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target)
      }).catch(function () { });
    } catch (e) { }

    alert(`Case #${caseId} completed! One capacity slot has been released for ${currentFO.name}.`);
    renderAll();
  };

  btnOpenAddModal?.addEventListener('click', () => {
    addOfficerModal.style.display = 'flex';
  });

  btnCloseModal?.addEventListener('click', () => {
    addOfficerModal.style.display = 'none';
  });

  newOfficerForm?.addEventListener('submit', (e) => {
    e.preventDefault();

    const newOfficer = {
      name: document.getElementById('newFoName').value.trim(),
      employeeId: document.getElementById('newFoEmpId').value.trim().toUpperCase(),
      basePin: document.getElementById('newFoPin').value.trim(),
      employmentType: document.getElementById('newFoType').value,
      grade: document.getElementById('newFoGrade').value,
      email: document.getElementById('newFoEmail').value.trim().toLowerCase(),
      maxCashless: 3,
      maxRI: 2,
      maxDailyVisits: 5,
      role: 'FieldOfficer',
      isActive: true
    };

    const list = getFieldOfficers();
    if (list.some(o => o.employeeId === newOfficer.employeeId || o.email === newOfficer.email)) {
      alert('An officer with this Employee ID or Email already exists!');
      return;
    }

    list.push(newOfficer);
    saveOfficers(list);

    alert(`Field Officer "${newOfficer.name}" (${newOfficer.employeeId}) registered successfully!`);
    newOfficerForm.reset();
    addOfficerModal.style.display = 'none';

    currentFO = newOfficer;
    updateTopProfileView();
    renderAll();
  });

  document.getElementById('btnExportFoCsv')?.addEventListener('click', () => {
    const list = getFieldOfficers();
    const allCases = getCases().filter(c => c.caseType !== 'Digital');

    if (!list || list.length === 0) {
      alert('No field officers available to export.');
      return;
    }

    const headers = [
      "Employee ID",
      "Officer Name",
      "Employment Type",
      "Forensic Grade",
      "Base PIN",
      "District",
      "State",
      "Attendance Status",
      "Performance Score (Out of 50)",
      "Score Percentage (%)",
      "Performance Tier",
      "Active Cashless Load",
      "Max Cashless Quota",
      "Active RI Load",
      "Max RI Quota",
      "Total Active Load",
      "Total Quota Cap",
      "Total Assigned Cases",
      "Total Cleared Cases",
      "Total Billed TA (INR)"
    ];

    const rows = list.map(officer => {
      const perf = computeFOScore(officer, allCases);

      const officerCases = allCases.filter(c =>
        (c.assignedTeam && (c.assignedTeam.fieldOfficer === officer.name || c.assignedTeam.fieldOfficer2 === officer.name)) ||
        (c.fieldOfficerId === officer.employeeId || c.fieldOfficer2Id === officer.employeeId)
      );

      const approvedCount = officerCases.filter(c => c.approvals?.fieldOfficer === 'Approved').length;

      let billedTa = 0;
      officerCases.forEach(c => {
        const metrics = calculateRouteAndTA(officer.basePin || '', c.pin, c.hospitalPin, c.caseType);
        billedTa += (c.extraTaAmount !== undefined ? c.extraTaAmount : metrics.extraTa);
      });

      return [
        `"${officer.employeeId || ''}"`,
        `"${officer.name || ''}"`,
        `"${officer.employmentType || 'Off-Roll'}"`,
        `"${officer.grade || 'C'}"`,
        `"${officer.basePin || ''}"`,
        `"${officer.district || ''}"`,
        `"${officer.state || ''}"`,
        `"${officer.isActive !== false ? 'Present' : 'Absent'}"`,
        perf.score50,
        `${perf.scorePct}%`,
        `"${perf.tier}"`,
        perf.cashlessCount,
        perf.limitCL,
        perf.nonCashlessCount,
        perf.limitRI,
        perf.totalActive,
        perf.totalCap,
        officerCases.length,
        approvedCount,
        billedTa.toFixed(2)
      ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `FO_Performance_Roster_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  searchOfficerInput?.addEventListener('input', () => {
    renderOfficersDirectory();
  });

  btnSyncQueue?.addEventListener('click', renderAll);
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY_CASES || e.key === STORAGE_KEY_FO) renderAll();
  });
});