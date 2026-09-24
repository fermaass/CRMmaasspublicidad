const crypto = require('node:crypto');

const SESSION_DAYS = 14;
const COOKIE = 'crm_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

function sessionCookie(token, expires, secure) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expires).toUTCString()}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function authMiddleware(db) {
  const find = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, (u.role = 'operador' OR (u.role = 'gerente' AND u.can_assign = 1)) AS can_assign FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`);
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.user = token ? find.get(token, Date.now()) || null : null;
    req.sessionToken = token;
    next();
  };
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Inicia sesión' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'No tienes permiso para esto' });
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, createSession, sessionCookie, clearCookie,
  authMiddleware, requireUser, requireRole,
};
