(function () {
    'use strict';

    const STORAGE_KEY_AUDITORS = 'ca_registered_auditors';
    const STORAGE_KEY_CASES = 'ca_shared_cases';

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

    // Helper: Categorize clients into Cashless Only, RI Only, and Both
    function parseClientScopes(clientsArray) {
        const rawList = Array.isArray(clientsArray)
            ? clientsArray
            : (typeof clientsArray === 'string' ? clientsArray.split(/[,;]/) : []);

        const cashlessOnly = [];
        const riOnly = [];
        const bothScopes = [];

        rawList.forEach(raw => {
            const item = String(raw || '').trim();
            if (!item) return;

            const lower = item.toLowerCase();
            const cleanName = item.split('(')[0].trim();

            if (lower.includes('cashless only')) {
                cashlessOnly.push(cleanName);
            } else if (lower.includes('ri only') || lower.includes('reimbursement only')) {
                riOnly.push(cleanName);
            } else {
                bothScopes.push(cleanName || item);
            }
        });

        return { cashlessOnly, riOnly, bothScopes, total: rawList.length };
    }

    // Helper: Render simple unique carrier chips for Heading 1
    function renderCarrierList(clientsArray) {
        const rawList = Array.isArray(clientsArray)
            ? clientsArray
            : (typeof clientsArray === 'string' ? clientsArray.split(/[,;]/) : []);

        if (!rawList.length) {
            return '<span style="color:var(--ink-soft); font-size:12px;">No insurance companies assigned</span>';
        }

        const uniqueCarriers = [...new Set(rawList.map(item => String(item || '').split('(')[0].trim()).filter(Boolean))];

        return uniqueCarriers.map(c => `
            <span class="badge-chip badge-client" style="background:#f1f5f9; color:#0f172a; border:1px solid #cbd5e1; font-weight:700; font-size:11.5px; padding:3px 9px; margin:2px 4px; display:inline-block;">
                🏥 ${esc(c)}
            </span>
        `).join('');
    }

    // Helper: 3-Tier Categorized Scope Box for Heading 2
    function renderGroupedClientScopes(clientsArray) {
        const { cashlessOnly, riOnly, bothScopes, total } = parseClientScopes(clientsArray);

        if (!total) {
            return '<span style="color:var(--ink-soft); font-size:12px;">No client scopes configured</span>';
        }

        const renderChips = (list, chipClass) => {
            if (!list.length) return '<span style="color:#94a3b8; font-size:11px; font-style:italic;">None</span>';
            return list.map(c => `<span class="${chipClass}">${esc(c)}</span>`).join('');
        };

        return `
            <div class="scope-overview-box">
                <div class="scope-row">
                    <span class="scope-title scope-cl">💳 Cashless Only:</span>
                    <div class="scope-chips-wrap">
                        ${renderChips(cashlessOnly, 'chip-cl')}
                    </div>
                </div>
                <div class="scope-row">
                    <span class="scope-title scope-ri">📑 RI Only:</span>
                    <div class="scope-chips-wrap">
                        ${renderChips(riOnly, 'chip-ri')}
                    </div>
                </div>
                <div class="scope-row">
                    <span class="scope-title scope-both">🔄 Both (Cashless + RI):</span>
                    <div class="scope-chips-wrap">
                        ${renderChips(bothScopes, 'chip-both')}
                    </div>
                </div>
            </div>
        `;
    }

    // Helper: Compact categorized badges for Auditor Table Directory
    function renderTableGroupedClients(clientsArray) {
        const { cashlessOnly, riOnly, bothScopes, total } = parseClientScopes(clientsArray);

        if (!total) return '<span style="color:var(--ink-soft); font-size:11px;">None</span>';

        const chip = (name, bg, fg, border) => `<span style="display:inline-block; margin:1px 2px; padding:1px 6px; border-radius:6px; font-size:10px; font-weight:700; background:${bg}; color:${fg}; border:1px solid ${border};">${esc(name)}</span>`;

        let html = '';
        if (cashlessOnly.length) {
            html += `<div style="margin-bottom:2px;"><strong style="color:#1d4ed8; font-size:10px;">💳 CL:</strong> ${cashlessOnly.map(c => chip(c, '#eff6ff', '#1d4ed8', '#bfdbfe')).join('')}</div>`;
        }
        if (riOnly.length) {
            html += `<div style="margin-bottom:2px;"><strong style="color:#b45309; font-size:10px;">📑 RI:</strong> ${riOnly.map(c => chip(c, '#fffbeb', '#b45309', '#fde68a')).join('')}</div>`;
        }
        if (bothScopes.length) {
            html += `<div><strong style="color:#047857; font-size:10px;">🔄 Both:</strong> ${bothScopes.map(c => chip(c, '#ecfdf5', '#047857', '#a7f3d0')).join('')}</div>`;
        }

        return html || '<span style="color:var(--ink-soft); font-size:11px;">None</span>';
    }

    const defaultWeeklySchedule = {
        Mon: 'Both',
        Tue: 'Both',
        Wed: 'Both',
        Thu: 'Both',
        Fri: 'Both',
        Sat: 'Both'
    };

    const excelAuditorRoster = [];

    let currentAuditor = null;

    const topRoleTag = document.getElementById('topRoleTag');
    const dispAuditorName = document.getElementById('dispAuditorName');
    const dispAuditorMeta = document.getElementById('dispAuditorMeta');
    const dispEmpId = document.getElementById('dispEmpId');
    const dispEmpType = document.getElementById('dispEmpType');
    const dispAuditMode = document.getElementById('dispAuditMode');
    const dispAllCarriers = document.getElementById('dispAllCarriers');
    const dispClients = document.getElementById('dispClients');
    const dispLanguages = document.getElementById('dispLanguages');
    const dispWorkingDays = document.getElementById('dispWorkingDays');
    const dispWeeklySchedule = document.getElementById('dispWeeklySchedule');
    const dutyToggle = document.getElementById('dutyToggle');
    const dutyStatusText = document.getElementById('dutyStatusText');

    const dispActiveLoad = document.getElementById('dispActiveLoad');
    const dispMonthlyTarget = document.getElementById('dispMonthlyTarget');
    const dispMtdCount = document.getElementById('dispMtdCount');
    const dispSpecialty = document.getElementById('dispSpecialty');

    const auditorDirectoryBody = document.getElementById('auditorDirectoryBody');
    const queueHeading = document.getElementById('queueHeading');
    const queueListWrap = document.getElementById('queueListWrap');
    const btnSyncQueue = document.getElementById('btnSyncQueue');
    const searchAuditorInput = document.getElementById('searchAuditorInput');

    const addAuditorModal = document.getElementById('addAuditorModal');
    const btnOpenAddModal = document.getElementById('btnOpenAddModal');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnCancelModal = document.getElementById('btnCancelModal');
    const newAuditorForm = document.getElementById('newAuditorForm');

    // Edit Auditor Profile & Scope Modal Elements
    const editAuditorModal = document.getElementById('editAuditorModal');
    const btnEditAuditorProfile = document.getElementById('btnEditAuditorProfile');
    const btnCloseEditModal = document.getElementById('btnCloseEditModal');
    const btnCancelEditModal = document.getElementById('btnCancelEditModal');
    const editAuditorForm = document.getElementById('editAuditorForm');

    const getAuditors = () => safeParse(STORAGE_KEY_AUDITORS, excelAuditorRoster);
    const saveAuditors = (list) => localStorage.setItem(STORAGE_KEY_AUDITORS, JSON.stringify(list));
    const getCases = () => safeParse(STORAGE_KEY_CASES, []);
    const saveCases = (cases) => localStorage.setItem(STORAGE_KEY_CASES, JSON.stringify(cases));

    const roster = getAuditors();
    currentAuditor = (window.CA_pickMe && window.CA_pickMe(roster, 0)) ||
        { employeeId: '-', name: 'No auditors imported yet', employmentType: '-', languages: [], clients: [], specialization: [], monthlyCapacity: 0, dailyCapacity: 0, isActive: false, leaveDays: 0, schedule: { ...defaultWeeklySchedule } };

    updateProfileView();
    renderAll();

    window.selectAuditor = function (empId) {
        if (window.CA_isAdmin && !window.CA_isAdmin()) return;
        const auditors = getAuditors();
        const found = auditors.find(a => a.employeeId === empId);
        if (found) {
            currentAuditor = found;
            updateProfileView();
            renderAll();
        }
    };

    window.setAuditorLeave = function (empId, days, event) {
        if (event) event.stopPropagation();
        const d = parseInt(days, 10) || 0;
        const auditors = getAuditors();
        const target = auditors.find(a => a.employeeId === empId);
        if (target) {
            target.leaveDays = d;
            target.isActive = (d === 0);
            saveAuditors(auditors);
            if (currentAuditor.employeeId === empId) {
                currentAuditor.leaveDays = d;
                currentAuditor.isActive = target.isActive;
                updateProfileView();
            }
            renderAll();
        }
    };

    window.adjustMonthlyQuota = function (empId, delta, event) {
        if (event) event.stopPropagation();
        const auditors = getAuditors();
        const target = auditors.find(a => a.employeeId === empId);
        if (target) {
            target.monthlyCapacity = Math.max(10, (target.monthlyCapacity || 50) + delta);
            saveAuditors(auditors);
            if (currentAuditor.employeeId === empId) {
                currentAuditor.monthlyCapacity = target.monthlyCapacity;
                updateProfileView();
            }
            renderAll();
        }
    };

    function updateProfileView() {
        if (!currentAuditor) return;

        if (topRoleTag) topRoleTag.textContent = `Auditor · ${currentAuditor.name}`;
        if (dispAuditorName) dispAuditorName.textContent = currentAuditor.name;
        if (dispAuditorMeta) dispAuditorMeta.textContent = `${currentAuditor.employmentType} Clinical Auditor • Daily Limit: ${currentAuditor.dailyCapacity} Cases`;
        if (dispEmpId) dispEmpId.textContent = currentAuditor.employeeId;
        if (dispEmpType) dispEmpType.textContent = currentAuditor.employmentType;
        if (dispAuditMode) dispAuditMode.textContent = (currentAuditor.specialization || []).join(', ');

        // Heading 1: All Assigned Insurance Companies
        if (dispAllCarriers) {
            dispAllCarriers.innerHTML = renderCarrierList(currentAuditor.clients);
        }

        // Heading 2: Categorized CL vs RI Breakdown
        if (dispClients) {
            dispClients.innerHTML = renderGroupedClientScopes(currentAuditor.clients);
        }

        if (dispLanguages) {
            dispLanguages.innerHTML = (currentAuditor.languages || [])
                .map(l => `<span class="badge-chip badge-lang">${esc(l)}</span>`).join('');
        }

        const lDays = currentAuditor.leaveDays || 0;
        if (dispWorkingDays) {
            if (lDays === 0) {
                dispWorkingDays.innerHTML = '<strong style="color:var(--green);">🟢 Present on Duty (0d leave)</strong>';
            } else if (lDays === 1) {
                dispWorkingDays.innerHTML = '<strong style="color:var(--amber);">🟡 Short Leave (1d) — RI Priority Eligible</strong>';
            } else {
                dispWorkingDays.innerHTML = `<strong style="color:var(--red);">🔴 Absent (${lDays}d leave) — Blocked from Cases</strong>`;
            }
        }

        if (dispWeeklySchedule) {
            const sch = currentAuditor.schedule || defaultWeeklySchedule;
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            dispWeeklySchedule.innerHTML = days.map(d => {
                const type = sch[d] || 'Both';
                const isCl = type === 'Cashless';
                const isRi = type === 'Reimbursement';
                const badgeClass = isCl ? 'badge-day-cl' : (isRi ? 'badge-day-ri' : 'badge-spec');
                return `
                    <div class="schedule-cell">
                        <strong>${d}</strong>
                        <span class="badge-chip ${type === 'Off' ? '' : badgeClass}" style="${type === 'Off' ? 'background:#fee2e2; color:#b91c1c;' : ''}">
                            ${type === 'Both' ? 'CL + RI' : (type === 'Off' ? 'Off' : type)}
                        </span>
                    </div>
                `;
            }).join('');
        }

        if (dutyToggle) dutyToggle.checked = (lDays === 0);
        if (dutyStatusText) {
            dutyStatusText.textContent = (lDays === 0) ? 'Active on Duty (Present)' : `Off Duty (${lDays}d Leave)`;
        }

        if (queueHeading) {
            queueHeading.textContent = `Assigned Clinical Pipeline: ${currentAuditor.name} (${currentAuditor.employeeId})`;
        }
    }

    dutyToggle?.addEventListener('change', () => {
        const isPresent = dutyToggle.checked;
        const auditors = getAuditors();
        const idx = auditors.findIndex(a => a.employeeId === currentAuditor.employeeId);
        if (idx !== -1) {
            auditors[idx].isActive = isPresent;
            auditors[idx].leaveDays = isPresent ? 0 : 2;
            currentAuditor.isActive = isPresent;
            currentAuditor.leaveDays = auditors[idx].leaveDays;
            saveAuditors(auditors);
        }
        updateProfileView();
        renderAuditorDirectory();
    });

    // =========================================================================
    // EDIT AUDITOR PROFILE & SCOPE MODAL HANDLERS
    // =========================================================================
    function closeEditModal() {
        if (editAuditorModal) editAuditorModal.style.display = 'none';
    }

    btnEditAuditorProfile?.addEventListener('click', () => {
        if (!currentAuditor || !currentAuditor.employeeId || currentAuditor.employeeId === '-') {
            alert('Please select a valid auditor from the directory table first.');
            return;
        }

        document.getElementById('editAudEmpId').value = currentAuditor.employeeId;
        document.getElementById('editAudName').value = currentAuditor.name;
        document.getElementById('editAudClients').value = (currentAuditor.clients || []).join(', ');
        document.getElementById('editAudLanguages').value = (currentAuditor.languages || []).join(', ');

        const sch = currentAuditor.schedule || defaultWeeklySchedule;
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
            const selectEl = document.getElementById(`edit_day_${day}`);
            if (selectEl) selectEl.value = sch[day] || 'Both';
        });

        if (editAuditorModal) editAuditorModal.style.display = 'flex';
    });

    btnCloseEditModal?.addEventListener('click', closeEditModal);
    btnCancelEditModal?.addEventListener('click', closeEditModal);

    editAuditorForm?.addEventListener('submit', (e) => {
        e.preventDefault();

        const empId = document.getElementById('editAudEmpId').value;
        const updatedClients = document.getElementById('editAudClients').value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        const updatedLangs = document.getElementById('editAudLanguages').value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        const updatedSchedule = {
            Mon: document.getElementById('edit_day_Mon')?.value || 'Both',
            Tue: document.getElementById('edit_day_Tue')?.value || 'Both',
            Wed: document.getElementById('edit_day_Wed')?.value || 'Both',
            Thu: document.getElementById('edit_day_Thu')?.value || 'Both',
            Fri: document.getElementById('edit_day_Fri')?.value || 'Both',
            Sat: document.getElementById('edit_day_Sat')?.value || 'Both'
        };

        const auditors = getAuditors();
        const target = auditors.find(a => a.employeeId === empId);

        if (target) {
            target.clients = updatedClients;
            target.languages = updatedLangs;
            target.schedule = updatedSchedule;

            saveAuditors(auditors);

            if (currentAuditor.employeeId === empId) {
                currentAuditor.clients = updatedClients;
                currentAuditor.languages = updatedLangs;
                currentAuditor.schedule = updatedSchedule;
                updateProfileView();
            }

            // Central server synchronization if API is configured
            try {
                fetch('/api/members/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employeeId: empId, role: 'Auditor', data: target })
                }).catch(() => {});
            } catch (err) {}

            renderAll();
            closeEditModal();
            alert(`✓ Scope & Day-Shift Schedule updated for "${target.name}"!`);
        }
    });

    function renderAll() {
        renderAuditorDirectory();
        renderQueue();
    }

    function renderAuditorDirectory() {
        if (!auditorDirectoryBody) return;
        const auditors = getAuditors();
        const allCases = getCases();

        const searchVal = document.getElementById('searchAuditorInput')?.value.trim().toLowerCase() || '';

        const filteredList = auditors.filter(a => {
            if (!searchVal) return true;
            const aName = String(a.name || '').toLowerCase();
            const aId = String(a.employeeId || '').toLowerCase();
            return aName.includes(searchVal) || aId.includes(searchVal);
        });

        if (filteredList.length === 0) {
            auditorDirectoryBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align:center; padding:24px; color:var(--ink-soft);">
                        No clinical auditors found matching "<strong>${esc(searchVal)}</strong>".
                    </td>
                </tr>
            `;
            return;
        }

        auditorDirectoryBody.innerHTML = filteredList.map(a => {
            const isSelected = a.employeeId === currentAuditor.employeeId;
            const inHand = allCases.filter(c =>
                (c.assignedTeam?.auditor === a.name || c.auditorId === a.employeeId) &&
                c.status !== 'Approved' &&
                c.approvals?.auditor === 'Pending'
            ).length + ((a.externalLoad && a.externalLoad.total) || 0);

            const clientBadges = renderTableGroupedClients(a.clients);
            const langBadges = (a.languages || []).map(l => `<span class="badge-chip badge-lang">${esc(l)}</span>`).join('');
            const lDays = a.leaveDays || 0;
            const sch = a.schedule || defaultWeeklySchedule;

            const weekTags = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => {
                const t = sch[d] || 'Both';
                return `<span style="font-size:9.5px; padding:1px 4px; border-radius:3px; background:#f1f5f9; color:#475569; margin:1px;">${d}:${t[0]}</span>`;
            }).join('');

            return `
                <tr class="auditor-row ${isSelected ? 'selected-auditor' : ''}" onclick="selectAuditor('${a.employeeId}')">
                    <td>
                        <strong>${esc(a.name)}</strong><br>
                        <span style="font-family:monospace; font-size:11px; color:var(--accent); font-weight:700;">EMP: ${esc(a.employeeId)}</span>
                        ${isSelected ? '<span class="status-pill active" style="font-size:9.5px; margin-left:4px;">Viewing</span>' : ''}
                    </td>
                    <td>
                        <strong style="color:${String(a.employmentType || '').includes('On-Roll') ? '#059669' : '#2563eb'};">${esc(a.employmentType || 'Off-Roll')}</strong><br>
                        <small style="color:var(--ink-soft);">${esc((a.specialization || []).join(', '))}</small>
                    </td>
                    <td><div style="max-width:260px;">${clientBadges}</div></td>
                    <td>${langBadges}</td>
                    <td><div style="display:flex; flex-wrap:wrap; max-width:140px;">${weekTags}</div></td>
                    <td>
                        <select style="padding:4px 6px; font-size:11px; font-weight:700; border-radius:6px; border:1px solid #cbd5e1; background:#fff; cursor:pointer;" onchange="setAuditorLeave('${a.employeeId}', this.value, event)" onclick="event.stopPropagation()">
                            <option value="0" ${lDays === 0 ? 'selected' : ''}>🟢 Present (Cashless &amp; RI)</option>
                            <option value="1" ${lDays === 1 ? 'selected' : ''}>🟡 Leave 1d (RI Priority)</option>
                            <option value="2" ${lDays === 2 ? 'selected' : ''}>🔴 Leave 2d (Blocked)</option>
                            <option value="3" ${lDays >= 3 ? 'selected' : ''}>🔴 Leave 3d+ (Blocked)</option>
                        </select>
                    </td>
                    <td>
                        <strong style="color:${inHand >= a.dailyCapacity ? 'var(--red)' : 'var(--amber)'}; font-size:13px;">${inHand} / ${a.dailyCapacity} In-Hand</strong>
                    </td>
                    <td>
                        <div style="display:inline-flex; align-items:center; gap:6px;">
                            <button class="btn small ghost" style="padding:2px 7px;" onclick="adjustMonthlyQuota('${a.employeeId}', -10, event)">-</button>
                            <strong>${a.monthlyCapacity || 50}</strong>
                            <button class="btn small ghost" style="padding:2px 7px;" onclick="adjustMonthlyQuota('${a.employeeId}', 10, event)">+</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderQueue() {
        const allCases = getCases();
        const myCases = allCases.filter(c => {
            return (c.assignedTeam && c.assignedTeam.auditor === currentAuditor.name) ||
                (c.auditorId === currentAuditor.employeeId);
        });

        const inHandCases = myCases.filter(c => (c.approvals?.auditor || 'Pending') === 'Pending');
        const completedCases = myCases.filter(c => c.approvals?.auditor === 'Approved');

        if (dispActiveLoad) dispActiveLoad.textContent = `${inHandCases.length + ((currentAuditor.externalLoad && currentAuditor.externalLoad.total) || 0)} Files`;
        if (dispMonthlyTarget) dispMonthlyTarget.textContent = `${currentAuditor.monthlyCapacity || 50} Cases`;
        if (dispMtdCount) dispMtdCount.textContent = `${completedCases.length} Cases`;
        if (dispSpecialty) dispSpecialty.textContent = (currentAuditor.specialization || []).join(', ');

        if (!queueListWrap) return;
        if (myCases.length === 0) {
            queueListWrap.innerHTML = `
                <div style="text-align:center; padding:32px; color:var(--ink-soft);">
                    No dockets currently assigned to <strong>${esc(currentAuditor.name)}</strong> (${esc(currentAuditor.employeeId)}).
                </div>
            `;
            return;
        }

        queueListWrap.innerHTML = myCases.map(c => {
            const decision = c.approvals?.auditor || 'Pending';
            const isDigital = c.caseType === 'Digital';

            return `
                <div class="claim-card" style="margin-bottom:12px; border-left:4px solid ${decision === 'Approved' ? 'var(--green)' : 'var(--accent)'};">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                        <div>
                            <strong>Case ID: ${esc(c.id)} (Claim #${esc(c.claimNo)})</strong>
                            <span class="status-pill ${c.status === 'Approved' ? 'active' : 'pending'}" style="margin-left:6px;">${esc(c.status)}</span>
                            ${c.referenceId ? `<span class="status-pill active" style="margin-left:4px; font-size:10px;">✓ ${esc(c.referenceId)}</span>` : ''}
                        </div>
                    </div>

                    <div class="spec-line" style="margin-top:6px;">
                        Patient: <strong>${esc(c.userName)}</strong> • Carrier: <strong style="color:var(--accent);">${esc(c.clientName)}</strong> • Scope: <strong>${esc(c.caseType)}</strong>
                        ${isDigital ? ` • Lang: <strong>${esc(c.digitalLang || 'Any')}</strong>` : ''}
                    </div>

                    <div class="spec-line" style="font-size:11.5px; margin-top:4px;">
                        Coordinator: <strong>${esc(c.approvals?.coordinator || 'Pending')}</strong> (${esc(c.assignedTeam?.coordinator)}) | 
                        Field Officer: <strong>${esc(c.approvals?.fieldOfficer || (isDigital ? 'Bypassed' : 'Pending'))}</strong> (${esc(c.assignedTeam?.fieldOfficer || 'Bypassed')})
                    </div>

                    <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                        <div>
                            Status: <span class="status-pill ${decision === 'Approved' ? 'active' : (decision === 'Rejected' ? 'inactive' : 'pending')}">${esc(decision)}</span>
                            ${c.auditorRejectionReason ? `<span style="color:var(--red); font-size:11px; margin-left:6px;">"${esc(c.auditorRejectionReason)}"</span>` : ''}
                        </div>

                        ${decision === 'Pending' ? `
                            <div style="display:flex; gap:8px;">
                                <button class="btn small approve" onclick="handleAuditorDecision('${c.id}', 'Approved')">Approve Clearance</button>
                                <button class="btn small reject" onclick="handleAuditorRejectPrompt('${c.id}')">Raise Tariff / Medical Objection</button>
                            </div>
                        ` : `
                            <span style="font-size:11.5px; color:var(--ink-soft);">Certified by ${esc(currentAuditor.name)}</span>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    }

    window.handleAuditorRejectPrompt = function (caseId) {
        const reason = prompt('Please enter clinical/tariff objection finding:');
        if (!reason || !reason.trim()) return;
        const cases = getCases();
        const target = cases.find(c => String(c.id).trim() === String(caseId).trim() || String(c.claimNo).trim() === String(caseId).trim());
        if (!target) return;
        target.approvals = target.approvals || {};
        target.approvals.auditor = 'Rejected';
        target.auditorRejectionReason = reason.trim();
        target.status = 'Disputed / Auditor Objection';
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

    window.handleAuditorDecision = function (caseId, decision) {
        const cases = getCases();
        const target = cases.find(c => String(c.id).trim() === String(caseId).trim() || String(c.claimNo).trim() === String(caseId).trim());
        if (!target) return;

        target.approvals = target.approvals || {};
        target.approvals.auditor = decision;

        const isCoordApproved = target.approvals.coordinator === 'Approved';
        const isFoApproved = target.approvals.fieldOfficer === 'Approved' || target.approvals.fieldOfficer === 'Bypassed';

        if (isCoordApproved && isFoApproved) {
            const cleanClaim = String(target.claimNo || target.id).trim();
            target.status = 'Approved';
            target.referenceId = 'REF-SETTLE-' + cleanClaim;
            target.settledAt = new Date().toLocaleString();
        } else {
            if (!String(target.status).includes('Disputed')) target.status = 'In Progress';
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

    function closeModal() {
        if (addAuditorModal) addAuditorModal.style.display = 'none';
        if (newAuditorForm) newAuditorForm.reset();
    }

    btnOpenAddModal?.addEventListener('click', () => { if (addAuditorModal) addAuditorModal.style.display = 'flex'; });
    btnCloseModal?.addEventListener('click', closeModal);
    btnCancelModal?.addEventListener('click', closeModal);

    newAuditorForm?.addEventListener('submit', (e) => {
        e.preventDefault();

        const clients = document.getElementById('newAudClients').value.split(',').map(s => s.trim()).filter(Boolean);
        const langs = document.getElementById('newAudLanguages').value.split(',').map(s => s.trim()).filter(Boolean);
        const mode = document.getElementById('newAudMode').value;

        const isDigital = mode === 'Both' || mode === 'Virtual';
        const isPhysical = mode === 'Both' || mode === 'Non-Virtual';

        const specs = [];
        if (isDigital) specs.push('Digital (VI)');
        if (isPhysical) specs.push('Physical');

        const weeklySchedule = {
            Mon: document.getElementById('day_Mon')?.value || 'Both',
            Tue: document.getElementById('day_Tue')?.value || 'Both',
            Wed: document.getElementById('day_Wed')?.value || 'Both',
            Thu: document.getElementById('day_Thu')?.value || 'Both',
            Fri: document.getElementById('day_Fri')?.value || 'Both',
            Sat: document.getElementById('day_Sat')?.value || 'Both'
        };

        const newAud = {
            name: document.getElementById('newAudName').value.trim(),
            employeeId: document.getElementById('newAudEmpId').value.trim().toUpperCase(),
            employmentType: document.getElementById('newAudEmpType').value,
            specialization: specs,
            isDigital: isDigital,
            isPhysical: isPhysical,
            clients: clients,
            languages: langs,
            schedule: weeklySchedule,
            monthlyCapacity: parseInt(document.getElementById('newAudMonthlyQuota').value, 10) || 50,
            dailyCapacity: 5,
            isActive: true,
            leaveDays: 0,
            role: 'Auditor'
        };

        const auditors = getAuditors();
        if (auditors.some(a => a.employeeId === newAud.employeeId)) {
            alert('An auditor with this Employee ID already exists!');
            return;
        }

        auditors.push(newAud);
        saveAuditors(auditors);

        alert(`✓ Auditor "${newAud.name}" registered successfully with customized weekly shift planner!`);
        closeModal();

        currentAuditor = newAud;
        updateProfileView();
        renderAll();
    });

    document.getElementById('btnExportAuditorCsv')?.addEventListener('click', () => {
        const auditors = getAuditors();
        const allCases = getCases();

        if (!auditors || auditors.length === 0) {
            alert('No auditors available to export.');
            return;
        }

        const headers = [
            "Employee ID",
            "Auditor Name",
            "Employment Type",
            "Specialization",
            "Assigned Clients",
            "Languages",
            "Duty Status",
            "Shift Mon-Sat",
            "In-Hand Load"
        ];

        const rows = auditors.map(a => {
            const myCases = allCases.filter(c => (c.assignedTeam?.auditor === a.name || c.auditorId === a.employeeId));
            const inHand = myCases.filter(c => (c.approvals?.auditor || 'Pending') === 'Pending').length + ((a.externalLoad && a.externalLoad.total) || 0);
            const sch = a.schedule || defaultWeeklySchedule;
            const schStr = `Mon:${sch.Mon};Tue:${sch.Tue};Wed:${sch.Wed};Thu:${sch.Thu};Fri:${sch.Fri};Sat:${sch.Sat}`;

            return [
                `"${a.employeeId || ''}"`,
                `"${a.name || ''}"`,
                `"${a.employmentType || 'Off-Roll'}"`,
                `"${(a.specialization || []).join('; ')}"`,
                `"${(a.clients || []).join('; ')}"`,
                `"${(a.languages || []).join('; ')}"`,
                `"${a.leaveDays === 0 ? 'Present' : 'Leave ' + a.leaveDays + 'd'}"`,
                `"${schStr}"`,
                inHand
            ];
        });

        const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Auditor_Weekly_Roster_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });

    searchAuditorInput?.addEventListener('input', () => {
        renderAuditorDirectory();
    });

    btnSyncQueue?.addEventListener('click', renderAll);
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY_CASES || e.key === STORAGE_KEY_AUDITORS) renderAll();
    });
})();