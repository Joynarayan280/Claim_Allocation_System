(function () {
    'use strict';
    const STORAGE_KEY_COORDS = 'ca_registered_coordinators';
    const STORAGE_KEY_FOS = 'ca_registered_field_officers';
    const STORAGE_KEY_AUDITORS = 'ca_registered_auditors';

    // Global utility helpers
    window.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    window.safeParse = (key, fallback = []) => {
        try {
            const d = JSON.parse(localStorage.getItem(key));
            return Array.isArray(d) && d.length > 0 ? d : fallback;
        } catch (e) {
            return fallback;
        }
    };

    // No demo data: the real roster comes from the server (Admin -> Staff Roster Import) and is loaded by session.js.


    // Responsive design: Attach labels and wrapper elements to table cells for card rendering
    function labelTable(t) {
        const heads = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
        t.querySelectorAll('tbody tr').forEach(r => [...r.children].forEach((td, i) => {
            if (td.hasAttribute('colspan') || td.querySelector(':scope > .cell')) return;
            td.dataset.label = heads[i] || '';
            const wrap = document.createElement('span');
            wrap.className = 'cell';
            while (td.firstChild) wrap.appendChild(td.firstChild);
            td.appendChild(wrap);
        }));
    }

    // 


    document.querySelectorAll('.data-table').forEach(t => {
        labelTable(t);
        new MutationObserver(() => labelTable(t)).observe(t, { childList: true, subtree: true });
    });
})();