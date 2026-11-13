/* session.js - must be the FIRST script on every portal page.

   What it does
   1) Login check. Sends the browser to login.html when there is no valid session.
   2) Loads the real staff roster (imported from Excel by the Admin) from the server into localStorage,
      so the portal scripts, which read localStorage, always work on the real data.
   3) Case loading that cannot lose work:
        - CA_syncCases()  loads the user's working set (all open cases + recent approved) from the server,
                          stores it without ever crashing on the browser's 5 MB limit, and re-renders the page.
        - CA_startLive()  keeps the page updated (socket.io + a polling safety net).
        - Every save (PATCH / DELETE on /api/cases) that fails because of a network problem, an expired
          session or a server hiccup is kept on this device and retried automatically; the user sees a banner.
   4) Top bar: name + Sign Out, and hides links to portals this role may not open.

   Note: the portal scripts were written around localStorage, so the first two requests below are made
   synchronously (small, once per page load) to guarantee the data is ready before those scripts run. */
(function () {
  'use strict';

  var CASES_KEY = 'ca_shared_cases';
  var QUEUE_KEY = 'ca_pending_writes';

  // ---------------------------------------------------------------- helpers
  function getSync(url) {
    var x = new XMLHttpRequest();
    x.open('GET', url, false);
    try { x.send(null); } catch (e) { return { status: 0, body: null }; }
    var body = null;
    try { body = JSON.parse(x.responseText); } catch (e) { }
    return { status: x.status, body: body };
  }

  function go(url) {
    window.location.replace(url);
    throw new Error('redirecting to ' + url);
  }

  // ---------------------------------------------------------------- 1) session check
  var me = getSync('/api/auth/me');
  if (me.status === 401 || me.status === 403) go('/login.html');
  if (me.status !== 200 || !me.body) {
    document.documentElement.innerHTML = '<body style="font-family:sans-serif;padding:40px"><h3>Cannot reach the server.</h3><p>Please check your connection and refresh this page.</p></body>';
    throw new Error('server unreachable');
  }
  if (me.body.mustChangePassword) go('/change-password.html');

  var KEYS = { coords: 'ca_registered_coordinators', fos: 'ca_registered_field_officers', auds: 'ca_registered_auditors' };
  var pid = String((me.body.profile && me.body.profile.employeeId) || me.body.employeeId);

  // A different person used this browser before: wipe their cached cases and roster.
  try {
    var prev = localStorage.getItem('ca_session_user');
    var current = me.body.employeeId + '|' + me.body.role;
    if (prev !== current) {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('ca_') === 0) localStorage.removeItem(k);
      });
      localStorage.setItem('ca_session_user', current);
    }
  } catch (e) { }

  // ---------------------------------------------------------------- 2) roster
  var roster = getSync('/api/roster');
  var R = (roster.status === 200 && roster.body) ? roster.body : { coords: [], fieldOfficers: [], auditors: [] };
  try {
    localStorage.setItem(KEYS.coords, JSON.stringify(R.coords || []));
    localStorage.setItem(KEYS.fos, JSON.stringify(R.fieldOfficers || []));
    localStorage.setItem(KEYS.auds, JSON.stringify(R.auditors || []));
  } catch (e) { }

  window.CA_ROSTER = { coords: R.coords || [], fieldOfficers: R.fieldOfficers || [], auditors: R.auditors || [] };
  window.CA_ME = { employeeId: pid, loginId: me.body.employeeId, role: me.body.role, name: me.body.name, profile: me.body.profile || {} };

  // Changes made to a staff profile in a portal (duty on/off, leave, capacity) are pushed to the server.
  var snap = {};
  function indexList(arr) {
    var m = {};
    (arr || []).forEach(function (p) {
      if (p && p.employeeId !== undefined) m[String(p.employeeId)] = JSON.stringify(p);
    });
    return m;
  }
  [KEYS.coords, KEYS.fos, KEYS.auds].forEach(function (k) {
    try { snap[k] = indexList(JSON.parse(localStorage.getItem(k))); } catch (e) { snap[k] = {}; }
  });

  var pendingProfiles = {};
  var profileTimer = null;
  function flushProfiles() {
    profileTimer = null;
    var jobs = pendingProfiles;
    pendingProfiles = {};
    Object.keys(jobs).forEach(function (id) {
      var item = jobs[id];
      fetch('/api/members/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: id, role: item.role || window.CA_ME.role, data: item })
      }).catch(function () { });
    });
  }

  var origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    origSet.apply(this, arguments);
    if (this !== window.localStorage || !snap[k]) return;
    var list;
    try { list = JSON.parse(v); } catch (e) { return; }
    var next = indexList(list);
    if (!window.CA_noSync) {
      (list || []).forEach(function (p) {
        var id = String(p.employeeId);
        if (snap[k][id] !== undefined && snap[k][id] !== next[id]) pendingProfiles[id] = p; // only changed, already existing staff
      });
      if (Object.keys(pendingProfiles).length && !profileTimer) profileTimer = setTimeout(flushProfiles, 400);
    }
    snap[k] = next;
  };

  window.CA_pickMe = function (list, fallbackIndex) {
    if (!Array.isArray(list) || !list.length) return null;
    var found = list.find(function (p) { return String(p.employeeId) === window.CA_ME.employeeId; });
    if (found) return found;
    return window.CA_ME.role === 'Admin' ? list[fallbackIndex || 0] : null; // Admin may "view as" the first person
  };
  window.CA_isAdmin = function () { return window.CA_ME.role === 'Admin'; };

  // ---------------------------------------------------------------- banner
  function banner(message, kind, action) {
    function draw() {
      var el = document.getElementById('caBanner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'caBanner';
        el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;max-width:92vw;z-index:99999;padding:10px 16px;border-radius:10px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;';
        document.body.appendChild(el);
      }
      el.style.background = kind === 'error' ? '#8f1d1d' : (kind === 'warn' ? '#8a5a00' : '#16382c');
      el.style.color = '#fff';
      el.innerHTML = '';
      var t = document.createElement('span');
      t.textContent = message;
      el.appendChild(t);
      if (action) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = action.label;
        b.style.cssText = 'background:#fff;color:#111;border:0;border-radius:6px;padding:4px 10px;font-weight:700;cursor:pointer;';
        b.onclick = action.run;
        el.appendChild(b);
      }
      var x = document.createElement('button');
      x.type = 'button'; x.textContent = '×';
      x.style.cssText = 'background:transparent;color:#fff;border:0;font-size:18px;cursor:pointer;';
      x.onclick = function () { el.remove(); };
      el.appendChild(x);
    }
    if (document.body) draw(); else document.addEventListener('DOMContentLoaded', draw);
  }
  function clearBanner() {
    var el = document.getElementById('caBanner');
    if (el) el.remove();
  }
  window.CA_banner = banner;

  function sessionExpired() {
    banner('Your session has expired. Sign in again. Unsaved changes are kept on this device and will be sent after you sign in.', 'error',
      { label: 'Sign in', run: function () { window.location.href = '/login.html'; } });
  }

  // ---------------------------------------------------------------- 3a) retry queue for saves
  var origFetch = window.fetch.bind(window);
  var flushing = false;

  function readQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; }
  }
  function writeQueue(q) {
    try {
      if (q.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); else localStorage.removeItem(QUEUE_KEY);
    } catch (e) { }
  }
  function enqueue(url, method, body) {
    var q = readQueue();
    q.push({ url: url, method: method, body: body || null, ts: Date.now() });
    writeQueue(q);
    banner('A save could not reach the server. It is kept on this device and will be retried automatically (' + q.length + ' waiting).', 'warn');
    scheduleFlush(4000);
  }

  var flushTimer = null;
  function scheduleFlush(ms) {
    if (flushTimer) return;
    flushTimer = setTimeout(function () { flushTimer = null; flushQueue(); }, ms);
  }

  function flushQueue() {
    if (flushing) return Promise.resolve();
    var q = readQueue();
    if (!q.length) return Promise.resolve();
    flushing = true;
    var remaining = [];
    var stop = false;
    var sentOk = 0;

    return q.reduce(function (chain, item) {
      return chain.then(function () {
        if (stop) { remaining.push(item); return; }
        var init = { method: item.method, headers: { 'Content-Type': 'application/json' } };
        if (item.body) init.body = item.body;
        return origFetch(item.url, init).then(function (res) {
          if (res.ok) { sentOk++; return; }
          if (res.status === 401) { stop = true; remaining.push(item); sessionExpired(); return; }
          if (res.status >= 500 || res.status === 409 || res.status === 429 || res.status === 408) { remaining.push(item); return; }
          // 400 / 403 / 404: the server will never accept this change, drop it and tell the user.
          banner('One change was rejected by the server and was not saved (case ' + decodeURIComponent(item.url.split('/').pop()) + '). Refresh the page.', 'error');
        }, function () { stop = true; remaining.push(item); });
      });
    }, Promise.resolve()).then(function () {
      writeQueue(remaining);
      flushing = false;
      if (remaining.length) scheduleFlush(8000);
      else if (sentOk) { clearBanner(); window.CA_syncCases(true); }
    });
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var isCaseWrite = /^\/api\/cases(\/|$)/.test(url) && method !== 'GET' && method !== 'POST';
    var body = init && typeof init.body === 'string' ? init.body : null;

    return origFetch(input, init).then(function (res) {
      if (res.status === 401 && url.indexOf('/api/auth/') !== 0) {
        if (isCaseWrite) enqueue(url, method, body); else sessionExpired();
      } else if (isCaseWrite && !res.ok) {
        if (res.status >= 500 || res.status === 409 || res.status === 429 || res.status === 408) {
          enqueue(url, method, body);
        } else {
          res.clone().json().catch(function () { return {}; }).then(function (j) {
            banner('The server did not accept this update: ' + (j.error || ('error ' + res.status)), 'error');
          });
        }
      }
      return res;
    }, function (err) {
      if (isCaseWrite) enqueue(url, method, body);
      throw err;
    });
  };

  window.addEventListener('online', function () { flushQueue(); });
  document.addEventListener('DOMContentLoaded', function () { if (readQueue().length) scheduleFlush(1500); });

  // ---------------------------------------------------------------- 3b) case loading
  // Stores as many cases as the browser allows (newest first). Returns how many were stored.
  function storeCases(cases) {
    var n = cases.length;
    while (true) {
      try {
        origSet.call(localStorage, CASES_KEY, JSON.stringify(n === cases.length ? cases : cases.slice(0, n)));
        return n;
      } catch (e) {
        if (n <= 1) return 0;
        n = Math.floor(n / 2);
      }
    }
  }
  window.CA_storeCases = storeCases;

  function notifyPage() {
    try { window.dispatchEvent(new StorageEvent('storage', { key: CASES_KEY })); } catch (e) { }
    try { window.dispatchEvent(new CustomEvent('ca_cases_updated')); } catch (e) { }
  }

  var syncing = null;
  var syncAgain = false;
  var lastSync = 0;

  // Load the working set. force=true ignores the 8 second throttle.
  window.CA_syncCases = function (force) {
    if (!force && Date.now() - lastSync < 8000) return Promise.resolve();   // many users + many updates: refresh at most every 8 s
    if (syncing) { if (force) syncAgain = true; return syncing; }

    // Never overwrite local state with older server state while saves are still waiting to be sent.
    var wait = readQueue().length ? flushQueue() : Promise.resolve();

    syncing = wait.then(function () {
      return origFetch('/api/cases');
    }).then(function (res) {
      if (res.status === 401) { sessionExpired(); return null; }
      if (!res.ok) return null;
      var truncated = res.headers.get('X-Truncated') === '1';
      var openTotal = Number(res.headers.get('X-Open-Total') || 0);
      return res.json().then(function (cases) {
        var stored = storeCases(cases);
        lastSync = Date.now();
        if (stored < cases.length) {
          banner('Showing the newest ' + stored + ' of ' + cases.length + ' cases (browser storage limit). Older ones are safe on the server.', 'warn');
        } else if (truncated) {
          banner('You have ' + openTotal + ' open cases; the newest ' + cases.length + ' are shown.', 'warn');
        }
        notifyPage();
        return window.CA_refreshLoad ? window.CA_refreshLoad() : null;
      });
    }).catch(function () { /* offline: keep showing the last data */ }).then(function () {
      syncing = null;
      if (syncAgain) { syncAgain = false; return window.CA_syncCases(true); }
    });
    return syncing;
  };

  // Workload per person (counted by the database). Only coordinators and admins need it (Intake Desk).
  window.CA_LOAD = null;
  window.CA_refreshLoad = function () {
    if (window.CA_ME.role !== 'Admin' && window.CA_ME.role !== 'Coordinator') return Promise.resolve();
    return origFetch('/api/load').then(function (res) { return res.ok ? res.json() : null; }).then(function (load) {
      if (load) {
        window.CA_LOAD = load;
        try { window.dispatchEvent(new CustomEvent('ca_cases_updated')); } catch (e) { }
      }
    }).catch(function () { });
  };

  // Keeps a page live: first load, socket.io updates, and a polling safety net.
  window.CA_startLive = function () {
    window.CA_syncCases(false);
    if (typeof io === 'function') {
      try {
        var socket = io();
        socket.on('cases_updated', function () { window.CA_syncCases(false); });
        socket.on('connect_error', function () { /* polling below keeps the page updated */ });
      } catch (e) { }
    }
    setInterval(function () { if (!document.hidden) window.CA_syncCases(false); }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) window.CA_syncCases(false); });
  };

  // ---------------------------------------------------------------- sign out
  window.CA_logout = function () {
    var done = function () {
      try {
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf('ca_') === 0 && k !== QUEUE_KEY) localStorage.removeItem(k);
        });
      } catch (e) { }
      window.location.replace('/login.html');
    };
    if (readQueue().length && !confirm('Some changes have not reached the server yet. Sign out anyway? They will be sent the next time you sign in on this device.')) return;
    origFetch('/api/auth/logout', { method: 'POST' }).then(done, done);
  };

  // ---------------------------------------------------------------- top bar
  var ALLOWED = {
    Admin: ['user-dashboard.html', 'coordinator.html', 'field-officer.html', 'auditor.html', 'admin.html'],
    Coordinator: ['user-dashboard.html', 'coordinator.html'],
    Auditor: ['auditor.html'],
    FieldOfficer: ['field-officer.html']
  }[me.body.role] || [];

  document.addEventListener('DOMContentLoaded', function () {
    var addBtn = document.getElementById('btnOpenAddModal');
    if (addBtn) addBtn.style.display = 'none'; // staff are added through the Admin Excel import

    // Field officers and auditors only ever see themselves: the colleague directory (with its quota controls) is for managers.
    if (window.CA_ME.role === 'FieldOfficer' || window.CA_ME.role === 'Auditor') {
      ['officersDirectoryBody', 'auditorDirectoryBody'].forEach(function (id) {
        var body = document.getElementById(id);
        var panel = body && body.closest('.panel');
        if (panel) panel.style.display = 'none';
      });
    }

    document.querySelectorAll('.portal-switch-links a').forEach(function (a) {
      var file = (a.getAttribute('href') || '').split('/').pop();
      if (ALLOWED.indexOf(file) === -1) a.remove();
    });

    var bar = document.querySelector('.topbar');
    if (bar && !document.getElementById('caUserChip')) {
      var chip = document.createElement('div');
      chip.id = 'caUserChip';
      chip.style.cssText = 'display:flex;align-items:center;gap:10px;margin-left:auto;font-size:12.5px;font-weight:700;';
      var label = document.createElement('span');
      label.textContent = window.CA_ME.name + ' · ' + window.CA_ME.role;
      var out = document.createElement('button');
      out.type = 'button';
      out.className = 'btn small ghost';
      out.textContent = 'Sign Out';
      out.addEventListener('click', window.CA_logout);
      chip.appendChild(label);
      chip.appendChild(out);
      bar.appendChild(chip);
    }
  });
})();
