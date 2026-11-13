// utils/auth.js
// Authentication engine: scrypt hashing, HMAC-signed session cookies, and role-based middleware.

const crypto = require('crypto');

const COOKIE_NAME = 'cd_session';
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);

// Cached session secret validation to eliminate runtime overhead
let cachedSecret = null;
function secret() {
  if (cachedSecret) return cachedSecret;
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    console.error('CRITICAL: SESSION_SECRET missing or shorter than 32 characters in environment variables.');
    process.exit(1);
  }
  cachedSecret = s;
  return cachedSecret;
}

// ---------- Password Encryption & Validation ----------
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(plain, stored) {
  try {
    const [algo, salt, hash] = String(stored || '').split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const test = crypto.scryptSync(String(plain), salt, 64);
    const real = Buffer.from(hash, 'hex');
    return real.length === test.length && crypto.timingSafeEqual(real, test);
  } catch (e) {
    return false;
  }
}

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) out += chars[bytes[i] % chars.length];
  return out + '@7';
}

// ---------- HMAC-Signed Token Handling ----------
const b64 = (b) => Buffer.from(b).toString('base64url');

function signToken(payload) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// ---------- Cookie Extraction & Management ----------
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = SESSION_HOURS * 3600;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
  );
}

// ---------- Role-Based Route Guards ----------
function buildAuth(allowPending) {
  return (...roles) => (req, res, next) => {
    const data = verifyToken(readCookie(req, COOKIE_NAME));
    if (!data) return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    if (data.mcp && !allowPending) return res.status(403).json({ error: 'Password update mandatory before proceeding.', code: 'PASSWORD_CHANGE_REQUIRED' });
    if (roles.length && !roles.includes(data.role)) return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    req.user = data;
    next();
  };
}
const requireAuth = buildAuth(false);
const requireAuthPending = buildAuth(true);

// ---------- In-Memory Brute-Force Rate Limiter (Leak-Proof) ----------
const attempts = new Map();
const MAX_ATTEMPTS_TRACKED = 10000;

function loginLimiter(req, res, next) {
  const key = `${req.ip}|${String(req.body?.employeeId || '').toLowerCase()}`;
  const rec = attempts.get(key);
  if (rec && rec.until > Date.now()) {
    const remainingMin = Math.ceil((rec.until - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many unsuccessful attempts. Access temporarily locked for ${remainingMin} minute(s).` });
  }
  req.loginKey = key;
  next();
}

function loginFailed(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, until: 0, lastSeen: now };
  rec.n += 1;
  rec.lastSeen = now;
  if (rec.n >= 5) { 
    rec.until = now + 10 * 60 * 1000; 
    rec.n = 0; 
  }
  // Prevent unbounded Map expansion under distributed attacks
  if (attempts.size >= MAX_ATTEMPTS_TRACKED && !attempts.has(key)) {
    const oldestKey = attempts.keys().next().value;
    attempts.delete(oldestKey);
  }
  attempts.set(key, rec);
}

function loginOk(key) { 
  attempts.delete(key); 
}

// Periodic cleanup of expired and stale entries (older than 30 mins)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) {
    if ((v.until && v.until < now) || (now - (v.lastSeen || 0) > 30 * 60 * 1000)) {
      attempts.delete(k);
    }
  }
}, 15 * 60 * 1000).unref();

module.exports = {
  COOKIE_NAME, hashPassword, verifyPassword, randomPassword,
  signToken, verifyToken, setSessionCookie, clearSessionCookie,
  requireAuth, requireAuthPending, loginLimiter, loginFailed, loginOk
};