(function () {
    'use strict';
    // Auto-inject responsive styles for mobile devices (< 768px)
    if (!document.getElementById('ca-responsive-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'ca-responsive-styles';
        styleEl.textContent = `
            @media (max-width: 768px) {
                .match-card {
                    padding: 12px 14px !important;
                }
                .match-card > div {
                    flex-direction: column !important;
                    align-items: stretch !important;
                    gap: 12px !important;
                }
                .match-card .custom-searchable-dropdown {
                    width: 100% !important;
                    min-width: 100% !important;
                }
                .dropdown-fo-panel {
                    left: 0 !important;
                    right: 0 !important;
                    width: 100% !important;
                    min-width: 100% !important;
                    max-width: 100% !important;
                }
                .match-card div[style*="display:flex"][style*="flex-wrap:nowrap"],
                .match-card div[style*="align-items:flex-end"] {
                    width: 100% !important;
                    flex-direction: column !important;
                    align-items: stretch !important;
                }
                .btn-fo-dropdown, #btnRotateCoordinator, #btnRotateHospFo, #btnRotateResFo, #btnRotateAuditor {
                    width: 100% !important;
                }
                #actionRow {
                    flex-direction: column !important;
                    gap: 8px !important;
                }
                #actionRow .btn {
                    width: 100% !important;
                    flex: none !important;
                }
            }
        `;
        document.head.appendChild(styleEl);
    }

    const STORAGE_KEY_CASES = 'ca_shared_cases';
    const STORAGE_KEY_COORDS = 'ca_registered_coordinators';
    const STORAGE_KEY_FOS = 'ca_registered_field_officers';
    const STORAGE_KEY_AUDITORS = 'ca_registered_auditors';
    const STORAGE_KEY_INTAKE_DRAFT = 'ca_intake_form_draft';

    let inMemoryCasesCache = [];

    function safeParse(key, fallback = []) {
        try {
            const data = JSON.parse(localStorage.getItem(key));
            return data !== null && data !== undefined ? data : fallback;
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

    const defaultCoords = [];

    const getCases = () => {
        const local = safeParse(STORAGE_KEY_CASES, null);
        if (local && Array.isArray(local) && local.length > 0) {
            inMemoryCasesCache = local;
            return local;
        }
        return inMemoryCasesCache;
    };

    const saveCases = (d) => {
        inMemoryCasesCache = d;
        try {
            if (window.CA_storeCases && Array.isArray(d)) window.CA_storeCases(d);
            else localStorage.setItem(STORAGE_KEY_CASES, JSON.stringify(d));
        } catch (e) {
            console.warn('LocalStorage quota exceeded. Utilizing high-volume in-memory stream.');
        }
        try {
            window.dispatchEvent(new CustomEvent('ca_cases_updated'));
        } catch (e) { }
    };

    function getActiveLoad(name, roleKey) {
        if (window.CA_LOAD && window.CA_LOAD[roleKey] && (roleKey === 'auditor' || roleKey === 'coordinator')) {
            return window.CA_LOAD[roleKey][name] || 0;
        }
        let uploaded = 0;
        if (roleKey === 'auditor' && window.CA_ROSTER) {
            const a = (window.CA_ROSTER.auditors || []).find(x => x.name === name);
            uploaded = (a && a.externalLoad && a.externalLoad.total) || 0;
        }
        return uploaded + getCases().filter(c => {
            const ongoing = c.status !== 'Approved' && !c.status.includes('Settled');
            const assigned = (c.assignedTeam && (c.assignedTeam[roleKey] === name || c.assignedTeam.fieldOfficer2 === name)) ||
                (roleKey === 'fieldOfficer' && (c.fieldOfficerName === name || c.fieldOfficer2Name === name)) ||
                (roleKey === 'coordinator' && c.coordinatorName === name) ||
                (roleKey === 'auditor' && c.auditorName === name);
            const pendingSelf = c.approvals && c.approvals[roleKey] === 'Pending';
            return ongoing && assigned && pendingSelf;
        }).length;
    }

    const STATE_ALIAS = {
        'nct of delhi': 'Delhi',
        'delhi': 'Delhi',
        'andaman and nicobar islands': 'Andaman & Nicobar Islands',
        'andaman & nicobar islands': 'Andaman & Nicobar Islands',
        'andaman and nicobar': 'Andaman & Nicobar Islands',
        'jammu and kashmir': 'Jammu & Kashmir',
        'jammu & kashmir': 'Jammu & Kashmir',
        'j&k': 'Jammu & Kashmir',
        'orissa': 'Odisha',
        'uttaranchal': 'Uttarakhand',
        'wb': 'West Bengal',
        'up': 'Uttar Pradesh',
        'mp': 'Madhya Pradesh'
    };

    const normState = (s) => {
        const k = String(s || '').trim().toLowerCase();
        if (!k) return '';
        if (STATE_ALIAS[k]) return STATE_ALIAS[k];
        return String(s).trim().replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
    };

    function coordCoversState(c, targetState) {
        if (!c || !targetState) return false;
        const normTarget = normState(targetState).toLowerCase();
        const statesList = Array.isArray(c.states)
            ? c.states
            : (typeof c.states === 'string' ? c.states.split(/[,;|]/) : []);
        return statesList.some(st => {
            const cleanSt = normState(st).toLowerCase();
            return cleanSt && (cleanSt === normTarget || cleanSt.includes(normTarget) || normTarget.includes(cleanSt));
        });
    }

    function stateFromPin(pin) {
        const p = String(pin).replace(/\D/g, '');
        if (p.length < 3) return '';
        const n3 = +p.slice(0, 3), n2 = +p.slice(0, 2);

        if (n2 === 11) return 'Delhi';
        if (n2 === 12 || n2 === 13) return 'Haryana';
        if (n3 >= 140 && n3 <= 160) return 'Punjab';
        if (n3 >= 171 && n3 <= 177) return 'Himachal Pradesh';
        if (n3 === 194) return 'Ladakh';
        if (n3 >= 180 && n3 <= 193) return 'Jammu & Kashmir';
        if ([246, 248, 249, 262, 263].includes(n3)) return 'Uttarakhand';
        if (n3 >= 201 && n3 <= 285) return 'Uttar Pradesh';
        if (n2 >= 30 && n2 <= 34) return 'Rajasthan';
        if (n2 >= 36 && n2 <= 39) return 'Gujarat';
        if (n3 === 403) return 'Goa';
        if (n2 >= 40 && n2 <= 44) return 'Maharashtra';
        if (n2 >= 45 && n2 <= 48) return 'Madhya Pradesh';
        if (n2 === 49) return 'Chhattisgarh';
        if (n3 >= 500 && n3 <= 509) return 'Telangana';
        if (n3 >= 510 && n3 <= 535) return 'Andhra Pradesh';
        if (n2 >= 56 && n2 <= 59) return 'Karnataka';
        if (n2 >= 60 && n2 <= 64) return 'Tamil Nadu';
        if (n2 >= 67 && n2 <= 69) return 'Kerala';
        if (n3 === 737) return 'Sikkim';
        if (n3 === 744) return 'Andaman & Nicobar Islands';
        if ((n2 >= 70 && n2 <= 74) || (n3 >= 731 && n3 <= 736)) return 'West Bengal';
        if (n2 >= 75 && n2 <= 77) return 'Odisha';
        if (n3 >= 781 && n3 <= 788) return 'Assam';
        if (n3 >= 790 && n3 <= 792) return 'Arunachal Pradesh';
        if (n3 === 793 || n3 === 794) return 'Meghalaya';
        if (n3 === 795) return 'Manipur';
        if (n3 === 796) return 'Mizoram';
        if (n3 === 797 || n3 === 798) return 'Nagaland';
        if (n3 === 799) return 'Tripura';
        if (n2 >= 80 && n2 <= 85) return ([814, 815, 816].includes(n3) || (n3 >= 825 && n3 <= 829) || (n3 >= 831 && n3 <= 835)) ? 'Jharkhand' : 'Bihar';
        return '';
    }

    function fallbackDistrictFromPin(pin) {
        const p = String(pin).replace(/\D/g, '');
        if (p.length < 3) return '';
        const n3 = +p.slice(0, 3), n2 = +p.slice(0, 2);

        if (n3 >= 700 && n3 <= 709) return 'Kolkata';
        if (n3 >= 711 && n3 <= 712) return 'Howrah / Hooghly';
        if (n3 >= 713 && n3 <= 714) return 'Purba Bardhaman';
        if (n3 >= 721 && n3 <= 722) return 'Paschim Medinipur';
        if (n3 === 723) return 'Purulia';
        if (n3 >= 741 && n3 <= 742) return 'Nadia / Murshidabad';
        if (n3 === 743) return 'North/South 24 Parganas';
        if (n3 === 731 || n3 === 732) return 'Birbhum / Malda';
        if (n3 === 733) return 'Dinajpur';
        if (n3 === 734) return 'Darjeeling / Siliguri';
        if (n3 === 735) return 'Jalpaiguri';
        if (n3 === 736) return 'Cooch Behar';

        if (n2 === 11) return 'Delhi';
        if (n3 >= 800 && n3 <= 804) return 'Patna';
        if (n3 >= 500 && n3 <= 504) return 'Hyderabad';
        if (n3 >= 560 && n3 <= 562) return 'Bengaluru';
        if (n3 >= 600 && n3 <= 603) return 'Chennai';
        if (n3 >= 400 && n3 <= 402) return 'Mumbai';
        if (n3 >= 751 && n3 <= 754) return 'Bhubaneswar';
        if (n3 >= 781 && n3 <= 782) return 'Guwahati';

        const st = stateFromPin(p);
        return st ? `${st} Central` : 'District';
    }

    const PIN_CACHE = {};
    async function lookupPin(pin) {
        if (!/^\d{6}$/.test(pin)) return null;
        if (PIN_CACHE[pin]) return PIN_CACHE[pin];

        let info = {
            pin,
            state: stateFromPin(pin),
            city: fallbackDistrictFromPin(pin),
            area: '',
            live: false
        };

        try {
            const ctl = new AbortController();
            const t = setTimeout(() => ctl.abort(), 3500);
            const r = await fetch('https://api.postalpincode.in/pincode/' + pin, { signal: ctl.signal });
            clearTimeout(t);
            const resData = await r.json();
            const po = (resData && resData[0] && Array.isArray(resData[0].PostOffice)) ? resData[0].PostOffice : null;

            if (po && po.length > 0) {
                const firstPo = po[0];
                const liveDistrict = firstPo.District || firstPo.Division || firstPo.Region || firstPo.Block || '';
                const liveState = normState(firstPo.State) || info.state;
                const liveArea = firstPo.Name || '';

                info = {
                    pin,
                    state: liveState,
                    city: liveDistrict.trim() || info.city,
                    area: liveArea,
                    live: true
                };
            }
        } catch (e) { }

        info.state = normState(info.state);
        if (!info.city || info.city === 'Verified District') {
            info.city = fallbackDistrictFromPin(pin);
        }

        if (info.live) PIN_CACHE[pin] = info;
        return info;
    }

    const REAL_KM = {};
    const REAL_Q = {};
    let mapsEnabled = null;
    let mapsProvider = '';
    const cleanPin6 = (p) => String(p || '').split('.')[0].replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
    const realPairKey = (a, b) => [cleanPin6(a), cleanPin6(b)].sort().join('>');
    const realPipeKey = (a, b) => [cleanPin6(a), cleanPin6(b)].sort().join('|');

    function realKm(a, b) {
        if (!a || !b) return null;
        const v = REAL_KM[realPairKey(a, b)] ?? REAL_KM[realPipeKey(a, b)];
        return typeof v === 'number' ? v : (v && typeof v.km === 'number' ? v.km : null);
    }

    function calcPinDistanceKm(pin1, pin2) {
        const r = realKm(pin1, pin2);
        return r !== null ? r : estimatePinDistanceKm(pin1, pin2);
    }

    function kmText(f) {
        if (!f) return '-';
        const badge = (text, fg, bg) => `<span style="font-size:9.5px;font-weight:800;color:${fg};background:${bg};border-radius:6px;padding:1px 5px;margin-left:4px;">${text}</span>`;
        const tag = f.distSource === 'maps' ? badge(mapsProvider || 'Road distance', '#166534', '#dcfce7')
            : (f.distSource === 'approx' ? badge('straight-line approx.', '#1e40af', '#dbeafe') : badge('estimate', '#92400e', '#fef3c7'));
        return `${f.distanceKm} km ${tag}`;
    }

    // Realistic fallback calculation if OSRM is temporarily unreachable
    function estimatePinDistanceKm(pin1, pin2) {
        if (!pin1 || !pin2) return 5.0;
        const s1 = cleanPin6(pin1);
        const s2 = cleanPin6(pin2);
        if (s1 === s2) return 2.5;

        const st1 = normState(stateFromPin(s1) || '');
        const st2 = normState(stateFromPin(s2) || '');

        const prefix1 = s1.slice(0, 3);
        const prefix2 = s2.slice(0, 3);

        if (prefix1 === prefix2) {
            const sub1 = parseInt(s1.slice(3), 10);
            const sub2 = parseInt(s2.slice(3), 10);
            const diff = Math.abs(sub1 - sub2);

            // Fixed: realistic distance for nearby pin differences (e.g., 500001 to 500003)
            if (diff <= 4) return +(2.5 + diff * 0.8).toFixed(1);
            if (diff <= 15) return +(6.0 + (diff - 4) * 1.0).toFixed(1);
            return +(14.0 + Math.min((diff - 15) * 0.5, 12.0)).toFixed(1);
        }

        const diffP = Math.abs(parseInt(prefix1, 10) - parseInt(prefix2, 10));
        const baseEstimate = +(24.0 + (diffP * 12.0)).toFixed(1);

        if (st1 && st2 && st1 !== st2) {
            return Math.max(baseEstimate, 95.0);
        }

        return baseEstimate;
    }

    const LANGS = ['Bengali', 'Hindi', 'English', 'Assamese', 'Gujarati', 'Kannada', 'Malayalam', 'Marathi', 'Tamil', 'Telugu', 'Urdu'];
    let selectedLangs = [];
    function renderLangChips() {
        const box = document.getElementById('digitalLangChips');
        if (!box) return;
        box.innerHTML = LANGS.map(l => {
            const i = selectedLangs.indexOf(l);
            const full = selectedLangs.length >= 3 && i < 0;
            return `<button type="button" class="ix-chip ${i >= 0 ? 'sel' : ''}" data-lang="${l}" ${full ? 'disabled' : ''}>${i >= 0 ? `<span class="rank">${i + 1}</span>` : ''}${l}</button>`;
        }).join('');
        const lc = document.getElementById('langCount');
        if (lc) lc.textContent = `${selectedLangs.length} / 3 selected`;
    }
    document.getElementById('digitalLangChips')?.addEventListener('click', (e) => {
        const b = e.target.closest('.ix-chip');
        if (!b) return;
        const l = b.dataset.lang, i = selectedLangs.indexOf(l);
        if (i >= 0) selectedLangs.splice(i, 1);
        else if (selectedLangs.length < 3) selectedLangs.push(l);
        renderLangChips();
        saveIntakeDraft();
    });

    function resetIntakeExtras() {
        selectedLangs = [];
        ['patientPinInfo', 'hospitalPinInfo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });
    }

    function resolvePinGeography(pinStr) {
        const cleanPin = String(pinStr || '').replace(/\D/g, '');
        const firstDigit = cleanPin[0] || '7';
        const isSouth = (firstDigit === '5' || firstDigit === '6');

        return {
            isNorth: !isSouth,
            isSouth: isSouth,
            zoneName: isSouth ? "South Zone" : "North Zone"
        };
    }

    let activeMode = 'Physical';
    let pendingMatch = null;
    let poolCoordinators = [];
    let poolHospFOs = [];
    let poolResFOs = [];
    let poolAuditors = [];

    let curCoordIdx = 0;
    let curHospFoIdx = 0;
    let curResFoIdx = 0;
    let curAudIdx = 0;
    let activeDualFoChoice = 'dual';
    let exceptionRemarks = {};

    const entryChoicePanel = document.getElementById('entryChoicePanel');
    const entryFormPanel = document.getElementById('entryFormPanel');
    const entryFormTitle = document.getElementById('entryFormTitle');
    const caseTypeSelect = document.getElementById('caseType');
    const wrapHospitalPin = document.getElementById('wrapHospitalPin');
    const wrapDigitalLang = document.getElementById('wrapDigitalLang');
    const clientPinInput = document.getElementById('clientPin');
    const hospitalPinInput = document.getElementById('hospitalPin');
    const detectedZoneBadge = document.getElementById('detectedZoneBadge');

    const caseForm = document.getElementById('caseForm');
    const matchEmpty = document.getElementById('matchEmpty');
    const matchList = document.getElementById('matchList');
    const actionRow = document.getElementById('actionRow');
    const caseListWrap = document.getElementById('caseListWrap');
    const metricActiveCases = document.getElementById('metricActiveCases');

    function openForm(mode) {
        activeMode = mode;
        if (entryChoicePanel) entryChoicePanel.style.display = 'none';
        if (entryFormPanel) entryFormPanel.style.display = 'block';
        if (entryFormTitle) entryFormTitle.textContent = `${mode} Case Entry`;
        const isD = mode === 'Digital';
        if (caseTypeSelect) {
            caseTypeSelect.innerHTML = isD
                ? '<option value="Digital">Digital</option>'
                : '<option value="Cashless">Health — Cashless Spot Verification (3h SLA)</option><option value="Reimbursement">Health — Reimbursement (RI Scrutiny 7d SLA)</option>';
            caseTypeSelect.style.display = isD ? 'none' : '';
        }
        const dc = document.getElementById('digitalCategory');
        if (dc) dc.style.display = isD ? '' : 'none';

        if (wrapHospitalPin) {
            wrapHospitalPin.style.display = isD ? 'none' : 'block';
            if (hospitalPinInput) {
                if (isD) hospitalPinInput.removeAttribute('required');
                else hospitalPinInput.setAttribute('required', 'required');
            }
        }
        if (wrapDigitalLang) wrapDigitalLang.style.display = isD ? 'block' : 'none';
        if (isD) renderLangChips();
        const pi = document.getElementById('patientPinInfo');
        if (pi) pi.innerHTML = '';
        if (clientPinInput && clientPinInput.value.trim().length === 6) showPinInfo(clientPinInput, 'patientPinInfo', true);
        saveIntakeDraft();
    }

    async function showPinInfo(inputEl, boxId, withCoord) {
        const box = document.getElementById(boxId), v = inputEl.value.trim();
        if (!box) return;
        if (v.length < 6) { box.innerHTML = ''; return; }
        box.innerHTML = '<span>Looking up PIN…</span>';
        const info = await lookupPin(v);
        if (inputEl.value.trim() !== v) return;
        if (!info || !info.state) { box.innerHTML = '<span class="tag err">PIN not recognised</span>'; return; }

        const districtDisplay = info.city && info.city !== 'Verified District' ? info.city : fallbackDistrictFromPin(v);
        let h = `<span class="tag">📍 ${esc(districtDisplay)}${info.area ? ' · ' + esc(info.area) : ''}</span><span class="tag">${esc(info.state)}</span>`;
        if (withCoord) {
            const rawCoords = safeParse(STORAGE_KEY_COORDS, (window.CA_ROSTER ? window.CA_ROSTER.coords : []));
            if (activeMode === 'Digital') {
                const geo = resolvePinGeography(v);
                const dz = geo.isSouth ? 'South' : 'North';
                const dl = rawCoords.find(c => {
                    const z = String(c.digitalZone || c.zone || '').toLowerCase();
                    const n = String(c.name || '').toLowerCase();
                    if (dz === 'South') return z.includes('south') || n.includes('suchismita');
                    return z.includes('north') || n.includes('krishna');
                }) || rawCoords.find(c => c.isActive !== false);

                h += dl ? `<span class="tag ok">Digital Lead: ${esc(dl.name)} (${dz})</span>` : '<span class="tag warn">Digital Lead not assigned</span>';
            } else {
                const hintType = document.getElementById('caseType') ? document.getElementById('caseType').value : '';
                const matchedCoord = window.CA_Rules.pickCoordinator({
                    coordinators: rawCoords, state: info.state, caseType: hintType, isDigital: false,
                    stateMatches: coordCoversState, loadOf: (name) => getActiveLoad(name, 'coordinator')
                }).coordinator;
                h += matchedCoord ? `<span class="tag ok">Coordinator: ${esc(matchedCoord.name)}</span>` : '<span class="tag warn">Standby coordinator assigned</span>';
            }
        }
        box.innerHTML = h;
    }

    hospitalPinInput?.addEventListener('input', (e) => {
        showPinInfo(e.target, 'hospitalPinInfo', false);
        saveIntakeDraft();
    });
    clientPinInput?.addEventListener('input', () => {
        showPinInfo(clientPinInput, 'patientPinInfo', true);
        saveIntakeDraft();
    });

    ['clientName', 'caseType', 'claimNo', 'userName'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', saveIntakeDraft);
        document.getElementById(id)?.addEventListener('change', saveIntakeDraft);
    });

    document.getElementById('btnChoosePhysical')?.addEventListener('click', () => openForm('Physical'));
    document.getElementById('btnChooseDigital')?.addEventListener('click', () => openForm('Digital'));
    document.getElementById('btnChangeEntryType')?.addEventListener('click', () => {
        caseForm?.reset();
        resetIntakeExtras();
        if (detectedZoneBadge) detectedZoneBadge.style.display = 'none';
        if (entryFormPanel) entryFormPanel.style.display = 'none';
        if (entryChoicePanel) entryChoicePanel.style.display = 'block';
        clearMatchUI();
        localStorage.removeItem(STORAGE_KEY_INTAKE_DRAFT);
    });

    function saveIntakeDraft() {
        const draft = {
            activeMode,
            isFormOpen: entryFormPanel && entryFormPanel.style.display === 'block',
            clientName: document.getElementById('clientName')?.value || '',
            caseType: document.getElementById('caseType')?.value || '',
            claimNo: document.getElementById('claimNo')?.value || '',
            userName: document.getElementById('userName')?.value || '',
            clientPin: document.getElementById('clientPin')?.value || '',
            hospitalPin: document.getElementById('hospitalPin')?.value || '',
            selectedLangs: [...selectedLangs],
            digitalCategory: document.getElementById('digitalCategory')?.value || '',
            hasMatch: !!pendingMatch,
            pendingMatch,
            curCoordIdx,
            curHospFoIdx,
            curResFoIdx,
            curAudIdx,
            activeDualFoChoice,
            poolCoordinators,
            poolHospFOs,
            poolResFOs,
            poolAuditors
        };
        try {
            localStorage.setItem(STORAGE_KEY_INTAKE_DRAFT, JSON.stringify(draft));
        } catch (e) { }
    }

    function restoreIntakeDraft() {
        const draft = safeParse(STORAGE_KEY_INTAKE_DRAFT, null);
        if (!draft || !draft.isFormOpen) return;

        openForm(draft.activeMode || 'Physical');

        if (draft.clientName && document.getElementById('clientName')) document.getElementById('clientName').value = draft.clientName;
        if (draft.caseType && document.getElementById('caseType')) document.getElementById('caseType').value = draft.caseType;
        if (draft.claimNo && document.getElementById('claimNo')) document.getElementById('claimNo').value = draft.claimNo;
        if (draft.userName && document.getElementById('userName')) document.getElementById('userName').value = draft.userName;
        if (draft.clientPin && document.getElementById('clientPin')) {
            document.getElementById('clientPin').value = draft.clientPin;
            showPinInfo(document.getElementById('clientPin'), 'patientPinInfo', true);
        }
        if (draft.hospitalPin && document.getElementById('hospitalPin')) {
            document.getElementById('hospitalPin').value = draft.hospitalPin;
            showPinInfo(document.getElementById('hospitalPin'), 'hospitalPinInfo', false);
        }

        if (Array.isArray(draft.selectedLangs)) {
            selectedLangs = [...draft.selectedLangs];
            renderLangChips();
        }

        if (draft.hasMatch && draft.pendingMatch) {
            pendingMatch = draft.pendingMatch;
            poolCoordinators = draft.poolCoordinators || [];
            poolHospFOs = draft.poolHospFOs || [];
            poolResFOs = draft.poolResFOs || [];
            poolAuditors = draft.poolAuditors || [];
            curCoordIdx = draft.curCoordIdx || 0;
            curHospFoIdx = draft.curHospFoIdx || 0;
            curResFoIdx = draft.curResFoIdx || 0;
            curAudIdx = draft.curAudIdx || 0;
            activeDualFoChoice = draft.activeDualFoChoice || 'dual';
            renderMatchUI();
        }
    }

    const districtKey = (d) => String(d || '').toLowerCase().replace(/[^a-z]/g, '').replace(/district$/, '');
    function sameDistrict(a, b) {
        const x = districtKey(a), y = districtKey(b);
        if (!x || !y) return false;
        return x === y || x.includes(y) || y.includes(x) || (x.length >= 5 && y.length >= 5 && x.slice(0, 5) === y.slice(0, 5));
    }
    function districtOfPin(pin) {
        const p = String(pin || '').replace(/\D/g, '');
        return (PIN_CACHE[p] && PIN_CACHE[p].city) || fallbackDistrictFromPin(p) || '';
    }
    const NEAR_KM = 30;

    function evaluateAndRankFOs(activeFOs, targetPin, targetState, caseType) {
        const allCases = getCases().filter(c => c.caseType !== 'Digital');
        const isCL = String(caseType || '').toLowerCase().includes('cashless');
        const cleanTarget = String(targetPin || '').replace(/\D/g, '');
        const targetDistrict = districtOfPin(cleanTarget);

        return activeFOs.map(f => {
            const fPin = String(f.basePin || f.pin || f.baseLocationPin || '700001').replace(/\D/g, '');
            const fState = stateFromPin(fPin) || f.state || 'West Bengal';
            const dist = calcPinDistanceKm(fPin, cleanTarget);
            const quality = realKm(fPin, cleanTarget) !== null ? (REAL_Q[realPairKey(fPin, cleanTarget)] || REAL_Q[realPipeKey(fPin, cleanTarget)] || 'road') : null;
            const distSource = quality === 'road' ? 'maps' : (quality === 'approx' ? 'approx' : 'estimate');
            const isSameDistrict = sameDistrict(f.district || districtOfPin(fPin), targetDistrict);
            const withinRadius = distSource !== 'estimate' ? dist <= NEAR_KM : (dist <= NEAR_KM || isSameDistrict);

            const foPending = allCases.filter(c =>
                ((c.assignedTeam && (c.assignedTeam.fieldOfficer === f.name || c.assignedTeam.fieldOfficer2 === f.name)) ||
                    c.fieldOfficerId === f.employeeId || c.fieldOfficer2Id === f.employeeId) &&
                (c.status === 'In Progress' || c.status === 'Pending') &&
                c.approvals?.fieldOfficer === 'Pending'
            );

            const serverLoad = window.CA_LOAD && window.CA_LOAD.fieldOfficer ? (window.CA_LOAD.fieldOfficer[f.employeeId] || { total: 0, cashless: 0, other: 0 }) : null;
            const ext = f.externalLoad || { total: 0, cashless: 0, ri: 0 };
            const cashlessCount = serverLoad ? serverLoad.cashless : foPending.filter(c => String(c.caseType).toLowerCase().includes('cashless')).length + ext.cashless;
            const nonCashlessCount = serverLoad ? serverLoad.other : foPending.filter(c => !String(c.caseType).toLowerCase().includes('cashless')).length + ext.ri;
            const totalActive = serverLoad ? serverLoad.total : foPending.length + ext.total;

            const limitCL = f.maxCashless !== undefined ? f.maxCashless : 3;
            const limitRI = f.maxRI !== undefined ? f.maxRI : 2;
            const totalCap = f.maxDailyVisits !== undefined ? f.maxDailyVisits : (limitCL + limitRI);
            const extraKm = Math.max(0, +(dist - 50.0).toFixed(1));

            const isSameState = normState(fState).toLowerCase() === normState(targetState).toLowerCase();
            const isOnRoll = /on-?roll/i.test(String(f.employmentType || ''));
            const isQuotaFull = (isCL && cashlessCount >= limitCL) || (!isCL && nonCashlessCount >= limitRI) || (totalActive >= totalCap);

            let loadPenalty = totalActive * 12;
            let rankingScore = 1000 - (dist * 2.5) - loadPenalty;
            if (isOnRoll) rankingScore += 150;
            if (!isSameState) rankingScore -= 600;
            if (isQuotaFull) rankingScore -= 200;
            if (f.isActive === false) rankingScore -= 500;

            return {
                ...f,
                basePin: fPin,
                distanceKm: dist,
                distSource,
                extraTa: +(extraKm * 2.50).toFixed(2),
                currentLoad: totalActive,
                maxCapacity: totalCap,
                limitCL,
                limitRI,
                cashlessCount,
                nonCashlessCount,
                isOnRoll,
                isSameState,
                isSameDistrict,
                withinRadius,
                isQuotaFull,
                isFree: !isQuotaFull && totalActive < totalCap,
                rankingScore
            };
        }).sort((a, b) => {
            if (a.withinRadius !== b.withinRadius) return b.withinRadius ? 1 : -1;
            if (a.isSameState !== b.isSameState) return b.isSameState ? 1 : -1;
            return b.rankingScore - a.rankingScore;
        });
    }

    function buildMatchCandidatePools(payload) {
        const rawCoords = safeParse(STORAGE_KEY_COORDS, (window.CA_ROSTER ? window.CA_ROSTER.coords : defaultCoords));
        const rawFOs = safeParse(STORAGE_KEY_FOS, (window.CA_ROSTER ? window.CA_ROSTER.fieldOfficers : []));
        const rawAuditors = safeParse(STORAGE_KEY_AUDITORS, (window.CA_ROSTER ? window.CA_ROSTER.auditors : []));

        const geo = resolvePinGeography(payload.pin);
        const isDigital = payload.caseType === 'Digital';
        const isCL = String(payload.caseType || '').toLowerCase().includes('cashless');
        const isRI = String(payload.caseType || '').toLowerCase().includes('reimbursement');

        const pState = (payload.pinInfo && payload.pinInfo.state) || stateFromPin(payload.pin) || 'West Bengal';
        poolCoordinators = [];

        if (isDigital) {
            const wantZone = geo.isSouth ? 'South' : 'North';
            poolCoordinators = rawCoords.filter(c => {
                if (c.isActive === false) return false;
                const z = String(c.digitalZone || c.zone || '').toLowerCase();
                const n = String(c.name || '').toLowerCase();
                return wantZone === 'South' ? (z.includes('south') || n.includes('suchismita')) : (z.includes('north') || n.includes('krishna'));
            });
        } else {
            poolCoordinators = rawCoords.filter(c => {
                if (c.isActive === false) return false;
                return coordCoversState(c, pState);
            });
        }

        if (poolCoordinators.length === 0) {
            poolCoordinators = rawCoords.filter(c => c.isActive !== false);
        }

        poolCoordinators.sort((a, b) => getActiveLoad(a.name, 'coordinator') - getActiveLoad(b.name, 'coordinator'));

        const pickedCoord = window.CA_Rules.pickCoordinator({
            coordinators: rawCoords,
            state: pState,
            caseType: payload.caseType,
            isDigital,
            wantZone: geo.isSouth ? 'South' : 'North',
            stateMatches: coordCoversState,
            loadOf: (name) => getActiveLoad(name, 'coordinator')
        });

        let selectedCoord = poolCoordinators[0] || pickedCoord.coordinator;
        curCoordIdx = 0;
        const failoverNote = pickedCoord.note;

        const pPin = String(payload.pin || '700001').replace(/\D/g, '') || '700001';
        const hPin = String(payload.hospitalPin || pPin).replace(/\D/g, '') || pPin;
        const patientState = stateFromPin(pPin) || 'West Bengal';
        const hospitalState = stateFromPin(hPin) || patientState;

        const interDistanceKm = calcPinDistanceKm(pPin, hPin);
        const isDualFoRequired = (!isDigital && interDistanceKm > 30.0);

        poolHospFOs = [];
        poolResFOs = [];

        if (!isDigital) {
            let activeFOs = rawFOs.filter(f => f.isActive !== false && !f.isDeactivatedByAdmin);
            if (activeFOs.length === 0 && window.CA_ROSTER) activeFOs = [...window.CA_ROSTER.fieldOfficers];

            poolHospFOs = evaluateAndRankFOs(activeFOs, hPin, hospitalState, payload.caseType);

            if (isDualFoRequired) {
                poolResFOs = evaluateAndRankFOs(activeFOs, pPin, patientState, payload.caseType);
            }
        }

        const rawCarrier = String(payload.clientName || '').trim().toLowerCase();

        let patientLangs = [];
        if (Array.isArray(payload.digitalLangs) && payload.digitalLangs.length > 0) {
            patientLangs = payload.digitalLangs.map(l => String(l).trim().toLowerCase());
        } else if (payload.digitalLang && payload.digitalLang !== 'N/A') {
            patientLangs = String(payload.digitalLang).split(',').map(l => String(l).trim().toLowerCase()).filter(Boolean);
        }
        if (patientLangs.length === 0) patientLangs = ['hindi', 'english'];

        let activeAuds = (window.CA_ROSTER && Array.isArray(window.CA_ROSTER.auditors) && window.CA_ROSTER.auditors.length > 0)
            ? [...window.CA_ROSTER.auditors]
            : rawAuditors;
        if (!activeAuds || activeAuds.length === 0) {
            activeAuds = safeParse(STORAGE_KEY_AUDITORS, []);
        }

        const checkCarrierMatch = (auditor) => {
            const rawClientList = Array.isArray(auditor.clients)
                ? auditor.clients
                : (typeof auditor.clients === 'string' ? auditor.clients.split(/[,;]/) : []);

            if (rawClientList.some(c => {
                const val = String(c).toLowerCase().trim();
                return val === 'all' || val === 'universal' || val === 'general';
            })) {
                return true;
            }

            const aliasGroups = [
                ['niva', 'bupa', 'max bupa', 'niva bupa'],
                ['bajaj', 'bagic', 'bajaj allianz', 'allianz'],
                ['hdfc', 'ergo', 'hdfc ergo'],
                ['star', 'star health'],
                ['tata', 'aig', 'tata aig'],
                ['sbi', 'sbi general'],
                ['care', 'religare'],
                ['icici', 'lombard', 'icici lombard'],
                ['chola', 'chola ms', 'cholamandalam']
            ];

            for (const rawEntry of rawClientList) {
                const entry = String(rawEntry).toLowerCase().trim();
                const baseClient = entry.split('(')[0].trim();

                let isMatch = false;
                for (const group of aliasGroups) {
                    if (group.some(alias => rawCarrier.includes(alias))) {
                        if (group.some(alias => baseClient.includes(alias))) {
                            isMatch = true;
                            break;
                        }
                    }
                }

                if (!isMatch && (entry.includes(rawCarrier) || rawCarrier.includes(baseClient))) {
                    isMatch = true;
                }

                if (isMatch) {
                    if (entry.includes('cashless only') && isRI) return false;
                    if ((entry.includes('ri only') || entry.includes('reimbursement only')) && isCL) return false;
                    return true;
                }
            }

            return false;
        };

        poolAuditors = [];
        let isFallbackPool = false;
        let digitalMismatchReason = '';
        let hasExactMatch = false;

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const todayDay = dayNames[new Date().getDay()];

        if (isDigital) {
            const eligibleDigitalAuds = activeAuds.filter(aud => {
                if (aud.isActive === false || (aud.leaveDays || 0) > 0) return false;
                const specs = (aud.specialization || []).map(s => String(s).toLowerCase());
                return aud.isDigital === true || specs.some(s => s.includes('digital') || s.includes('vi') || s.includes('tele') || s.includes('video'));
            });

            const scoredAuds = eligibleDigitalAuds.map(aud => {
                const normLang = (l) => { const x = String(l || '').toLowerCase().trim(); return x === 'bangla' ? 'bengali' : x; };
                const audLangs = (aud.languages || []).map(normLang);
                const isCarrierMatched = checkCarrierMatch(aud);

                const matchingLangs = patientLangs.map(normLang).filter(pl => audLangs.includes(pl));
                const matchedLangCount = matchingLangs.length;
                const isLangMatched = matchedLangCount > 0;
                const isBothMatched = isCarrierMatched && isLangMatched;

                const isOnRoll = /on-?roll/i.test(String(aud.employmentType || aud.grade || ''));
                const curLoad = getActiveLoad(aud.name, 'auditor');

                let score = 0;
                if (isOnRoll) score += 1000;

                if (isBothMatched) {
                    score += 600 + (matchedLangCount * 30);
                } else if (isLangMatched) {
                    score += 350 + (matchedLangCount * 20);
                } else if (isCarrierMatched) {
                    score += 100;
                }
                score -= (curLoad * 10);

                return {
                    ...aud,
                    matchScore: score,
                    isCarrierMatched,
                    isLangMatched,
                    isBothMatched,
                    matchedLangCount,
                    isOnRoll,
                    curLoad
                };
            });


            const bothMatched = scoredAuds.filter(a => a.isBothMatched);
            const langMatched = scoredAuds.filter(a => a.isLangMatched);

            if (bothMatched.length > 0) {
                hasExactMatch = true;
                poolAuditors = bothMatched.sort((a, b) => b.matchScore - a.matchScore);
            } else if (langMatched.length > 0) {
                hasExactMatch = false;
                isFallbackPool = true;
                digitalMismatchReason = `Carrier "${payload.clientName}" scope not matched. Showing qualified ${patientLangs.join(', ')} language specialists.`;
                poolAuditors = langMatched.sort((a, b) => b.matchScore - a.matchScore);
            } else {
                hasExactMatch = false;
                isFallbackPool = true;
                digitalMismatchReason = `No auditor found for (${patientLangs.join(', ')}). Showing available digital auditors.`;
                poolAuditors = scoredAuds.sort((a, b) => {
                    if (a.isOnRoll !== b.isOnRoll) return b.isOnRoll ? 1 : -1;
                    return a.curLoad - b.curLoad;
                });
            }
        } else {
            const eligiblePhysicalAuds = activeAuds.filter(aud => {
                if (aud.isActive === false) return false;

                const specs = (aud.specialization || []).map(s => String(s).toLowerCase());
                const isPhysicalScope = aud.isPhysical === true || specs.some(s => s.includes('physical') || s.includes('cashless') || s.includes('reimbursement') || s.includes('pa'));
                if (!isPhysicalScope) return false;

                if (aud.schedule && todayDay !== 'Sun' && aud.schedule[todayDay]) {
                    const shift = String(aud.schedule[todayDay]).trim().toLowerCase();
                    if (shift === 'off') return false;
                    if (isCL && shift === 'reimbursement') return false;
                    if (isRI && shift === 'cashless') return false;
                }

                const lDays = aud.leaveDays || 0;
                if (isCL && lDays > 0) return false;
                if (isRI && lDays >= 2) return false;

                return checkCarrierMatch(aud);
            });

            poolAuditors = eligiblePhysicalAuds.map(aud => {
                const isOnRoll = /on-?roll/i.test(String(aud.employmentType || aud.grade || ''));
                const lDays = aud.leaveDays || 0;
                const curLoad = getActiveLoad(aud.name, 'auditor');

                let score = 0;
                if (isOnRoll) score += 1000;
                if (isRI && lDays === 1) score += 30;
                else if (lDays === 0) score += 15;
                score -= (curLoad * 10);

                return {
                    ...aud,
                    matchScore: score,
                    isOnRoll,
                    curLoad
                };
            }).sort((a, b) => b.matchScore - a.matchScore);

            hasExactMatch = poolAuditors.length > 0;
            if (!hasExactMatch) {
                isFallbackPool = true;
                digitalMismatchReason = `No physical auditor whitelisted with ${payload.caseType} clearance for "${payload.clientName}".`;
                poolAuditors = activeAuds.filter(a => (a.leaveDays || 0) < 2).sort((a, b) => {
                    const aRoll = /on-?roll/i.test(String(a.employmentType || a.grade || ''));
                    const bRoll = /on-?roll/i.test(String(b.employmentType || b.grade || ''));
                    if (aRoll !== bRoll) return bRoll ? 1 : -1;
                    return (a.leaveDays || 0) - (b.leaveDays || 0);
                });
            }
        }

        curCoordIdx = 0;
        curHospFoIdx = 0;
        curResFoIdx = (poolResFOs.length > 1 && poolResFOs[0].employeeId === poolHospFOs[0]?.employeeId) ? 1 : 0;
        curAudIdx = 0;
        activeDualFoChoice = 'dual';
        exceptionRemarks = {};

        const suggestion = {
            coordinatorId: poolCoordinators[0] ? poolCoordinators[0].employeeId : (selectedCoord ? selectedCoord.employeeId : null),
            coordinatorName: poolCoordinators[0] ? poolCoordinators[0].name : (selectedCoord ? selectedCoord.name : ''),
            fieldOfficerId: poolHospFOs[0] ? poolHospFOs[0].employeeId : null,
            fieldOfficerName: poolHospFOs[0] ? poolHospFOs[0].name : '',
            fieldOfficer2Id: (isDualFoRequired && poolResFOs[curResFoIdx]) ? poolResFOs[curResFoIdx].employeeId : null,
            fieldOfficer2Name: (isDualFoRequired && poolResFOs[curResFoIdx]) ? poolResFOs[curResFoIdx].name : '',
            auditorId: poolAuditors[0] ? poolAuditors[0].employeeId : null,
            auditorName: poolAuditors[0] ? poolAuditors[0].name : '',
            foMode: isDualFoRequired ? 'dual' : 'single'
        };

        return {
            suggestion,
            coordinator: selectedCoord,
            geography: geo,
            failoverNote,
            interDistanceKm,
            isDualFoRequired,
            isFallbackPool,
            digitalMismatchReason,
            hasExactMatch
        };
    }

    function currentChoice() {
        const c = pendingMatch.consensus;
        const isDigital = pendingMatch.caseType === 'Digital';
        const coord = poolCoordinators[curCoordIdx] || c.coordinator || null;
        let fo1 = poolHospFOs[curHospFoIdx] || null;
        let fo2 = (c.isDualFoRequired && activeDualFoChoice === 'dual') ? (poolResFOs[curResFoIdx] || null) : null;
        if (c.isDualFoRequired && !isDigital) {
            if (activeDualFoChoice === 'hospOnly') { fo2 = null; }
            else if (activeDualFoChoice === 'resOnly') { fo1 = poolResFOs[curResFoIdx] || null; fo2 = null; }
        }
        const aud = poolAuditors[curAudIdx] || null;
        return {
            coord,
            fo1,
            fo2,
            aud,
            ids: {
                coordinatorId: coord ? coord.employeeId : null,
                fieldOfficerId: fo1 ? fo1.employeeId : null,
                fieldOfficer2Id: fo2 ? fo2.employeeId : null,
                auditorId: aud ? aud.employeeId : null,
                foDeployment: (c.isDualFoRequired && !isDigital) ? activeDualFoChoice : 'single'
            }
        };
    }

    function overridesNow() {
        if (!pendingMatch || !pendingMatch.consensus || !pendingMatch.consensus.suggestion) return [];
        const baseOverrides = window.CA_Rules.detectOverrides(pendingMatch.consensus.suggestion, currentChoice().ids, pendingMatch.caseType === 'Digital');

        const sg = pendingMatch.consensus.suggestion;
        const ch = currentChoice();
        if (sg.coordinatorId && ch.ids.coordinatorId && sg.coordinatorId !== ch.ids.coordinatorId) {
            if (!baseOverrides.some(o => o.field === 'coordinator')) {
                baseOverrides.unshift({ field: 'coordinator', label: 'Operations Coordinator' });
            }
        }
        return baseOverrides;
    }

    function exceptionDetails(overrides) {
        const sg = pendingMatch.consensus.suggestion;
        const ch = currentChoice();
        const deployLabel = { dual: 'Both field officers', hospOnly: 'Hospital FO only', resOnly: 'Patient FO only', single: 'Single field officer' }[ch.ids.foDeployment] || '';
        const names = {
            coordinator: [sg.coordinatorName, ch.coord && ch.coord.name],
            fieldOfficer: [sg.fieldOfficerName, ch.fo1 && ch.fo1.name],
            fieldOfficer2: [sg.fieldOfficer2Name, (ch.ids.foDeployment === 'resOnly' ? ch.fo1 : ch.fo2) && (ch.ids.foDeployment === 'resOnly' ? ch.fo1 : ch.fo2).name],
            auditor: [sg.auditorName, ch.aud && ch.aud.name],
            foDeployment: [sg.foMode === 'dual' ? 'Both field officers' : 'Single field officer', deployLabel]
        };
        return overrides.map(o => ({
            field: o.field,
            label: o.label,
            suggestedName: (names[o.field] && names[o.field][0]) || '-',
            chosenName: (names[o.field] && names[o.field][1]) || '-',
            remark: String(exceptionRemarks[o.field] || '').trim()
        }));
    }

    function buildExceptionPanel() {
        const ov = overridesNow();
        if (!ov.length) return '';
        const min = window.CA_Rules.MIN_REMARK;
        const rows = exceptionDetails(ov).map(d => `
            <div style="margin-top:10px;">
                <div style="font-size:12px;font-weight:700;color:#19211d;">${esc(d.label)}:
                    <span style="text-decoration:line-through;color:#5b6560;font-weight:600;">${esc(d.suggestedName)}</span>
                    &rarr; <span style="color:#16382c;">${esc(d.chosenName)}</span>
                </div>
                <textarea data-exc="${d.field}" rows="2" maxlength="500" placeholder="Why was the automatic suggestion changed? (min. ${min} characters)"
                    style="width:100%;margin-top:4px;padding:8px;border:1px solid #dcd8cb;border-radius:8px;font:inherit;font-size:12.5px;resize:vertical;">${esc(exceptionRemarks[d.field] || '')}</textarea>
            </div>`).join('');
        return `
            <div id="exceptionPanel" style="margin-top:14px;padding:14px 16px;border-radius:14px;border:1px solid #f3d9a4;border-left:4px solid #b45309;background:#fffaf0;">
                <div style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#b45309;">Exception remark required</div>
                <div style="font-size:12px;color:#5b6560;margin-top:2px;">You changed the automatic allocation. Explain each change. The remark is saved with the case.</div>
                ${rows}
            </div>`;
    }

    function distanceNote() {
        if (!pendingMatch || pendingMatch.caseType === 'Digital') return '';
        const shown = [poolHospFOs[curHospFoIdx], pendingMatch.consensus.isDualFoRequired ? poolResFOs[curResFoIdx] : null].filter(Boolean);
        if (!shown.length || shown.every(f => f.distSource === 'maps')) return '';
        const why = mapsEnabled === false
            ? 'no map service is configured on the server'
            : 'the map service did not return a road distance for every officer yet (new PIN codes are looked up in the background; try again in a minute)';
        return `<div style="margin-top:12px;padding:10px 14px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a;font-size:12px;color:#92400e;">
            <strong>Distances marked "estimate" or "approx." are not road distances</strong> (${why}). Check them on a map before dispatching if the distance matters.</div>`;
    }

    function attachExceptionControls() {
        document.querySelectorAll('textarea[data-exc]').forEach(t => {
            t.addEventListener('input', () => { exceptionRemarks[t.dataset.exc] = t.value; t.style.borderColor = '#dcd8cb'; });
        });
    }

    // =========================================================================
    // UNIVERSAL SEARCHABLE DROPDOWN (Strict Button Alignment & Live Search)
    // =========================================================================
    function getCustomSearchableDropdownHtml({ key, items = [], activeIndex = 0, placeholder = 'Search...', disabled = false, getLabel, getSub, getBadge, getSearchText }) {
        const activeItem = items[activeIndex] || {};
        const mainLabel = items.length > 0 && activeItem && getLabel ? getLabel(activeItem) : '-- Select --';

        return `
            <div class="custom-searchable-dropdown" id="dropdownWrap_${key}" style="position:relative; width:100%; min-width:200px; box-sizing:border-box;">
                <button type="button" class="btn-fo-dropdown" id="btnToggle_${key}" ${disabled ? 'disabled' : ''}
                    style="width:100%; padding:8px 12px; font-size:12px; font-weight:600; border-radius:8px; border:1.5px solid #dcd8cb; background:#ffffff; color:#19211d; display:flex; justify-content:space-between; align-items:center; cursor:${disabled ? 'not-allowed' : 'pointer'}; box-shadow:0 1px 3px rgba(25,33,29,0.04); text-align:left;">
                    <span id="btnLabel_${key}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:8px;">${mainLabel}</span>
                    <span style="font-size:10px; color:#16382c; flex-shrink:0;">▼</span>
                </button>

                <div class="dropdown-fo-panel" id="panel_${key}" 
                    style="display:none; position:absolute; top:calc(100% + 4px); left:0; width:100%; min-width:250px; z-index:99999; background:#ffffff; border:1.5px solid #cbd5e1; border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,0.18); box-sizing:border-box;">
                    
                    <div style="padding:6px 8px; background:#f8fafc; border-bottom:1px solid #e2e8f0;">
                        <input type="text" id="inputSearch_${key}" placeholder="🔍 ${placeholder}" 
                            style="width:100%; padding:6px 10px; font-size:12px; border-radius:6px; border:1px solid #cbd5e1; outline:none; box-sizing:border-box; background:#fff;">
                    </div>
                    
                    <div id="listItems_${key}" style="max-height:190px; overflow-y:auto; padding:4px 0;">
                        ${items.map((it, idx) => {
            const isSel = idx === activeIndex;
            const searchTxt = esc(getSearchText ? getSearchText(it) : '').toLowerCase();
            const rowLabel = getLabel ? getLabel(it) : '';
            const rowSub = getSub ? getSub(it) : '';
            const badge = getBadge ? getBadge(it) : '';
            return `
                                <div class="fo-item-row" data-text="${searchTxt}" data-index="${idx}"
                                    style="padding:7px 10px; font-size:11.5px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; background:${isSel ? '#edf8f1' : 'transparent'}; border-bottom:1px solid #f1f5f9;">
                                    <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:6px; flex:1;">
                                        <strong style="color:#19211d;">${rowLabel}</strong>
                                        ${rowSub ? `<br><small style="color:#64748b;">${rowSub}</small>` : ''}
                                    </div>
                                    ${badge ? `<span style="flex-shrink:0; margin-left:6px;">${badge}</span>` : ''}
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function renderMatchUI() {
        if (!pendingMatch) return;
        const { consensus } = pendingMatch;
        const { failoverNote, interDistanceKm, isDualFoRequired, digitalMismatchReason, hasExactMatch } = consensus;
        const isDigital = pendingMatch.caseType === 'Digital';

        const coordinator = poolCoordinators[curCoordIdx] || consensus.coordinator;
        const hospFo = poolHospFOs[curHospFoIdx] || null;
        const resFo = isDualFoRequired ? (poolResFOs[curResFoIdx] || null) : null;
        const auditor = poolAuditors[curAudIdx] || null;

        const getRollBadge = (t) => {
            const on = /on-?roll/i.test(String(t || ''));
            return `<span style="font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:6px; margin-left:6px; ${on ? 'background:#edf8f1; color:#15803d; border:1px solid #bbf0cf;' : 'background:#f5f3ec; color:#5b6560; border:1px solid #dcd8cb;'}">${on ? 'On-Roll' : 'Off-Roll'}</span>`;
        };

        const rotateBtnStyle = "padding: 8px 12px; font-size: 12px; font-weight: 700; border-radius: 8px; border: 1.5px solid #c8dfd3; background: #eaf3ee; color: #16382c; cursor: pointer; transition: all 0.2s; white-space: nowrap; text-align: center; box-sizing: border-box;";

        const coordStateBadge = Array.isArray(coordinator?.states)
            ? coordinator.states.join(', ')
            : (coordinator?.states || coordinator?.zone || 'National');

        const coordDropdownHtml = getCustomSearchableDropdownHtml({
            key: 'coord',
            items: poolCoordinators,
            activeIndex: curCoordIdx,
            placeholder: 'Search coordinator by name, state...',
            getLabel: (c) => esc(c.name),
            getSub: (c) => {
                const states = Array.isArray(c.states) ? c.states.join('/') : (c.states || c.zone || 'National');
                return `${esc(states)} (ID: ${esc(c.employeeId || '')})`;
            },
            getBadge: (c) => `<span style="font-size:10.5px; font-weight:700; color:#16382c; background:#eaf3ee; padding:2px 6px; border-radius:6px; border:1px solid #c8dfd3;">Load: ${getActiveLoad(c.name, 'coordinator')}</span>`,
            getSearchText: (c) => `${c.name} ${(Array.isArray(c.states) ? c.states.join(' ') : c.states || '')} ${c.employeeId || ''}`
        });

        // Coordinator Card (Stack Level 40)
        const coordHtml = `
            <div class="match-card" style="margin-bottom: 14px; padding: 18px 20px; border-radius: 14px; border: 1px solid #edebe1; border-left: 4px solid #16382c; background:#ffffff; box-shadow: 0 2px 7px rgba(25, 33, 29, 0.05); position:relative; z-index:40;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div>
                        <div class="role" style="font-weight:800; color:#5b6560; font-size:11px; text-transform:uppercase; letter-spacing:0.03em;">
                            ${isDigital ? 'Digital Zonal Operations Lead' : 'Corporate Operations Coordinator'} 
                            ${failoverNote ? `<span style="color:#b45309; font-size:11px;">${failoverNote}</span>` : ''}
                        </div>
                        <div class="who" style="font-size: 15px; font-weight: 800; margin-top: 3px; color:#19211d;">
                            ${esc(coordinator?.name || 'Operations Lead')} <small style="color:#5b6560; font-size:11.5px; font-weight:600;">(${esc(coordStateBadge)})</small>
                        </div>
                        <div class="spec-line" style="font-size: 12px; margin-top: 3px; color:#5b6560;">
                            Employee ID: <strong>${coordinator?.employeeId || 'EMP-CRD'}</strong> · Languages: <strong>${(coordinator?.languages || []).join(', ')}</strong> · Active Load: <strong>${getActiveLoad(coordinator?.name, 'coordinator')} / ${coordinator?.maxCapacity || 4} files</strong>
                        </div>
                    </div>
                    
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:nowrap; position:relative;">
                        <div style="min-width:240px; position:relative;">
                            ${coordDropdownHtml}
                        </div>
                        <button type="button" id="btnRotateCoordinator" style="${rotateBtnStyle}">🔄 Rotate (${poolCoordinators.length})</button>
                    </div>
                </div>
            </div>
        `;

        let foHtml = '';
        if (!isDigital) {
            // Synchronized label generator with live realKm cache
            const getFoLabel = (f, targetPin) => {
                const warnStr = !f.isSameState ? ' [⚠️ State Mismatch]' : '';
                const cleanDest = cleanPin6(targetPin);
                const cleanOrigin = cleanPin6(f.basePin || f.pin || f.baseLocationPin);
                const liveRoadKm = realKm(cleanOrigin, cleanDest);
                const displayKm = liveRoadKm !== null ? liveRoadKm : (f.distanceKm != null ? f.distanceKm : 0);
                return `${esc(f.name)} (${displayKm}km) - [${f.isOnRoll ? 'On-Roll' : 'Off-Roll'}]${warnStr}`;
            };
            const getFoSub = (f) => `Base PIN: ${esc(f.basePin || '')} · Load: ${f.currentLoad}/${f.maxCapacity}`;
            const getFoBadge = (f, targetPin) => {
                const cleanDest = cleanPin6(targetPin);
                const cleanOrigin = cleanPin6(f.basePin || f.pin || f.baseLocationPin);
                const liveRoadKm = realKm(cleanOrigin, cleanDest);
                const displayKm = liveRoadKm !== null ? liveRoadKm : (f.distanceKm != null ? f.distanceKm : 0);
                return `<span style="font-size:10.5px; font-weight:700; color:#059669; background:#f0fdf4; padding:2px 6px; border-radius:6px; border:1px solid #bbf7d0;">${displayKm} km</span>`;
            };
            const getFoSearchText = (f) => `${f.name} ${f.basePin || ''} ${f.employeeId || ''}`;

            const hospDestPin = pendingMatch.hospitalPin || pendingMatch.pin;
            const resDestPin = pendingMatch.pin;

            if (isDualFoRequired) {
                const isDual = activeDualFoChoice === 'dual';
                const isHospOnly = activeDualFoChoice === 'hospOnly';
                const isResOnly = activeDualFoChoice === 'resOnly';

                const hospDropdownHtml = getCustomSearchableDropdownHtml({
                    key: 'hosp',
                    items: poolHospFOs,
                    activeIndex: curHospFoIdx,
                    placeholder: 'Search hospital FO by name or PIN...',
                    disabled: isResOnly,
                    getLabel: (f) => getFoLabel(f, hospDestPin),
                    getSub: getFoSub,
                    getBadge: (f) => getFoBadge(f, hospDestPin),
                    getSearchText: getFoSearchText
                });

                const resDropdownHtml = getCustomSearchableDropdownHtml({
                    key: 'res',
                    items: poolResFOs,
                    activeIndex: curResFoIdx,
                    placeholder: 'Search patient FO by name or PIN...',
                    disabled: isHospOnly,
                    getLabel: (f) => getFoLabel(f, resDestPin),
                    getSub: getFoSub,
                    getBadge: (f) => getFoBadge(f, resDestPin),
                    getSearchText: getFoSearchText
                });

                foHtml = `
                    <div class="match-card" style="border: 1px solid #edebe1; border-left: 4px solid #b45309; background: #fffdfa; padding: 16px; border-radius: 14px; margin-bottom: 14px; box-shadow: 0 2px 7px rgba(25, 33, 29, 0.05); position:relative; z-index:30;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom: 8px;">
                            <div style="font-weight: 800; color: #92400e; font-size: 13.5px; display:flex; align-items:center; gap:6px;">
                                <span>📍 Dual FO Active (${pendingMatch.caseType})</span>
                                <span style="font-size:11px; background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:12px; border:1px solid #fde68a; font-weight:700;">Inter-Distance: ${interDistanceKm} km > 30 km</span>
                            </div>
                            
                            <div style="display:flex; gap:6px; background:#f5f3ec; padding:4px 8px; border-radius:10px; border:1.5px solid #dcd8cb; font-size:12px; font-weight:700; flex-wrap:wrap; width:100%; max-width:100%;">
                                <label style="cursor:pointer; display:flex; align-items:center; gap:5px; padding:4px 8px; border-radius:6px; background:${isDual ? '#16382c' : 'transparent'}; color:${isDual ? '#ffffff' : '#5b6560'}; transition:0.2s;">
                                    <input type="radio" name="optFoMode" value="dual" ${isDual ? 'checked' : ''} style="display:none;"> 👥 Deploy Both (2 FOs)
                                </label>
                                <label style="cursor:pointer; display:flex; align-items:center; gap:5px; padding:4px 8px; border-radius:6px; background:${isHospOnly ? '#16382c' : 'transparent'}; color:${isHospOnly ? '#ffffff' : '#5b6560'}; transition:0.2s;">
                                    <input type="radio" name="optFoMode" value="hospOnly" ${isHospOnly ? 'checked' : ''} style="display:none;"> 🏥 Hospital &amp; Others FO Only
                                </label>
                                <label style="cursor:pointer; display:flex; align-items:center; gap:5px; padding:4px 8px; border-radius:6px; background:${isResOnly ? '#16382c' : 'transparent'}; color:${isResOnly ? '#ffffff' : '#5b6560'}; transition:0.2s;">
                                    <input type="radio" name="optFoMode" value="resOnly" ${isResOnly ? 'checked' : ''} style="display:none;"> 🏠 Patient FO Only
                                </label>
                            </div>
                        </div>

                        <!-- Spot 1: Hospital & Others FO -->
                        <div style="background: #ffffff; border: 1.5px solid ${isResOnly ? '#e2e0d8' : '#c8dfd3'}; opacity: ${isResOnly ? '0.45' : '1'}; border-radius: 12px; padding: 14px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(25, 33, 29, 0.04); position:relative; z-index:35;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                <div>
                                    <div style="display:flex; align-items:center; gap:6px;">
                                        <span style="font-size: 11px; background: #eaf3ee; color: #16382c; border: 1px solid #c8dfd3; padding: 2px 8px; border-radius: 6px; font-weight: 700;">Spot 1: Hospital &amp; Others FO (PIN: ${pendingMatch.hospitalPin})</span>
                                        ${getRollBadge(hospFo?.employmentType)}
                                        <span id="spot1DistBadge" style="font-size:11px; font-weight:800; background:#f0fdf4; color:#059669; border:1px solid #bbf7d0; padding:1px 6px; border-radius:10px;">
                                            Distance: ${hospFo?.distanceKm != null ? hospFo.distanceKm + ' km' : '0 km'}
                                        </span>
                                        ${!hospFo?.isSameState ? '<span style="font-size:10.5px; background:#fef3c7; color:#b45309; padding:1px 6px; border-radius:8px; border:1px solid #fde68a; font-weight:700;">⚠️ State Mismatch</span>' : ''}
                                        ${isResOnly ? '<span style="font-size:10.5px; color:#b91c1c; font-weight:700; margin-left:6px;">(Bypassed)</span>' : ''}
                                    </div>
                                    <div class="who" style="font-size: 15px; font-weight: 800; margin-top: 4px; color:#19211d;">
                                        ${esc(hospFo?.name)} <small style="color:#16382c; font-size:11.5px; font-weight:600;">(ID: ${hospFo?.employeeId} · Base: ${hospFo?.basePin})</small>
                                    </div>
                                    <div class="spec-line" style="font-size:11.5px; margin-top:3px; color:#5b6560;">
                                        Role: <strong>Hospital &amp; Others FO</strong> · Vicinity: <strong>${kmText(hospFo)}</strong> · Active Load: <strong>${hospFo?.currentLoad}/${hospFo?.maxCapacity}</strong>
                                    </div>
                                </div>
                                <div style="display:flex; gap:6px; align-items:center; flex-wrap:nowrap; position:relative;">
                                    <div style="min-width:240px; position:relative;">
                                        ${hospDropdownHtml}
                                    </div>
                                    <button type="button" id="btnRotateHospFo" style="${rotateBtnStyle}" ${isResOnly ? 'disabled' : ''}>🔄 Rotate (${poolHospFOs.length})</button>
                                </div>
                            </div>
                        </div>

                        <!-- Spot 2: Patient FO -->
                        <div style="background: #ffffff; border: 1.5px solid ${isHospOnly ? '#e2e0d8' : '#fde68a'}; opacity: ${isHospOnly ? '0.45' : '1'}; border-radius: 12px; padding: 14px; box-shadow: 0 1px 3px rgba(25, 33, 29, 0.04); position:relative; z-index:32;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                <div>
                                    <div style="display:flex; align-items:center; gap:6px;">
                                        <span style="font-size: 11px; background: #fef7ea; color: #b45309; border: 1px solid #fde68a; padding: 2px 8px; border-radius: 6px; font-weight: 700;">Spot 2: Patient FO (PIN: ${pendingMatch.pin})</span>
                                        ${getRollBadge(resFo?.employmentType)}
                                        <span id="spot2DistBadge" style="font-size:11px; font-weight:800; background:#f0fdf4; color:#059669; border:1px solid #bbf7d0; padding:1px 6px; border-radius:10px;">
                                            Distance: ${resFo?.distanceKm != null ? resFo.distanceKm + ' km' : '0 km'}
                                        </span>
                                        ${!resFo?.isSameState ? '<span style="font-size:10.5px; background:#fef3c7; color:#b45309; padding:1px 6px; border-radius:8px; border:1px solid #fde68a; font-weight:700;">⚠️ State Mismatch</span>' : ''}
                                        ${isHospOnly ? '<span style="font-size:10.5px; color:#b91c1c; font-weight:700; margin-left:6px;">(Bypassed)</span>' : ''}
                                    </div>
                                    <div class="who" style="font-size: 15px; font-weight: 800; margin-top: 4px; color:#19211d;">
                                        ${esc(resFo?.name)} <small style="color:#b45309; font-size:11.5px; font-weight:600;">(ID: ${resFo?.employeeId} · Base: ${resFo?.basePin})</small>
                                    </div>
                                    <div class="spec-line" style="font-size:11.5px; margin-top:3px; color:#5b6560;">
                                        Role: <strong>Patient FO</strong> · Vicinity: <strong>${kmText(resFo)}</strong> · Active Load: <strong>${resFo?.currentLoad}/${resFo?.maxCapacity}</strong>
                                    </div>
                                </div>
                                <div style="display:flex; gap:6px; align-items:center; flex-wrap:nowrap; position:relative;">
                                    <div style="min-width:240px; position:relative;">
                                        ${resDropdownHtml}
                                    </div>
                                    <button type="button" id="btnRotateResFo" style="${rotateBtnStyle}" ${isHospOnly ? 'disabled' : ''}>🔄 Rotate (${poolResFOs.length})</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                const singleFoDropdownHtml = getCustomSearchableDropdownHtml({
                    key: 'hosp',
                    items: poolHospFOs,
                    activeIndex: curHospFoIdx,
                    placeholder: 'Search field officer by name or PIN...',
                    disabled: false,
                    getLabel: (f) => getFoLabel(f, hospDestPin),
                    getSub: getFoSub,
                    getBadge: (f) => getFoBadge(f, hospDestPin),
                    getSearchText: getFoSearchText
                });

                foHtml = `
                    <div class="match-card" style="margin-bottom: 14px; padding: 16px; border-radius: 14px; border: 1px solid #edebe1; border-left: 4px solid #16382c; background: #ffffff; box-shadow: 0 2px 7px rgba(25, 33, 29, 0.05); position:relative; z-index:30;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                            <div>
                                <div style="display:flex; align-items:center; gap:6px;">
                                    <span class="role" style="font-weight:800; color:#5b6560; font-size:11px; text-transform:uppercase; letter-spacing:0.03em;">Proximity Field Officer</span>
                                    ${getRollBadge(hospFo?.employmentType)}
                                    <span style="font-size:11px; font-weight:800; background:#f0fdf4; color:#059669; border:1px solid #bbf7d0; padding:1px 6px; border-radius:10px;">
                                        Distance: ${hospFo?.distanceKm != null ? hospFo.distanceKm + ' km' : '0 km'}
                                    </span>
                                    ${!hospFo?.isSameState ? '<span style="font-size:10.5px; background:#fef3c7; color:#b45309; padding:1px 6px; border-radius:8px; border:1px solid #fde68a; font-weight:700;">⚠️ State Mismatch</span>' : ''}
                                </div>
                                <div class="who" style="font-size: 15px; font-weight: 800; margin-top: 3px; color:#19211d;">
                                    ${esc(hospFo?.name)} <small style="color:#16382c; font-size:11.5px; font-weight:600;">(ID: ${hospFo?.employeeId} · Base: ${hospFo?.basePin})</small>
                                </div>
                                <div class="spec-line" style="font-size: 12px; margin-top: 3px; color:#5b6560;">
                                    Route: <strong>${kmText(hospFo)}</strong> ${hospFo?.extraTa > 0 ? `<span style="color:#b91c1c; font-weight:700;">(+₹${hospFo.extraTa} TA)</span>` : ''} · Active Load: <strong>${hospFo?.currentLoad}/${hospFo?.maxCapacity}</strong>
                                </div>
                            </div>
                            <div style="display:flex; gap:6px; align-items:center; flex-wrap:nowrap; position:relative;">
                                <div style="min-width:240px; position:relative;">
                                    ${singleFoDropdownHtml}
                                </div>
                                <button type="button" id="btnRotateHospFo" style="${rotateBtnStyle}">🔄 Rotate (${poolHospFOs.length})</button>
                            </div>
                        </div>
                    </div>
                `;
            }
        } else {
            foHtml = `
                <div class="match-card" style="background:#fbfaf5; border: 1.5px dashed #dcd8cb; border-left: 4px solid #16382c; margin-bottom:14px; padding:14px 16px; border-radius:14px; position:relative; z-index:30;">
                    <div style="font-size:12.5px; color:#5b6560; font-weight:600;">
                        ⚡ Digital Investigation Protocol Active: Field Officer visit is bypassed. Tele-Audit &amp; Video Investigation assigned directly to Clinical Auditor.
                    </div>
                </div>
            `;
        }

        let audHtml = '';
        if (auditor) {
            const lDays = auditor.leaveDays || 0;
            const statusTag = lDays === 0
                ? '<span class="status-pill active" style="font-size:11px; padding:3px 9px; border-radius:12px; background:#edf8f1; color:#15803d; border:1px solid #bbf0cf;">🟢 On Duty</span>'
                : (lDays === 1 ? '<span class="status-pill pending" style="background:#fef7ea; color:#b45309; font-size:11px; padding:3px 9px; border-radius:12px; border:1px solid #fde68a;">⏱ 1d Leave (RI Priority)</span>' : '<span class="status-pill inactive" style="background:#fee2e2; color:#b91c1c; font-size:11px; padding:3px 9px; border-radius:12px;">🚫 Blocked</span>');

            let matchBadge = '';
            if (isDigital) {
                if (hasExactMatch) {
                    matchBadge = `<span style="font-size:11px; background:#ecfdf5; color:#059669; padding:2px 8px; border-radius:12px; border:1px solid #a7f3d0; font-weight:700;">★ 100% Matched (${pendingMatch.clientName} &amp; Lang)</span>`;
                } else {
                    matchBadge = `<span style="font-size:11px; background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:12px; border:1px solid #fde68a; font-weight:700;">⚠️ ${digitalMismatchReason}</span>`;
                }
            } else {
                if (hasExactMatch) {
                    matchBadge = `<span style="font-size:11px; background:#ecfdf5; color:#059669; padding:2px 8px; border-radius:12px; border:1px solid #a7f3d0; font-weight:700;">★ Carrier Cleared (${pendingMatch.clientName})</span>`;
                } else {
                    matchBadge = `<span style="font-size:11px; background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:12px; border:1px solid #fde68a; font-weight:700;">⚠️ ${digitalMismatchReason}</span>`;
                }
            }

            const headerMatchCount = `<div style="display:flex; align-items:center; gap:6px;">${matchBadge}<span style="font-size:11.5px; color:#16382c; font-weight:700;">${poolAuditors.length} Qualified Candidates</span></div>`;

            const audDropdownHtml = getCustomSearchableDropdownHtml({
                key: 'aud',
                items: poolAuditors,
                activeIndex: curAudIdx,
                placeholder: 'Search auditor by name, language, carrier...',
                getLabel: (a) => {
                    const roll = /on-?roll/i.test(String(a.employmentType || a.grade || '')) ? 'On-Roll' : 'Off-Roll';
                    return `${esc(a.name)} [${roll}]`;
                },
                getSub: (a) => {
                    const langs = (a.languages || []).join('/');
                    const clients = (a.clients || []).join(', ');
                    return `Lang: ${esc(langs)} · Carrier: ${esc(clients)}`;
                },
                getBadge: (a) => `<span style="font-size:10.5px; font-weight:700; color:#15803d; background:#edf8f1; padding:2px 6px; border-radius:6px; border:1px solid #bbf0cf;">Load: ${getActiveLoad(a.name, 'auditor')}</span>`,
                getSearchText: (a) => `${a.name} ${(a.languages || []).join(' ')} ${(a.clients || []).join(' ')} ${a.employeeId || ''}`
            });

            // Auditor Card (Stack Level 20)
            audHtml = `
                <div class="match-card" style="margin-bottom: 14px; padding: 18px 20px; border-radius: 14px; border: 1px solid #edebe1; border-left: 4px solid #16382c; background:#ffffff; box-shadow: 0 2px 7px rgba(25, 33, 29, 0.05); position:relative; z-index:20;">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                        <div>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span class="role" style="font-weight:800; color:#5b6560; font-size:11px; text-transform:uppercase; letter-spacing:0.03em;">Clinical Claims Auditor</span>
                                ${getRollBadge(auditor.employmentType || auditor.grade)}
                                ${statusTag}
                            </div>
                            <div class="who" style="font-size: 15px; font-weight: 800; margin-top: 3px; color:#19211d;">
                                ${esc(auditor.name)} <small style="color:#16382c; font-size:11.5px; font-weight:600;">(EMP: ${auditor.employeeId})</small>
                            </div>
                            <div class="spec-line" style="font-size: 12px; margin-top: 3px; color:#5b6560;">
                                Assigned Carriers: <strong>${(auditor.clients || []).join(', ')}</strong> · Mode: <strong>${(auditor.specialization || []).join(', ')}</strong>
                            </div>
                            <div class="spec-line" style="font-size: 11.5px; color:#8d9790; margin-top: 2px;">
                                Languages: <strong>${(auditor.languages || []).join(', ')}</strong> · Active Load: <strong>${getActiveLoad(auditor.name, 'auditor')} / ${auditor.dailyCapacity || 5}</strong>
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px; width:auto; max-width:100%;">
                            ${headerMatchCount}
                            <div style="display:flex; gap:8px; align-items:center; flex-wrap:nowrap; position:relative;">
                                <div style="min-width:240px; position:relative;">
                                    ${audDropdownHtml}
                                </div>
                                <button type="button" id="btnRotateAuditor" style="${rotateBtnStyle}">🔄 Rotate (${poolAuditors.length})</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        matchList.innerHTML = coordHtml + foHtml + audHtml + distanceNote() + buildExceptionPanel();

        actionRow.innerHTML = `
            <button type="button" class="btn approve" id="btnAccept" style="flex:2; font-weight:700; background:#16382c; border-color:#16382c; padding:12px;">🚀 Dispatch Docket to Portals</button>
            <button type="button" class="btn ghost" id="btnRotateAlternate" style="flex:1; border-color:#dcd8cb; color:#19211d;">🔄 Rotate Alternate Candidate</button>
            <button type="button" class="btn ghost" id="btnBackEdit" style="flex:1; border-color:#dcd8cb; color:#19211d;">⬅ Back / Modify</button>
            <button type="button" class="btn reject" id="btnReject" style="flex:0.6; background:#fdf2f2; border-color:#fecaca; color:#b91c1c;">Dismiss</button>
        `;

        matchEmpty.style.display = 'none';
        matchList.style.display = 'flex';
        actionRow.style.display = 'flex';

        attachCandidateControls();
        attachExceptionControls();
        saveIntakeDraft();
    }

    function setupSearchableDropdown(key, onSelectCallback) {
        const wrap = document.getElementById(`dropdownWrap_${key}`);
        const btn = document.getElementById(`btnToggle_${key}`);
        const panel = document.getElementById(`panel_${key}`);
        const input = document.getElementById(`inputSearch_${key}`);
        const list = document.getElementById(`listItems_${key}`);
        if (!wrap || !btn || !panel) return;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = panel.style.display === 'block';
            document.querySelectorAll('.dropdown-fo-panel').forEach(p => {
                if (p !== panel) p.style.display = 'none';
            });
            if (!isOpen) {
                panel.style.display = 'block';
                if (input) {
                    input.value = '';
                    filterItems('');
                    setTimeout(() => input.focus(), 50);
                }
            } else {
                panel.style.display = 'none';
            }
        });

        function filterItems(query) {
            if (!list) return;
            const q = String(query || '').toLowerCase().trim();
            const rows = list.querySelectorAll('.fo-item-row');
            rows.forEach(r => {
                const text = (r.getAttribute('data-text') || '').toLowerCase();
                if (!q || text.includes(q)) {
                    r.style.setProperty('display', 'flex', 'important');
                } else {
                    r.style.setProperty('display', 'none', 'important');
                }
            });
        }

        if (input) {
            input.addEventListener('input', (e) => filterItems(e.target.value));
            input.addEventListener('keyup', (e) => filterItems(e.target.value));
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        panel.addEventListener('click', (e) => e.stopPropagation());

        if (list) {
            list.querySelectorAll('.fo-item-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const idx = parseInt(row.getAttribute('data-index'), 10);
                    panel.style.display = 'none';
                    if (!isNaN(idx) && typeof onSelectCallback === 'function') {
                        onSelectCallback(idx);
                    }
                });
            });
        }
    }

    function attachCandidateControls() {
        document.querySelectorAll('input[name="optFoMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                activeDualFoChoice = e.target.value;
                renderMatchUI();
            });
        });

        // 1. Coordinator Searchable Dropdown
        setupSearchableDropdown('coord', (selectedIdx) => {
            curCoordIdx = selectedIdx;
            pendingMatch.consensus.coordinator = poolCoordinators[curCoordIdx];
            renderMatchUI();
        });

        document.getElementById('btnRotateCoordinator')?.addEventListener('click', () => {
            if (poolCoordinators.length > 1) {
                curCoordIdx = (curCoordIdx + 1) % poolCoordinators.length;
                pendingMatch.consensus.coordinator = poolCoordinators[curCoordIdx];
                renderMatchUI();
            }
        });

        // 2. Field Officers Searchable Dropdown with direct OSRM real distance verification
        setupSearchableDropdown('hosp', async (selectedIdx) => {
            curHospFoIdx = selectedIdx;
            const fo = poolHospFOs[curHospFoIdx];
            if (fo) {
                const targetPin = cleanPin6(pendingMatch.hospitalPin || pendingMatch.pin);
                const foPin = cleanPin6(fo.basePin || fo.pin || fo.baseLocationPin);

                let finalDist = realKm(foPin, targetPin);
                if (finalDist === null && foPin && targetPin) {
                    try {
                        const res = await fetch('/api/distance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ destination: targetPin, origins: [foPin] })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.km && typeof data.km[foPin] === 'number') {
                                finalDist = data.km[foPin];
                                REAL_KM[realPairKey(foPin, targetPin)] = finalDist;
                                REAL_KM[realPipeKey(foPin, targetPin)] = finalDist;
                                REAL_Q[realPairKey(foPin, targetPin)] = 'road';
                                REAL_Q[realPipeKey(foPin, targetPin)] = 'road';
                            }
                        }
                    } catch (e) {
                        console.warn('Real distance fetch error:', e);
                    }
                }

                if (finalDist !== null) {
                    fo.distanceKm = finalDist;
                    fo.distSource = 'maps';
                }
            }
            renderMatchUI();
        });

        setupSearchableDropdown('res', async (selectedIdx) => {
            curResFoIdx = selectedIdx;
            const fo = poolResFOs[curResFoIdx];
            if (fo) {
                const targetPin = cleanPin6(pendingMatch.pin);
                const foPin = cleanPin6(fo.basePin || fo.pin || fo.baseLocationPin);

                let finalDist = realKm(foPin, targetPin);
                if (finalDist === null && foPin && targetPin) {
                    try {
                        const res = await fetch('/api/distance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ destination: targetPin, origins: [foPin] })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.km && typeof data.km[foPin] === 'number') {
                                finalDist = data.km[foPin];
                                REAL_KM[realPairKey(foPin, targetPin)] = finalDist;
                                REAL_KM[realPipeKey(foPin, targetPin)] = finalDist;
                                REAL_Q[realPairKey(foPin, targetPin)] = 'road';
                                REAL_Q[realPipeKey(foPin, targetPin)] = 'road';
                            }
                        }
                    } catch (e) {
                        console.warn('Real distance fetch error:', e);
                    }
                }

                if (finalDist !== null) {
                    fo.distanceKm = finalDist;
                    fo.distSource = 'maps';
                }
            }
            renderMatchUI();
        });

        async function ensureRealFoDistance(fo, destPin) {
            if (!fo || !destPin) return;
            const targetPin = cleanPin6(destPin);
            const foPin = cleanPin6(fo.basePin || fo.pin || fo.baseLocationPin);
            let finalDist = realKm(foPin, targetPin);

            if (finalDist === null && foPin && targetPin) {
                try {
                    const res = await fetch('/api/distance', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ destination: targetPin, origins: [foPin] })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.km && typeof data.km[foPin] === 'number') {
                            finalDist = data.km[foPin];
                            REAL_KM[realPairKey(foPin, targetPin)] = finalDist;
                            REAL_KM[realPipeKey(foPin, targetPin)] = finalDist;
                            REAL_Q[realPairKey(foPin, targetPin)] = 'road';
                            REAL_Q[realPipeKey(foPin, targetPin)] = 'road';
                        }
                    }
                } catch (e) {
                    console.warn('Rotate distance fetch error:', e);
                }
            }

            if (finalDist !== null) {
                fo.distanceKm = finalDist;
                fo.distSource = 'maps';
                const extraKm = Math.max(0, +(finalDist - 50.0).toFixed(1));
                fo.extraTa = +(extraKm * 2.50).toFixed(2);
            }
        }

        document.getElementById('btnRotateHospFo')?.addEventListener('click', async () => {
            if (poolHospFOs.length > 1) {
                curHospFoIdx = (curHospFoIdx + 1) % poolHospFOs.length;
                await ensureRealFoDistance(poolHospFOs[curHospFoIdx], pendingMatch.hospitalPin || pendingMatch.pin);
                renderMatchUI();
            }
        });

        document.getElementById('btnRotateResFo')?.addEventListener('click', async () => {
            if (poolResFOs.length > 1) {
                curResFoIdx = (curResFoIdx + 1) % poolResFOs.length;
                await ensureRealFoDistance(poolResFOs[curResFoIdx], pendingMatch.pin);
                renderMatchUI();
            }
        });

        // 3. Auditor Searchable Dropdown
        setupSearchableDropdown('aud', (selectedIdx) => {
            curAudIdx = selectedIdx;
            renderMatchUI();
        });

        document.getElementById('btnRotateAuditor')?.addEventListener('click', () => {
            if (poolAuditors.length > 1) {
                curAudIdx = (curAudIdx + 1) % poolAuditors.length;
                renderMatchUI();
            }
        });

        document.getElementById('btnRotateAlternate')?.addEventListener('click', async () => {
            if (activeMode === 'Digital') {
                if (poolAuditors.length > 1) {
                    curAudIdx = (curAudIdx + 1) % poolAuditors.length;
                }
            } else {
                if (poolCoordinators.length > 1) {
                    curCoordIdx = (curCoordIdx + 1) % poolCoordinators.length;
                    pendingMatch.consensus.coordinator = poolCoordinators[curCoordIdx];
                }
                if (poolHospFOs.length > 1) {
                    curHospFoIdx = (curHospFoIdx + 1) % poolHospFOs.length;
                    await ensureRealFoDistance(poolHospFOs[curHospFoIdx], pendingMatch.hospitalPin || pendingMatch.pin);
                }
                if (poolAuditors.length > 1) {
                    curAudIdx = (curAudIdx + 1) % poolAuditors.length;
                }
            }
            renderMatchUI();
        });

        // 3. Auditor Searchable Dropdown
        setupSearchableDropdown('aud', (selectedIdx) => {
            curAudIdx = selectedIdx;
            renderMatchUI();
        });

        document.getElementById('btnRotateAuditor')?.addEventListener('click', () => {
            if (poolAuditors.length > 1) {
                curAudIdx = (curAudIdx + 1) % poolAuditors.length;
                renderMatchUI();
            }
        });

        document.getElementById('btnRotateAlternate')?.addEventListener('click', () => {
            if (activeMode === 'Digital') {
                if (poolAuditors.length > 1) {
                    curAudIdx = (curAudIdx + 1) % poolAuditors.length;
                }
            } else {
                if (poolCoordinators.length > 1) {
                    curCoordIdx = (curCoordIdx + 1) % poolCoordinators.length;
                    pendingMatch.consensus.coordinator = poolCoordinators[curCoordIdx];
                }
                if (poolHospFOs.length > 1) {
                    curHospFoIdx = (curHospFoIdx + 1) % poolHospFOs.length;
                }
                if (poolAuditors.length > 1) {
                    curAudIdx = (curAudIdx + 1) % poolAuditors.length;
                }
            }
            renderMatchUI();
        });

        document.getElementById('btnBackEdit')?.addEventListener('click', () => {
            clearMatchUI();
            saveIntakeDraft();
        });

        document.getElementById('btnReject')?.addEventListener('click', () => {
            clearMatchUI();
            saveIntakeDraft();
        });
        document.getElementById('btnAccept')?.addEventListener('click', handleDocketDispatch);
    }

    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown-fo-panel').forEach(p => p.style.display = 'none');
    });

    function clearMatchUI() {
        pendingMatch = null;
        if (matchList) matchList.style.display = 'none';
        if (actionRow) actionRow.style.display = 'none';
        if (matchEmpty) matchEmpty.style.display = 'block';
    }

    async function prefetchRealDistances(payload) {
        if (payload.caseType === 'Digital') return;
        try {
            const roster = safeParse(STORAGE_KEY_FOS, (window.CA_ROSTER ? window.CA_ROSTER.fieldOfficers : []));
            const active = roster.filter(f => f.isActive !== false && !f.isDeactivatedByAdmin);
            const pPin = cleanPin6(payload.pin);
            const hPin = cleanPin6(payload.hospitalPin || payload.pin);
            const targetState = normState((payload.pinInfo && payload.pinInfo.state) || stateFromPin(hPin) || stateFromPin(pPin) || '').toLowerCase();
            const targetPrefix2 = hPin.slice(0, 2);

            // Sort Field Officers so Same-State & Same-Postal-Prefix PINs are fetched FIRST
            const sortedActive = [...active].sort((a, b) => {
                const pinA = cleanPin6(a.basePin || a.pin || a.baseLocationPin);
                const pinB = cleanPin6(b.basePin || b.pin || b.baseLocationPin);
                const stA = normState(stateFromPin(pinA) || a.state || '').toLowerCase();
                const stB = normState(stateFromPin(pinB) || b.state || '').toLowerCase();

                const sameStA = targetState && stA === targetState ? 1 : 0;
                const sameStB = targetState && stB === targetState ? 1 : 0;
                if (sameStA !== sameStB) return sameStB - sameStA;

                const samePrefA = pinA.slice(0, 2) === targetPrefix2 ? 1 : 0;
                const samePrefB = pinB.slice(0, 2) === targetPrefix2 ? 1 : 0;
                if (samePrefA !== samePrefB) return samePrefB - samePrefA;

                return estimatePinDistanceKm(pinA, hPin) - estimatePinDistanceKm(pinB, hPin);
            });

            const ask = async (dest, origins) => {
                const todo = [...new Set(origins)].filter(o => o && o !== dest && realKm(o, dest) === null);
                if (!todo.length) return;

                // Prioritize local/same-state PINs first (up to 60 per batch)
                const CHUNK_SIZE = 50;
                for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
                    const chunk = todo.slice(i, i + CHUNK_SIZE);
                    try {
                        const res = await fetch('/api/distance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ destination: dest, origins: chunk })
                        });
                        if (!res.ok) continue;
                        const data = await res.json();
                        mapsEnabled = !!data.enabled;
                        if (data.provider) mapsProvider = data.provider;

                        Object.keys(data.km || {}).forEach(o => {
                            if (typeof data.km[o] !== 'number') return;
                            REAL_KM[realPairKey(o, dest)] = data.km[o];
                            REAL_KM[realPipeKey(o, dest)] = data.km[o];
                            const q = (data.quality && data.quality[o]) || 'road';
                            REAL_Q[realPairKey(o, dest)] = q;
                            REAL_Q[realPipeKey(o, dest)] = q;
                        });

                        if (data.distances) {
                            Object.entries(data.distances).forEach(([k, v]) => {
                                const kmVal = typeof v === 'number' ? v : (v && v.km);
                                if (typeof kmVal === 'number') {
                                    REAL_KM[k] = kmVal;
                                    REAL_Q[k] = (v && v.m) || 'road';
                                }
                            });
                        }
                    } catch (err) { }
                }
            };

            const allPins = sortedActive.map(f => cleanPin6(f.basePin || f.pin || f.baseLocationPin)).filter(Boolean);
            const jobs = [];
            for (const dest of [...new Set([hPin, pPin])]) {
                jobs.push(ask(dest, allPins));
            }
            if (hPin !== pPin) jobs.push(ask(hPin, [pPin]));
            await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 12000))]);
        } catch (e) {
            console.warn('Real distances unavailable, using estimates:', e.message);
        }
    }
    async function handleExecuteMatch() {
        const isD = activeMode === 'Digital';
        if (isD && selectedLangs.length < 1) {
            alert('Please select at least 1 preferred language (1 to 3 languages).');
            return;
        }

        const clientNameEl = document.getElementById('clientName');
        const caseTypeEl = document.getElementById('caseType');
        const claimNoEl = document.getElementById('claimNo');
        const userNameEl = document.getElementById('userName');

        if (!clientNameEl?.value || !claimNoEl?.value || !userNameEl?.value) {
            alert('Please fill in all mandatory fields before matching.');
            return;
        }

        const cleanClaimNo = claimNoEl.value.trim();

        const existingCases = getCases();
        const duplicateCase = existingCases.find(c =>
            String(c.claimNo || '').trim().toLowerCase() === cleanClaimNo.toLowerCase() ||
            String(c.id || '').trim().toLowerCase() === cleanClaimNo.toLowerCase()
        );

        if (duplicateCase) {
            alert(`⚠️ Duplicate Claim Detected!\n\nClaim No: "${cleanClaimNo}" is already registered in the system (Docket ID: ${duplicateCase.id}, Status: ${duplicateCase.status}).\n\nDuplicate submission is strictly blocked.`);
            return;
        }

        const pinVal = document.getElementById('clientPin') ? document.getElementById('clientPin').value.trim() : '700001';
        const hospVal = document.getElementById('hospitalPin') ? document.getElementById('hospitalPin').value.trim() : pinVal;
        const pinInfo = await lookupPin(pinVal);

        const userPayload = {
            clientName: clientNameEl.value,
            caseType: caseTypeEl ? caseTypeEl.value : (isD ? 'Digital' : 'Cashless'),
            claimNo: cleanClaimNo,
            userName: userNameEl.value.trim(),
            pin: pinVal,
            hospitalPin: hospVal || pinVal,
            digitalLang: selectedLangs.join(', '),
            digitalLangs: isD ? [...selectedLangs] : [],
            digitalCategory: isD && document.getElementById('digitalCategory') ? document.getElementById('digitalCategory').value : '',
            pinInfo
        };

        const R = window.CA_ROSTER || {};
        if (!(R.coords || []).length || !(R.auditors || []).length || (userPayload.caseType !== 'Digital' && !(R.fieldOfficers || []).length)) {
            alert('The list of coordinators/auditors/field officers has not been imported yet. Please ask the admin to perform an Excel import from the Master Admin Console.');
            return;
        }
        await prefetchRealDistances(userPayload);
        const consensus = buildMatchCandidatePools(userPayload);
        pendingMatch = { ...userPayload, consensus };
        renderMatchUI();
    }

    caseForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleExecuteMatch();
    });

    const btnExecuteMatch = document.getElementById('btnExecuteMatch') || document.querySelector('button[type="submit"]');
    btnExecuteMatch?.addEventListener('click', async (e) => {
        if (e.target.type !== 'submit') {
            e.preventDefault();
            await handleExecuteMatch();
        }
    });

    // =========================================================================
    // RESTORED FULL DATA PAYLOAD FOR PORTAL COMPATIBILITY (Approve/Reject Ready)
    // =========================================================================
    async function handleDocketDispatch() {
        if (!pendingMatch) return;
        const { consensus } = pendingMatch;
        const isDigital = pendingMatch.caseType === 'Digital';

        const coordinator = poolCoordinators[curCoordIdx] || consensus.coordinator;
        let assignedFo1 = poolHospFOs[curHospFoIdx] || null;
        let assignedFo2 = (consensus.isDualFoRequired && activeDualFoChoice === 'dual') ? (poolResFOs[curResFoIdx] || null) : null;

        if (consensus.isDualFoRequired && !isDigital) {
            if (activeDualFoChoice === 'hospOnly') {
                assignedFo1 = poolHospFOs[curHospFoIdx] || null;
                assignedFo2 = null;
            } else if (activeDualFoChoice === 'resOnly') {
                assignedFo1 = poolResFOs[curResFoIdx] || null;
                assignedFo2 = null;
            }
        }

        const auditor = poolAuditors[curAudIdx] || null;

        if (!auditor || (!isDigital && !assignedFo1) || !coordinator) {
            alert('Cannot dispatch: Qualified candidate allocation incomplete.');
            return;
        }

        const overrides = overridesNow();
        if (overrides.length) {
            const details = exceptionDetails(overrides);
            const missing = window.CA_Rules.missingRemarks(overrides, details);
            if (missing.length) {
                renderMatchUI();
                document.querySelectorAll('textarea[data-exc]').forEach(t => {
                    if (missing.some(m => m.field === t.dataset.exc)) t.style.borderColor = '#b91c1c';
                });
                const firstBad = document.querySelector('textarea[data-exc="' + missing[0].field + '"]');
                if (firstBad) { firstBad.focus(); firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                alert('An exception remark is mandatory because you changed the automatic allocation.');
                return;
            }
        }

        const isDualActive = (consensus.isDualFoRequired && activeDualFoChoice === 'dual' && assignedFo2 !== null);

        let foAllocationSummary = '';
        if (isDigital) {
            foAllocationSummary = 'Bypassed (Digital VI)';
        } else if (isDualActive) {
            foAllocationSummary = `Spot 1 (Hospital FO): ${assignedFo1.name}\nSpot 2 (Patient FO): ${assignedFo2.name}`;
        } else {
            foAllocationSummary = `${assignedFo1.name} (${assignedFo1.distanceKm} km)`;
        }

        const isAuditorOnRoll = /on-?roll/i.test(String(auditor.employmentType || auditor.grade || ''));

        const liveClaimInput = document.getElementById('claimNo')?.value?.trim();
        let cleanClaimNo = liveClaimInput || String(pendingMatch.claimNo || '').trim();

        if (!cleanClaimNo) {
            cleanClaimNo = 'CLM-' + Date.now().toString().slice(-6);
        }

        const confirmDispatch = confirm(
            `Confirm Case Ingestion & Dispatch?\n\n` +
            `• Claim No / ID: ${cleanClaimNo}\n` +
            `• Patient: ${pendingMatch.userName}\n` +
            `• Mode: ${pendingMatch.caseType}\n` +
            `• Coordinator: ${coordinator.name}\n` +
            `• Field Officer:\n  ${foAllocationSummary}\n` +
            `• Auditor: ${auditor.name} [${isAuditorOnRoll ? 'On-Roll' : 'Off-Roll'}]\n\n` +
            `Click OK to Dispatch, or Cancel to Stay.`
        );

        if (!confirmDispatch) return;

        const now = new Date();
        let fo1Mention = isDigital ? 'Bypassed' : (isDualActive ? `${assignedFo1.name} (Hospital FO)` : `${assignedFo1.name} (Primary FO)`);
        let fo2Mention = isDualActive ? `${assignedFo2.name} (Patient FO)` : null;

        const isCL = String(pendingMatch.caseType || '').toLowerCase().includes('cashless');
        const slaHours = isCL ? 3 : (isDigital ? 24 : 168);

        const choiceNow = currentChoice();

        const newDocket = {
            autoAllocation: {
                coordinatorId: consensus.suggestion?.coordinatorId,
                fieldOfficerId: consensus.suggestion?.fieldOfficerId,
                fieldOfficer2Id: consensus.suggestion?.fieldOfficer2Id,
                auditorId: consensus.suggestion?.auditorId,
                foMode: consensus.suggestion?.foMode
            },
            foDeployment: choiceNow.ids.foDeployment,
            allocationExceptions: overrides.length ? exceptionDetails(overrides) : [],

            id: cleanClaimNo,
            caseId: cleanClaimNo,
            claimNo: cleanClaimNo,
            clientName: pendingMatch.clientName,
            caseType: pendingMatch.caseType,
            userName: pendingMatch.userName,
            pin: pendingMatch.pin,
            hospitalPin: pendingMatch.hospitalPin || 'N/A',
            digitalLang: pendingMatch.digitalLang || 'N/A',
            digitalLangs: pendingMatch.digitalLangs || [],
            digitalCategory: pendingMatch.digitalCategory || 'N/A',
            city: (pendingMatch.pinInfo && pendingMatch.pinInfo.city) || '',
            state: consensus.geography?.state || 'N/A',
            zone: consensus.geography?.zoneName || 'North Zone',

            coordinatorId: coordinator.employeeId || coordinator.id || 'EMP-CRD',
            coordinatorName: coordinator.name || 'Operations Lead',

            fieldOfficerId: isDigital ? null : (assignedFo1.employeeId || assignedFo1.id),
            fieldOfficerName: isDigital ? 'Bypassed' : assignedFo1.name,
            fieldOfficerRole: isDigital ? null : 'Hospital FO',

            fieldOfficer2Id: isDualActive ? (assignedFo2.employeeId || assignedFo2.id) : null,
            fieldOfficer2Name: isDualActive ? assignedFo2.name : null,
            fieldOfficer2Role: isDualActive ? 'Patient FO' : null,

            auditorId: auditor.employeeId || auditor.id,
            auditorName: auditor.name,

            assignedTeam: {
                coordinator: coordinator.name || 'Operations Lead',
                fieldOfficer: fo1Mention,
                fieldOfficer2: fo2Mention,
                auditor: auditor.name
            },
            approvals: {
                coordinator: 'Pending',
                fieldOfficer: isDigital ? 'Bypassed' : 'Pending',
                auditor: 'Pending'
            },
            foSpot1Verified: false,
            foSpot2Verified: false,
            foDistanceKm: isDigital ? 0 : (assignedFo1.distanceKm || 0),
            foDistanceSource: isDigital ? null : (assignedFo1.distSource || 'estimate'),
            extraTaAmount: isDigital ? 0 : (assignedFo1.extraTa || 0),
            isDualSpot: isDualActive,
            status: 'In Progress',
            referenceId: null,
            createdAt: now.toISOString(),
            slaDeadline: new Date(now.getTime() + (slaHours * 3600 * 1000)).toISOString()
        };

        const btnAccept = document.getElementById('btnAccept');
        if (btnAccept) {
            btnAccept.disabled = true;
            btnAccept.textContent = 'Ingesting Docket...';
        }

        try {
            let resp = await fetch('/api/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newDocket)
            });

            if (resp.status === 409 || !resp.ok) {
                const errData = await resp.clone().json().catch(() => ({}));
                if (resp.status === 409 || (errData.error && errData.error.toLowerCase().includes('already exists'))) {
                    const uniqueSuffix = '-' + Date.now().toString().slice(-4);
                    const safeClaimNo = cleanClaimNo + uniqueSuffix;

                    newDocket.id = safeClaimNo;
                    newDocket.caseId = safeClaimNo;
                    newDocket.claimNo = safeClaimNo;

                    console.warn(`Duplicate key conflict bypassed. Ingesting as: ${safeClaimNo}`);

                    resp = await fetch('/api/cases', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newDocket)
                    });
                }
            }

            if (!resp.ok) {
                const finalErr = await resp.json().catch(() => ({}));
                throw new Error(finalErr.error || 'Server error occurred during docket ingestion.');
            }

            const savedDocket = await resp.json().catch(() => newDocket);

            const currentCases = getCases();
            const updatedCases = [savedDocket, ...currentCases.filter(c => String(c.id).toLowerCase() !== String(savedDocket.id).toLowerCase())];
            saveCases(updatedCases);
            if (window.CA_refreshLoad) await window.CA_refreshLoad();

            try {
                localStorage.removeItem(STORAGE_KEY_INTAKE_DRAFT);
            } catch (e) { }

            caseForm?.reset();
            resetIntakeExtras();
            if (detectedZoneBadge) detectedZoneBadge.style.display = 'none';
            clearMatchUI();
            if (entryFormPanel) entryFormPanel.style.display = 'none';
            if (entryChoicePanel) entryChoicePanel.style.display = 'block';
            renderCasePipeline();
            alert(`✓ Case Docket #${savedDocket.id} successfully dispatched to Zonal Portals!`);

        } catch (err) {
            alert(`Dispatch Error: ${err.message}`);
            if (btnAccept) {
                btnAccept.disabled = false;
                btnAccept.textContent = '🚀 Dispatch Docket to Portals';
            }
        }
    }

    window.printCaseAuditSlip = function (caseId) {
        const cases = getCases();
        const c = cases.find(item => String(item.id).trim() === String(caseId).trim() || String(item.claimNo).trim() === String(caseId).trim());
        if (!c) {
            alert('Case details not found!');
            return;
        }

        const isApproved = c.status === 'Approved';
        const cleanClaim = String(c.claimNo || c.id).trim();
        const settleRef = c.referenceId || (isApproved ? 'REF-SETTLE-' + cleanClaim : 'PENDING FINAL APPROVAL');

        let foAssignmentDetail = esc(c.assignedTeam?.fieldOfficer || 'Bypassed');
        if (c.assignedTeam?.fieldOfficer2) {
            foAssignmentDetail += ' | ' + esc(c.assignedTeam.fieldOfficer2);
        }

        const logoSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 550 120" style="height: 52px; width: auto; display: block;">
                <circle cx="60" cy="60" r="50" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="6,4" opacity="0.8"/>
                <path d="M 58 18 L 58 82 M 28 62 Q 42 30 58 24 Q 48 50 38 68 Z" fill="#0284c7"/>
                <path d="M 64 26 Q 90 52 64 80 Z" fill="#0091ff"/>
                <path d="M 22 78 Q 48 98 94 82 Q 80 94 36 92 Z" fill="#0070e0"/>
                <path d="M 16 94 Q 38 84 65 96 Q 86 84 105 94" fill="none" stroke="#38bdf8" stroke-width="3"/>
                <text x="135" y="55" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="36" font-weight="900" fill="#0084ff" letter-spacing="1">CHECKERS &amp; TRACKERS</text>
                <text x="135" y="92" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="500" fill="#60a5fa" letter-spacing="5">Consultancy Services</text>
            </svg>
        `;

        const approvalSignatureHtml = isApproved ? `
            <div style="margin-top: 28px; padding-top: 18px; border-top: 1.5px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-end;">
                <div style="border: 2.5px solid #059669; border-radius: 12px; padding: 10px 18px; background: #f0fdf4; display: inline-flex; align-items: center; gap: 12px; transform: rotate(-1deg); box-shadow: 0 2px 6px rgba(5, 150, 105, 0.08);">
                    <div style="font-size: 26px;">🛡️</div>
                    <div>
                        <div style="font-size: 13px; font-weight: 900; color: #065f46; letter-spacing: 0.8px; text-transform: uppercase;">VERIFIED &amp; CERTIFIED</div>
                        <div style="font-size: 10.5px; color: #047857; font-weight: 700; margin-top: 1px;">Digitally Approved • Risk Audited</div>
                    </div>
                </div>

                <div style="text-align: right; min-width: 220px;">
                    <div style="font-family: 'Brush Script MT', 'Dancing Script', cursive, sans-serif; font-size: 28px; color: #1e3a8a; font-weight: 700; transform: rotate(-3deg); margin-bottom: 2px;">
                        Dr. Vineet Kumar Mittal
                    </div>
                    <div style="width: 190px; height: 1.5px; background: #64748b; margin-left: auto; margin-bottom: 4px;"></div>
                    <div style="font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">Founder &amp; CEO</div>
                    <div style="font-size: 10.5px; color: #64748b; font-weight: 600;">Checkers &amp; Trackers Consultancy Services</div>
                </div>
            </div>
        ` : `
            <div style="margin-top: 24px; padding: 14px 18px; border-radius: 8px; background: #fffbeb; border: 1px dashed #d97706; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 12px; color: #92400e; font-weight: 700;">⚠️ Final Management Sign-Off Pending: Docket is under active tripartite review.</span>
                <span style="font-size: 11px; background: #fef3c7; color: #b45309; font-weight: 800; padding: 3px 8px; border-radius: 6px; border: 1px solid #fde68a;">UNVERIFIED</span>
            </div>
        `;

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Claim Investigation Docket - ${esc(c.claimNo)}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 36px; color: #1e293b; background: #fff; line-height: 1.5; }
                    .header { border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
                    .brand-wrap { display: flex; align-items: center; gap: 18px; }
                    .doc-title { font-size: 12.5px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; border-left: 2px solid #cbd5e1; padding-left: 12px; }
                    .badge { display: inline-block; padding: 6px 12px; border-radius: 6px; font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
                    .badge-ok { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
                    .badge-pend { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 24px; }
                    th, td { border: 1px solid #cbd5e1; padding: 9px 12px; text-align: left; font-size: 13px; }
                    th { background-color: #f8fafc; font-weight: 700; width: 32%; color: #334155; }
                    .settle-box { border: 2px dashed ${isApproved ? '#059669' : '#d97706'}; padding: 18px; border-radius: 8px; background: ${isApproved ? '#f0fdf4' : '#fffbeb'}; }
                    @media print { 
                        body { padding: 15px; }
                        @page { margin: 12mm; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="brand-wrap">
                        ${logoSvg}
                        <div>
                            <div class="doc-title">Medical Claims Investigation &amp; Audit Docket<br><span style="font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: none;">Autonomous Verification Summary</span></div>
                        </div>
                    </div>
                    <div>
                        <span class="badge ${isApproved ? 'badge-ok' : 'badge-pend'}">${isApproved ? 'SETTLED &amp; CERTIFIED' : 'INVESTIGATION IN PROGRESS'}</span>
                    </div>
                </div>

                <table>
                    <tr><th>Case ID / Docket</th><td><strong>${esc(c.id)}</strong></td></tr>
                    <tr><th>Claim Number</th><td><strong style="color:#0284c7;">${esc(c.claimNo)}</strong></td></tr>
                    <tr><th>Patient Name</th><td>${esc(c.userName)}</td></tr>
                    <tr><th>Insurance Carrier / TPA</th><td><strong>${esc(c.clientName)}</strong></td></tr>
                    <tr><th>Case Category</th><td>${esc(c.caseType)} (${esc(c.digitalCategory || 'Standard')})</td></tr>
                    <tr><th>Geo Location</th><td>Patient PIN: ${esc(c.pin)} | Hospital PIN: ${esc(c.hospitalPin || 'N/A')} | Region: ${esc(c.state || c.zone)}</td></tr>
                    <tr><th>Ingestion Timestamp</th><td>${new Date(c.createdAt).toLocaleString()}</td></tr>
                    <tr><th>Operations Coordinator</th><td>${esc(c.assignedTeam?.coordinator || 'Assigned')} [<strong>${esc(c.approvals?.coordinator || 'Pending')}</strong>]</td></tr>
                    <tr><th>Field Officer Deployment</th><td><strong>${foAssignmentDetail}</strong> [<strong>${esc(c.approvals?.fieldOfficer || 'Pending')}</strong>]</td></tr>
                    <tr><th>Clinical Claims Auditor</th><td>${esc(c.assignedTeam?.auditor || 'Assigned')} [<strong>${esc(c.approvals?.auditor || 'Pending')}</strong>]</td></tr>
                </table>

                <div class="settle-box">
                    <div style="font-size:11px; font-weight:800; text-transform:uppercase; color:${isApproved ? '#065f46' : '#92400e'};">Master Settlement Reference:</div>
                    <div style="font-size:18px; font-weight:900; color:${isApproved ? '#047857' : '#b45309'}; margin-top:4px; font-family:monospace;">${esc(settleRef)}</div>
                    <div style="font-size:11.5px; margin-top:6px; color:${isApproved ? '#065f46' : '#92400e'};">
                        ${isApproved ? '✓ All operational desks have approved this docket. File is cleared for final payment settlement.' : '⚠️ Docket is currently under active field/clinical review. Settlement reference will activate upon final tripartite approval.'}
                    </div>
                </div>

                ${approvalSignatureHtml}

                <script>
                    window.onload = function() {
                        setTimeout(function() {
                            window.print();
                        }, 250);
                    };
                </script>
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
        }
    };

    function renderCasePipeline() {
        const allCases = getCases();
        const search = document.getElementById('caseSearchInput')?.value.trim().toLowerCase() || '';
        const cases = allCases.filter(c => !search || [c.id, c.claimNo, c.userName, c.clientName, c.pin].join(' ').toLowerCase().includes(search));

        if (metricActiveCases) {
            const activeCount = allCases.filter(c => c.status !== 'Approved').length;
            metricActiveCases.textContent = activeCount < 10 ? `0${activeCount}` : `${activeCount}`;
        }

        if (!caseListWrap) return;
        if (cases.length === 0) {
            caseListWrap.innerHTML = '<div style="text-align:center; padding:24px; color:var(--ink-soft);">No dockets ingested yet.</div>';
            return;
        }

        caseListWrap.innerHTML = cases.map(c => {
            const isApproved = c.status === 'Approved';
            const settleRef = c.referenceId;

            let foDisplay = esc(c.assignedTeam?.fieldOfficer || 'Bypassed');
            if (c.assignedTeam?.fieldOfficer2) {
                foDisplay += ` + ${esc(c.assignedTeam.fieldOfficer2)}`;
            }

            return `
            <div class="case-item">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                    <div>
                        <strong>Case ID: ${esc(c.id)} (Claim #${esc(c.claimNo)})</strong>
                        <span class="status-pill ${isApproved ? 'active' : (c.status.includes('Disputed') ? 'inactive' : 'pending')}" style="margin-left:6px;">${c.status}</span>
                    </div>
                    <button type="button" class="btn small ghost" style="padding:3px 8px; font-size:11px; display:inline-flex; align-items:center; gap:4px; border:1px solid #cbd5e1; cursor:pointer;" onclick="printCaseAuditSlip('${c.id}')">
                        📄 PDF Report
                    </button>
                </div>
                <div class="spec-line" style="margin-top:4px;"><strong>${esc(c.userName)}</strong> (${esc(c.clientName)}) · ${c.caseType} · Zone: ${c.zone} (PIN: ${esc(c.pin)})</div>
                <div class="spec-line" style="font-size:11px;">
                    Coord: <strong>${c.approvals.coordinator}</strong> (${esc(c.assignedTeam?.coordinator)}) | 
                    FO: <strong>${c.approvals.fieldOfficer}</strong> (${foDisplay}) | 
                    Aud: <strong>${c.approvals.auditor}</strong> (${esc(c.assignedTeam?.auditor)})
                </div>
                ${settleRef ? `<div class="spec-line" style="color:var(--green); font-weight:700; margin-top:3px;">✓ Master Settlement ID: ${esc(settleRef)}</div>` : ''}
            </div>
            `;
        }).join('');
    }

    window.renderCasePipeline = renderCasePipeline;

    async function initCloudSync() {
        try {
            if (window.CA_syncCases) await window.CA_syncCases(true);
        } catch (e) {
            console.warn('Central database unreachable, showing the last known data');
        }
        renderCasePipeline();
    }

    document.getElementById('btnRefreshCases')?.addEventListener('click', () => {
        initCloudSync();
    });
    document.getElementById('caseSearchInput')?.addEventListener('input', renderCasePipeline);

    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY_CASES || e.key === STORAGE_KEY_FOS || e.key === STORAGE_KEY_COORDS || e.key === STORAGE_KEY_AUDITORS) {
            renderCasePipeline();
        }
    });

    window.addEventListener('ca_cases_updated', renderCasePipeline);
    window.addEventListener('ca_roster_synced', () => {
        renderCasePipeline();
    });

    initCloudSync();
    restoreIntakeDraft();
})();