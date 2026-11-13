// utils/caseUpdate.js
// Pure (database-free) logic that decides what a user is allowed to change on a case.
//
// Why this exists: every portal used to send its WHOLE (possibly stale) copy of a case to the server,
// and the server replaced fields blindly. If the auditor and the coordinator approved the same case at
// about the same time, one approval silently overwrote the other and the case never settled.
// Now each role may only change its own fields, approvals are merged key by key, an approval can
// never be rolled back by a stale copy, and the case status is always recomputed on the server.

const APPROVAL_VALUES = ['Pending', 'Approved', 'Rejected', 'Bypassed'];

// approvals.<key> each role may set
const APPROVAL_KEY = {
  Coordinator: ['coordinator'],
  FieldOfficer: ['fieldOfficer'],
  Auditor: ['auditor'],
  Admin: ['coordinator', 'fieldOfficer', 'auditor']
};

// plain fields each role may set
const TEXT_FIELDS = {
  Coordinator: ['coordinatorRejectionReason'],
  FieldOfficer: ['foRejectionReason', 'foVerifiedGps'],
  Auditor: ['auditorRejectionReason'],
  Admin: ['coordinatorRejectionReason', 'foRejectionReason', 'foVerifiedGps', 'auditorRejectionReason']
};
const NUMBER_FIELDS = {
  FieldOfficer: ['foDistanceKm', 'extraTaAmount'],
  Admin: ['foDistanceKm', 'extraTaAmount']
};
const FLAG_FIELDS = {          // only ever switched on by a client, never off by a stale copy
  FieldOfficer: ['foSpot1Verified', 'foSpot2Verified'],
  Admin: ['foSpot1Verified', 'foSpot2Verified']
};

function isClosedLegacyStatus(status) {
  return /settled/i.test(String(status || ''));
}

// Returns { set, changed } where `set` is a flat $set object (dotted paths allowed).
function computeCaseUpdate(doc, role, body) {
  const set = {};
  const input = body && typeof body === 'object' ? body : {};
  const curApprovals = Object.assign({ coordinator: 'Pending', fieldOfficer: 'Pending', auditor: 'Pending' }, doc.approvals || {});
  const nextApprovals = Object.assign({}, curApprovals);
  let approvalsTouched = false;

  // 1) approvals: own key only, never downgrade a decision back to Pending
  const incoming = input.approvals && typeof input.approvals === 'object' ? input.approvals : {};
  for (const key of APPROVAL_KEY[role] || []) {
    if (!(key in incoming)) continue;
    const val = String(incoming[key]);
    if (!APPROVAL_VALUES.includes(val)) continue;
    if (val === 'Pending' && curApprovals[key] !== 'Pending') continue;
    if (val !== curApprovals[key]) {
      nextApprovals[key] = val;
      set['approvals.' + key] = val;
      approvalsTouched = true;
    }
  }

  // 2) text / number / flag fields
  for (const f of TEXT_FIELDS[role] || []) {
    if (typeof input[f] === 'string' && input[f] !== doc[f]) set[f] = input[f].slice(0, 2000);
  }
  for (const f of NUMBER_FIELDS[role] || []) {
    const n = Number(input[f]);
    if (input[f] !== undefined && input[f] !== null && input[f] !== '' && Number.isFinite(n) && n >= 0 && n !== doc[f]) set[f] = n;
  }
  for (const f of FLAG_FIELDS[role] || []) {
    if (input[f] === true && doc[f] !== true) set[f] = true;
  }

  // 3) status is derived from approvals on the server (never trusted from the client)
  if (approvalsTouched) {
    const cleared =
      nextApprovals.coordinator === 'Approved' &&
      (nextApprovals.fieldOfficer === 'Approved' || nextApprovals.fieldOfficer === 'Bypassed') &&
      nextApprovals.auditor === 'Approved';

    let status;
    if (cleared) status = 'Approved';
    else if (nextApprovals.coordinator === 'Rejected') status = 'Disputed / Coordinator Discrepancy';
    else if (nextApprovals.auditor === 'Rejected') status = 'Disputed / Auditor Objection';
    else status = 'In Progress';

    if (!isClosedLegacyStatus(doc.status) && status !== doc.status) set.status = status;

    if (status === 'Approved') {
      if (!doc.referenceId) set.referenceId = 'REF-SETTLE-' + String(doc.claimNo || doc.id).trim();
      if (!doc.settledAt) set.settledAt = new Date().toISOString();
    } else if (doc.status === 'Approved') {
      // the case was re-opened
      set.referenceId = null;
      set.settledAt = null;
    }
  }

  return { set, changed: Object.keys(set).length > 0 };
}

// Applies computeCaseUpdate with optimistic concurrency: if somebody else changed the case between our
// read and our write (the `rev` counter moved), we simply recompute on the fresh copy and try again.
async function applyCaseUpdate(CaseModel, filter, role, body, maxAttempts = 6) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const doc = await CaseModel.findOne(filter).lean();
    if (!doc) return { notFound: true };

    const { set, changed } = computeCaseUpdate(doc, role, body);
    if (!changed) return { doc, changed: false };

    const guard = doc.rev === undefined ? { rev: { $exists: false } } : { rev: doc.rev };
    const updated = await CaseModel.findOneAndUpdate(
      Object.assign({}, filter, guard),
      { $set: set, $inc: { rev: 1 } },
      { new: true }
    ).lean();
    if (updated) return { doc: updated, changed: true };
  }
  throw new Error('Case is being updated by several people at once. Please retry.');
}

module.exports = { computeCaseUpdate, applyCaseUpdate };
