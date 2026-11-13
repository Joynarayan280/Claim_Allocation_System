// routes/auth.js
// POST /api/auth/login, /logout, /change-password  |  GET /api/auth/me

const express = require('express');
const User = require('../models/User');
const {
  hashPassword, verifyPassword, signToken, setSessionCookie, clearSessionCookie,
  requireAuthPending, loginLimiter, loginFailed, loginOk
} = require('../utils/auth');

const router = express.Router();

// Clean path routing: Admin and Coordinator both land directly on Intake Desk
const HOME = {
  Admin: '/dashboard',
  Coordinator: '/dashboard',
  Auditor: '/auditor',
  FieldOfficer: '/field-officer'
};

const normId = (v) => String(v || '').trim().toUpperCase();
const pid = (u) => String((u.profile && u.profile.employeeId) || u.employeeId);

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const employeeId = normId(req.body?.employeeId);
    const password = String(req.body?.password || '');
    const wantedRole = String(req.body?.role || '');
    if (!employeeId || !password) return res.status(400).json({ error: 'Provide your employee ID and password.' });

    // The same employee ID may exist in more than one role (for example Coordinator and Auditor).
    const users = await User.find({ employeeId });
    if (!users.length) verifyPassword(password, 'scrypt$00$00'); // keep response time similar for unknown IDs

    const matching = users.filter((u) => u.isActive && verifyPassword(password, u.passwordHash));
    if (!matching.length) {
      loginFailed(req.loginKey);
      return res.status(401).json({ error: 'Employee ID or password is incorrect (or the account is disabled)' });
    }

    let user = matching.length === 1 ? matching[0] : matching.find((u) => u.role === wantedRole);
    if (!user) {
      // Password is valid for several roles: let the person choose which one to open.
      return res.json({ ok: false, chooseRole: true, roles: matching.map((u) => u.role) });
    }

    loginOk(req.loginKey);
    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken({ employeeId: user.employeeId, pid: pid(user), role: user.role, name: user.name, mcp: !!user.mustChangePassword });
    setSessionCookie(res, token);
    res.json({
      ok: true,
      role: user.role,
      name: user.name,
      mustChangePassword: !!user.mustChangePassword,
      redirect: user.mustChangePassword ? '/change-password.html' : HOME[user.role]
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuthPending(), async (req, res) => {
  try {
    const user = await User.findOne({ employeeId: req.user.employeeId, role: req.user.role }).lean();
    if (!user || !user.isActive) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Account closed or non-existent' });
    }
    res.json({
      employeeId: user.employeeId,
      role: user.role,
      name: user.name,
      mustChangePassword: !!user.mustChangePassword,
      profile: user.profile || {},
      home: HOME[user.role]
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/change-password', requireAuthPending(), async (req, res) => {
  try {
    const oldPassword = String(req.body?.oldPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return res.status(400).json({ error: 'The new password must be at least 8 characters long and include both letters and numbers.' });
    }
    if (newPassword === oldPassword) return res.status(400).json({ error: 'The new password cannot be the same as the old one.' });

    const user = await User.findOne({ employeeId: req.user.employeeId, role: req.user.role });
    if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
      return res.status(401).json({ error: 'The old password is incorrect.' });
    }
    user.passwordHash = hashPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();

    setSessionCookie(res, signToken({ employeeId: user.employeeId, pid: pid(user), role: user.role, name: user.name, mcp: false }));
    res.json({ ok: true, redirect: HOME[user.role] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.HOME = HOME;
