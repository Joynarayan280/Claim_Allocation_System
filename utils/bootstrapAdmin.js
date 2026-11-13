// utils/bootstrapAdmin.js
// Bootstraps default Administrator credentials from environment variables on startup.

const User = require('../models/User');
const { hashPassword } = require('./auth');

async function ensureAdmin({ force = false } = {}) {
  const id = String(process.env.ADMIN_ID || 'ADMIN').trim().toUpperCase();
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return null;
  if (pass.length < 8) throw new Error('Admin password must be at least 8 characters long.');

  // Check specifically for the target default administrator account
  const exists = await User.findOne({ employeeId: id, role: 'Admin' });
  if (exists && !force) return null;

  const adminName = process.env.ADMIN_NAME || 'Master Admin';

  const doc = await User.findOneAndUpdate(
    { employeeId: id, role: 'Admin' },
    {
      employeeId: id,
      role: 'Admin',
      name: adminName,
      passwordHash: hashPassword(pass),
      mustChangePassword: false,
      isActive: true,
      profile: { employeeId: id, name: adminName, role: 'Admin' }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
}

module.exports = { ensureAdmin };