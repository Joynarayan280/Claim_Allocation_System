// models/User.js
// Handles authenticated users (Admin, Coordinator, Auditor, FieldOfficer).
// Supports multi-role staff assignments using compound index on employeeId and role.

const mongoose = require('mongoose');

const ROLES = ['Admin', 'Coordinator', 'Auditor', 'FieldOfficer'];

const UserSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, trim: true },
  role: { type: String, enum: ROLES, required: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { 
    type: String, 
    trim: true, 
    lowercase: true,
    sparse: true // null বা missing থাকলে ডুপ্লিকেট ধরবে না
  },
  passwordHash: { type: String, required: true },
  mustChangePassword: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  profile: { type: Object, default: {} },
  lastLoginAt: Date
}, { timestamps: true });

// Compound unique index allowing single employeeId to hold distinct operational roles
// partialFilterExpression ensures it only applies when employeeId is an actual string
UserSchema.index(
  { employeeId: 1, role: 1 }, 
  { 
    unique: true, 
    partialFilterExpression: { employeeId: { $type: "string" } } 
  }
);
UserSchema.index({ role: 1, isActive: 1 });

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
module.exports.ROLES = ROLES;