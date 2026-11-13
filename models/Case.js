// models/Case.js
// Master Case schema with optimized indexing for high-volume claim pipeline tracking.

const mongoose = require('mongoose');

const CaseSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, trim: true },
  caseId: { type: String, trim: true }, // Backward compatibility field to prevent null collisions
  claimNo: { type: String, required: true, trim: true },
  claimKey: { type: String }, // Lowercase claim number used for duplicate protection
  rev: { type: Number },      // Bumped on every update (optimistic concurrency)
  clientName: { type: String, required: true, trim: true },
  caseType: { type: String, required: true },
  userName: { type: String, required: true },
  pin: { type: String, required: true },
  hospitalPin: String,
  digitalLang: String,
  digitalLangs: { type: [String], default: [] },
  digitalCategory: String,
  city: String,
  state: String,
  zone: String,

  // Tripartite operational team allocations
  coordinatorId: { type: String, index: true },
  coordinatorName: String,
  fieldOfficerId: { type: String, index: true },
  fieldOfficerName: String,
  fieldOfficerRole: String,

  // Dual spot field officer fields
  fieldOfficer2Id: { type: String, index: true },
  fieldOfficer2Name: String,
  fieldOfficer2Role: String,
  isDualSpot: { type: Boolean, default: false },

  auditorId: { type: String, index: true },
  auditorName: String,

  assignedTeam: { type: Object, default: {} },
  approvals: {
    type: Object,
    default: { coordinator: 'Pending', fieldOfficer: 'Pending', auditor: 'Pending' }
  },

  foDistanceKm: { type: Number, default: 0 },
  extraTaAmount: { type: Number, default: 0 },
  foSpot1Verified: { type: Boolean, default: false },
  foSpot2Verified: { type: Boolean, default: false },
  foVerifiedGps: String,

  coordinatorRejectionReason: String,
  auditorRejectionReason: String,
  foRejectionReason: String,

  // Audit trail of the allocation
  autoAllocation: { type: Object },                       // Engine suggestion record
  foDeployment: String,                                   // single | dual | hospOnly | resOnly
  allocationExceptions: { type: [Object], default: [] },  // Manual overrides with mandatory remarks
  createdBy: { type: Object },                            // User reference who initiated the case

  status: { type: String, default: 'In Progress', index: true },
  referenceId: String,
  settledAt: String,
  createdAt: { type: Date, default: Date.now, index: true },
  slaDeadline: String
}, { strict: false, timestamps: true });

// Compound Performance Indexes
CaseSchema.index({ status: 1, createdAt: -1 });
CaseSchema.index({ coordinatorId: 1, status: 1 });
CaseSchema.index({ fieldOfficerId: 1, status: 1 });
CaseSchema.index({ fieldOfficer2Id: 1, status: 1 });
CaseSchema.index({ auditorId: 1, status: 1 });
CaseSchema.index({ state: 1, status: 1 });
CaseSchema.index({ 'createdBy.id': 1, status: 1 });
CaseSchema.index({ status: 1, 'approvals.auditor': 1, auditorName: 1 });
CaseSchema.index({ status: 1, 'approvals.coordinator': 1, coordinatorName: 1 });
CaseSchema.index({ status: 1, 'approvals.fieldOfficer': 1, caseType: 1, fieldOfficerId: 1 });
CaseSchema.index({ status: 1, 'approvals.fieldOfficer': 1, caseType: 1, fieldOfficer2Id: 1 });

// Ensure clean model compilation and export
const Case = mongoose.models.Case || mongoose.model('Case', CaseSchema);
module.exports = Case;