// Panel interno (panel.rentaypunto.com): login obligatorio, permisos por perfil revisados aquí en el servidor.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const auth = require('./auth');
const {
  ROLES, PROP_STATUS, VISIBLE, STAGES, LOST_REASONS, EXTRAS, INCLUDES, REQUIREMENTS, PROP_TYPES, siteSettings, setSetting, phone10, slugify,
} = require('./db');
const { getProp, PROP_SQL, shapeProp, isDate, localNow } = require('./data');
const { seoAuto, cleanSlug } = require('./seo');
const { transactionalRoutes } = require('./tx');
const { rateLimiter } = require('./site');
const { clientIp, passwordProblem } = require('./security');
const { alertMatches, alertsFor, ownerReport, reportMessage, summary, myNumbers, opinionStats } = require('./insights');
const { ACTA_ITEMS, OWNER_REQUESTS, DOC_KINDS, PAY_CONCEPTS } = require('./db');
const { panelDocsRoutes } = require('./docs');

const LINK_HOURS = 72;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const isoNow = () => new Date().toISOString();
const MANAGERS = ['gerente', 'dueno'];
const isManager = (u) => MANAGERS.includes(u.role);

function panelRouter({ db, config, photos, actas, onLead, vlt, wa, seo }) {
  // Cuando una propiedad publicada cambia, se avisa a los buscadores (después de guardar).
  const changed = (res, id, oldSlug) => res.on('finish', () => { if (res.statusCode < 400) seo.propertyChanged(id, oldSlug); });
  const app = transactionalRoutes(express.Router(), db);
  const loginFails = new Map();
  const loginByIp = rateLimiter(30, 15 * 60e3);
  const setupTries = rateLimiter(10, 15 * 60e3);
  const codeTries = rateLimiter(10, 15 * 60e3);
  const linkTries = rateLimiter(30, 15 * 60e3);
  const secure = (req) => Boolean(config.cookieSecure || req.secure);
  // Bitácora de seguridad. Se escribe al terminar la respuesta (fuera de la transacción), así también quedan los intentos fallidos.
  const audit = (req, res, action, detail, userId) => res.on('finish', () => {
    try {
      db.prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?, ?, ?, ?)').run(userId ?? req.user?.id ?? req.pendingUser?.id ?? null, action, detail ? String(detail).slice(0, 300) : null, clientIp(req).slice(0, 60));
      db.prepare('DELETE FROM audit_log WHERE id <= (SELECT MAX(id) - 5000 FROM audit_log)').run();
    } catch { /* la bitácora nunca tumba la app */ }
  });

  // El panel nunca aparece en Google.
  app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  app.use(express.static(path.join(__dirname, '..', 'public', 'panel'), { index: 'index.html', maxAge: 0 }));
  // El panel usa la misma regla de "Ideal para" que el sitio.
  app.get('/match.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'sitio', 'match.js')));
  app.get('/brand.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'sitio', 'brand.js')));
  app.use(auth.authMiddleware(db));
  // Las fotos llegan en JSON más grande; todo lo demás, hasta 1 MB.
  app.use('/api/properties/:id/photos', express.json({ limit: '12mb' }));
  app.use('/api/properties/:id/acta/photos', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Se espera JSON' });
    next();
  });

  const startSession = (req, res, userId, pending) => {
    const { role } = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    const { token, expires } = auth.createSession(db, userId, pending, role);
    res.set('Set-Cookie', auth.sessionCookie(token, expires, secure(req)));
  };
  const me = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, publish_direct: u.publish_direct });
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  // Gerente y Dueño siempre; vendedores también si el Dueño lo activa.
  const needsMfa = (u) => !config.mfaOff && (auth.MFA_ROLES.includes(u.role) || siteSettings(db).mfa_all);
  // Tras la contraseña: si es Gerente o Dueño, queda a medias hasta poner el código de la app.
  function afterPassword(req, res, user) {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(isoNow(), user.id);
    audit(req, res, 'entró (contraseña)', req.get('user-agent'), user.id);
    if (needsMfa(user)) {
      startSession(req, res, user.id, true);
      return res.json({ mfa: user.totp_enabled ? 'code' : 'setup' });
    }
    startSession(req, res, user.id, false);
    return res.json(me(user));
  }

  // ---------- Primer uso: con el código de instalación (Railway → Deploy Logs) se crea el Dueño ----------
  app.get('/api/setup', (req, res) => res.json({ needed: userCount() === 0 }));
  app.post('/api/setup', (req, res) => {
    if (userCount() > 0) return res.status(409).json({ error: 'El panel ya está configurado' });
    const ip = clientIp(req);
    if (setupTries.hit(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const given = norm(req.body?.setup_code); const expected = norm(config.setupCode);
    if (!expected || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return res.status(403).json({ error: 'Código de instalación incorrecto. Está en Railway → Deploy Logs.' });
    }
    const { name, email, password } = req.body || {};
    if (!clip(name, 80) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())) return res.status(400).json({ error: 'Escribe tu nombre y un correo válido.' });
    const weak = passwordProblem(password, email);
    if (weak) return res.status(400).json({ error: weak });
    const id = Number(db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'dueno')")
      .run(clip(name, 80), String(email).trim(), auth.hashPassword(String(password))).lastInsertRowid);
    afterPassword(req, res.status(201), db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  });

  // ---------- Entrar ----------
  app.post('/api/login', (req, res) => {
    const key = String(req.body?.email || '').trim().toLowerCase();
    const ip = clientIp(req);
    const fails = loginFails.get(key);
    if (fails && fails.until > Date.now()) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos o pide al Dueño un link para una contraseña nueva.' });
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(key);
    // Mismo mensaje y mismo tiempo exista o no el correo: así no se puede averiguar quién tiene cuenta.
    const ok = auth.verifyPassword(String(req.body?.password || ''), user && user.password_hash ? user.password_hash : auth.DUMMY_HASH) && user && user.password_hash;
    if (!ok) {
      audit(req, res, 'intento fallido de entrar', key.slice(0, 80), user ? user.id : null);
      if (loginByIp.hit(ip)) return res.status(429).json({ error: 'Demasiados intentos desde esta conexión. Espera 15 minutos.' });
      const n = (fails && fails.until && fails.until <= Date.now() ? 0 : fails?.n || 0) + 1;
      loginFails.set(key, { n, until: n >= 5 ? Date.now() + 15 * 60e3 : 0 });
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }
    loginFails.delete(key);
    afterPassword(req, res, user);
  });

  // Verificación en dos pasos. "setup": primera vez, se muestra la clave para la app. "code": ya la tiene.
  app.get('/api/2fa', (req, res) => {
    const u = req.pendingUser;
    if (!u) return res.status(401).json({ error: 'Vuelve a entrar con tu contraseña.' });
    if (u.totp_enabled) return res.json({ mode: 'code' });
    let { totp_secret: secret } = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(u.id);
    if (!secret) { secret = auth.newTotpSecret(); db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, u.id); }
    res.json({ mode: 'setup', secret, uri: auth.totpUri(secret, u.email) });
  });
  app.post('/api/2fa', (req, res) => {
    const u = req.pendingUser;
    if (!u) return res.status(401).json({ error: 'Pasaron más de 10 minutos. Vuelve a entrar con tu contraseña.' });
    if (codeTries.hit(`${u.id}`)) { audit(req, res, 'bloqueo por códigos equivocados'); return res.status(429).json({ error: 'Demasiados códigos equivocados. Espera 15 minutos.' }); }
    const { totp_secret: secret, totp_last_step: last } = db.prepare('SELECT totp_secret, totp_last_step FROM users WHERE id = ?').get(u.id);
    // Un código ya usado no vuelve a servir (aunque alguien lo haya visto por encima del hombro).
    const step = auth.verifyTotp(secret, req.body?.code, Date.now(), last);
    if (!step) { audit(req, res, 'código de verificación incorrecto'); return res.status(400).json({ error: 'Código incorrecto o ya usado. Espera el siguiente código de tu app.' }); }
    db.prepare('UPDATE users SET totp_last_step = ?, totp_enabled = 1 WHERE id = ?').run(step, u.id);
    audit(req, res, u.totp_enabled ? 'entró (verificación en dos pasos)' : 'activó la verificación en dos pasos');
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    startSession(req, res, u.id, false);
    res.json(me(u));
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    // Además de borrar la sesión, se le pide al navegador que olvide lo guardado de este sitio.
    res.set({ 'Set-Cookie': auth.clearCookie(secure(req)), 'Clear-Site-Data': '"cache", "storage"' }).json({ ok: true });
  });
  app.get('/api/me', auth.requireUser, (req, res) => res.json(me(req.user)));
  app.post('/api/me/password', auth.requireUser, (req, res) => {
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(String(req.body?.current || ''), u.password_hash)) return res.status(400).json({ error: 'Tu contraseña actual no es correcta' });
    const weak = passwordProblem(req.body?.password, req.user.email);
    if (weak) return res.status(400).json({ error: weak });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(req.body.password)), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
    audit(req, res, 'cambió su contraseña');
    res.json({ ok: true });
  });
  // "Cerrar mis otras sesiones": por si dejó la sesión abierta en otra computadora o perdió el celular.
  app.post('/api/me/logout-others', auth.requireUser, (req, res) => {
    const n = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash).changes;
    audit(req, res, 'cerró sus otras sesiones', `${n}`);
    res.json({ ok: true, closed: n });
  });

  // ---------- Invitaciones y contraseña nueva (link de un solo uso, 72 h) ----------
  function accessLink(req, userId, kind) {
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare('DELETE FROM user_tokens WHERE user_id = ? AND used_at IS NULL').run(userId);
    const expires = Date.now() + LINK_HOURS * 3600e3;
    db.prepare('INSERT INTO user_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(auth.sha256(token), userId, kind, expires);
    const base = config.panelUrl || `${req.protocol}://${req.get('host')}${req.baseUrl}`;
    return { link: `${base}/?acceso=${token}`, expires_at: new Date(expires).toISOString() };
  }
  const findToken = (t) => db.prepare('SELECT t.*, u.name, u.email, u.active FROM user_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?').get(auth.sha256(t));
  const dead = (t) => !t || t.used_at || t.expires_at < Date.now() || !t.active;
  app.get('/api/access/:token', (req, res) => {
    if (linkTries.hit(clientIp(req))) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const t = findToken(req.params.token);
    if (dead(t)) return res.status(410).json({ error: 'Este link ya no sirve: venció o ya se usó. Pide uno nuevo al Dueño.' });
    res.json({ name: t.name, email: t.email, kind: t.kind });
  });
  app.post('/api/access/:token', (req, res) => {
    if (linkTries.hit(clientIp(req))) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const t = findToken(req.params.token);
    if (dead(t)) return res.status(410).json({ error: 'Este link ya no sirve: venció o ya se usó. Pide uno nuevo al Dueño.' });
    const password = String(req.body?.password || '');
    const weak = passwordProblem(password, t.email);
    if (weak) return res.status(400).json({ error: weak });
    audit(req, res, t.kind === 'invite' ? 'activó su acceso con invitación' : 'creó contraseña nueva con link', null, t.user_id);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), t.user_id);
    db.prepare('UPDATE user_tokens SET used_at = ? WHERE token_hash = ?').run(isoNow(), t.token_hash);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.user_id);
    loginFails.delete(String(t.email).toLowerCase());
    afterPassword(req, res, db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id));
  });

  // ---------- Equipo (altas y permisos: solo el Dueño) ----------
  app.get('/api/users', auth.requireUser, (req, res) => {
    if (req.user.role !== 'dueno') return res.json(db.prepare('SELECT id, name, role, phone, active FROM users ORDER BY name').all());
    res.json(db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.publish_direct, u.active, u.totp_enabled, u.last_login_at, (u.password_hash = '') AS invited,
      (SELECT COUNT(*) FROM leads l WHERE l.advisor_id = u.id) AS leads, (SELECT COUNT(*) FROM leads l WHERE l.advisor_id = u.id AND l.stage = 'firmado') AS signed
      FROM users u ORDER BY u.active DESC, u.name`).all());
  });
  app.post('/api/users', auth.requireRole('dueno'), (req, res) => {
    const b = req.body || {};
    const name = clip(b.name, 80); const email = String(b.email || '').trim().toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Escribe nombre y un correo válido.' });
    if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Elige el perfil.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Ya hay alguien con ese correo.' });
    const id = Number(db.prepare('INSERT INTO users (name, email, phone, role, publish_direct) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, phone10(b.phone) || null, b.role, b.role === 'vendedor' && b.publish_direct ? 1 : 0).lastInsertRowid);
    audit(req, res, 'dio de alta a un usuario', `${name} (${b.role})`);
    res.status(201).json({ id, ...accessLink(req, id, 'invite') });
  });
  app.patch('/api/users/:id', auth.requireRole('dueno'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'No existe' });
    const b = req.body || {};
    const next = { name: b.name !== undefined ? clip(b.name, 80) : u.name, phone: b.phone !== undefined ? (phone10(b.phone) || null) : u.phone,
      role: b.role !== undefined ? b.role : u.role, active: b.active !== undefined ? (b.active ? 1 : 0) : u.active,
      publish_direct: b.publish_direct !== undefined ? (b.publish_direct ? 1 : 0) : u.publish_direct };
    if (!next.name || !ROLES.includes(next.role)) return res.status(400).json({ error: 'Datos inválidos' });
    if (u.id === req.user.id && (next.role !== 'dueno' || !next.active)) return res.status(400).json({ error: 'No puedes quitarte el perfil de Dueño ni desactivarte.' });
    if (next.role !== 'vendedor') next.publish_direct = 0;
    db.prepare('UPDATE users SET name = ?, phone = ?, role = ?, active = ?, publish_direct = ? WHERE id = ?').run(next.name, next.phone, next.role, next.active, next.publish_direct, u.id);
    if (!next.active) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      // Sus leads abiertos quedan sin asesor para que el Gerente los reparta.
      db.prepare("UPDATE leads SET advisor_id = NULL WHERE advisor_id = ? AND stage NOT IN ('firmado','perdido')").run(u.id);
    }
    if (next.role !== u.role && auth.MFA_ROLES.includes(next.role)) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id); // que entre de nuevo con verificación
    const changes = ['name', 'phone', 'role', 'active', 'publish_direct'].filter((k) => String(next[k] ?? '') !== String(u[k] ?? '')).map((k) => `${k}: ${u[k] ?? '—'} → ${next[k] ?? '—'}`);
    if (changes.length) audit(req, res, `cambió a ${u.name}`, changes.join(', '));
    res.json({ ok: true });
  });
  app.post('/api/users/:id/link', auth.requireRole('dueno'), (req, res) => {
    const u = db.prepare('SELECT id, active FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u || !u.active) return res.status(404).json({ error: 'No existe o está desactivado' });
    audit(req, res, 'generó link de contraseña', `usuario ${u.id}`);
    res.json(accessLink(req, u.id, 'reset'));
  });
  // Si alguien cambia de celular, el Dueño le borra la verificación y la vuelve a configurar al entrar.
  app.post('/api/users/:id/reset-2fa', auth.requireRole('dueno'), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'La tuya se reinicia con la variable RESET_2FA en Railway (ver PUBLICAR.md).' });
    db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(req, res, 'reinició la verificación en dos pasos', `usuario ${id}`);
    res.json({ ok: true });
  });

  // ---------- Configuración y zonas ----------
  app.get('/api/config', auth.requireUser, (req, res) => {
    res.json({
      settings: siteSettings(db), zones: db.prepare('SELECT * FROM zones ORDER BY name').all(),
      lists: { roles: ROLES, propStatus: PROP_STATUS, stages: STAGES, lostReasons: LOST_REASONS, extras: EXTRAS, includes: INCLUDES, requirements: REQUIREMENTS, propTypes: PROP_TYPES },
      siteUrl: config.siteUrl || '', today: localNow().date, mail: Boolean(config.resendKey && config.mailFrom), capi: Boolean(config.metaToken),
      actaItems: ACTA_ITEMS, ownerRequests: OWNER_REQUESTS, docKinds: DOC_KINDS, payConcepts: PAY_CONCEPTS,
      docs: vlt.enabled, wa: wa.enabled, waTemplates: wa.TEMPLATES,
    });
  });
  app.patch('/api/settings', auth.requireRole('dueno'), (req, res) => {
    const b = req.body || {};
    if (b.whatsapp !== undefined) {
      const w = phone10(b.whatsapp);
      if (b.whatsapp && !w) return res.status(400).json({ error: 'El WhatsApp debe tener 10 dígitos.' });
      setSetting(db, 'whatsapp', w);
    }
    if (b.visit_hours !== undefined) {
      const hours = [...new Set(String(b.visit_hours).split(/[\s,]+/).filter(Boolean))].sort();
      if (!hours.length || hours.some((h) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(h))) return res.status(400).json({ error: 'Horarios inválidos. Usa el formato 10:00, 11:30…' });
      setSetting(db, 'visit_hours', JSON.stringify(hours));
    }
    if (b.visit_days !== undefined) {
      const d = Number(b.visit_days);
      if (!(d >= 1 && d <= 30)) return res.status(400).json({ error: 'Días para agendar: de 1 a 30.' });
      setSetting(db, 'visit_days', d);
    }
    for (const k of ['complaints_promise', 'fees_text', 'legal_text', 'company_legal_name']) if (b[k] !== undefined) setSetting(db, k, clip(b[k], 2000));
    if (b.meta_pixel_id !== undefined) {
      const id = String(b.meta_pixel_id).replace(/\D/g, '');
      if (b.meta_pixel_id && !/^\d{5,20}$/.test(id)) return res.status(400).json({ error: 'El ID del píxel son solo números (Administrador de eventos de Meta).' });
      setSetting(db, 'meta_pixel_id', id);
    }
    if (b.mfa_all !== undefined) { setSetting(db, 'mfa_all', b.mfa_all ? '1' : '0'); audit(req, res, `verificación en dos pasos para todos: ${b.mfa_all ? 'sí' : 'no'}`); }
    if (b.docs_retention_days !== undefined) {
      const n = Number(b.docs_retention_days);
      if (!(n === 0 || (n >= 30 && n <= 3650))) return res.status(400).json({ error: 'Días para borrar documentos: 0 (nunca) o entre 30 y 3650.' });
      setSetting(db, 'docs_retention_days', n);
      audit(req, res, `borrado automático de documentos: ${n ? `${n} días` : 'apagado'}`);
    }
    if (b.social_links !== undefined) {
      const links = String(b.social_links).split(/[\s,]+/).filter(Boolean);
      if (links.some((u) => !/^https:\/\/[^\s]+$/.test(u))) return res.status(400).json({ error: 'Las redes van como enlaces completos que empiezan con https://' });
      setSetting(db, 'social_links', JSON.stringify(links.slice(0, 8)));
    }
    if (b.wa_auto !== undefined) {
      const cur = siteSettings(db).wa_auto;
      for (const k of Object.keys(cur)) if (b.wa_auto[k] !== undefined) cur[k] = Boolean(b.wa_auto[k]);
      setSetting(db, 'wa_auto', JSON.stringify(cur));
    }
    if (b.commission_months !== undefined) {
      const n = Number(b.commission_months);
      if (!(n >= 0 && n <= 12)) return res.status(400).json({ error: 'Meses de cobro: de 0 a 12.' });
      setSetting(db, 'commission_months', n);
    }
    if (b.commission_pct !== undefined) {
      const n = Number(b.commission_pct);
      if (!(n >= 0 && n <= 100)) return res.status(400).json({ error: 'Porcentaje para el asesor: de 0 a 100.' });
      setSetting(db, 'commission_pct', n);
    }
    if (b.notify_email !== undefined) {
      const e = String(b.notify_email).trim();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: 'Correo inválido.' });
      setSetting(db, 'notify_email', e);
    }
    res.json(siteSettings(db));
  });
  app.post('/api/zones', auth.requireRole(...MANAGERS), (req, res) => {
    const name = clip(req.body?.name, 60); const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Escribe el nombre de la zona.' });
    if (slug === 'queretaro') return res.status(400).json({ error: '"Querétaro" ya es la página de toda la ciudad. Usa el nombre de la zona o colonia.' });
    if (db.prepare('SELECT 1 FROM zones WHERE slug = ? OR name = ?').get(slug, name)) return res.status(409).json({ error: 'Esa zona ya existe.' });
    res.status(201).json({ id: Number(db.prepare('INSERT INTO zones (name, slug) VALUES (?, ?)').run(name, slug).lastInsertRowid) });
  });
  app.patch('/api/zones/:id', auth.requireRole(...MANAGERS), (req, res) => {
    const z = db.prepare('SELECT * FROM zones WHERE id = ?').get(Number(req.params.id));
    if (!z) return res.status(404).json({ error: 'No existe' });
    if (req.body?.active !== undefined) db.prepare('UPDATE zones SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, z.id);
    if (req.body?.intro !== undefined || req.body?.near !== undefined) {
      db.prepare('UPDATE zones SET intro = ?, near = ?, updated_at = ? WHERE id = ?').run(
        req.body.intro !== undefined ? clip(req.body.intro, 2000) || null : z.intro, req.body.near !== undefined ? clip(req.body.near, 300) || null : z.near, isoNow(), z.id);
    }
    res.json({ ok: true });
  });

  // ---------- Propiedades ----------
  // Vendedor: edita lo que capturó o tiene asignado; sin "publica sin aprobación" solo mientras sea borrador.
  const canEdit = (u, p) => isManager(u) || ((p.created_by === u.id || p.advisor_id === u.id) && (p.status === 'borrador' || u.publish_direct));
  const canPublish = (u) => isManager(u) || Boolean(u.publish_direct);
  const seesPrivate = (u, p) => isManager(u) || p.advisor_id === u.id || p.created_by === u.id;
  const nextCode = () => `RP-${String(db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(code, 4) AS INTEGER)), 0) + 1 AS n FROM properties").get().n).padStart(4, '0')}`;
  const leadCount = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE property_id = ?");

  function propOut(u, p) {
    const out = { ...p, can_edit: canEdit(u, p), sees_private: seesPrivate(u, p), leads: leadCount.get(p.id).n, acta_items: (() => { try { return JSON.parse(p.acta_items || '[]'); } catch { return []; } })() };
    if (!seesPrivate(u, p)) { out.address_private = null; out.owner_id = null; }
    return out;
  }
  app.get('/api/properties', auth.requireUser, (req, res) => {
    const rows = db.prepare(`${PROP_SQL} ORDER BY CASE p.status WHEN 'borrador' THEN 0 ELSE 1 END, p.id DESC`).all().map((r) => propOut(req.user, shapeProp(db, r)));
    res.json(rows);
  });
  app.get('/api/properties/:id', auth.requireUser, (req, res) => {
    const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    const out = propOut(req.user, p);
    if (seesPrivate(req.user, p) && p.owner_id) out.owner = db.prepare('SELECT id, name, phone FROM owners WHERE id = ?').get(p.owner_id);
    res.json(out);
  });

  // Valida y arma los datos de una propiedad. Devuelve { error } o { data }.
  function readProp(b, current) {
    const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(Number(b.zone_id ?? current?.zone_id));
    const title = clip(b.title ?? current?.title, 90);
    const rent = num(b.rent ?? current?.rent);
    if (!title) return { error: 'Escribe el título.' };
    if (!zone) return { error: 'Elige la zona.' };
    if (!(rent > 0)) return { error: 'Escribe la renta mensual.' };
    const pick = (k, f) => (b[k] !== undefined ? f(b[k]) : current ? current[k] : f(undefined));
    const data = {
      title, zone_id: zone.id, rent: Math.round(rent),
      prop_type: pick('prop_type', (v) => (PROP_TYPES.includes(v) ? v : null)),
      colonia: pick('colonia', (v) => clip(v, 120) || null),
      address_private: pick('address_private', (v) => clip(v, 300) || null),
      deposit_months: pick('deposit_months', (v) => (num(v) != null && num(v) >= 0 ? num(v) : 1)),
      maintenance: pick('maintenance', (v) => Math.max(0, Math.round(num(v) || 0))),
      m2: pick('m2', (v) => num(v)), bedrooms: pick('bedrooms', (v) => num(v)), bathrooms: pick('bathrooms', (v) => num(v)),
      parking: pick('parking', (v) => num(v)), max_occupants: pick('max_occupants', (v) => num(v)), min_term: pick('min_term', (v) => num(v)),
      extras: b.extras !== undefined ? JSON.stringify((Array.isArray(b.extras) ? b.extras : []).filter((x) => EXTRAS.includes(x))) : (current ? JSON.stringify(current.extras) : '[]'),
      includes: b.includes !== undefined ? JSON.stringify((Array.isArray(b.includes) ? b.includes : []).filter((x) => INCLUDES.includes(x))) : (current ? JSON.stringify(current.includes) : '[]'),
      near: pick('near', (v) => clip(v, 200) || null), consider_note: pick('consider_note', (v) => clip(v, 200) || null),
      description: pick('description', (v) => clip(v, 4000) || null),
      requirements: pick('requirements', (v) => clip(v, 80) || null),
      available_from: pick('available_from', (v) => (isDate(v) ? v : null)),
      contract_start: pick('contract_start', (v) => (isDate(v) ? v : null)),
      contract_end: pick('contract_end', (v) => (isDate(v) ? v : null)),
      owner_id: pick('owner_id', (v) => (num(v) && db.prepare('SELECT 1 FROM owners WHERE id = ?').get(num(v)) ? num(v) : null)),
      // (el vendedor no puede ligar propietarios: vería nombre y teléfono de registros que no le tocan; ver más abajo)
    };
    for (const k of ['m2', 'bedrooms', 'bathrooms', 'parking', 'max_occupants', 'min_term']) if (data[k] != null && data[k] < 0) return { error: 'Los números no pueden ser negativos.' };
    if (data.contract_start && data.contract_end && data.contract_end <= data.contract_start) return { error: 'El contrato debe terminar después de que empieza.' };
    return { data, zone };
  }
  // SEO: lo que mandaron (si lo editaron) o lo automático. La URL siempre se normaliza a renta/<zona>/<texto>-<código>.
  function readSeo(b, data, zone, code, current) {
    const auto = seoAuto({ title: data.title, zone: zone.name, rent: data.rent, m2: data.m2, bedrooms: data.bedrooms, bathrooms: data.bathrooms, extras: JSON.parse(data.extras), code });
    const slug = cleanSlug(b.seo_slug ?? (current && current.zone_id === zone.id ? current.seo_slug : auto.slug), zone.slug, code);
    return { seo_slug: slug, seo_title: clip(b.seo_title, 70) || auto.title, seo_desc: clip(b.seo_desc, 160) || auto.desc };
  }

  app.post('/api/properties', auth.requireUser, (req, res) => {
    const b = req.body || {}; const u = req.user;
    const r = readProp(isManager(u) ? b : { ...b, owner_id: undefined });
    if (r.error) return res.status(400).json({ error: r.error });
    const code = nextCode();
    const seo = readSeo(b, r.data, r.zone, code);
    let status = PROP_STATUS.includes(b.status) ? b.status : 'borrador';
    if (!canPublish(u)) status = 'borrador';
    const advisor = isManager(u) ? (num(b.advisor_id) && db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(num(b.advisor_id)) ? num(b.advisor_id) : null) : u.id;
    const pub = VISIBLE.includes(status);
    const d = { ...r.data, ...seo, code, status, advisor_id: advisor, created_by: u.id, published_by: pub ? u.id : null, published_at: pub ? isoNow() : null };
    const cols = Object.keys(d);
    const id = Number(db.prepare(`INSERT INTO properties (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((k) => d[k])).lastInsertRowid);
    if (VISIBLE.includes(status)) changed(res, id);
    res.status(201).json({ ...propOut(u, getProp(db, id)), alert_matches: alertsFor(db, id) });
  });

  app.patch('/api/properties/:id', auth.requireUser, (req, res) => {
    const u = req.user; const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (!canEdit(u, p)) return res.status(403).json({ error: p.status === 'borrador' ? 'Solo puedes editar lo que capturaste o tienes asignado.' : 'Ya está publicada: pide al Gerente que haga el cambio.' });
    const b = isManager(u) ? (req.body || {}) : { ...(req.body || {}), owner_id: undefined };
    const r = readProp(b, p);
    if (r.error) return res.status(400).json({ error: r.error });
    const seo = readSeo(b, r.data, r.zone, p.code, p);
    const d = { ...r.data, ...seo, updated_at: isoNow() };
    if (!seesPrivate(u, p)) { delete d.address_private; delete d.owner_id; }
    if (b.advisor_id !== undefined && isManager(u)) d.advisor_id = num(b.advisor_id) && db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(num(b.advisor_id)) ? num(b.advisor_id) : null;
    if (b.status !== undefined && b.status !== p.status) {
      if (!PROP_STATUS.includes(b.status)) return res.status(400).json({ error: 'Estado inválido' });
      if (!canPublish(u)) return res.status(403).json({ error: 'Queda en borrador: el Gerente la revisa y la publica.' });
      Object.assign(d, statusChange(u, p, b.status));
    }
    const cols = Object.keys(d);
    db.prepare(`UPDATE properties SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => d[k]), p.id);
    if (p.status !== 'borrador' || (d.status && d.status !== 'borrador')) changed(res, p.id, p.seo_slug);
    res.json({ ...propOut(u, getProp(db, p.id)), alert_matches: d.status && VISIBLE.includes(d.status) && !VISIBLE.includes(p.status) ? alertsFor(db, p.id) : 0 });
  });
  function statusChange(u, p, status) {
    const d = { status };
    if (VISIBLE.includes(status) && !p.published_at) { d.published_at = isoNow(); d.published_by = u.id; }
    if (status === 'rentada' && p.status !== 'rentada') d.rented_at = isoNow();
    return d;
  }
  app.post('/api/properties/:id/status', auth.requireUser, (req, res) => {
    const u = req.user; const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    const status = req.body?.status;
    if (!PROP_STATUS.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    if (!canPublish(u) || !canEdit(u, p)) return res.status(403).json({ error: 'No tienes permiso para cambiar el estado.' });
    const d = { ...statusChange(u, p, status), updated_at: isoNow() };
    db.prepare(`UPDATE properties SET ${Object.keys(d).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(d), p.id);
    if (p.status !== 'borrador' || status !== 'borrador') changed(res, p.id);
    res.json({ ...propOut(u, getProp(db, p.id)), alert_matches: VISIBLE.includes(status) && !VISIBLE.includes(p.status) ? alertsFor(db, p.id) : 0 });
  });
  // Eliminar: solo Gerente o Dueño, y solo si no tiene leads (si tiene, mejor pausarla para no perder el historial).
  app.delete('/api/properties/:id', auth.requireRole(...MANAGERS), (req, res) => {
    const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (leadCount.get(p.id).n) return res.status(409).json({ error: 'Tiene leads: mejor ponla en Pausada para no perder su historial.' });
    db.prepare('DELETE FROM properties WHERE id = ?').run(p.id);
    audit(req, res, 'eliminó una propiedad', `${p.code} · ${p.title}`);
    res.on('finish', () => { if (res.statusCode < 400) p.photos.forEach((f) => photos.remove(f.file)); });
    res.json({ ok: true });
  });

  // Fotos (el panel ya las manda achicadas).
  app.post('/api/properties/:id/photos', auth.requireUser, (req, res) => {
    const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (!canEdit(req.user, p)) return res.status(403).json({ error: 'No puedes cambiar las fotos de esta propiedad.' });
    if (p.photos.length >= 30) return res.status(400).json({ error: 'Máximo 30 fotos por propiedad.' });
    const name = photos.save(p.id, req.body?.big, req.body?.small);
    if (!name) return res.status(400).json({ error: 'La foto no es válida. Usa JPG o PNG.' });
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM photos WHERE property_id = ?').get(p.id).n;
    const id = Number(db.prepare('INSERT INTO photos (property_id, file, position) VALUES (?, ?, ?)').run(p.id, name, pos).lastInsertRowid);
    db.prepare('UPDATE properties SET updated_at = ? WHERE id = ?').run(isoNow(), p.id);
    res.on('finish', () => { if (res.statusCode >= 400) photos.remove(name); });
    res.status(201).json({ id, file: name });
  });
  app.delete('/api/photos/:id', auth.requireUser, (req, res) => {
    const f = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'No existe' });
    const p = getProp(db, f.property_id);
    if (!canEdit(req.user, p)) return res.status(403).json({ error: 'No puedes cambiar las fotos de esta propiedad.' });
    db.prepare('DELETE FROM photos WHERE id = ?').run(f.id);
    res.on('finish', () => { if (res.statusCode < 400) photos.remove(f.file); });
    res.json({ ok: true });
  });
  app.put('/api/properties/:id/photos/order', auth.requireUser, (req, res) => {
    const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (!canEdit(req.user, p)) return res.status(403).json({ error: 'No puedes cambiar las fotos de esta propiedad.' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const upd = db.prepare('UPDATE photos SET position = ? WHERE id = ? AND property_id = ?');
    ids.forEach((id, i) => upd.run(i, id, p.id));
    res.json({ ok: true });
  });

  // ---------- Leads (solicitudes de visita) ----------
  // El Vendedor solo ve los suyos; Gerente y Dueño ven todos.
  const LEAD_SQL = `SELECT l.*, p.code AS prop_code, p.title AS prop_title, p.rent AS prop_rent, p.seo_slug AS prop_slug, p.colonia AS prop_colonia,
    z.name AS prop_zone, u.name AS advisor_name FROM leads l LEFT JOIN properties p ON p.id = l.property_id LEFT JOIN zones z ON z.id = p.zone_id
    LEFT JOIN users u ON u.id = l.advisor_id`;
  const findLead = (req, id) => {
    const l = db.prepare(`${LEAD_SQL} WHERE l.id = ?`).get(id);
    if (!l || (!isManager(req.user) && l.advisor_id !== req.user.id)) return null;
    return l;
  };
  const event = (leadId, userId, type, content) => db.prepare('INSERT INTO lead_events (lead_id, user_id, type, content) VALUES (?, ?, ?, ?)').run(leadId, userId, type, content);

  app.get('/api/leads', auth.requireUser, (req, res) => {
    const rows = isManager(req.user)
      ? db.prepare(`${LEAD_SQL} ORDER BY l.created_at DESC LIMIT 2000`).all()
      : db.prepare(`${LEAD_SQL} WHERE l.advisor_id = ? ORDER BY l.created_at DESC LIMIT 2000`).all(req.user.id);
    res.json(rows);
  });
  app.get('/api/leads/:id', auth.requireUser, (req, res) => {
    const l = findLead(req, Number(req.params.id));
    if (!l) return res.status(404).json({ error: 'No existe o no es tuyo' });
    const events = db.prepare('SELECT e.*, u.name AS user_name FROM lead_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.lead_id = ? ORDER BY e.id DESC').all(l.id);
    // Quien atiende el lead necesita la dirección exacta para mandarla cuando la cita esté confirmada.
    const prop = l.property_id ? db.prepare('SELECT address_private, rent, bedrooms, zone_id, status FROM properties WHERE id = ?').get(l.property_id) : null;
    res.json({ ...l, events, address_private: prop ? prop.address_private : null });
  });

  // Captura manual (alguien que escribió directo por WhatsApp o llamó).
  app.post('/api/leads', auth.requireUser, (req, res) => {
    const b = req.body || {};
    const name = clip(b.name, 80); const phone = phone10(b.phone);
    if (!name || !phone) return res.status(400).json({ error: 'Escribe nombre y WhatsApp a 10 dígitos.' });
    const prop = num(b.property_id) ? db.prepare('SELECT id, advisor_id, code FROM properties WHERE id = ?').get(num(b.property_id)) : null;
    if (b.visit_date && (!isDate(b.visit_date) || !/^\d{2}:\d{2}$/.test(String(b.visit_time || '')))) return res.status(400).json({ error: 'Fecha u hora de la cita inválida.' });
    const advisor = isManager(req.user) ? (num(b.advisor_id) || (prop ? prop.advisor_id : null)) : req.user.id;
    const origin = ['WhatsApp', 'Llamada', 'Referido', 'Otro'].includes(b.origin) ? b.origin : 'Otro';
    const id = Number(db.prepare('INSERT INTO leads (property_id, name, phone, visit_date, visit_time, advisor_id, origin, stage, contacted_at, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(prop ? prop.id : null, name, phone, b.visit_date || null, b.visit_date ? b.visit_time : null, advisor, origin, 'contactado', isoNow(), clip(b.note, 1000) || null).lastInsertRowid);
    event(id, req.user.id, 'creado', `Capturado a mano (${origin})${prop ? ` para ${prop.code}` : ''}`);
    res.status(201).json(findLead(req, id) || { id });
  });

  app.patch('/api/leads/:id', auth.requireUser, (req, res) => {
    const l = findLead(req, Number(req.params.id));
    if (!l) return res.status(404).json({ error: 'No existe o no es tuyo' });
    const b = req.body || {}; const u = req.user; const now = isoNow();
    if (b.stage !== undefined && b.stage !== l.stage) {
      if (!STAGES.includes(b.stage)) return res.status(400).json({ error: 'Etapa inválida' });
      if (b.stage === 'perdido' && !LOST_REASONS.includes(b.lost_reason)) return res.status(400).json({ error: 'Elige el motivo por el que se perdió.' });
      db.prepare('UPDATE leads SET stage = ?, lost_reason = ?, contacted_at = COALESCE(contacted_at, ?), updated_at = ? WHERE id = ?')
        .run(b.stage, b.stage === 'perdido' ? b.lost_reason : null, b.stage === 'nuevo' ? null : now, now, l.id);
      // Hitos: la fecha en que llegó a cada paso no se borra aunque después se pierda (así el embudo es real).
      const at = STAGES.indexOf(b.stage);
      if (b.stage !== 'perdido') {
        if (at >= STAGES.indexOf('cita')) db.prepare('UPDATE leads SET confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?').run(now, l.id);
        if (at >= STAGES.indexOf('visito')) db.prepare('UPDATE leads SET visited_at = COALESCE(visited_at, ?) WHERE id = ?').run(now, l.id);
        if (b.stage === 'firmado') db.prepare('UPDATE leads SET signed_at = COALESCE(signed_at, ?) WHERE id = ?').run(now, l.id);
      }
      event(l.id, u.id, 'etapa', `${l.stage} → ${b.stage}${b.stage === 'perdido' ? ` (${b.lost_reason})` : ''}`);
      // Firmado: la propiedad pasa a Rentada y sale del sitio y del mapa del sitio.
      if (b.stage === 'firmado' && l.property_id) {
        const p = db.prepare('SELECT status FROM properties WHERE id = ?').get(l.property_id);
        db.prepare('UPDATE properties SET tenant_lead_id = ? WHERE id = ?').run(l.id, l.property_id); // quien firmó es el inquilino
        if (p && p.status !== 'rentada') {
          db.prepare("UPDATE properties SET status = 'rentada', rented_at = ?, updated_at = ? WHERE id = ?").run(now, now, l.property_id);
          event(l.id, u.id, 'propiedad', `${l.prop_code} pasó a Rentada y salió del sitio`);
          changed(res, l.property_id);
        }
      }
    }
    if (b.visit_date !== undefined || b.visit_time !== undefined) {
      const date = b.visit_date ?? l.visit_date; const time = b.visit_time ?? l.visit_time;
      if (!isDate(date) || !/^\d{2}:\d{2}$/.test(String(time))) return res.status(400).json({ error: 'Fecha u hora inválida.' });
      db.prepare('UPDATE leads SET visit_date = ?, visit_time = ?, updated_at = ? WHERE id = ?').run(date, time, now, l.id);
      event(l.id, u.id, 'cita', `Cita cambiada a ${date} ${time}`);
    }
    if (b.followup_done !== undefined) db.prepare('UPDATE leads SET followup_done = ?, updated_at = ? WHERE id = ?').run(b.followup_done ? 1 : 0, now, l.id);
    if (b.no_show) {
      db.prepare("UPDATE leads SET stage = 'contactado', updated_at = ? WHERE id = ?").run(now, l.id);
      event(l.id, u.id, 'cita', 'No asistió a la cita');
    }
    res.json(findLead(req, l.id));
  });
  app.post('/api/leads/:id/assign', auth.requireRole(...MANAGERS), (req, res) => {
    const l = findLead(req, Number(req.params.id));
    if (!l) return res.status(404).json({ error: 'No existe' });
    const to = num(req.body?.advisor_id);
    const user = to ? db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').get(to) : null;
    if (to && !user) return res.status(400).json({ error: 'Ese asesor no existe o está desactivado.' });
    db.prepare('UPDATE leads SET advisor_id = ?, updated_at = ? WHERE id = ?').run(user ? user.id : null, isoNow(), l.id);
    event(l.id, req.user.id, 'asignado', user ? `Asignado a ${user.name}` : 'Quedó sin asesor');
    res.on('finish', () => { if (res.statusCode < 400 && user) onLead(l.id, true); });
    res.json(findLead(req, l.id));
  });
  app.post('/api/leads/:id/notes', auth.requireUser, (req, res) => {
    const l = findLead(req, Number(req.params.id));
    if (!l) return res.status(404).json({ error: 'No existe o no es tuyo' });
    const text = clip(req.body?.text, 2000);
    if (!text) return res.status(400).json({ error: 'Escribe la nota.' });
    event(l.id, req.user.id, 'nota', text);
    db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(isoNow(), l.id);
    res.status(201).json({ ok: true });
  });

  // ---------- Seguimiento: propietarios, quejas, jurídico y alertas (Gerente y Dueño) ----------
  const LISTS = {
    owners: { table: 'owners', statuses: ['nuevo', 'contactado', 'publicado', 'descartado'] },
    tickets: { table: 'tickets', statuses: ['en_gestion', 'resuelto'] },
    legal: { table: 'legal_requests', statuses: ['nuevo', 'contactado', 'cerrado'] },
    alerts: { table: 'alerts', statuses: ['nuevo', 'contactado', 'cerrado'] },
  };
  app.get('/api/follow', auth.requireRole(...MANAGERS), (req, res) => {
    const out = {};
    for (const [k, v] of Object.entries(LISTS)) out[k] = db.prepare(`SELECT * FROM ${v.table} ORDER BY id DESC LIMIT 500`).all();
    const matches = new Map(alertMatches(db).map((a) => [a.id, a.matches]));
    out.alerts = out.alerts.map((a) => ({ ...a, filters: (() => { try { return JSON.parse(a.filters); } catch { return {}; } })(), matches: matches.get(a.id) || [] }));
    out.requests = db.prepare(`SELECT r.*, p.code, p.title, p.rent, u.name AS by_name FROM owner_requests r JOIN properties p ON p.id = r.property_id
      LEFT JOIN users u ON u.id = r.created_by ORDER BY CASE r.status WHEN 'nueva' THEN 0 ELSE 1 END, r.id DESC LIMIT 300`).all();
    out.opinions = db.prepare(`SELECT p.id, p.code, p.title, COUNT(*) AS n, SUM(o.liked = 'si') AS liked, SUM(o.rent_opinion = 'alta') AS high
      FROM opinions o JOIN properties p ON p.id = o.property_id GROUP BY p.id ORDER BY n DESC`).all();
    res.json(out);
  });
  app.patch('/api/follow/:kind/:id', auth.requireRole(...MANAGERS), (req, res) => {
    const v = LISTS[req.params.kind];
    if (!v) return res.status(404).json({ error: 'No existe' });
    const row = db.prepare(`SELECT id FROM ${v.table} WHERE id = ?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'No existe' });
    if (req.body?.status !== undefined) {
      if (!v.statuses.includes(req.body.status)) return res.status(400).json({ error: 'Estado inválido' });
      db.prepare(`UPDATE ${v.table} SET status = ? WHERE id = ?`).run(req.body.status, row.id);
    }
    if (req.body?.assigned_to !== undefined && req.params.kind === 'tickets') db.prepare('UPDATE tickets SET assigned_to = ? WHERE id = ?').run(num(req.body.assigned_to), row.id);
    if (req.body?.advisor_id !== undefined && req.params.kind === 'owners') db.prepare('UPDATE owners SET advisor_id = ? WHERE id = ?').run(num(req.body.advisor_id), row.id);
    res.json({ ok: true });
  });

  // ---------- Fase 3 y 4: expedientes, documentos cifrados, pagos y bitácora de WhatsApp ----------
  panelDocsRoutes(app, { db, vlt, config });
  app.get('/api/audit', auth.requireRole('dueno'), (req, res) => res.json(db.prepare(`SELECT a.at, a.action, a.detail, a.ip, u.name AS user_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 300`).all()));
  // Llave nueva para la bóveda: se genera aquí, se muestra una sola vez al Dueño y no se guarda en ningún lado.
  app.post('/api/docs-key', auth.requireRole('dueno'), (req, res) => {
    if (vlt.enabled) return res.status(409).json({ error: 'La bóveda ya tiene llave. Cambiarla haría ilegibles los documentos guardados.' });
    audit(req, res, 'generó una llave para la bóveda de documentos');
    res.json({ key: crypto.randomBytes(32).toString('hex') });
  });
  app.get('/api/wa-log', auth.requireRole('dueno'), (req, res) => res.json(db.prepare('SELECT key, to_phone, template, status, error, at FROM wa_messages ORDER BY id DESC LIMIT 40').all()));

  // ---------- SEO: páginas que genera el sitio, para que el equipo vea qué existe y qué le falta ----------
  app.get('/api/seo', auth.requireRole(...MANAGERS), (req, res) => {
    const { visibleProps, publicProp } = require('./data');
    const { CITY, landingsFor } = require('./landings');
    const all = visibleProps(db).map(publicProp);
    const zs = db.prepare('SELECT * FROM zones WHERE active = 1 ORDER BY name').all();
    const pages = [{ id: 0, slug: CITY.slug, name: CITY.name }, ...zs].map((z) => {
      const list = z.slug === CITY.slug ? all : all.filter((p) => p.zone_slug === z.slug);
      return { zone: z.name, slug: z.slug, n: list.length, landings: landingsFor(z, list).map((l) => ({ path: l.path, h1: l.h1, n: l.n, indexable: l.indexable })) };
    });
    const last = (() => { try { return JSON.parse(siteSettings(db).indexnow_last || 'null'); } catch { return null; } })();
    res.json({ siteUrl: config.siteUrl || '', indexnow: seo.enabled, indexnowLast: last, zones: zs, pages });
  });

  // ---------- Fase 2 ----------
  // Enlace de opinión para quien ya visitó (se manda por WhatsApp). Siempre el mismo para ese lead.
  app.post('/api/leads/:id/opinion-link', auth.requireUser, (req, res) => {
    const l = findLead(req, Number(req.params.id));
    if (!l) return res.status(404).json({ error: 'No existe o no es tuyo' });
    if (!l.visited_at || !l.property_id) return res.status(400).json({ error: 'Primero marca que visitó la propiedad.' });
    let token = l.opinion_token;
    if (!token) { token = crypto.randomBytes(16).toString('base64url'); db.prepare('UPDATE leads SET opinion_token = ? WHERE id = ?').run(token, l.id); }
    res.json({ url: `${config.siteUrl || `${req.protocol}://${req.get('host')}`}/opinion/${token}`, done: Boolean(db.prepare('SELECT 1 FROM opinions WHERE lead_id = ?').get(l.id)) });
  });

  // "Mis números" del mes y comisión estimada (con los supuestos que pone el Dueño).
  app.get('/api/my-numbers', auth.requireUser, (req, res) => res.json(myNumbers(db, req.user.id, siteSettings(db))));

  // Resumen: Gerente y Dueño. El costo por cita (inversión en Meta) solo lo ve el Dueño.
  app.get('/api/summary', auth.requireRole(...MANAGERS), (req, res) => res.json(summary(db, String(req.query.period || 'mes'), req.user.role === 'dueno')));
  app.put('/api/meta-spend', auth.requireRole('dueno'), (req, res) => {
    const month = String(req.body?.month || ''); const amount = Number(req.body?.amount);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'Mes inválido.' });
    if (!(amount >= 0)) return res.status(400).json({ error: 'Escribe la inversión en pesos.' });
    db.prepare('INSERT INTO meta_spend (month, amount) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET amount = excluded.amount').run(month, Math.round(amount));
    res.json({ ok: true });
  });

  // Reportes semanales para cada propietario (se mandan por WhatsApp con un clic; el envío automático llega en la fase 4).
  app.get('/api/reports', auth.requireRole(...MANAGERS), (req, res) => {
    const rows = db.prepare(`${PROP_SQL} WHERE p.status != 'borrador' ORDER BY p.code`).all().map((r) => {
      const p = shapeProp(db, r);
      const owner = p.owner_id ? db.prepare('SELECT id, name, phone FROM owners WHERE id = ?').get(p.owner_id) : null;
      const s = ownerReport(db, p);
      return { id: p.id, code: p.code, title: p.title, status: p.status, owner, ...s, message: reportMessage(p, owner, s) };
    });
    res.json(rows);
  });
  app.post('/api/properties/:id/report-sent', auth.requireRole(...MANAGERS), (req, res) => {
    const p = db.prepare('SELECT id FROM properties WHERE id = ?').get(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    db.prepare('INSERT INTO owner_reports (property_id, sent_by) VALUES (?, ?)').run(p.id, req.user.id);
    res.status(201).json({ ok: true });
  });
  app.get('/api/properties/:id/opinions', auth.requireUser, (req, res) => res.json(opinionStats(db, Number(req.params.id))));

  // Solicitudes del propietario (llegan por WhatsApp al asesor; aquí se registran y se aplican).
  app.post('/api/properties/:id/requests', auth.requireUser, (req, res) => {
    const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (!seesPrivate(req.user, p)) return res.status(403).json({ error: 'Solo el asesor de la propiedad, el Gerente o el Dueño.' });
    const b = req.body || {};
    if (!OWNER_REQUESTS[b.kind]) return res.status(400).json({ error: 'Elige qué pide el propietario.' });
    const rent = num(b.new_rent);
    if (b.kind === 'precio' && !(rent > 0)) return res.status(400).json({ error: 'Escribe la renta nueva.' });
    const id = Number(db.prepare('INSERT INTO owner_requests (property_id, kind, new_rent, note, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, b.kind, b.kind === 'precio' ? Math.round(rent) : null, clip(b.note, 500) || null, req.user.id).lastInsertRowid);
    res.status(201).json({ id });
  });
  app.post('/api/requests/:id/:action', auth.requireRole(...MANAGERS), (req, res) => {
    const r = db.prepare('SELECT * FROM owner_requests WHERE id = ?').get(Number(req.params.id));
    if (!r || !['aplicar', 'rechazar'].includes(req.params.action)) return res.status(404).json({ error: 'No existe' });
    if (r.status !== 'nueva') return res.status(409).json({ error: 'Ya se resolvió.' });
    const now = isoNow();
    if (req.params.action === 'aplicar') {
      const p = getProp(db, r.property_id);
      const st = { pausar: 'pausada', reanudar: 'disponible', ya_rentada: 'rentada' }[r.kind];
      if (st) {
        const d = { ...statusChange(req.user, p, st), updated_at: now };
        db.prepare(`UPDATE properties SET ${Object.keys(d).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(d), p.id);
      }
      if (r.kind === 'precio') {
        // El título y la descripción SEO llevan el precio: se regeneran con la renta nueva.
        const a = seoAuto({ title: p.title, zone: p.zone, rent: r.new_rent, m2: p.m2, bedrooms: p.bedrooms, bathrooms: p.bathrooms, extras: p.extras, code: p.code });
        db.prepare('UPDATE properties SET rent = ?, seo_title = ?, seo_desc = ?, updated_at = ? WHERE id = ?').run(r.new_rent, a.title, a.desc, now, p.id);
      }
    }
    if (req.params.action === 'aplicar' && ['pausar', 'reanudar', 'ya_rentada', 'precio'].includes(r.kind)) changed(res, r.property_id);
    db.prepare('UPDATE owner_requests SET status = ?, resolved_at = ? WHERE id = ?').run(req.params.action === 'aplicar' ? 'aplicada' : 'rechazada', now, r.id);
    res.json({ ok: true });
  });

  // Acta de entrega: lista de revisión y fotos privadas (no salen en el sitio).
  app.put('/api/properties/:id/acta', auth.requireUser, (req, res) => {
    const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (!seesPrivate(req.user, p)) return res.status(403).json({ error: 'Solo el asesor de la propiedad, el Gerente o el Dueño.' });
    const items = Array.isArray(req.body?.items) ? ACTA_ITEMS.map((_, i) => Boolean(req.body.items[i])) : [];
    db.prepare('UPDATE properties SET acta_items = ? WHERE id = ?').run(JSON.stringify(items), p.id);
    res.json({ ok: true });
  });
  app.get('/api/properties/:id/acta', auth.requireUser, (req, res) => {
    const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (!seesPrivate(req.user, p)) return res.status(403).json({ error: 'Solo el asesor de la propiedad, el Gerente o el Dueño.' });
    res.json({ items: JSON.parse(p.acta_items || '[]'), photos: db.prepare('SELECT id FROM acta_photos WHERE property_id = ? ORDER BY id').all(p.id) });
  });
  app.post('/api/properties/:id/acta/photos', auth.requireUser, (req, res) => {
    const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (!seesPrivate(req.user, p)) return res.status(403).json({ error: 'Solo el asesor de la propiedad, el Gerente o el Dueño.' });
    const name = actas.save(p.id, req.body?.big, req.body?.small);
    if (!name) return res.status(400).json({ error: 'La foto no es válida. Usa JPG o PNG.' });
    const id = Number(db.prepare('INSERT INTO acta_photos (property_id, file) VALUES (?, ?)').run(p.id, name).lastInsertRowid);
    res.on('finish', () => { if (res.statusCode >= 400) actas.remove(name); });
    res.status(201).json({ id });
  });
  app.get('/api/acta-photo/:id', auth.requireUser, (req, res) => {
    const f = db.prepare('SELECT * FROM acta_photos WHERE id = ?').get(Number(req.params.id));
    const p = f && getProp(db, f.property_id);
    if (!f || !seesPrivate(req.user, p)) return res.status(404).json({ error: 'No existe' });
    res.set('Cache-Control', 'private, max-age=3600').sendFile(actas.path(f.file, req.query.sm === '1'));
  });

  app.post('/api/follow/alerts/:id/notified', auth.requireRole(...MANAGERS), (req, res) => {
    const a = db.prepare('SELECT id FROM alerts WHERE id = ?').get(Number(req.params.id));
    if (!a) return res.status(404).json({ error: 'No existe' });
    db.prepare("UPDATE alerts SET notified_at = ?, status = 'contactado' WHERE id = ?").run(isoNow(), a.id);
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe' }));
  return app;
}

module.exports = { panelRouter };
