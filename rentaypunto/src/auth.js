// Acceso al panel: contraseñas cifradas (scrypt), sesión en cookie y verificación en dos pasos (códigos de 6 dígitos
// de una app como Google Authenticator) para Gerente y Dueño.
const crypto = require('node:crypto');

const SESSION_DAYS = 14;
const PENDING_MINUTES = 10; // tiempo para escribir el código después de la contraseña
const COOKIE = 'rp_panel';
const MFA_ROLES = ['gerente', 'dueno'];

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(String(password), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// La cookie guarda el token; la base solo su huella (si alguien copia la base, no puede entrar con ella).
function createSession(db, userId, pending) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + (pending ? PENDING_MINUTES * 60e3 : SESSION_DAYS * 86400e3);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, pending, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, pending ? 1 : 0, expires);
  return { token, expires };
}
function sessionCookie(token, expires, secure) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Expires=${new Date(expires).toUTCString()}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

function authMiddleware(db) {
  const find = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.publish_direct, u.totp_enabled, s.pending
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`);
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const row = token ? find.get(sha256(token), Date.now()) : null;
    req.sessionHash = token ? sha256(token) : null;
    // Sesión a medias (falta el código): solo sirve para terminar la verificación.
    req.pendingUser = row && row.pending ? row : null;
    req.user = row && !row.pending ? row : null;
    next();
  };
}

const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Inicia sesión' }));
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'No tienes permiso para esto' });
  next();
};

// ---------- Verificación en dos pasos (TOTP, RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(str) {
  let bits = 0; let value = 0; const out = [];
  for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const newTotpSecret = () => base32(crypto.randomBytes(20));
function totpCode(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
// Acepta el código actual y el de 30 s antes o después (relojes de celular desfasados).
function verifyTotp(secret, code, now = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (!secret || c.length !== 6) return false;
  const step = Math.floor(now / 30000);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(totpCode(secret, step + d)), Buffer.from(c)));
}
const totpUri = (secret, email) => `otpauth://totp/${encodeURIComponent(`Rentaypunto:${email}`)}?secret=${secret}&issuer=Rentaypunto`;

module.exports = {
  COOKIE, MFA_ROLES, sha256, hashPassword, verifyPassword, createSession, sessionCookie, clearCookie,
  authMiddleware, requireUser, requireRole, newTotpSecret, totpCode, verifyTotp, totpUri,
};
