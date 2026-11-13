(function () {
    'use strict';

    // =========================================================================
    // INJECT MASTER ADMIN INPUT & DROPDOWN UI STYLING
    // =========================================================================
    if (!document.getElementById('ca-admin-input-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'ca-admin-input-styles';
        styleEl.textContent = `
            /* Master Admin Clean Select & Dropdown Styling */
            select, .admin-select {
                appearance: none !important;
                -webkit-appearance: none !important;
                background-color: #ffffff !important;
                background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2316382c' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e") !important;
                background-repeat: no-repeat !important;
                background-position: right 12px center !important;
                background-size: 13px !important;
                padding: 8px 34px 8px 12px !important;
                border: 1.5px solid #cbd5e1 !important;
                border-radius: 8px !important;
                font-size: 13px !important;
                font-weight: 600 !important;
                color: #1e293b !important;
                outline: none !important;
                cursor: pointer !important;
                box-sizing: border-box !important;
                transition: border-color 0.2s, box-shadow 0.2s !important;
            }
            select:focus, .admin-select:focus {
                border-color: #16382c !important;
                box-shadow: 0 0 0 3px rgba(22, 56, 44, 0.12) !important;
            }

            /* Master Admin Text, Search & Number Inputs */
            input[type="text"], input[type="search"] {
                padding: 8px 12px !important;
                border: 1.5px solid #cbd5e1 !important;
                border-radius: 8px !important;
                font-size: 13px !important;
                color: #1e293b !important;
                background: #ffffff !important;
                outline: none !important;
                box-sizing: border-box !important;
                transition: border-color 0.2s, box-shadow 0.2s !important;
            }
            input[type="text"]:focus, input[type="search"]:focus {
                border-color: #16382c !important;
                box-shadow: 0 0 0 3px rgba(22, 56, 44, 0.12) !important;
            }

            /* Table Row Capacity Number Inputs */
            .admin-cap-input {
                width: 58px !important;
                height: 32px !important;
                padding: 4px 6px !important;
                font-size: 12.5px !important;
                font-weight: 800 !important;
                color: #16382c !important;
                background: #f8fafc !important;
                border: 1.5px solid #cbd5e1 !important;
                border-radius: 6px !important;
                text-align: center !important;
                outline: none !important;
                box-sizing: border-box !important;
                transition: all 0.2s ease !important;
            }
            .admin-cap-input:focus {
                background: #ffffff !important;
                border-color: #16382c !important;
                box-shadow: 0 0 0 2px rgba(22, 56, 44, 0.18) !important;
            }

            @media (max-width: 768px) {
                select, input[type="text"], input[type="search"] {
                    width: 100% !important;
                    margin-bottom: 6px !important;
                }
            }
        `;
        document.head.appendChild(styleEl);
    }

    const STORAGE_KEY_COORDS = 'ca_registered_coordinators';
    const STORAGE_KEY_AUDITORS = 'ca_registered_auditors';
    const STORAGE_KEY_FO = 'ca_registered_field_officers';
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

    function renderAdminGroupedClients(clientsArray) {
        const rawList = Array.isArray(clientsArray)
            ? clientsArray
            : (typeof clientsArray === 'string' ? clientsArray.split(/[,;]/) : []);

        if (!rawList.length) return '<span style="color:var(--ink-soft); font-size:11px;">None</span>';

        const cashlessOnly = [];
        const riOnly = [];
        const bothScopes = [];

        rawList.forEach(raw => {
            const item = String(raw).trim();
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

    const getList = (k) => safeParse(k, []);
    const saveList = (k, v) => localStorage.setItem(k, JSON.stringify(v));

    const topRoleTag = document.getElementById('topRoleTag');
    if (topRoleTag && window.CA_ME) topRoleTag.textContent = 'Master Admin · ' + window.CA_ME.name;

    window.adminResetPassword = async function (id, storageKey) {
        if (!confirm('Would you like to reset this staff member\'s password? A new temporary password will be generated.')) return;
        const roleByKey = {};
        roleByKey[STORAGE_KEY_COORDS] = 'Coordinator';
        roleByKey[STORAGE_KEY_AUDITORS] = 'Auditor';
        roleByKey[STORAGE_KEY_FO] = 'FieldOfficer';
        try {
            const res = await fetch('/api/admin/users/' + encodeURIComponent(id) + '/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: roleByKey[storageKey] || undefined })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Password reset failed.');
            prompt(`${data.name} (${data.employeeId}) — New Temporary Password generated. Copy and securely share it with the user (it will only be displayed once):`, data.tempPassword);
        } catch (e) { alert(e.message); }
    };

    window.adjustLeaveDays = function (empId) {
        const auds = getList(STORAGE_KEY_AUDITORS);
        const item = auds.find(a => String(a.employeeId || a.id) === String(empId));
        if (!item) return;

        const val = prompt(
            `Set Leave Days for ${item.name}:\n` +
            `0 = Present on Duty\n` +
            `1 = Short Leave (Eligible for Reimbursement)\n` +
            `2+ = Long Leave (Blocked)`,
            item.leaveDays !== undefined ? item.leaveDays : '0'
        );
        if (val === null) return;
        const days = parseInt(val, 10);
        item.leaveDays = isNaN(days) ? 0 : days;
        item.isActive = item.leaveDays === 0;
        item.isPresent = item.leaveDays === 0;
        saveList(STORAGE_KEY_AUDITORS, auds);

        try {
            fetch('/api/members/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeId: item.employeeId, role: 'Auditor', data: item })
            }).catch(function () { });
        } catch (e) { }

        renderAll();
    };

    window.updateCapacity = function (empId, roleKey, val) {
        const cap = parseInt(val, 10);
        if (isNaN(cap) || cap < 1) return;
        const list = getList(roleKey);
        const item = list.find(o => String(o.employeeId || o.id) === String(empId));
        if (item) {
            if (roleKey === STORAGE_KEY_FO) item.maxDailyVisits = cap;
            else if (roleKey === STORAGE_KEY_AUDITORS) item.dailyCapacity = cap;
            saveList(roleKey, list);

            try {
                fetch('/api/members/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employeeId: item.employeeId, role: roleKey, data: item })
                }).catch(function () { });
            } catch (e) { }
        }
    };

    window.adminEditAuditorScope = function (empId) {
        const auds = getList(STORAGE_KEY_AUDITORS);
        const item = auds.find(a => String(a.employeeId || a.id) === String(empId));
        if (!item) return;

        const currentClients = (item.clients || []).join(', ');
        const newClients = prompt(
            `Update Assigned Companies & Scope for ${item.name} (${item.employeeId}):\n\n` +
            `Format: Company (Scope). Example:\n` +
            `SBI General (Cashless Only), Star Health (RI Only), HDFC ERGO (Both)`,
            currentClients
        );

        if (newClients === null) return;

        const sch = item.schedule || defaultWeeklySchedule;
        const currentSchStr = `Mon:${sch.Mon || 'Both'};Tue:${sch.Tue || 'Both'};Wed:${sch.Wed || 'Both'};Thu:${sch.Thu || 'Both'};Fri:${sch.Fri || 'Both'};Sat:${sch.Sat || 'Both'}`;

        const newSchStr = prompt(
            `Update Weekly Shift Schedule for ${item.name} (Mon to Sat):\n` +
            `Allowed values: Both, Cashless, Reimbursement, Off`,
            currentSchStr
        );

        if (newSchStr === null) return;

        item.clients = newClients.split(',').map(s => s.trim()).filter(Boolean);
        item.schedule = parseScheduleString(newSchStr);

        saveList(STORAGE_KEY_AUDITORS, auds);

        try {
            fetch('/api/members/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeId: item.employeeId, role: 'Auditor', data: item })
            }).catch(() => {});
        } catch (e) {}

        renderAll();
        alert(`✓ Scope and Weekly Schedule updated for ${item.name}!`);
    };

    // =========================================================================
    // REALLOCATE REJECTED CASE MODAL & ACTION HANDLER
    // =========================================================================
    window.openReallocateModal = function (caseId) {
        const cases = getList(STORAGE_KEY_CASES);
        const c = cases.find(item => String(item.id) === String(caseId) || String(item.claimNo) === String(caseId));
        if (!c) return alert('Case docket not found!');

        const coords = getList(STORAGE_KEY_COORDS).filter(x => x.isActive !== false);
        const auds = getList(STORAGE_KEY_AUDITORS).filter(x => x.isActive !== false && (x.leaveDays || 0) === 0);
        const fos = getList(STORAGE_KEY_FO).filter(x => x.isActive !== false);

        const modalId = 'adminReallocateModal';
        let modal = document.getElementById(modalId);
        if (modal) modal.remove();

        const isCoordRej = c.approvals?.coordinator === 'Rejected';
        const isFoRej = c.approvals?.fieldOfficer === 'Rejected';
        const isAudRej = c.approvals?.auditor === 'Rejected';

        const modalHtml = `
            <div id="${modalId}" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.6); display:flex; justify-content:center; align-items:center; z-index:999999; padding:15px; box-sizing:border-box;">
                <div style="background:#ffffff; border-radius:12px; width:100%; max-width:500px; padding:22px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.2); box-sizing:border-box;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px;">
                        <div>
                            <strong style="font-size:15px; color:#1e293b;">Reassign Staff for Docket #${esc(c.id)}</strong>
                            <div style="font-size:11.5px; color:#64748b; margin-top:2px;">Patient: ${esc(c.userName)} (${esc(c.caseType)})</div>
                        </div>
                        <button type="button" onclick="document.getElementById('${modalId}').remove()" style="background:none; border:none; font-size:18px; cursor:pointer; color:#64748b;">✕</button>
                    </div>

                    ${c.coordinatorRejectionReason || c.foRejectionReason || c.auditorRejectionReason ? `
                        <div style="background:#fef2f2; border:1px solid #fecaca; border-left:4px solid #dc2626; padding:10px 12px; border-radius:6px; font-size:11.5px; color:#991b1b; margin-bottom:16px;">
                            <strong>Rejection Reason:</strong> ${esc(c.coordinatorRejectionReason || c.foRejectionReason || c.auditorRejectionReason)}
                        </div>
                    ` : ''}

                    <!-- Coordinator Reassign -->
                    <div style="margin-bottom:14px;">
                        <label style="display:block; font-size:11px; font-weight:700; color:${isCoordRej ? '#dc2626' : '#475569'}; text-transform:uppercase; margin-bottom:5px;">
                            Operations Coordinator ${isCoordRej ? '⚠️ (Rejected by current staff)' : ''}
                        </label>
                        <select id="reassignCoordSelect" style="width:100%; height:38px;">
                            <option value="">-- Keep Current (${esc(c.assignedTeam?.coordinator || 'None')}) --</option>
                            ${coords.map(co => `<option value="${co.employeeId}" ${co.name === c.assignedTeam?.coordinator ? 'disabled' : ''}>${esc(co.name)} (${esc(co.employeeId)})</option>`).join('')}
                        </select>
                    </div>

                    <!-- Field Officer Reassign -->
                    ${c.caseType !== 'Digital' ? `
                        <div style="margin-bottom:14px;">
                            <label style="display:block; font-size:11px; font-weight:700; color:${isFoRej ? '#dc2626' : '#475569'}; text-transform:uppercase; margin-bottom:5px;">
                                Field Officer ${isFoRej ? '⚠️ (Rejected by current staff)' : ''}
                            </label>
                            <select id="reassignFoSelect" style="width:100%; height:38px;">
                                <option value="">-- Keep Current (${esc(c.assignedTeam?.fieldOfficer || 'None')}) --</option>
                                ${fos.map(f => `<option value="${f.employeeId}" ${f.employeeId === c.fieldOfficerId ? 'disabled' : ''}>${esc(f.name)} [PIN: ${f.basePin || ''}] (${esc(f.employeeId)})</option>`).join('')}
                            </select>
                        </div>
                    ` : ''}

                    <!-- Auditor Reassign -->
                    <div style="margin-bottom:18px;">
                        <label style="display:block; font-size:11px; font-weight:700; color:${isAudRej ? '#dc2626' : '#475569'}; text-transform:uppercase; margin-bottom:5px;">
                            Clinical Auditor ${isAudRej ? '⚠️ (Rejected by current staff)' : ''}
                        </label>
                        <select id="reassignAudSelect" style="width:100%; height:38px;">
                            <option value="">-- Keep Current (${esc(c.assignedTeam?.auditor || 'None')}) --</option>
                            ${auds.map(a => `<option value="${a.employeeId}" ${a.employeeId === c.auditorId ? 'disabled' : ''}>${esc(a.name)} [${esc(a.employmentType || '')}] (${esc(a.employeeId)})</option>`).join('')}
                        </select>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:8px;">
                        <button type="button" onclick="document.getElementById('${modalId}').remove()" class="btn small ghost" style="padding:8px 14px;">Cancel</button>
                        <button type="button" onclick="submitStaffReallocation('${c.id}')" class="btn small approve" style="padding:8px 16px; background:#16382c; color:#fff; border-color:#16382c; font-weight:700;">✓ Save &amp; Re-dispatch</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    };

    window.submitStaffReallocation = async function (caseId) {
        const cases = getList(STORAGE_KEY_CASES);
        const c = cases.find(item => String(item.id) === String(caseId) || String(item.claimNo) === String(caseId));
        if (!c) return;

        const coords = getList(STORAGE_KEY_COORDS);
        const auds = getList(STORAGE_KEY_AUDITORS);
        const fos = getList(STORAGE_KEY_FO);

        const coordId = document.getElementById('reassignCoordSelect')?.value;
        const foId = document.getElementById('reassignFoSelect')?.value;
        const audId = document.getElementById('reassignAudSelect')?.value;

        let hasChange = false;

        // Central Server Sync
    try {
        let res = await fetch('/api/cases/' + encodeURIComponent(c.id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(c)
        });

        // যদি সার্ভারে PUT না থাকে (404 দেয়), তবে POST /api/cases দিয়ে আপডেট করা হবে
        if (!res.ok) {
            await fetch('/api/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(c)
            });
        }
    } catch (e) {
        console.warn('Central server reassign sync fallback, saved locally.');
    }

        if (coordId) {
            const newCoord = coords.find(x => x.employeeId === coordId);
            if (newCoord) {
                c.coordinatorId = newCoord.employeeId;
                c.coordinatorName = newCoord.name;
                if (!c.assignedTeam) c.assignedTeam = {};
                c.assignedTeam.coordinator = newCoord.name;
                if (!c.approvals) c.approvals = {};
                c.approvals.coordinator = 'Pending';
                delete c.coordinatorRejectionReason;
                hasChange = true;
            }
        }

        if (foId && c.caseType !== 'Digital') {
            const newFo = fos.find(x => x.employeeId === foId);
            if (newFo) {
                c.fieldOfficerId = newFo.employeeId;
                c.fieldOfficerName = newFo.name;
                if (!c.assignedTeam) c.assignedTeam = {};
                c.assignedTeam.fieldOfficer = `${newFo.name} (Primary FO)`;
                if (!c.approvals) c.approvals = {};
                c.approvals.fieldOfficer = 'Pending';
                c.foSpot1Verified = false;
                delete c.foRejectionReason;
                hasChange = true;
            }
        }

        if (audId) {
            const newAud = auds.find(x => x.employeeId === audId);
            if (newAud) {
                c.auditorId = newAud.employeeId;
                c.auditorName = newAud.name;
                if (!c.assignedTeam) c.assignedTeam = {};
                c.assignedTeam.auditor = newAud.name;
                if (!c.approvals) c.approvals = {};
                c.approvals.auditor = 'Pending';
                delete c.auditorRejectionReason;
                hasChange = true;
            }
        }

        if (!hasChange) {
            alert('Please select at least one new staff member to reassign.');
            return;
        }

        c.status = 'In Progress';
        c.reassignedAt = new Date().toISOString();

        try {
            const res = await fetch('/api/cases/' + encodeURIComponent(c.id), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(c)
            });
            if (!res.ok) {
                await fetch('/api/cases', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(c)
                });
            }
        } catch (e) {
            console.warn('Central server reassign sync failed, saving locally.');
        }

        saveList(STORAGE_KEY_CASES, cases);
        document.getElementById('adminReallocateModal')?.remove();
        renderAll();
        alert(`✓ Docket #${c.id} has been successfully reassigned and re-dispatched!`);
    };

    const PAGE = 50;
    const shown = { ledger: PAGE, claims: PAGE, fos: PAGE };
    function moreRow(key, total, cols) {
        if (total <= shown[key]) return '';
        const remaining = total - shown[key];
        return `<tr class="more-row"><td colspan="${cols}" style="text-align:center;padding:12px;"><button type="button" class="btn small ghost" onclick="showMoreRows('${key}')">Show ${Math.min(PAGE, remaining)} more (${remaining} remaining)</button></td></tr>`;
    }
    window.showMoreRows = function (key) { shown[key] += PAGE; renderAll(); };

    window.CA_STATS = null;
    let statsAt = 0;
    function refreshStats(force) {
        if (!force && Date.now() - statsAt < 10000) return;
        statsAt = Date.now();
        fetch('/api/stats').then(r => (r.ok ? r.json() : null)).then(s => { if (s) { window.CA_STATS = s; renderAll(); } }).catch(() => { });
    }

    function renderAll() {
        const coords = getList(STORAGE_KEY_COORDS);
        const auds = getList(STORAGE_KEY_AUDITORS);
        const fos = getList(STORAGE_KEY_FO);
        const cases = getList(STORAGE_KEY_CASES);

        if (document.getElementById('kpiCoords')) document.getElementById('kpiCoords').textContent = coords.length;
        if (document.getElementById('kpiCoordsDuty')) document.getElementById('kpiCoordsDuty').textContent = `${coords.filter(c => c.isActive !== false).length} on duty`;

        if (document.getElementById('kpiAuditors')) document.getElementById('kpiAuditors').textContent = auds.length;
        if (document.getElementById('kpiAuditorsDuty')) document.getElementById('kpiAuditorsDuty').textContent = `${auds.filter(a => (a.leaveDays || 0) === 0 && a.isActive !== false).length} on duty`;

        if (document.getElementById('kpiFOs')) document.getElementById('kpiFOs').textContent = fos.length;
        if (document.getElementById('kpiFOsDuty')) document.getElementById('kpiFOsDuty').textContent = `${fos.filter(f => f.isActive !== false).length} on duty`;

        const st = window.CA_STATS;
        const totalAll = st ? st.total : cases.length;
        const settledAll = st ? (st.byStatus['Approved'] || 0) : cases.filter(c => c.status === 'Approved').length;
        const activeAll = totalAll - settledAll;

        if (document.getElementById('kpiTotalCases')) document.getElementById('kpiTotalCases').textContent = totalAll.toLocaleString();
        if (document.getElementById('kpiCaseStatus')) document.getElementById('kpiCaseStatus').textContent = `${settledAll.toLocaleString()} Settled · ${activeAll.toLocaleString()} Active`;

        const settledWrap = document.getElementById('settledLedgerWrap');
        if (settledWrap) {
            const settled = cases.filter(c => c.status === 'Approved');
            if (settled.length === 0) {
                settledWrap.innerHTML = '<div style="text-align:center; padding:24px; color:var(--ink-soft);">No claims settled yet.</div>';
            } else {
                const remaining = settled.length - shown.ledger;
                settledWrap.innerHTML = settled.slice(0, shown.ledger).map(c => {
                    const cleanClaim = String(c.claimNo || c.id || '').trim();
                    const settleRef = c.referenceId || ('REF-SETTLE-' + cleanClaim);

                    return `
                    <div style="background:#fff; border:1px solid var(--line); border-left:4px solid var(--green); padding:12px 16px; border-radius:6px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <span class="ref-badge">${esc(settleRef)}</span>
                            <strong style="margin-left:8px;">${c.id} — Claim #${esc(c.claimNo)}</strong> (${esc(c.userName)})
                            <div class="spec-line">Carrier: ${esc(c.clientName)} | Coord: ${esc(c.assignedTeam?.coordinator)} | FO: ${esc(c.assignedTeam?.fieldOfficer || 'Bypassed')} | Aud: ${esc(c.assignedTeam?.auditor)}</div>
                        </div>
                        <span class="status-pill active">${c.settledAt || 'Certified'}</span>
                    </div>
                    `;
                }).join('') + (remaining > 0 ? `<div style="text-align:center;margin-top:8px;"><button type="button" class="btn small ghost" onclick="showMoreRows('ledger')">Show ${Math.min(PAGE, remaining)} more (${remaining} remaining)</button></div>` : '');
            }
        }

        // Live Claims Table with Reassign Action
        const caseTableBody = document.getElementById('caseTableBody');
        if (caseTableBody) {
            caseTableBody.innerHTML = cases.slice(0, shown.claims).map(c => {
                const isRejectedOrDisputed = String(c.status).includes('Disputed') ||
                    c.approvals?.coordinator === 'Rejected' ||
                    c.approvals?.fieldOfficer === 'Rejected' ||
                    c.approvals?.auditor === 'Rejected';

                return `
                <tr>
                    <td><strong>${c.id}</strong><br><small style="color:var(--ink-soft);">${esc(c.claimNo)}</small></td>
                    <td><strong>${esc(c.userName)}</strong><br><span style="color:var(--accent); font-size:11px;">${esc(c.clientName)}</span></td>
                    <td>${c.state || c.zone || 'Region'} (PIN: ${esc(c.pin)})</td>
                    <td style="font-size:11px;">
                        Coord: ${esc(c.assignedTeam?.coordinator)} [${c.approvals?.coordinator || 'Pending'}]<br>
                        FO: ${esc(c.assignedTeam?.fieldOfficer || 'Bypassed')} [${c.approvals?.fieldOfficer || (c.caseType === 'Digital' ? 'Bypassed' : 'Pending')}]<br>
                        Aud: ${esc(c.assignedTeam?.auditor)} [${c.approvals?.auditor || 'Pending'}]
                    </td>
                    <td><span class="status-pill ${c.status === 'Approved' ? 'active' : (isRejectedOrDisputed ? 'inactive' : 'pending')}">${c.status}</span></td>
                    <td style="color:#b91c1c; font-size:11px;">${c.coordinatorRejectionReason || c.foRejectionReason || c.auditorRejectionReason || '—'}</td>
                    <td>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            ${isRejectedOrDisputed ? `
                                <button class="btn small" style="background:#b45309; border-color:#b45309; color:#fff; font-weight:700;" onclick="openReallocateModal('${c.id}')">🔄 Reassign</button>
                            ` : `
                                <button class="btn small ghost" onclick="openReallocateModal('${c.id}')">Edit Staff</button>
                            `}
                            <button class="btn small reject" onclick="deleteDocket('${c.id}')">Delete</button>
                        </div>
                    </td>
                </tr>
            `}).join('') + moreRow('claims', cases.length, 7) || '<tr><td colspan="7" style="text-align:center; padding:24px;">No cases logged.</td></tr>';
        }

        const coordTableBody = document.getElementById('coordTableBody');
        if (coordTableBody) {
            coordTableBody.innerHTML = coords.map(c => {
                const stateDisplay = Array.isArray(c.states) ? c.states.join(', ') : (c.states || c.zone || 'Multi-State');
                return `
                <tr>
                    <td><strong>${c.employeeId}</strong></td>
                    <td><strong>${esc(c.name)}</strong><br><small style="color:var(--ink-soft);">${c.phone || c.email || ''}</small></td>
                    <td>${esc(stateDisplay)}</td>
                    <td>${cases.filter(cs => cs.assignedTeam?.coordinator === c.name && cs.status !== 'Approved').length} / ${c.maxCapacity || 4}</td>
                    <td><span class="status-pill ${c.isActive !== false ? 'active' : 'inactive'}">${c.isActive !== false ? 'On Duty' : 'Off Duty'}</span></td>
                    <td><button class="btn small ghost" onclick="adminResetPassword('${c.employeeId}', '${STORAGE_KEY_COORDS}')">🔑 Reset Pass</button></td>
                </tr>
                `;
            }).join('');
        }

        const audTableBody = document.getElementById('audTableBody');
        if (audTableBody) {
            audTableBody.innerHTML = auds.map(a => {
                const lDays = a.leaveDays || 0;
                const isDuty = lDays === 0 && a.isActive !== false;
                const clientGroupHtml = renderAdminGroupedClients(a.clients);

                return `
                    <tr>
                        <td><strong>${a.employeeId}</strong></td>
                        <td>
                            <strong>${esc(a.name)}</strong><br>
                            <small style="color:var(--accent); font-weight:700;">${esc(a.employmentType || 'Off-Roll')}</small>
                            <div style="margin-top:4px; max-width:240px;">${clientGroupHtml}</div>
                        </td>
                        <td>${esc((a.specialization || a.specialty || []).join(', '))}</td>
                        <td><input type="number" class="admin-cap-input" value="${a.dailyCapacity || 5}" onchange="updateCapacity('${a.employeeId}', '${STORAGE_KEY_AUDITORS}', this.value)"></td>
                        <td>${isDuty ? '<span class="status-pill active">Present</span>' : `<span class="status-pill inactive">Leave (${lDays}d)</span>`}</td>
                        <td>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                <button class="btn small" style="background:#0284c7; border-color:#0284c7; color:#fff;" onclick="adminEditAuditorScope('${a.employeeId}')">✏️ Scope</button>
                                <button class="btn small ghost" onclick="adjustLeaveDays('${a.employeeId}')">Set Leave</button>
                                <button class="btn small ghost" onclick="adminResetPassword('${a.employeeId}', '${STORAGE_KEY_AUDITORS}')">🔑 Reset</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        const foTableBody = document.getElementById('foTableBody');
        if (foTableBody) {
            foTableBody.innerHTML = fos.slice(0, shown.fos).map(f => `
                <tr>
                    <td><strong>${f.employeeId}</strong></td>
                    <td><strong>${esc(f.name)}</strong> (${f.employmentType || 'Off-Roll'})<br><small style="color:var(--ink-soft);">${f.district || f.state || ''}</small></td>
                    <td><span class="status-pill active">${f.grade || 'C'}</span></td>
                    <td>PIN: ${f.basePin || f.pin || '700001'}</td>
                    <td><input type="number" class="admin-cap-input" value="${f.maxDailyVisits || 4}" onchange="updateCapacity('${f.employeeId}', '${STORAGE_KEY_FO}', this.value)"></td>
                    <td><span class="status-pill ${f.isActive !== false ? 'active' : 'inactive'}">${f.isActive !== false ? 'On Duty' : 'Off Duty'}</span></td>
                    <td><button class="btn small ghost" onclick="adminResetPassword('${f.employeeId}', '${STORAGE_KEY_FO}')">🔑 Reset Pass</button></td>
                </tr>
            `).join('') + moreRow('fos', fos.length, 7);
        }
        renderLoadOverview();
    }

    let overviewLimit = 20;
    function renderLoadOverview() {
        const body = document.getElementById('loadOverviewBody');
        if (!body) return;
        const role = document.getElementById('overviewRole').value;
        const q = String(document.getElementById('overviewSearch').value || '').toLowerCase().trim();
        const L = window.CA_LOAD;
        const summary = document.getElementById('loadOverviewSummary');
        if (!L) { summary.textContent = 'Workload is loading (or temporarily unavailable).'; body.innerHTML = ''; return; }

        let rows;
        if (role === 'FieldOfficer') {
            rows = getList(STORAGE_KEY_FO).map(f => {
                const l = (L.fieldOfficer && L.fieldOfficer[f.employeeId]) || { total: 0, cashless: 0, other: 0 };
                return { id: f.employeeId, name: f.name, type: f.employmentType || '-', load: l.total, cap: f.maxDailyVisits !== undefined ? f.maxDailyVisits : 5,
                    sub: `Cashless ${l.cashless}/${f.maxCashless !== undefined ? f.maxCashless : 3} · RI ${l.other}/${f.maxRI !== undefined ? f.maxRI : 2}`, off: f.isActive === false };
            });
        } else {
            rows = getList(STORAGE_KEY_AUDITORS).map(a => ({
                id: a.employeeId, name: a.name, type: a.employmentType || '-', load: (L.auditor && L.auditor[a.name]) || 0, cap: a.dailyCapacity || 5,
                sub: (a.clients || []).join(', '), off: (a.leaveDays || 0) > 0 || a.isActive === false }));
        }
        const filtered = rows.filter(r => !q || r.name.toLowerCase().includes(q) || String(r.id).toLowerCase().includes(q));
        filtered.forEach(r => { r.util = r.cap > 0 ? r.load / r.cap : (r.load > 0 ? 9 : 0); });
        filtered.sort((a, b) => b.util - a.util || a.name.localeCompare(b.name));

        const over = rows.filter(r => r.load >= r.cap && r.cap > 0).length;
        summary.textContent = `${rows.length} people - ${over} at or over their limit - ${rows.filter(r => r.off).length} off duty / on leave`;

        body.innerHTML = filtered.slice(0, overviewLimit).map(r => {
            const pct = Math.min(100, Math.round(r.util * 100));
            const color = r.off ? '#94a3b8' : (r.util >= 1 ? '#dc2626' : (r.util >= 0.7 ? '#d97706' : '#059669'));
            const label = r.off ? 'Off duty' : (r.util > 1 ? 'Overloaded' : (r.util >= 1 ? 'Full' : 'Available'));
            return `<tr>
                <td data-label="Name"><strong>${esc(r.name)}</strong><br><small style="color:var(--ink-soft);">${esc(r.id)}${r.sub ? ' - ' + esc(r.sub) : ''}</small></td>
                <td data-label="Type">${esc(r.type)}</td>
                <td data-label="Active cases"><strong>${r.load}</strong></td>
                <td data-label="Limit">${r.cap}</td>
                <td data-label="Utilisation" style="min-width:120px;"><div style="background:#eceae1;border-radius:6px;height:8px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${color};"></div></div><small>${pct}%</small></td>
                <td data-label="Status"><span class="status-pill" style="color:${color};border-color:${color};">${label}</span></td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" style="text-align:center;padding:18px;">No matching people.</td></tr>';

        const more = document.getElementById('overviewMore');
        const remainingOverview = filtered.length - overviewLimit;
        more.style.display = remainingOverview > 0 ? '' : 'none';
        more.textContent = `Show more (${remainingOverview} remaining)`;
    }

    document.getElementById('overviewRole')?.addEventListener('change', () => { overviewLimit = 20; renderLoadOverview(); });
    document.getElementById('overviewSearch')?.addEventListener('input', () => { overviewLimit = 20; renderLoadOverview(); });
    document.getElementById('overviewMore')?.addEventListener('click', () => { overviewLimit += 20; renderLoadOverview(); });
    window.addEventListener('ca_cases_updated', () => { renderLoadOverview(); refreshStats(false); });

    async function lookupClaim() {
        const q = document.getElementById('lookupInput').value.trim();
        const msg = document.getElementById('lookupMsg');
        const table = document.getElementById('lookupTable');
        const body = document.getElementById('lookupBody');
        if (q.length < 2) { msg.textContent = 'Type at least 2 characters.'; return; }
        msg.textContent = 'Searching...';
        try {
            const res = await fetch('/api/cases?limit=25&q=' + encodeURIComponent(q));
            if (!res.ok) throw new Error('Search failed');
            const list = await res.json();
            const total = res.headers.get('X-Total-Count');
            body.innerHTML = list.map(c => `<tr>
                <td data-label="Docket"><strong>${esc(c.id)}</strong><br><small style="color:var(--ink-soft);">Claim ${esc(c.claimNo)}</small></td>
                <td data-label="Patient"><strong>${esc(c.userName)}</strong><br><small>${esc(c.clientName)} · ${esc(c.caseType)}</small></td>
                <td data-label="Team" style="font-size:11px;">Coord: ${esc(c.assignedTeam?.coordinator)} [${esc(c.approvals?.coordinator || 'Pending')}]<br>FO: ${esc(c.assignedTeam?.fieldOfficer || 'Bypassed')} [${esc(c.approvals?.fieldOfficer || 'Pending')}]<br>Aud: ${esc(c.assignedTeam?.auditor)} [${esc(c.approvals?.auditor || 'Pending')}]</td>
                <td data-label="Status"><span class="status-pill ${c.status === 'Approved' ? 'active' : (String(c.status).includes('Disputed') ? 'inactive' : 'pending')}">${esc(c.status)}</span></td>
            </tr>`).join('');
            table.style.display = list.length ? '' : 'none';
            msg.textContent = list.length ? `Showing ${list.length} of ${total} matching claims.` : 'No claim found.';
        } catch (e) { msg.textContent = e.message; }
    }
    document.getElementById('lookupBtn')?.addEventListener('click', lookupClaim);
    document.getElementById('lookupInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') lookupClaim(); });

    window.deleteDocket = function (caseId) {
        if (!confirm(`Delete Docket #${caseId}?`)) return;
        saveList(STORAGE_KEY_CASES, getList(STORAGE_KEY_CASES).filter(c => c.id !== caseId));

        try {
            fetch('/api/cases/' + caseId, {
                method: 'DELETE'
            }).catch(function () { });
        } catch (e) { }

        renderAll();
    };

    const tabCoords = document.getElementById('tabCoords');
    const tabAuds = document.getElementById('tabAuds');
    const tabFOs = document.getElementById('tabFOs');
    const panelCoords = document.getElementById('panelCoords');
    const panelAuds = document.getElementById('panelAuds');
    const panelFOs = document.getElementById('panelFOs');

    function showPanel(panel, btn) {
        [panelCoords, panelAuds, panelFOs].forEach(p => { if (p) p.style.display = 'none'; });
        [tabCoords, tabAuds, tabFOs].forEach(b => { if (b) b.classList.remove('active'); });
        if (panel) panel.style.display = 'block';
        if (btn) btn.classList.add('active');
    }

    tabCoords?.addEventListener('click', () => showPanel(panelCoords, tabCoords));
    tabAuds?.addEventListener('click', () => showPanel(panelAuds, tabAuds));
    tabFOs?.addEventListener('click', () => showPanel(panelFOs, tabFOs));

    document.getElementById('btnRefreshCases')?.addEventListener('click', renderAll);
    document.getElementById('btnRefreshSettled')?.addEventListener('click', renderAll);

    const csvCell = (v) => {
        let s = String(v ?? '');
        if (/^[=@\t\r]|^[+\-](?![\d\s])/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
    };

    function downloadCsv(name, rows) {
        const blob = new Blob(['\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    document.getElementById('btnExportCases')?.addEventListener('click', () => {
        downloadCsv('Claims_Report', [
            ['Case ID', 'Claim No', 'Patient', 'Insurer', 'Mode', 'Status', 'Settlement Ref', 'Coordinator', 'FO', 'Auditor', 'Manual allocation changes (remarks)'],
            ...getList(STORAGE_KEY_CASES).map(c => {
                const cleanClaim = String(c.claimNo || c.id || '').trim();
                const settleRef = c.status === 'Approved' ? (c.referenceId || ('REF-SETTLE-' + cleanClaim)) : '';
                return [
                    c.id,
                    c.claimNo,
                    c.userName,
                    c.clientName,
                    c.caseType,
                    c.status,
                    settleRef,
                    c.assignedTeam?.coordinator,
                    c.assignedTeam?.fieldOfficer || 'Bypassed',
                    c.assignedTeam?.auditor,
                    (c.allocationExceptions || []).map(x => `${x.label}: ${x.suggestedName || '-'} -> ${x.chosenName || '-'} (${x.remark})`).join(' | ')
                ];
            })
        ]);
    });

    document.getElementById('btnExportStaff')?.addEventListener('click', () => {
        downloadCsv('Staff_Roster', [
            ['Role', 'ID', 'Name', 'Phone', 'Capacity', 'Status', 'Leave'],
            ...getList(STORAGE_KEY_AUDITORS).map(a => [
                'Auditor',
                a.employeeId,
                a.name,
                a.phone || '',
                a.dailyCapacity,
                (a.leaveDays || 0) === 0 ? 'Present' : 'Leave',
                a.leaveDays || 0
            ]),
            ...getList(STORAGE_KEY_FO).map(f => [
                'Field Officer',
                f.employeeId,
                f.name,
                f.phone || '',
                f.maxDailyVisits,
                f.isActive !== false ? 'Active' : 'Inactive',
                0
            ])
        ]);
    });

    window.addEventListener('storage', renderAll);
    renderAll();
    refreshStats(true);

    const IMPORT_COLUMNS = {
        Coordinator: ['employeeId', 'name', 'zone', 'designation', 'digitalZone', 'states', 'caseTypes', 'clients', 'languages', 'email', 'phone', 'maxCapacity', 'isActive'],
        Auditor: ['employeeId', 'name', 'employmentType', 'languages', 'clients', 'specialization', 'caseTypes', 'shiftSchedule', 'currentLoad', 'monthlyCapacity', 'dailyCapacity', 'phone', 'email', 'isActive', 'leaveDays'],
        FieldOfficer: ['employeeId', 'name', 'employmentType', 'grade', 'basePin', 'state', 'district', 'phone', 'email', 'maxDailyVisits', 'maxCashless', 'maxRI', 'currentLoad', 'currentCashless', 'currentRI', 'isActive']
    };

    const IMPORT_EXAMPLE = {
        Coordinator: [
            { employeeId: 'C1001', name: 'Example Coordinator', zone: 'Tripura', designation: 'State Operations Coordinator', digitalZone: '', states: 'Tripura, West Bengal', caseTypes: 'Cashless, Reimbursement', clients: 'All', languages: 'Bengali, Hindi, English', email: 'coord.tripura@company.com', phone: '9800000000', maxCapacity: 4, isActive: 'yes' },
            { employeeId: 'C1002', name: 'Example Digital Lead', zone: 'South', designation: 'Digital Zonal Lead', digitalZone: 'South', states: '', caseTypes: 'Digital', clients: 'Universal', languages: 'English, Hindi', email: 'lead.south@company.com', phone: '9800000001', maxCapacity: 4, isActive: 'yes' }
        ],
        Auditor: [
            { employeeId: 'A2001', name: 'Dr. Example Auditor', employmentType: 'On-Roll', languages: 'English, Bengali', clients: 'SBI (Cashless Only), Star Health (RI Only), HDFC ERGO (Both)', specialization: 'Physical, Digital (VI)', caseTypes: 'Cashless, Reimbursement', shiftSchedule: 'Mon:Both;Tue:Cashless;Wed:Reimbursement;Thu:Both;Fri:Both;Sat:Both', monthlyCapacity: 50, dailyCapacity: 5, phone: '9811111111', email: 'auditor@company.com', isActive: 'yes', leaveDays: 0 }
        ],
        FieldOfficer: [
            { employeeId: 'F3001', name: 'Example Field Officer', employmentType: 'On-Roll', grade: 'A', basePin: '700001', state: 'West Bengal', district: 'Kolkata', phone: '9822222222', email: 'fo.kolkata@company.com', maxDailyVisits: 5, maxCashless: 3, maxRI: 2, isActive: 'yes' }
        ]
    };

    const impRole = document.getElementById('impRole');
    const impResult = document.getElementById('impResult');
    const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    document.getElementById('btnTemplate')?.addEventListener('click', () => {
        if (typeof XLSX === 'undefined') return alert('Excel library failed to load. Please check your internet connection.');
        const role = impRole.value;
        const ws = XLSX.utils.json_to_sheet(IMPORT_EXAMPLE[role], { header: IMPORT_COLUMNS[role] });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, role);
        XLSX.writeFile(wb, `${role}_template.xlsx`);
    });

    function downloadCredentials(creds, role) {
        if (!creds.length) return;
        downloadCsv(`New_Login_Credentials_${role}`, [
            ['Employee ID', 'Name', 'Role', 'Temporary Password'],
            ...creds.map(c => [c.employeeId, c.name, c.role, c.tempPassword])
        ]);
    }

    function parseScheduleString(schStr) {
        const defaultSchedule = { Mon: 'Both', Tue: 'Both', Wed: 'Both', Thu: 'Both', Fri: 'Both', Sat: 'Both' };
        if (!schStr || typeof schStr !== 'string') return defaultSchedule;

        const parts = schStr.split(/[;,|]/);
        parts.forEach(p => {
            const [dayRaw, valRaw] = p.split(':');
            if (dayRaw && valRaw) {
                const day = dayRaw.trim().slice(0, 3);
                const dayKey = day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
                const val = valRaw.trim();
                if (defaultSchedule[dayKey] !== undefined) {
                    if (/cashless/i.test(val)) defaultSchedule[dayKey] = 'Cashless';
                    else if (/reimbursement|ri/i.test(val)) defaultSchedule[dayKey] = 'Reimbursement';
                    else if (/off/i.test(val)) defaultSchedule[dayKey] = 'Off';
                    else defaultSchedule[dayKey] = 'Both';
                }
            }
        });
        return defaultSchedule;
    }

    const LOAD_ALIAS = {
        employeeid: 'employeeId', empid: 'employeeId', empcode: 'employeeId', employeecode: 'employeeId', id: 'employeeId',
        currentload: 'currentLoad', totalactiveload: 'currentLoad', onhandload: 'currentLoad', activeload: 'currentLoad',
        load: 'currentLoad', totalload: 'currentLoad', activecases: 'currentLoad',
        currentcashless: 'currentCashless', cashlessload: 'currentCashless', cashless: 'currentCashless', activecashless: 'currentCashless',
        currentri: 'currentRI', riload: 'currentRI', ri: 'currentRI', reimbursementload: 'currentRI', activeri: 'currentRI'
    };
    const loadRoleSel = document.getElementById('loadRole');
    const loadResult = document.getElementById('loadResult');

    document.getElementById('btnLoadTemplate')?.addEventListener('click', () => {
        if (typeof XLSX === 'undefined') return alert('The Excel library could not be loaded (check your internet connection).');
        const role = loadRoleSel.value;
        const sample = role === 'FieldOfficer'
            ? [{ employeeId: 'F3001', name: 'Example Field Officer', currentLoad: 6, currentCashless: 2, currentRI: 4 }]
            : [{ employeeId: 'A2001', name: 'Dr. Example Auditor', currentLoad: 12 }];
        const ws = XLSX.utils.json_to_sheet(sample);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, role === 'FieldOfficer' ? 'FieldOfficers' : 'Auditors');
        XLSX.writeFile(wb, `CurrentLoad_${role}_template.xlsx`);
    });

    document.getElementById('btnLoadUpload')?.addEventListener('click', async () => {
        const file = document.getElementById('loadFile').files[0];
        const role = loadRoleSel.value;
        const zeroMissing = document.getElementById('loadZeroMissing').checked;
        if (!file) return alert('Choose an Excel / CSV file first.');
        if (typeof XLSX === 'undefined') return alert('The Excel library could not be loaded (check your internet connection).');
        if (zeroMissing && !confirm('Everyone of this role who is NOT in the file will be set to 0 current load. Continue?')) return;

        loadResult.style.color = '';
        loadResult.textContent = 'Reading file...';
        try {
            const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const kw = role === 'FieldOfficer' ? 'field' : 'audit';
            let sheetName = wb.SheetNames.find(n => normHeader(n).includes(kw));
            if (!sheetName) sheetName = wb.SheetNames.find(n => { const r0 = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: false })[0]; return r0 && Object.keys(r0).some(h => LOAD_ALIAS[normHeader(h)] === 'employeeId'); });
            if (!sheetName) sheetName = wb.SheetNames[0];

            const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false })
                .filter(r => Object.values(r).some(v => String(v).trim() !== ''));
            if (!raw.length) throw new Error(`The sheet "${sheetName}" has no rows.`);

            const rows = raw.map(r => {
                const out = {};
                Object.keys(r).forEach(h => { const k = LOAD_ALIAS[normHeader(h)]; if (k) out[k] = r[h]; });
                return out;
            });
            const cols = new Set(Object.keys(rows[0]));
            if (!cols.has('employeeId')) throw new Error('No employee ID column found (use "employeeId").');
            if (!cols.has('currentLoad') && !cols.has('currentCashless') && !cols.has('currentRI')) {
                throw new Error('No load column found (use "currentLoad", "TotalActiveLoad" or "OnHandLoad").');
            }

            loadResult.textContent = `Sending ${rows.length} rows...`;
            const res = await fetch('/api/admin/roster/load', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, zeroMissing, rows })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const remainingProblems = data.totalProblems - data.problems.length;
                const more = data.problems ? '\n' + data.problems.join('\n') + (remainingProblems > 0 ? `\n... and ${remainingProblems} more` : '') : '';
                throw new Error((data.error || 'Upload failed') + more);
            }

            loadResult.style.color = 'var(--green)';
            loadResult.textContent = `✓ Current load updated for ${data.updated} people (total ${data.totalLoad} cases).` +
                (data.zeroed ? `\n${data.zeroed} people not in the file were set to 0.` : '') +
                (data.notFound && data.notFound.length ? `\n⚠ Not found in the system (import them first): ${data.notFound.slice(0, 15).join(', ')}${data.notFound.length > 15 ? ' ...' : ''}` : '');
        } catch (e) {
            loadResult.style.color = 'var(--red)';
            loadResult.textContent = '✗ ' + e.message;
        }
    });

    document.getElementById('btnImportRoster')?.addEventListener('click', async () => {
        const file = document.getElementById('impFile').files[0];
        const role = impRole.value;
        const mode = document.getElementById('impMode').value;
        if (!file) return alert('Please select an Excel (.xlsx / .xls) file first.');
        if (typeof XLSX === 'undefined') return alert('Excel library failed to load. Please check your internet connection.');
        if (mode === 'replace' && !confirm(`Warning: All existing ${role} records will be replaced by the records in this file. Proceed?`)) return;

        impResult.textContent = 'Reading file...';
        try {
            const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const kw = { Coordinator: 'coord', Auditor: 'audit', FieldOfficer: 'field' }[role];
            const readSheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: false });
            let sheetName = wb.SheetNames.find(n => normHeader(n).includes(kw));
            if (!sheetName) sheetName = wb.SheetNames.find(n => { const r0 = readSheet(n)[0]; return r0 && Object.keys(r0).some(h => normHeader(h) === 'employeeid'); });
            if (!sheetName) sheetName = wb.SheetNames[0];
            const raw = readSheet(sheetName).filter(r => Object.values(r).some(v => String(v).trim() !== ''));
            if (!raw.length) throw new Error(`No data rows found in sheet "${sheetName}".`);

            const wanted = IMPORT_COLUMNS[role];
            const alias = {
                empid: 'employeeId', employeeid: 'employeeId', emp: 'employeeId', empcode: 'employeeId', employeecode: 'employeeId',
                fullname: 'name', employeename: 'name',
                pin: 'basePin', pincode: 'basePin', basepincode: 'basePin', baselocationpin: 'basePin', homepin: 'basePin', locationpin: 'basePin',
                ri: 'maxRI', maxreimbursement: 'maxRI', maxcashlessvisits: 'maxCashless', dailyvisits: 'maxDailyVisits', maxdailyvisit: 'maxDailyVisits',
                status: 'isActive', active: 'isActive',
                monthlyquota: 'monthlyCapacity', monthlytarget: 'monthlyCapacity', dailylimit: 'dailyCapacity',
                casetype: 'caseTypes', casetypes: 'caseTypes', cases: 'caseTypes',
                state: 'states', states: 'states', operatingstates: 'states', coveredstates: 'states',
                client: 'clients', clients: 'clients', insurers: 'clients', authorizedclients: 'clients', assignedcarriers: 'clients',
                shiftschedule: 'shiftSchedule', schedule: 'shiftSchedule', dayschedule: 'shiftSchedule',
                totalactiveload: 'currentLoad', onhandload: 'currentLoad', activeload: 'currentLoad', cashlessload: 'currentCashless', riload: 'currentRI',
                mobile: 'phone', mobileno: 'phone', phoneno: 'phone', emailid: 'email',
                employeetype: 'employmentType', emptype: 'employmentType'
            };
            const map = {};
            wanted.forEach(w => { map[normHeader(w)] = w; });
            Object.entries(alias).forEach(([k, v]) => { if (!map[k] && wanted.includes(v)) map[k] = v; });

            const rows = raw.map(r => {
                const out = {};
                Object.keys(r).forEach(h => { const key = map[normHeader(h)]; if (key) out[key] = r[h]; });
                return out;
            });
            const found = new Set(Object.keys(raw[0]).map(h => map[normHeader(h)]).filter(Boolean));
            const ignoredCols = Object.keys(raw[0]).filter(h => !map[normHeader(h)]);
            if (role === 'FieldOfficer' && !found.has('basePin')) throw new Error('The Field Officer sheet has no PIN column (use the header "BasePin" or "PinCode"). Without it every officer would get PIN 700001.');
            if (!found.has('employeeId') || !found.has('name')) throw new Error('Mandatory columns "employeeId" and "name" are missing. Please refer to the template.');

            rows.forEach(r => {
                if (role === 'Auditor') {
                    if (r.clients && typeof r.clients === 'string') {
                        r.clients = r.clients.split(',').map(s => s.trim()).filter(Boolean);
                    } else if (!r.clients) {
                        r.clients = ['Universal'];
                    }
                    if (r.languages && typeof r.languages === 'string') {
                        r.languages = r.languages.split(',').map(s => s.trim()).filter(Boolean);
                    }
                    if (r.specialization && typeof r.specialization === 'string') {
                        r.specialization = r.specialization.split(',').map(s => s.trim()).filter(Boolean);
                    }
                    r.schedule = parseScheduleString(r.shiftSchedule);
                    r.dailyCapacity = parseInt(r.dailyCapacity, 10) || 5;
                    r.monthlyCapacity = parseInt(r.monthlyCapacity, 10) || 50;
                    r.leaveDays = parseInt(r.leaveDays, 10) || 0;
                    r.isActive = String(r.isActive).toLowerCase() !== 'no' && r.leaveDays === 0;
                } else if (role === 'Coordinator') {
                    if (r.states && typeof r.states === 'string') {
                        r.states = r.states.split(',').map(s => s.trim()).filter(Boolean);
                    }
                    if (r.clients && typeof r.clients === 'string') {
                        r.clients = r.clients.split(',').map(s => s.trim()).filter(Boolean);
                    }
                    if (r.languages && typeof r.languages === 'string') {
                        r.languages = r.languages.split(',').map(s => s.trim()).filter(Boolean);
                    }
                }
            });

            impResult.textContent = `Uploading ${rows.length} records to server...`;
            const res = await fetch('/api/admin/roster/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, mode, rows })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const remainingProblems = data.totalProblems - data.problems.length;
                const more = data.problems ? '\n' + data.problems.join('\n') + (remainingProblems > 0 ? `\n... and ${remainingProblems} more issues` : '') : '';
                throw new Error((data.error || 'Import operation failed.') + more);
            }

            impResult.style.color = 'var(--green)';
            const extra = (ignoredCols.length ? '\n⚠ These columns were not recognised and were ignored: ' + ignoredCols.join(', ') : '') +
                (data.warnings || []).map(w => '\n⚠ ' + w).join('');
            impResult.textContent = `✓ Import complete: Total ${data.total} | Created: ${data.created} | Updated: ${data.updated} | Removed: ${data.removed}` +
                (data.created ? '\nDownloading temporary credentials for new staff (keep them in a secure place).' : '') + extra;
            downloadCredentials(data.credentials || [], role);

            if (role === 'Auditor') {
                const currentAuds = getList(STORAGE_KEY_AUDITORS);
                let finalAuds = [];
                if (mode === 'replace') {
                    finalAuds = rows;
                } else {
                    const rowMap = new Map(rows.map(r => [r.employeeId, r]));
                    finalAuds = currentAuds.map(a => rowMap.has(a.employeeId) ? { ...a, ...rowMap.get(a.employeeId) } : a);
                    rows.forEach(r => {
                        if (!currentAuds.some(a => a.employeeId === r.employeeId)) finalAuds.push(r);
                    });
                }
                saveList(STORAGE_KEY_AUDITORS, finalAuds);
            }

            const r2 = await fetch('/api/roster');
            if (r2.ok) {
                const R = await r2.json();
                window.CA_noSync = true;
                localStorage.setItem(STORAGE_KEY_COORDS, JSON.stringify(R.coords || []));
                localStorage.setItem(STORAGE_KEY_AUDITORS, JSON.stringify(R.auditors || []));
                localStorage.setItem(STORAGE_KEY_FO, JSON.stringify(R.fieldOfficers || []));
                window.CA_noSync = false;
                window.CA_ROSTER = { coords: R.coords || [], fieldOfficers: R.fieldOfficers || [], auditors: R.auditors || [] };
                renderAll();
            }
        } catch (e) {
            impResult.style.color = 'var(--red)';
            impResult.textContent = '✗ ' + e.message;
        }
    });
})();