(function () {
    'use strict';

    const STORAGE_KEY_CASES = 'ca_shared_cases';
    const STORAGE_KEY_COORDS = 'ca_registered_coordinators';

    function safeParse(key, fallback = []) {
        try {
            const data = JSON.parse(localStorage.getItem(key));
            return Array.isArray(data) && data.length > 0 ? data : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    // Helper: Dynamic State Badges for Coordinator Operating Coverage
    function renderCoordStateChips(statesData) {
        if (!statesData || (Array.isArray(statesData) && statesData.length === 0)) {
            return '<span style="color:var(--ink-soft); font-size:11px;">National / All States</span>';
        }

        const statesList = Array.isArray(statesData)
            ? statesData
            : String(statesData).split(/[,;|]/);

        return statesList.map(st => {
            const name = String(st || '').trim();
            if (!name) return '';
            return `<span class="badge-chip badge-client" style="background:#f1f5f9; color:#0f172a; border:1px solid #cbd5e1; display:inline-block; margin:2px 3px; font-weight:700; font-size:11px;">📍 ${esc(name)}</span>`;
        }).filter(Boolean).join('');
    }

    // Master Coordinator Roster
    const defaultCoordinators = [];

    let currentCoord = null;
    let slaIntervalId = null;

    // DOM Elements
    const topRoleTag = document.getElementById('topRoleTag');
    const dispCoordName = document.getElementById('dispCoordName');
    const dispCoordMeta = document.getElementById('dispCoordMeta');
    const dispActiveLoad = document.getElementById('dispActiveLoad');
    const dispMaxCapacity = document.getElementById('dispMaxCapacity');
    const dispZoneLead = document.getElementById('dispZoneLead');
    const dutyToggle = document.getElementById('dutyToggle');
    const dutyStatusText = document.getElementById('dutyStatusText');

    const dispEmpId = document.getElementById('dispEmpId');
    const dispAnchorZone = document.getElementById('dispAnchorZone');
    const dispLanguages = document.getElementById('dispLanguages');
    const dispContact = document.getElementById('dispContact');
    const dispAttendance = document.getElementById('dispAttendance');

    const dispTotalCases = document.getElementById('dispTotalCases');
    const dispPendingCases = document.getElementById('dispPendingCases');
    const dispDigitalCases = document.getElementById('dispDigitalCases');
    const dispApprovedCases = document.getElementById('dispApprovedCases');

    const coordDirectoryBody = document.getElementById('coordDirectoryBody');
    const queueHeading = document.getElementById('queueHeading');
    const queueListWrap = document.getElementById('queueListWrap');
    const btnSyncQueue = document.getElementById('btnSyncQueue');
    const searchCoordInput = document.getElementById('searchCoordInput');

    const addCoordModal = document.getElementById('addCoordModal');
    const btnOpenAddModal = document.getElementById('btnOpenAddModal');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const newCoordForm = document.getElementById('newCoordForm');

    function getCoordinators() {
        try {
            const list = JSON.parse(localStorage.getItem(STORAGE_KEY_COORDS));
            if (Array.isArray(list)) return list;
        } catch (e) { }
        return [];
    }

    const saveCoordinators = (d) => localStorage.setItem(STORAGE_KEY_COORDS, JSON.stringify(d));
    const getCases = () => safeParse(STORAGE_KEY_CASES, []);
    const saveCases = (d) => localStorage.setItem(STORAGE_KEY_CASES, JSON.stringify(d));

    const coords = getCoordinators();
    currentCoord = (window.CA_pickMe && window.CA_pickMe(coords, 0)) ||
        { employeeId: '-', name: 'No coordinators imported yet', zone: '-', designation: 'Admin: use Staff Roster Import', states: [], email: '', phone: '', languages: [], maxCapacity: 0, isActive: false };

    updateProfileView();
    renderAll();
    startSlaTracker();

    window.selectCoordinator = function (empId) {
        if (window.CA_isAdmin && !window.CA_isAdmin()) return;
        const list = getCoordinators();
        const found = list.find(c => c.employeeId === empId);
        if (found) {
            currentCoord = found;
            updateProfileView();
            renderAll();
        }
    };

    window.toggleCoordStatus = function (empId, event) {
        if (event) event.stopPropagation();
        const list = getCoordinators();
        const target = list.find(c => c.employeeId === empId);
        if (target) {
            target.isActive = !target.isActive;
            saveCoordinators(list);
            if (currentCoord.employeeId === empId) {
                currentCoord.isActive = target.isActive;
                updateProfileView();
            }
            renderAll();
        }
    };

    function updateProfileView() {
        if (!currentCoord) return;

        if (topRoleTag) topRoleTag.textContent = `Corporate Coordinator · ${currentCoord.name}`;
        if (dispCoordName) dispCoordName.textContent = currentCoord.name;
        if (dispCoordMeta) dispCoordMeta.textContent = `${currentCoord.designation || 'Operations Lead'} • Permanent Corporate Staff`;
        if (dispMaxCapacity) dispMaxCapacity.textContent = currentCoord.maxCapacity || 4;
        if (dispZoneLead) dispZoneLead.textContent = `${currentCoord.zone || 'National'} Lead`;

        if (dispEmpId) dispEmpId.textContent = currentCoord.employeeId;

        // Render Assigned States Badges in Profile Header
        if (dispAnchorZone) {
            const stateChips = renderCoordStateChips(currentCoord.states);
            dispAnchorZone.innerHTML = `<strong>${esc(currentCoord.zone || 'National')} Authority</strong><div style="margin-top:4px;">${stateChips}</div>`;
        }

        if (dispContact) dispContact.textContent = `${currentCoord.email} | ${currentCoord.phone || ''}`;

        if (dispLanguages) {
            dispLanguages.innerHTML = (currentCoord.languages || ['Bengali', 'Hindi', 'English'])
                .map(l => `<span class="lang-chip">${esc(l)}</span>`).join('');
        }

        if (dutyToggle) dutyToggle.checked = currentCoord.isActive !== false;
        if (currentCoord.isActive !== false) {
            if (dutyStatusText) dutyStatusText.textContent = 'Active on Duty (Present)';
            if (dispAttendance) dispAttendance.innerHTML = '<span class="status-pill active">Present</span>';
        } else {
            if (dutyStatusText) dutyStatusText.textContent = 'Off Duty (Absent / Standby)';
            if (dispAttendance) dispAttendance.innerHTML = '<span class="status-pill inactive">Absent</span>';
        }

        if (queueHeading) {
            queueHeading.textContent = `Assigned Claims Queue: ${currentCoord.name} (${currentCoord.employeeId})`;
        }
    }

    dutyToggle?.addEventListener('change', () => {
        const isPresent = dutyToggle.checked;
        currentCoord.isActive = isPresent;
        const list = getCoordinators();
        const idx = list.findIndex(c => c.employeeId === currentCoord.employeeId);
        if (idx !== -1) {
            list[idx].isActive = isPresent;
            saveCoordinators(list);
        }
        updateProfileView();
        renderCoordinatorDirectory();
    });

    function calculateSla(deadlineIso) {
        if (!deadlineIso) return { text: '3h 00m left', breached: false };
        const diff = new Date(deadlineIso) - new Date();
        if (diff <= 0) return { text: 'SLA BREACHED', breached: true };
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        return { text: `${h}h ${m}m ${s}s left`, breached: false };
    }

    function startSlaTracker() {
        if (slaIntervalId) clearInterval(slaIntervalId);
        slaIntervalId = setInterval(() => {
            document.querySelectorAll('.sla-timer-val').forEach(node => {
                const res = calculateSla(node.getAttribute('data-deadline'));
                node.textContent = res.text;
                const pill = node.closest('.sla-pill');
                if (pill) {
                    if (res.breached) pill.classList.add('breached');
                    else pill.classList.remove('breached');
                }
            });
        }, 1000);
    }

    function renderAll() {
        renderCoordinatorDirectory();
        renderQueue();
    }

    // 1. Render Directory with Live Filter Support & Operating States
    function renderCoordinatorDirectory() {
        if (!coordDirectoryBody) return;
        const list = getCoordinators();
        const allCases = getCases();

        const searchVal = document.getElementById('searchCoordInput')?.value.trim().toLowerCase() || '';

        const filteredList = list.filter(c => {
            if (!searchVal) return true;
            const cName = String(c.name || '').toLowerCase();
            const cId = String(c.employeeId || '').toLowerCase();
            const cStates = Array.isArray(c.states) ? c.states.join(' ').toLowerCase() : String(c.states || '').toLowerCase();
            return cName.includes(searchVal) || cId.includes(searchVal) || cStates.includes(searchVal);
        });

        if (filteredList.length === 0) {
            coordDirectoryBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align:center; padding:24px; color:var(--ink-soft);">
                        No coordinators found matching "<strong>${esc(searchVal)}</strong>".
                    </td>
                </tr>
            `;
            return;
        }

        coordDirectoryBody.innerHTML = filteredList.map(c => {
            const isSelected = c.employeeId === currentCoord.employeeId;
            const isOnline = c.isActive !== false;
            const activeLoad = allCases.filter(item => {
                const assigned = item.assignedTeam?.coordinator === c.name || item.coordinatorId === c.employeeId;
                const ongoing = item.status !== 'Approved' && !item.status.includes('Settled');
                return assigned && ongoing;
            }).length;

            const langTags = (c.languages || []).map(l => `<span class="lang-chip">${esc(l)}</span>`).join('');
            const stateBadges = renderCoordStateChips(c.states);

            return `
                <tr class="coord-row ${isSelected ? 'selected-coord' : ''}" onclick="selectCoordinator('${c.employeeId}')">
                    <td>
                        <strong>${esc(c.name)}</strong><br>
                        <span style="font-family:monospace; font-size:11px; color:var(--accent); font-weight:700;">${esc(c.employeeId)}</span>
                        ${isSelected ? '<span class="status-pill active" style="font-size:9.5px; margin-left:4px;">Viewing</span>' : ''}
                    </td>
                    <td>
                        <strong>${esc(c.zone || 'National')}</strong><br>
                        <small style="color:var(--ink-soft);">${esc(c.designation || 'Operations Staff')}</small>
                        <div style="margin-top:4px; max-width:180px;">${stateBadges}</div>
                    </td>
                    <td>${langTags}</td>
                    <td>
                        <small>${esc(c.email)}</small><br>
                        <small style="color:var(--ink-soft);">${esc(c.phone || '')}</small>
                    </td>
                    <td>
                        <button type="button" class="btn small ${isOnline ? 'ghost' : 'reject'}" style="padding:2px 8px; font-size:11px;" onclick="toggleCoordStatus('${c.employeeId}', event)">
                            ${isOnline ? '🟢 Present' : '🔴 Absent'}
                        </button>
                    </td>
                    <td>
                        <strong style="font-size:13px; color:var(--primary);">${activeLoad} / ${c.maxCapacity || 4} Files</strong>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderQueue() {
        const allCases = getCases();
        const myCases = allCases.filter(c => {
            return (c.assignedTeam && c.assignedTeam.coordinator === currentCoord.name) ||
                (c.coordinatorId === currentCoord.employeeId);
        });

        const pending = myCases.filter(c => (c.approvals?.coordinator || 'Pending') === 'Pending');
        const approved = myCases.filter(c => c.approvals?.coordinator === 'Approved');
        const digital = myCases.filter(c => c.caseType === 'Digital');

        if (dispActiveLoad) dispActiveLoad.textContent = pending.length;
        if (dispTotalCases) dispTotalCases.textContent = myCases.length;
        if (dispPendingCases) dispPendingCases.textContent = pending.length;
        if (dispApprovedCases) dispApprovedCases.textContent = approved.length;
        if (dispDigitalCases) dispDigitalCases.textContent = digital.length;

        if (!queueListWrap) return;
        if (myCases.length === 0) {
            queueListWrap.innerHTML = `
                <div style="text-align:center; padding:32px; color:var(--ink-soft);">
                    No dockets currently allocated to <strong>${esc(currentCoord.name)}</strong> (${esc(currentCoord.employeeId)}).
                </div>
            `;
            return;
        }

        queueListWrap.innerHTML = myCases.map(c => {
            const decision = c.approvals?.coordinator || 'Pending';
            const isDecided = decision !== 'Pending';
            const isDigital = c.caseType === 'Digital';
            const sla = calculateSla(c.slaDeadline);

            return `
                <div class="claim-card" style="margin-bottom:12px; border-left:4px solid ${decision === 'Approved' ? 'var(--green)' : 'var(--accent)'};">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                        <div>
                            <strong>${esc(c.id)} — Claim #${esc(c.claimNo)}</strong>
                            <span class="status-pill ${c.status === 'Approved' ? 'active' : 'pending'}" style="margin-left:6px;">${esc(c.status)}</span>
                            ${c.referenceId ? `<span class="status-pill active" style="margin-left:4px; font-size:10px;">✓ ${esc(c.referenceId)}</span>` : ''}
                        </div>
                        <div class="sla-pill ${sla.breached ? 'breached' : ''}">⏱ <span class="sla-timer-val" data-deadline="${c.slaDeadline}">${sla.text}</span></div>
                    </div>

                    ${(Array.isArray(c.allocationExceptions) && c.allocationExceptions.length) ? `
                    <div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:#fffaf0;border:1px solid #f3d9a4;font-size:12px;">
                        <strong style="color:#b45309;">Allocation changed manually</strong>
                        ${c.allocationExceptions.map(x => `<div style="margin-top:3px;">${esc(x.label)}: <s>${esc(x.suggestedName || '-')}</s> &rarr; <strong>${esc(x.chosenName || '-')}</strong> &ndash; &ldquo;${esc(x.remark)}&rdquo; <span style="color:#5b6560;">(${esc((x.by && x.by.name) || '')}, ${x.at ? new Date(x.at).toLocaleString() : ''})</span></div>`).join('')}
                    </div>` : ''}

                    <div class="spec-line" style="margin-top:6px;">
                        Patient: <strong>${esc(c.userName)}</strong> (${esc(c.clientName)}) • Category: <strong>${esc(c.caseType)}</strong> • Zone: <strong>${esc(c.state || c.zone)}</strong> (PIN: ${esc(c.pin)})
                        ${isDigital ? ` • Lang: <strong>${esc(c.digitalLang || 'Any')}</strong>` : ''}
                    </div>

                    <div class="spec-line" style="font-size:11.5px; margin-top:4px;">
                        Field Officer: <strong>${esc(c.approvals?.fieldOfficer || (isDigital ? 'Bypassed' : 'Pending'))}</strong> (${esc(c.assignedTeam?.fieldOfficer || 'Bypassed')}) | 
                        Auditor: <strong>${esc(c.approvals?.auditor || 'Pending')}</strong> (${esc(c.assignedTeam?.auditor || 'Pending')})
                    </div>

                    <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                        <div>
                            Status: <span class="status-pill ${decision === 'Approved' ? 'active' : (decision === 'Rejected' ? 'inactive' : 'pending')}">${decision}</span>
                            ${c.coordinatorRejectionReason ? `<span style="color:var(--red); font-size:11px; margin-left:6px;">"${esc(c.coordinatorRejectionReason)}"</span>` : ''}
                        </div>

                        ${!isDecided ? `
                            <div style="display:flex; gap:8px;">
                                <button class="btn small approve" onclick="handleCoordDecision('${c.id}', 'Approved')">✓ Certify &amp; Approve</button>
                                <button class="btn small reject" onclick="handleCoordRejectPrompt('${c.id}')">✕ Discrepancy</button>
                            </div>
                        ` : `
                            <span style="font-size:11.5px; color:var(--ink-soft);">Certified by ${esc(currentCoord.name)}</span>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    }

    window.handleCoordRejectPrompt = function (caseId) {
        const reason = prompt('Please enter formal rejection justification:');
        if (!reason || !reason.trim()) return;
        handleCoordDecision(caseId, 'Rejected', reason.trim());
    };

    window.handleCoordDecision = function (caseId, decision, reason = '') {
        const cases = getCases();
        const target = cases.find(c => c.id === caseId);
        if (!target) return;

        target.approvals = target.approvals || {};
        target.approvals.coordinator = decision;

        if (decision === 'Rejected') {
            target.coordinatorRejectionReason = reason;
            target.status = 'Disputed / Coordinator Discrepancy';
        } else {
            const foCleared = target.approvals.fieldOfficer === 'Approved' || target.approvals.fieldOfficer === 'Bypassed';
            const audCleared = target.approvals.auditor === 'Approved';

            if (foCleared && audCleared) {
                target.status = 'Approved';
                target.referenceId = 'REF-SETTLE-' + Math.floor(100000 + Math.random() * 900000);
                target.settledAt = new Date().toLocaleString();
            } else {
                if (!String(target.status).includes('Disputed')) target.status = 'In Progress';
            }
        }

        saveCases(cases);

        try {
            fetch('/api/cases/' + caseId, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(target)
            }).catch(function () { });
        } catch (e) { }

        renderQueue();
    };

    btnOpenAddModal?.addEventListener('click', () => { if (addCoordModal) addCoordModal.style.display = 'flex'; });
    btnCloseModal?.addEventListener('click', () => { if (addCoordModal) addCoordModal.style.display = 'none'; });

    newCoordForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const langs = document.getElementById('newCoordLanguages')?.value.split(',').map(s => s.trim()).filter(Boolean) || [];
        const statesInput = document.getElementById('newCoordStates')?.value.split(',').map(s => s.trim()).filter(Boolean) || [];

        const newCoord = {
            id: 'COORD-' + Date.now().toString().slice(-4),
            name: document.getElementById('newCoordName').value.trim(),
            employeeId: document.getElementById('newCoordEmpId').value.trim().toUpperCase(),
            zone: document.getElementById('newCoordZone').value,
            states: statesInput.length > 0 ? statesInput : [document.getElementById('newCoordZone').value],
            designation: 'Operations Coordinator',
            languages: langs.length > 0 ? langs : ['Bengali', 'Hindi', 'English'],
            email: document.getElementById('newCoordEmail').value.trim().toLowerCase(),
            phone: document.getElementById('newCoordPhone').value.trim(),
            maxCapacity: 4,
            role: 'Coordinator',
            isActive: true
        };

        const list = getCoordinators();
        if (list.some(c => c.employeeId === newCoord.employeeId || c.email === newCoord.email)) {
            alert('A coordinator with this Employee ID or Email already exists!');
            return;
        }

        list.push(newCoord);
        saveCoordinators(list);

        alert(`✓ Coordinator "${newCoord.name}" (${newCoord.employeeId}) registered successfully!`);
        newCoordForm.reset();
        if (addCoordModal) addCoordModal.style.display = 'none';

        currentCoord = newCoord;
        updateProfileView();
        renderAll();
    });

    searchCoordInput?.addEventListener('input', () => {
        renderCoordinatorDirectory();
    });

    btnSyncQueue?.addEventListener('click', renderAll);
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY_CASES || e.key === STORAGE_KEY_COORDS) renderAll();
    });
})();