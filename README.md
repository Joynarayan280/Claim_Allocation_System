# Case Allocation System

Insurance claim dispatch and audit workflow. Intake staff register a claim; the system allocates a
Coordinator, a Field Officer (physical cases) and a Clinical Auditor; each of them approves in their own portal;
when all required approvals are in, the case settles automatically.

Stack: Node.js + Express 5, MongoDB (Mongoose), socket.io, plain HTML/CSS/JavaScript front end (no build step).

## Project layout
```
server.js                 Web server: security headers, page guards, case API, live updates, start-up
config/db.js              MongoDB connection
models/Case.js            Case schema (one document per claim)
models/User.js            Login accounts. One account per (employeeId, role): a person can hold several roles
routes/auth.js            Login (with role choice), logout, change password, current user
routes/roster.js          Staff roster: Excel import, password reset, profile sync
utils/auth.js             Password hashing (scrypt), signed session cookie, role guards, login rate limit
utils/caseUpdate.js       THE RULES for changing a case (who may change what, approvals, status). Unit tested
utils/ensureIndexes.js    Creates / repairs database indexes at every start
utils/loadMerge.js        Adds the Excel-uploaded load to the database workload (unit tested)
utils/distanceService.js  Road distances behind one interface, cached forever (unit tested)
utils/osmProvider.js      FREE provider: Nominatim (PIN to point) + OSRM (driving distance), rate limited, background geocoding
utils/googleProvider.js   Optional paid provider: Google Routes API, with a daily budget
utils/bootstrapAdmin.js   Creates the first Admin from .env
scripts/create-admin.js   `npm run create-admin` re-creates / resets the Admin password
tests/*.test.js           `npm test` (case rules, allocation rules, load merge)
public/allocation-rules.js Coordinator choice by state + case type, override detection, remark rules (browser + server)
public/login.html         Sign in (+ role chooser) ; change-password.html = forced password change
public/session.js         Loaded first on every page: login check, roster, case loading, auto-retry of saves
public/user-dashboard.html + script.js   Intake Desk: register a claim, automatic team allocation
public/coordinator.html + coordinator.js Coordinator portal
public/field-officer.html + field-officer.js Field Officer portal
public/auditor.html + auditor.js         Auditor portal
public/admin.html + admin.js             Master Admin Console: staff import, directories, reports
```

## Roles and pages
| Role | Opens | Sees |
|---|---|---|
| Admin | everything | all cases (the newest 2,000 open ones on screen; true totals and a claim search cover the rest) |
| Coordinator | Intake Desk, Coordinator portal | their own cases (assigned to them or registered by them) |
| Auditor | Auditor portal | only cases assigned to them |
| Field Officer | Field Officer portal | only cases assigned to them |

## How a case moves
1. **Intake** (`script.js`) picks the team and `POST /api/cases` saves it. A duplicate claim number is refused (409).
2. Each person approves/rejects in their portal -> `PATCH /api/cases/:id`.
3. The server (`utils/caseUpdate.js`) lets each role change **only its own** fields, merges approvals so two people
   approving at the same moment never overwrite each other, and computes the status:
   `In Progress` -> `Approved` (coordinator + field officer or `Bypassed` + auditor all approved) or
   `Disputed / ...` after a rejection.

## Allocation rules (Intake Desk)
- **Coordinator (state AND case type):** Physical -> among the coordinators whose `States` contain the hospital state, those whose `caseTypes` include the case type (Cashless / Reimbursement / Digital; blank = all types) are preferred; if two qualify the one with the lighter load wins. If the state is covered but nobody there handles that type, the state coordinator gets the case with a visible warning note; with no state match a standby coordinator is used. Digital -> South: Suchismita, North: Krishna (Excel column `digitalZone`, or by name). The rules live in `public/allocation-rules.js` (unit tested, shared by browser and server).
- **Auditor, physical case:** client must match, the auditor must do Physical work and the case type (Cashless / Reimbursement, Excel column `caseTypes`), be on duty and not on leave.
- **Auditor, digital case:** the patient's language must match exactly; a client match ranks higher but is not required.
- **Field Officer:** only officers within about 30 km (or in the same district) of the hospital / patient PIN are offered; if nobody is nearby everyone is listed so a person can choose.
- **Distances (Field Officer selection, the 30 km rule, the two-officer decision, extra TA):** one source of truth, shown with a label next to every figure. **Free by default:** road distances from OpenStreetMap data (green *OpenStreetMap* label). If a Google Maps key is configured, Google Maps is used instead (green *Google Maps* label). If no road distance is available, a *straight-line approx.* or a PIN-based *estimate* is shown with a warning and allocation still works. Candidates are chosen from the most likely officers (nearest by estimate plus the same district, up to 25 per destination). Every PIN and every PIN pair is looked up only once and remembered in the database.

## Dashboards
- **Field Officer / Auditor:** own summary tiles (assigned, active workload against the daily limit including the uploaded Excel load, cleared, extra TA), the personal case list, duty / leave switch. They only ever see themselves; the colleague directory is hidden for them.
- **Coordinator:** own queue, case cards (with any manual-allocation remarks), Intake Desk.
- **Admin:** true totals from the database, **Workforce Load Overview** (every field officer / auditor with active cases, limit, utilisation bar and Full / Overloaded flag, searchable), **Find a Claim** (server-side search of any claim, however old), staff import, load upload, ledgers (50 at a time, "Show more"). "View as" for any field officer / auditor: open their portal and click the person in the directory.
- All pages are responsive: phones (cards instead of wide tables, 2 x 2 summary tiles, touch-sized buttons), tablets and desktops. Checked in headless Chromium at 390 / 820 / 1366 px for every role: no horizontal overflow, no console errors.

## Exception remark (audit trail)
The Intake Desk shows the engine's suggestion (coordinator, field officer(s), auditor). If the person changes any of them
(different field officer / auditor, or hospital-only / patient-only deployment) a yellow **Exception remark required** box appears and
the case cannot be dispatched until every change has a remark of at least 10 characters. The server repeats the check on
`POST /api/cases` and stores, on the case, what the engine suggested (`autoAllocation`), every change with its remark, who made it and
when (`allocationExceptions`). Remarks appear on the coordinator's case card and in the Admin "Claims_Report" export.
Limit: the engine's suggestion is computed in the browser, so the server can prove that a remark was given for every difference
it is told about, but it cannot independently recompute the suggestion.

## Current case load (Excel)
Admin Console -> *Current Case Load*. Upload how many cases each Field Officer / Auditor already carries **outside this system**
(columns `employeeId`, `currentLoad`, and for field officers optionally `currentCashless`, `currentRI`; the headers
`TotalActiveLoad` and `OnHandLoad` from the client workbook are accepted). The Intake Desk adds this number to the open cases inside the
system when it checks capacity (`GET /api/load`). Upload again any time to refresh it. When those cases have been entered in the system,
upload 0 for them, otherwise they are counted twice. The same columns are also read by the normal *Staff Roster Import*.

## Staff data (Excel)
Admin Console -> *Staff Roster Import*. One import per role (Coordinators, Auditors, Field Officers), mode **Replace** or **Merge**.
New staff receive a temporary password (CSV downloaded once). Columns (case and spacing do not matter):
- Coordinators: employeeId, name, zone, designation, digitalZone, states, caseTypes, languages, email, phone, maxCapacity, isActive
- Auditors: employeeId, name, employmentType, languages, clients, specialization, caseTypes, currentLoad, monthlyCapacity, dailyCapacity, phone, email, isActive, leaveDays
- Field Officers: employeeId, name, employmentType, grade, basePin, state, district, phone, email, maxDailyVisits, maxCashless, maxRI, currentLoad, currentCashless, currentRI, isActive

## Known limits and where trouble could appear in future
| Area | What to know |
|---|---|
| Browser storage | Each portal keeps its working set in the browser (about 5 MB). A coordinator, field officer or auditor only receives the cases that are theirs, so their list is always complete however many cases exist in total. The Admin screen shows the newest 2,000 open cases plus true totals and a search; if the browser cannot hold what the server sends it keeps the newest and shows a yellow banner (nothing is lost on the server). |
| Open-case ceiling | One load returns at most 5,000 open cases per coordinator / field officer / auditor and 2,000 for the Admin (`OPEN_CAP`, `ADMIN_OPEN_CAP` in `server.js`). |
| Workload numbers | Counted by the database from covered indexes (`GET /api/load`), computed once and shared by all users (`utils/cache.js`, refreshed at most about every 0.7 s after a change and every 5 s otherwise). Two coordinators dispatching in the same second may exceed a capacity limit by one. |
| Statuses | The server treats `In Progress`, `Pending` and the two `Disputed / ...` values as "open" (`OPEN_STATUSES` in `server.js`). If you invent a new open status, add it there or those cases will not load. |
| Real-time updates | socket.io runs in one process. Do not start several PM2 instances without adding a Redis adapter. Pages also poll every 30 s as a safety net. |
| Distances | The free OpenStreetMap provider uses public servers (OSRM and Nominatim) run by the OSM community: best effort, no guarantee, and they may block heavy use. Our traffic is small because every PIN and every PIN pair is remembered, and everything falls back to estimates if they are down. For guaranteed service run your own OSRM/Nominatim, or set a Google Maps key. A PIN code is turned into one point, so every figure (OpenStreetMap or Google) is centre-to-centre, not door-to-door, and OpenStreetMap results can differ a little from Google Maps. The first time a new PIN appears its location is looked up (about 1 second for the hospital / patient PIN; officers' base PINs are looked up in the background after each import). Cases already dispatched keep the distance (and TA) calculated at dispatch (`foDistanceKm`, `foDistanceSource`). |
| Sessions | A login lasts `SESSION_HOURS` (12). After that the page shows a banner; unsaved changes stay on the device and are sent after signing in again. |
| Failed saves | Network errors, expired sessions and server errors on approvals are retried automatically (queue in the browser). Rejections by the server (403/404) are shown in a red banner. |
| Duplicates | Claim numbers are unique (case-insensitive). If the old database contained duplicates, the start-up log prints a WARNING; merge those cases by hand. |
| Excel import | Max 5,000 rows per upload. Replace mode deletes staff of that role who are not in the file (their cases stay). |
| Backups | Provided by MongoDB Atlas Cloud Backup. Test a restore. |
| Not load-tested | Logic is covered by 28 unit tests, 33 HTTP checks against an in-memory database and browser checks, but it has NOT been load-tested against a real MongoDB cluster. Before go-live run a staging test with realistic volume (for example k6 or Artillery with a few hundred thousand cases) and watch Atlas -> Performance Advisor. |
