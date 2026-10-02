const path = require('node:path');
const express = require('express');
const {
  openDb, ROLES, STATUSES, PROFILES, SOURCES, MANUAL_SOURCES, LABELS, CATALOG_KINDS, phoneKey, getSetting, setSetting, ensureSettings,
  MAX_TOUCHES, CADENCE_DAYS, TOUCH_CHANNELS, TOUCH_OUTCOMES, OUTCOMES_BY_STATUS, QUICK_PROFILE, NO_ANSWER, GHOSTED, POSTPONED, DECLINE_REASONS, FOLLOWUP, WA_TEMPLATES,
} = require('./db');
const auth = require('./auth');
const { ingestLead, addEvent, resolveStatusProfile, now, campaignName, autoAssign, workload, suggestSeller, balanceUnassigned, releaseLeads } = require('./leads');
const { webhooksRouter } = require('./webhooks');
const xlsx = require('./xlsx');
const { offsiteConfig, uploadBackup } = require('./offsite');
const STARTED_AT = new Date().toISOString();
// Guarda una falla para el panel (se quedan las últimas 300). Solo datos técnicos: dónde y qué mensaje.
function logOpsError(db, source, place, message) {
  try {
    db.prepare('INSERT INTO ops_errors (at, source, place, message) VALUES (?, ?, ?, ?)')
      .run(new Date().toISOString(), source, String(place || '').slice(0, 120), String(message || '').slice(0, 300));
    db.prepare('DELETE FROM ops_errors WHERE id <= (SELECT MAX(id) - 300 FROM ops_errors)').run();
  } catch { /* el registro de fallas nunca debe tumbar la app */ }
}
const { transactionalRoutes } = require('./tx');
const { snapshot, listBackups, backupDir, dailyBackup } = require('./backup');
const fs = require('node:fs');

const EDITORS = ['gerente', 'marketing'];
// La etapa que se ve (misma regla que FOLLOWUP.stageOf), para filtrar y contar en SQL.
const STAGE_SQL = `CASE WHEN l.status = 'nuevo' AND l.contacted_at IS NOT NULL THEN 'contesto'
  WHEN l.status = 'nuevo' AND l.touch_count > 0 THEN 'contactando'
  WHEN l.status = 'declinado' AND l.profile = 'cumple' THEN 'declinado_perfil'
  WHEN l.status = 'declinado' THEN 'declinado_sin' ELSE l.status END`;
// Audiencias para remarketing. Los que nunca contestaron no entran: no vale la pena volver a buscarlos.
const AUDIENCES = {
  perfil: ["l.status = 'declinado' AND l.profile = 'cumple'", []],
  contestaron: ["l.status = 'declinado' AND l.contacted_at IS NOT NULL AND l.profile != 'cumple'", []],
  pospuso: ["l.status = 'declinado' AND l.decline_reason = ?", [POSTPONED]],
  clientes: ["l.status = 'vendido'", []],
};
// Asignar leads es el trabajo del Coordinador de leads (rol 'operador' por dentro). Además, a cualquier usuario
// (gerente, gerente de marketing, vendedor o analista) se le puede dar la función con "También asigna leads" (can_assign).
// Cualquier gerente puede reasignar desde la ficha (emergencias).
const canAssign = (user) => Boolean(user && (user.role === 'operador' || user.can_assign));
// Al coordinador no le hace falta la casilla: asignar es su rol.
const assignFlag = (role, value) => (role !== 'operador' && value ? 1 : 0);
const canReassign = (user) => Boolean(user && (user.role === 'gerente' || canAssign(user)));
const requireAssigner = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión' });
  if (!canAssign(req.user)) return res.status(403).json({ error: 'Solo quien asigna leads puede hacerlo' });
  next();
};
const requireReassigner = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión' });
  if (!canReassign(req.user)) return res.status(403).json({ error: 'Solo quien asigna leads o el gerente pueden reasignarlos' });
  next();
};
// Canal efectivo del lead: el suyo o, si no tiene, el de su campaña.
const CHANNEL_EXPR = `COALESCE(l.channel_id, (SELECT cc.channel_id FROM catalog_items cc WHERE cc.kind = 'campana' AND cc.name = l.campaign))`;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const isDateTime = (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(v)) && !Number.isNaN(new Date(v).getTime());

// Bloqueo por intentos fallidos: 5 seguidos con el mismo email bloquean 15 minutos (en memoria; se reinicia con el servidor).
const LOGIN_MAX_FAILS = 5; const LOGIN_LOCK_MS = 15 * 60e3;
const ACCESS_LINK_HOURS = 72;
const sha256 = (v) => require('node:crypto').createHash('sha256').update(String(v)).digest('hex');
// IP real del visitante: detrás de Cloudflare viene en CF-Connecting-IP; si no, la que da el proxy de Railway.
const clientIp = (req) => String(req.get('cf-connecting-ip') || req.ip || '');
// Límite simple por IP en memoria: máx. `max` eventos por ventana de `ms`. Devuelve true si ya se pasó.
function rateLimiter(max, ms) {
  const hits = new Map();
  return {
    hit(key) {
      const now = Date.now(); const h = hits.get(key);
      if (!h || h.start + ms < now) { hits.set(key, { start: now, n: 1 }); return false; }
      h.n += 1; if (hits.size > 5000) for (const [k, v] of hits) if (v.start + ms < now) hits.delete(k);
      return h.n > max;
    },
    blocked(key) { const h = hits.get(key); return Boolean(h && h.start + ms >= Date.now() && h.n > max); },
  };
}
// Código de instalación: sin él nadie puede crear la primera cuenta, aunque abra el subdominio antes que tú.
// Viene en SETUP_CODE o se genera solo y se muestra en el registro del servidor (Railway → Deploy Logs).
function setupCode(db, config) {
  if (config.setupCode) return String(config.setupCode);
  let code = getSetting(db, 'setup_code');
  if (!code) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const bytes = require('node:crypto').randomBytes(8);
    code = Array.from(bytes, (b) => abc[b % abc.length]).join('').replace(/^(.{4})/, '$1-');
    setSetting(db, 'setup_code', code);
  }
  return code;
}
const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function createApp({ db, config }) {
  ensureSettings(db, config);
  FOLLOWUP.configure({ term: getSetting(db, 'service_term') || 'campana', renewals: getSetting(db, 'renewals') !== '0' });
  const loginFails = new Map();
  const loginByIp = rateLimiter(30, 15 * 60e3); // 30 intentos fallidos por IP en 15 min
  const setupTries = rateLimiter(10, 15 * 60e3);
  // Captcha (Cloudflare Turnstile): si hay claves, entrar, crear contraseña y el primer uso piden comprobar que no es un robot.
  const captcha = async (req, res, next) => {
    if (!config.turnstileSecret) return next();
    const token = req.body?.captcha;
    if (!token) return res.status(400).json({ error: 'Confirma que no eres un robot (la casilla de verificación).', captcha: true });
    try {
      const r = await fetch(config.turnstileVerifyUrl || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(8000),
        body: new URLSearchParams({ secret: config.turnstileSecret, response: String(token), remoteip: clientIp(req) }),
      });
      const out = await r.json();
      if (!out.success) return res.status(400).json({ error: 'No pudimos comprobar que no eres un robot. Intenta de nuevo.', captcha: true });
    } catch {
      return res.status(503).json({ error: 'No se pudo comprobar la verificación. Revisa tu internet e intenta de nuevo.', captcha: true });
    }
    return next();
  };
  const app = transactionalRoutes(express(), db);
  app.disable('x-powered-by');
  // Encabezados de seguridad: nadie puede meter la app dentro de otra página (engaños de clic), el navegador no adivina tipos
  // de archivo y los links de invitación no se filtran a otros sitios en el "Referer".
  app.use((req, res, next) => {
    res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "frame-ancestors 'none'" });
    next();
  });
  // Detrás del proxy HTTPS del hosting: así sabemos si la conexión es segura y la URL pública real.
  app.set('trust proxy', 1);
  // Salud: confirma que la base responde (Railway reinicia el servicio si esto falla).
  app.get('/health', (req, res) => {
    try { db.prepare('SELECT 1').get(); res.send('ok'); } catch (err) { res.status(503).send(`base de datos sin respuesta: ${err.message}`); }
  });
  app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false }));

  app.use('/webhooks', webhooksRouter(db));

  app.use(auth.authMiddleware(db));
  // Las rutas de la API que modifican datos solo aceptan JSON: junto con la cookie SameSite
  // evita que otro sitio mande formularios a nombre del usuario.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Se espera JSON' });
    }
    next();
  });

  // Instalación nueva: el código se crea al arrancar (fuera de cualquier petición, para que un intento fallido no lo cambie).
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) setupCode(db, config);

  const startSession = (req, res, userId) => {
    const { token, expires } = auth.createSession(db, userId);
    res.set('Set-Cookie', auth.sessionCookie(token, expires, config.cookieSecure || req.secure));
  };
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  // ---------- Primer uso: crear el gerente desde la pantalla ----------
  app.get('/api/setup', (req, res) => res.json({ needed: userCount() === 0 }));

  // Dos formas: el gerente se da de alta él mismo (con contraseña), o quien instala para un cliente deja creado al
  // gerente del cliente y recibe un link de invitación para mandárselo (así nunca conoce su contraseña).
  app.post('/api/setup', captcha, (req, res) => {
    if (userCount() > 0) return res.status(409).json({ error: 'La app ya está configurada' });
    const ip = clientIp(req);
    if (setupTries.blocked(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const { name, email, password, can_assign: operates, company, setup_code: code } = req.body || {};
    const expected = normCode(setupCode(db, config));
    const given = normCode(code);
    const ok = given.length === expected.length && require('node:crypto').timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) { setupTries.hit(ip); return res.status(403).json({ error: 'Código de instalación incorrecto. Está en el registro del servidor (Railway → Deploy Logs) o en la variable SETUP_CODE.' }); }
    if (!name || !email || !String(company || '').trim()) return res.status(400).json({ error: 'Faltan datos' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return res.status(400).json({ error: 'Email inválido' });
    if (password !== undefined && password !== '' && String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    setSetting(db, 'company_name', String(company).trim().slice(0, 80));
    const id = Number(db.prepare('INSERT INTO users (name, email, password_hash, role, can_assign) VALUES (?, ?, ?, ?, ?)')
      .run(String(name).trim(), String(email).trim(), password ? auth.hashPassword(String(password)) : '', 'gerente', assignFlag('gerente', operates)).lastInsertRowid);
    db.prepare("DELETE FROM settings WHERE key = 'setup_code'").run();
    if (!password) return res.status(201).json({ invited: true, name, email, ...accessLink(req, id, 'invite') });
    startSession(req, res, id);
    res.status(201).json({ id, name, email, role: 'gerente', can_assign: assignFlag('gerente', operates) });
  });

  // ---------- Sesión ----------
  app.post('/api/login', captcha, (req, res) => {
    const { email, password } = req.body || {};
    const key = String(email || '').trim().toLowerCase();
    const ip = clientIp(req);
    if (loginByIp.blocked(ip)) return res.status(429).json({ error: 'Demasiados intentos desde esta conexión. Espera 15 minutos.' });
    const fails = loginFails.get(key);
    if (fails && fails.until > Date.now()) {
      const min = Math.ceil((fails.until - Date.now()) / 60e3);
      return res.status(429).json({ error: `Demasiados intentos. Espera ${min} ${min === 1 ? 'minuto' : 'minutos'} o pídele a tu gerente un link para crear una contraseña nueva.` });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').trim());
    if (user && !user.password_hash) {
      return res.status(401).json({ error: 'Todavía no activas tu acceso: abre el link de invitación que te mandó tu gerente.' });
    }
    if (!user || !auth.verifyPassword(String(password || ''), user.password_hash)) {
      loginByIp.hit(ip);
      const n = (fails?.until && fails.until <= Date.now() ? 0 : fails?.n || 0) + 1; // si ya pasó el bloqueo, cuenta de nuevo
      loginFails.set(key, { n, until: n >= LOGIN_MAX_FAILS ? Date.now() + LOGIN_LOCK_MS : 0 });
      return res.status(401).json({ error: n >= LOGIN_MAX_FAILS ? 'Demasiados intentos. Espera 15 minutos o pídele a tu gerente un link para crear una contraseña nueva.' : 'Email o contraseña incorrectos' });
    }
    loginFails.delete(key);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
    startSession(req, res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, can_assign: canAssign(user) ? 1 : 0 });
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.set('Set-Cookie', auth.clearCookie()).json({ ok: true });
  });

  app.get('/api/me', auth.requireUser, (req, res) => res.json(req.user));

  // Cambiar mi contraseña: pide la actual. Cierra mis otras sesiones (la de este dispositivo sigue).
  app.post('/api/me/password', auth.requireUser, (req, res) => {
    const { current, password } = req.body || {};
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(String(current || ''), user.password_hash)) return res.status(400).json({ error: 'Tu contraseña actual no es correcta' });
    if (String(password || '').length < 8) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(password)), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.sessionToken);
    res.json({ ok: true });
  });

  // ---------- Acceso por link (invitación o contraseña nueva) ----------
  // El gerente genera el link y lo manda por WhatsApp o correo; quien lo abre elige su contraseña. Un solo uso, vence en 72 h.
  function accessLink(req, userId, kind) {
    const token = require('node:crypto').randomBytes(24).toString('base64url');
    db.prepare('DELETE FROM user_tokens WHERE user_id = ? AND used_at IS NULL').run(userId);
    const expires = Date.now() + ACCESS_LINK_HOURS * 3600e3;
    db.prepare('INSERT INTO user_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, kind, expires);
    return { link: `${req.protocol}://${req.get('host')}/?acceso=${token}`, kind, expires_at: new Date(expires).toISOString() };
  }
  const findToken = (token) => db.prepare(`SELECT t.*, u.name, u.email, u.active FROM user_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?`).get(sha256(token));
  app.get('/api/access/:token', (req, res) => {
    const t = findToken(req.params.token);
    if (!t || t.used_at || t.expires_at < Date.now() || !t.active) return res.status(410).json({ error: 'Este link ya no sirve: venció o ya se usó. Pídele a tu gerente uno nuevo.' });
    res.json({ name: t.name, email: t.email, kind: t.kind });
  });
  app.post('/api/access/:token', captcha, (req, res) => {
    const t = findToken(req.params.token);
    if (!t || t.used_at || t.expires_at < Date.now() || !t.active) return res.status(410).json({ error: 'Este link ya no sirve: venció o ya se usó. Pídele a tu gerente uno nuevo.' });
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    const ts = new Date().toISOString();
    db.prepare('UPDATE users SET password_hash = ?, last_login_at = ? WHERE id = ?').run(auth.hashPassword(password), ts, t.user_id);
    db.prepare('UPDATE user_tokens SET used_at = ? WHERE token_hash = ?').run(ts, t.token_hash);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.user_id); // con contraseña nueva, se cierran las sesiones anteriores
    loginFails.delete(String(t.email).toLowerCase());
    startSession(req, res, t.user_id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id);
    res.json({ id: u.id, name: u.name, email: u.email, role: u.role, can_assign: canAssign(u) ? 1 : 0 });
  });

  // ---------- Empresa: nombre, logo y cómo se llama lo que vende (cada instalación es de una empresa) ----------
  const company = () => ({ name: getSetting(db, 'company_name') || '', logo: getSetting(db, 'company_logo') || '',
    term: getSetting(db, 'service_term') || 'campana', renewals: getSetting(db, 'renewals') !== '0', captcha_site_key: config.turnstileSiteKey || '' });
  app.get('/api/company', (req, res) => res.json(company()));
  app.patch('/api/company', auth.requireRole('gerente'), (req, res) => {
    const b = req.body || {};
    if (b.name !== undefined) {
      if (!String(b.name).trim()) return res.status(400).json({ error: 'Escribe el nombre de la empresa' });
      setSetting(db, 'company_name', String(b.name).trim().slice(0, 80));
    }
    if (b.logo !== undefined) {
      // Solo imágenes PNG, JPG o WebP de hasta ~300 KB (se guardan dentro de la base).
      if (b.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo)) return res.status(400).json({ error: 'El logo debe ser PNG, JPG o WebP' });
      if (b.logo && b.logo.length > 420000) return res.status(400).json({ error: 'El logo pesa demasiado: usa uno de menos de 300 KB' });
      setSetting(db, 'company_logo', b.logo || '');
    }
    if (b.term !== undefined) {
      if (!Object.hasOwn(FOLLOWUP.TERMS, String(b.term))) return res.status(400).json({ error: 'Opción inválida' });
      setSetting(db, 'service_term', b.term); FOLLOWUP.configure({ term: b.term });
    }
    if (b.renewals !== undefined) { setSetting(db, 'renewals', b.renewals ? '1' : '0'); FOLLOWUP.configure({ renewals: Boolean(b.renewals) }); }
    res.json(company());
  });

  app.get('/api/meta', (req, res) => res.json({ statuses: STATUSES, profiles: PROFILES, roles: ROLES, sources: SOURCES, manualSources: MANUAL_SOURCES, labels: LABELS,
    touches: { max: MAX_TOUCHES, cadence: CADENCE_DAYS, channels: TOUCH_CHANNELS, outcomes: TOUCH_OUTCOMES, byStatus: OUTCOMES_BY_STATUS },
    quickProfile: QUICK_PROFILE, stages: FOLLOWUP.STAGES, declineReasons: DECLINE_REASONS, postponed: POSTPONED, noAnswer: NO_ANSWER, ghosted: GHOSTED, silentMax: FOLLOWUP.SILENT_MAX }));

  // ---------- Configuración (solo gerente) ----------
  // Estado de los datos: si la base está en disco persistente y los respaldos (solo gerente).
  app.get('/api/system', auth.requireRole('gerente'), (req, res) => {
    const file = config.dbPath;
    const size = file && file !== ':memory:' && fs.existsSync(file) ? fs.statSync(file).size : null;
    const backups = file && file !== ':memory:' ? listBackups(file) : [];
    res.json({ storage_warning: Boolean(config.storageWarning), size, backups: backups.length, last_backup: backups.at(-1)?.file.slice(4, 14) || null,
      leads: db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,
      offsite: { configured: Boolean(offsiteConfig()), last: getSetting(db, 'offsite_last'), error: getSetting(db, 'offsite_error') } });
  });
  // Descarga de un respaldo completo al momento, para guardarlo fuera del servidor.
  app.get('/api/backup', auth.requireRole('gerente'), (req, res) => {
    if (!config.dbPath || config.dbPath === ':memory:') return res.status(400).json({ error: 'No hay base de datos en disco' });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const tmp = path.join(backupDir(config.dbPath), `descarga-${Date.now()}.db`);
    try { snapshot(db, tmp); } catch (err) { return res.status(500).json({ error: `No se pudo crear el respaldo: ${err.message}` }); }
    res.download(tmp, `crm-respaldo-${stamp}.db`, () => fs.rm(tmp, { force: true }, () => {}));
  });

  app.get('/api/settings', auth.requireRole(...EDITORS), (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      form_url: `${base}/webhooks/form`,
      form_api_key: getSetting(db, 'form_api_key'),
      wa_templates: waTemplates(),
    });
  });

  // Plantillas de WhatsApp: todos las usan; gerente y marketing las editan en Configuración.
  function waTemplates() {
    let saved = {};
    try { saved = JSON.parse(getSetting(db, 'wa_templates') || '{}'); } catch { /* se usan las de fábrica */ }
    return Object.fromEntries(Object.keys(WA_TEMPLATES).map((k) => [k, typeof saved[k] === 'string' && saved[k].trim() ? saved[k] : WA_TEMPLATES[k]]));
  }
  app.get('/api/wa-templates', auth.requireUser, (req, res) => res.json(waTemplates()));

  app.patch('/api/settings', auth.requireRole(...EDITORS), (req, res) => {
    const b = req.body || {};
    if (b.auto_assign !== undefined) return res.status(403).json({ error: 'El reparto se configura en Asignación' });
    if (b.wa_templates && typeof b.wa_templates === 'object') {
      const clean = Object.fromEntries(Object.keys(WA_TEMPLATES).filter((k) => typeof b.wa_templates[k] === 'string')
        .map((k) => [k, b.wa_templates[k].trim().slice(0, 1000)]));
      setSetting(db, 'wa_templates', JSON.stringify({ ...waTemplates(), ...clean }));
    }
    if (b.regenerate_form_key) setSetting(db, 'form_api_key', require('node:crypto').randomBytes(18).toString('base64url'));
    res.json({ ok: true });
  });

  // ---------- Listas: canales de percepción, productos y campañas ----------
  const money = (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(String(v).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new Error('Monto inválido');
    return Math.round(n * 100) / 100;
  };

  app.get('/api/catalog', auth.requireUser, (req, res) => {
    const items = db.prepare('SELECT id, kind, name, active, budget, channel_id, price, fixed_price FROM catalog_items ORDER BY active DESC, name COLLATE NOCASE').all();
    const budgets = db.prepare('SELECT campaign_id, month, amount FROM campaign_budgets ORDER BY month').all();
    items.filter((i) => i.kind === 'campana').forEach((c) => {
      c.budgets = budgets.filter((b) => b.campaign_id === c.id).map(({ month, amount }) => ({ month, amount }));
    });
    res.json(Object.fromEntries(CATALOG_KINDS.map((k) => [k, items.filter((i) => i.kind === k)])));
  });

  app.post('/api/catalog', auth.requireRole(...EDITORS), (req, res) => {
    const kind = req.body?.kind;
    const name = String(req.body?.name || '').trim();
    if (!CATALOG_KINDS.includes(kind) || !name) return res.status(400).json({ error: 'Escribe un nombre' });
    const existing = db.prepare('SELECT id, active FROM catalog_items WHERE kind = ? AND name = ? COLLATE NOCASE').get(kind, name);
    if (existing?.active) return res.status(409).json({ error: 'Ya está en la lista' });
    if (existing) {
      db.prepare('UPDATE catalog_items SET active = 1 WHERE id = ?').run(existing.id);
      return res.json({ id: existing.id });
    }
    let budget = null;
    try { budget = kind === 'campana' ? money(req.body?.budget) ?? null : null; } catch (err) { return res.status(400).json({ error: err.message }); }
    let channelId = null; let price = null;
    try {
      channelId = kind === 'campana' ? catalogId('canal', req.body?.channel_id) ?? null : null;
      price = kind === 'producto' ? money(req.body?.price) ?? null : null;
    } catch (err) { return res.status(400).json({ error: err.message }); }
    const fixed = kind === 'producto' && req.body?.fixed_price && price > 0 ? 1 : 0;
    if (kind === 'producto' && req.body?.fixed_price && !(price > 0)) return res.status(400).json({ error: 'Para precio fijo escribe el precio' });
    const { lastInsertRowid } = db.prepare('INSERT INTO catalog_items (kind, name, budget, channel_id, price, fixed_price) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, name.slice(0, 120), budget, channelId, price, fixed);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  // No se borran: se desactivan para que los leads que ya los tienen conserven el dato.
  app.patch('/api/catalog/:id', auth.requireRole(...EDITORS), (req, res) => {
    const item = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'No existe' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 120) : item.name;
    if (!name) return res.status(400).json({ error: 'Escribe un nombre' });
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : item.active;
    let budget; let channelId; let price;
    try {
      budget = item.kind === 'campana' ? money(req.body?.budget) : undefined;
      channelId = item.kind === 'campana' ? catalogId('canal', req.body?.channel_id) : undefined;
      price = item.kind === 'producto' ? money(req.body?.price) : undefined;
    } catch (err) { return res.status(400).json({ error: err.message }); }
    // Precio de lista y precio fijo: solo productos. Precio fijo sin precio no tiene sentido.
    const newPrice = price === undefined ? item.price : price;
    let fixed = item.kind === 'producto' && req.body?.fixed_price !== undefined ? (req.body.fixed_price ? 1 : 0) : item.fixed_price;
    if (fixed && !(newPrice > 0)) {
      if (req.body?.fixed_price) return res.status(400).json({ error: 'Para precio fijo escribe el precio' });
      fixed = 0;
    }
    try {
      db.prepare('UPDATE catalog_items SET name = ?, active = ?, budget = ?, channel_id = ?, price = ?, fixed_price = ? WHERE id = ?')
        .run(name, active, budget === undefined ? item.budget : budget, channelId === undefined ? item.channel_id : channelId, newPrice, fixed, item.id);
    } catch {
      return res.status(409).json({ error: 'Ya hay otro elemento con ese nombre' });
    }
    // Los leads guardan la campaña por nombre: al renombrarla se actualizan.
    if (item.kind === 'campana' && name !== item.name) db.prepare('UPDATE leads SET campaign = ? WHERE campaign = ?').run(name, item.name);
    res.json({ ok: true });
  });

  // Inversión de una campaña en un mes. amount vacío = se borra ese mes.
  app.put('/api/catalog/:id/budgets', auth.requireRole(...EDITORS), (req, res) => {
    const item = db.prepare("SELECT id FROM catalog_items WHERE id = ? AND kind = 'campana'").get(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'No existe' });
    const month = String(req.body?.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Mes inválido' });
    let amount;
    try { amount = money(req.body?.amount); } catch (err) { return res.status(400).json({ error: err.message }); }
    if (amount == null) db.prepare('DELETE FROM campaign_budgets WHERE campaign_id = ? AND month = ?').run(item.id, month);
    else {
      db.prepare(`INSERT INTO campaign_budgets (campaign_id, month, amount) VALUES (?, ?, ?)
        ON CONFLICT(campaign_id, month) DO UPDATE SET amount = excluded.amount`).run(item.id, month, amount);
    }
    res.json({ ok: true });
  });

  // Valida un id de la lista; undefined = no cambia, null = sin valor.
  function catalogId(kind, value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const item = db.prepare('SELECT id FROM catalog_items WHERE id = ? AND kind = ?').get(Number(value), kind);
    if (!item) throw new Error(kind === 'canal' ? 'Canal inválido' : 'Producto inválido');
    return item.id;
  }

  // ---------- Usuarios ----------
  app.get('/api/users', auth.requireUser, (req, res) => {
    // Los demás solo necesitan nombres y roles (listas de vendedores); correos y accesos son del gerente.
    if (req.user.role !== 'gerente') return res.json(db.prepare('SELECT id, name, role, active FROM users ORDER BY active DESC, name').all());
    // pendiente = todavía no abre su invitación (no tiene contraseña).
    res.json(db.prepare(`SELECT id, name, email, role, active, can_assign, created_at, last_login_at, password_hash = '' AS pendiente,
      (SELECT MAX(expires_at) FROM user_tokens t WHERE t.user_id = users.id AND t.used_at IS NULL) AS link_vence,
      (SELECT COUNT(*) FROM leads l WHERE l.assigned_to = users.id AND l.status IN ('nuevo', 'nuevo_perfil', 'cotizando')) AS en_curso
      FROM users ORDER BY active DESC, name`).all());
  });

  app.post('/api/users', auth.requireRole('gerente'), (req, res) => {
    // Desde la pantalla se da de alta sin contraseña y se manda el link de invitación; con password (scripts de carga) queda activo.
    const { name, email, password, role, can_assign: operates } = req.body || {};
    if (!name || !email || !ROLES.includes(role)) return res.status(400).json({ error: 'Faltan datos' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return res.status(400).json({ error: 'Email inválido' });
    if (password !== undefined && String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    let id;
    try {
      id = Number(db.prepare('INSERT INTO users (name, email, password_hash, role, can_assign) VALUES (?, ?, ?, ?, ?)')
        .run(String(name).trim(), String(email).trim(), password ? auth.hashPassword(String(password)) : '', role, assignFlag(role, operates)).lastInsertRowid);
    } catch {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    }
    res.status(201).json({ id, ...(password ? {} : accessLink(req, id, 'invite')) });
  });

  // Link de acceso: invitación (si aún no entra) o para crear una contraseña nueva (si la olvidó).
  app.post('/api/users/:id/access-link', auth.requireRole('gerente'), (req, res) => {
    const user = db.prepare('SELECT id, active, password_hash FROM users WHERE id = ?').get(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'No existe' });
    if (!user.active) return res.status(400).json({ error: 'Primero reactiva al usuario' });
    res.json(accessLink(req, user.id, user.password_hash ? 'reset' : 'invite'));
  });

  app.patch('/api/users/:id', auth.requireRole('gerente'), (req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'No existe' });
    const { name, role, active, password, can_assign: operates } = req.body || {};
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
    if (id === req.user.id && (active === false || (role && role !== 'gerente'))) {
      return res.status(400).json({ error: 'No puedes desactivarte ni quitarte el rol de gerente' });
    }
    // El gerente no escribe contraseñas: genera un link para que cada quien elija la suya.
    if (password !== undefined) return res.status(400).json({ error: 'Las contraseñas las elige cada usuario: genera un link de acceso' });
    db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(
      name ? String(name).trim() : user.name, role || user.role,
      active === undefined ? user.active : (active ? 1 : 0), id);
    // "También asigna leads": se conserva al cambiar de rol (salvo al pasar a Coordinador de leads, donde es su trabajo).
    const newRole = role || user.role;
    const flag = operates !== undefined ? assignFlag(newRole, operates) : assignFlag(newRole, user.can_assign);
    db.prepare('UPDATE users SET can_assign = ? WHERE id = ?').run(flag, id);
    if (active === false) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    // Si deja de ser vendedor activo, sus leads en curso vuelven a "Sin asignar" para no perderse.
    const leftSales = user.role === 'vendedor' && user.active && (active === false || (role && role !== 'vendedor'));
    const released = leftSales ? releaseLeads(db, id, req.user.id, user.name) : 0;
    res.json({ ok: true, released });
  });

  // ---------- Leads ----------
  const leadSelect = `SELECT l.*, u.name AS assigned_name, ch.name AS channel_name, pr.name AS product_name,
    (SELECT e.content FROM lead_events e WHERE e.lead_id = l.id AND e.type = 'nota' ORDER BY e.id DESC LIMIT 1) AS last_note FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to
    LEFT JOIN catalog_items ch ON ch.id = ${CHANNEL_EXPR}
    LEFT JOIN catalog_items pr ON pr.id = l.product_id`;

  function leadFilters(req) {
    const where = [];
    const params = [];
    const q = req.query;
    // El vendedor ve solo sus leads. Si además asigna leads, en Asignación ve también los que no tienen dueño.
    if (req.user.role === 'vendedor' && canAssign(req.user) && q.assigned === 'none') {
      // sin restricción extra: abajo se filtra a los que no tienen vendedor
    } else if (req.user.role === 'vendedor') {
      where.push('l.assigned_to = ?'); params.push(req.user.id);
    }
    if (STATUSES.includes(q.status)) { where.push('l.status = ?'); params.push(q.status); }
    if (FOLLOWUP.STAGES.includes(q.stage)) { where.push(`${STAGE_SQL} = ?`); params.push(q.stage); }
    if (PROFILES.includes(q.profile)) { where.push('l.profile = ?'); params.push(q.profile); }
    if (SOURCES.includes(q.source)) { where.push('l.source = ?'); params.push(q.source); }
    if (q.assigned === 'none') where.push('l.assigned_to IS NULL');
    else if (q.assigned) { where.push('l.assigned_to = ?'); params.push(Number(q.assigned)); }
    if (q.campaign) { where.push('l.campaign = ?'); params.push(String(q.campaign)); }
    if (q.reason) { where.push('l.decline_reason = ?'); params.push(String(q.reason)); }
    if (Object.hasOwn(AUDIENCES, String(q.audience))) { where.push(`(${AUDIENCES[q.audience][0]})`); params.push(...AUDIENCES[q.audience][1]); }
    for (const [param, col] of [['channel', CHANNEL_EXPR], ['product', 'l.product_id']]) {
      if (q[param] === 'none') where.push(`${col} IS NULL`);
      else if (q[param]) { where.push(`${col} = ?`); params.push(Number(q[param])); }
    }
    if (q.from) { where.push('l.created_at >= ?'); params.push(String(q.from)); }
    if (q.to) { where.push('l.created_at < ?'); params.push(String(q.to)); }
    if (q.q) {
      const like = `%${String(q.q).trim()}%`;
      where.push('(l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.campaign LIKE ?)');
      params.push(like, like, like, like);
    }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  function getLead(req, id) {
    const lead = db.prepare(`${leadSelect} WHERE l.id = ?`).get(id);
    if (!lead) return null;
    if (req.user.role === 'vendedor' && lead.assigned_to !== req.user.id && !(canAssign(req.user) && !lead.assigned_to)) return null;
    return lead;
  }

  // Avance de ventas (etapa, toques, montos): el gerente y el vendedor dueño del lead.
  // Marketing no registra toques ni mueve etapas, para no ensuciar los números de ventas; solo corrige el origen y los datos de contacto.
  // El gerente puede corregir (etapa, montos), pero los toques solo los registra el vendedor dueño del lead.
  function canEdit(user, lead) {
    if (user.role === 'gerente') return true;
    return user.role === 'vendedor' && lead.assigned_to === user.id;
  }
  const canTouch = (user, lead) => user.role === 'vendedor' && lead.assigned_to === user.id;
  const canEditOrigin = (user) => EDITORS.includes(user.role) || canAssign(user);
  const ORIGIN_FIELDS = ['campaign', 'channel_id', 'product_id', 'name', 'phone', 'email'];

  app.get('/api/leads', auth.requireUser, (req, res) => {
    const { sql, params } = leadFilters(req);
    // Lo que está en curso (o tiene algo pendiente) va primero, para que nunca quede fuera del límite por leads viejos cerrados.
    res.json(db.prepare(`${leadSelect} ${sql} ORDER BY (l.status IN ('nuevo', 'nuevo_perfil', 'cotizando', 'vendido')
      OR l.recontact_at IS NOT NULL) DESC, l.updated_at DESC LIMIT 5000`).all(...params));
  });

  app.get('/api/leads.csv', auth.requireRole('gerente', 'marketing', 'analista'), (req, res) => {
    const { sql, params } = leadFilters(req);
    const rows = db.prepare(`${leadSelect} ${sql} ORDER BY l.created_at DESC`).all(...params);
    const cols = [['id', 'ID'], ['name', 'Nombre'], ['phone', 'Teléfono'], ['email', 'Email'], ['source', 'Origen'],
      ['campaign', 'Campaña'], ['channel_name', 'Se enteró por'], ['product_name', 'Producto'], ['status', 'Estado'], ['profile', 'Perfil'], ['decline_reason', 'Motivo declinado'],
      ['assigned_name', 'Vendedor'], ['quote_amount', 'Monto cotizado'], ['sale_amount', 'Monto de venta'],
      ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_content', 'Anuncio (utm_content)'], ['created_at', 'Fecha']];
    const esc = (v) => {
      let s = v == null ? '' : String(v);
      // Un nombre como "=HYPERLINK(...)" llegado del formulario público no debe correr como fórmula al abrirlo en Excel.
      // Los teléfonos (+52 55…) y los números negativos se dejan igual.
      if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-][\d\s().-]*$/.test(s))) s = `'${s}`;
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    let csv;
    if (req.query.format === 'ads') {
      // Para subir como público a Meta o Google: teléfono internacional (+52…), correo y nombre separados.
      const rowsAds = rows.map((r) => {
        const n = FOLLOWUP.waNumber(r.phone);
        const [fn, ...ln] = String(r.name || '').trim().split(/\s+/);
        return [r.email ? r.email.toLowerCase() : '', n ? `+${n}` : '', fn || '', ln.join(' '), 'MX'];
      }).filter((r) => r[0] || r[1]);
      csv = [['email', 'phone', 'fn', 'ln', 'country'].join(','), ...rowsAds.map((r) => r.map(esc).join(','))].join('\n');
    } else {
      csv = [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map(([k]) => esc(['status', 'profile'].includes(k) ? LABELS[r[k]] : r[k])).join(','))].join('\n');
    }
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${req.query.format === 'ads' ? 'audiencia-anuncios' : 'leads'}.csv"` });
    res.send('﻿' + csv);
  });

  app.get('/api/leads/:id', auth.requireUser, (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    const events = db.prepare(`SELECT e.*, u.name AS user_name FROM lead_events e
      LEFT JOIN users u ON u.id = e.user_id WHERE e.lead_id = ? ORDER BY e.id DESC`).all(lead.id);
    res.json({ ...lead, events, can_edit: canEdit(req.user, lead), can_touch: canTouch(req.user, lead),
      can_edit_origin: canEdit(req.user, lead) || canEditOrigin(req.user), can_reassign: canReassign(req.user) });
  });

  app.post('/api/leads', auth.requireUser, (req, res) => {
    if (!['gerente', 'marketing', 'vendedor', 'operador'].includes(req.user.role) && !canAssign(req.user)) {
      return res.status(403).json({ error: 'No tienes permiso' });
    }
    const b = req.body || {};
    try {
      if (!MANUAL_SOURCES.includes(b.source)) return res.status(400).json({ error: 'Indica por dónde llegó el lead' });
      // Sin origen no se puede medir qué inversión trajo el lead.
      if (!b.campaign && !b.channel_id) return res.status(400).json({ error: 'Indica de dónde viene el lead' });
      // Quien administra los leads elige al capturarlo quién le da seguimiento.
      let seller = null;
      if (b.assigned_to && canReassign(req.user)) {
        seller = db.prepare("SELECT id, name FROM users WHERE id = ? AND active = 1 AND role = 'vendedor'").get(Number(b.assigned_to));
        if (!seller) return res.status(400).json({ error: 'Ese vendedor no existe o está inactivo' });
      }
      // Si el contacto ya existía, ingestLead lo registra en su historial en vez de duplicarlo.
      const result = ingestLead(db, {
        ...b, userId: req.user.id, channel_id: catalogId('canal', b.channel_id), product_id: catalogId('producto', b.product_id),
        campaign: campaignName(db, b.campaign),
      });
      if (!result.created) {
        const owner = db.prepare('SELECT l.assigned_to, u.name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = ?')
          .get(result.id);
        if (req.user.role === 'vendedor' && !canAssign(req.user) && owner.assigned_to && owner.assigned_to !== req.user.id) {
          return res.status(409).json({ error: `Este contacto ya lo atiende ${owner.name}. Se dejó registrado en su historial.` });
        }
        if (seller && !owner.assigned_to) assignLead(result.id, seller, req.user.id);
        else if (req.user.role === 'vendedor' && !owner.assigned_to) assignLead(result.id, req.user, req.user.id);
        else autoAssign(db, result.id);
        return res.json({ id: result.id, existing: true });
      }
      if (seller) assignLead(result.id, seller, req.user.id);
      else if (req.user.role === 'vendedor') {
        db.prepare('UPDATE leads SET assigned_to = ?, assigned_at = created_at WHERE id = ?').run(req.user.id, result.id);
      } else autoAssign(db, result.id);
      res.status(201).json({ id: result.id, repeat_of: result.repeat_of });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  function assignLead(id, seller, userId) {
    const ts = now();
    db.prepare('UPDATE leads SET assigned_to = ?, assigned_at = ?, updated_at = ? WHERE id = ?').run(seller.id, ts, ts, id);
    addEvent(db, id, userId, 'asignacion', `Asignado a ${seller.name}`);
  }

  // Carga por vendedor y a quién le toca el siguiente lead.
  app.get('/api/workload', requireAssigner, (req, res) => {
    const u = db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM leads WHERE assigned_to IS NULL AND status IN ('nuevo', 'nuevo_perfil', 'cotizando')").get();
    res.json({ sellers: workload(db), suggested: suggestSeller(db)?.id ?? null, unassigned: u.n, oldest_unassigned_at: u.oldest,
      auto_assign: getSetting(db, 'auto_assign') === '1' });
  });
  // Reparto automático al de menor carga: lo decide quien asigna (o el gerente).
  app.patch('/api/assign-settings', requireReassigner, (req, res) => {
    if (req.body?.auto_assign !== undefined) setSetting(db, 'auto_assign', req.body.auto_assign ? '1' : '0');
    res.json({ ok: true, auto_assign: getSetting(db, 'auto_assign') === '1' });
  });

  app.post('/api/leads/balance', requireAssigner, (req, res) => {
    res.json({ assigned: balanceUnassigned(db, req.user.id) });
  });

  // Asignar o reasignar un lead (quien administra los leads).
  app.post('/api/leads/:id/assign', requireReassigner, (req, res) => {
    const lead = db.prepare('SELECT id, assigned_to FROM leads WHERE id = ?').get(Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    const to = req.body?.assigned_to;
    if (!to) {
      if (lead.assigned_to) {
        db.prepare('UPDATE leads SET assigned_to = NULL, assigned_at = NULL, updated_at = ? WHERE id = ?').run(now(), lead.id);
        addEvent(db, lead.id, req.user.id, 'asignacion', 'Se quitó el vendedor');
      }
      return res.json({ ok: true });
    }
    const seller = db.prepare("SELECT id, name FROM users WHERE id = ? AND active = 1 AND role = 'vendedor'").get(Number(to));
    if (!seller) return res.status(400).json({ error: 'Ese vendedor no existe o está inactivo' });
    if (seller.id !== lead.assigned_to) assignLead(lead.id, seller, req.user.id);
    res.json({ ok: true });
  });

  // "Pedir seguimiento": el gerente le deja al vendedor una instrucción sobre un lead; sale arriba en su Mi día hasta que registre un toque.
  app.post('/api/leads/:id/request', auth.requireRole('gerente'), (req, res) => {
    const lead = db.prepare('SELECT id, assigned_to FROM leads WHERE id = ?').get(Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    const text = String(req.body?.text || '').trim().slice(0, 300);
    if (text && !lead.assigned_to) return res.status(400).json({ error: 'Primero hay que asignar el lead a un vendedor' });
    const ts = now();
    db.prepare('UPDATE manager_requests SET cancelled = 1, done_at = ? WHERE lead_id = ? AND done_at IS NULL').run(ts, lead.id);
    if (text) db.prepare('INSERT INTO manager_requests (lead_id, seller_id, text, created_at) VALUES (?, ?, ?, ?)').run(lead.id, lead.assigned_to, text, ts);
    db.prepare('UPDATE leads SET manager_request = ?, manager_request_at = ? WHERE id = ?').run(text || null, text ? ts : null, lead.id);
    addEvent(db, lead.id, req.user.id, 'nota', text ? `Seguimiento pedido por el gerente: ${text}` : 'El gerente quitó el pedido de seguimiento');
    res.json({ ok: true });
  });

  // ---------- Marketing: campañas a revisar y ficha de campaña ----------
  const monthOf = (d) => d.toISOString().slice(0, 7);
  // Semáforo por campaña con lo del mes en curso: dónde se está yendo el dinero sin traer leads buenos.
  app.get('/api/campaign-health', auth.requireRole('gerente', 'marketing', 'analista'), (req, res) => {
    const nowMs = Date.now(); const month = monthOf(new Date());
    const from = `${month}-01T00:00:00.000Z`;
    const camps = db.prepare("SELECT id, name FROM catalog_items WHERE kind = 'campana' AND active = 1").all();
    const budget = Object.fromEntries(db.prepare('SELECT campaign_id, amount FROM campaign_budgets WHERE month = ?').all(month).map((r) => [r.campaign_id, r.amount]));
    const stats = Object.fromEntries(db.prepare(`SELECT campaign AS key, COUNT(*) AS leads,
        SUM(COALESCE(profiled_at, quoted_at, won_at) IS NOT NULL) AS perfil FROM leads WHERE campaign IS NOT NULL AND created_at >= ? GROUP BY campaign`)
      .all(from).map((r) => [r.key, r]));
    const last = Object.fromEntries(db.prepare('SELECT campaign AS key, MAX(created_at) AS at FROM leads WHERE campaign IS NOT NULL GROUP BY campaign').all().map((r) => [r.key, r.at]));
    const reasons = {};
    db.prepare(`SELECT campaign AS key, COALESCE(decline_reason, 'Sin motivo') AS reason, COUNT(*) AS n FROM leads
      WHERE campaign IS NOT NULL AND status = 'declinado' AND created_at >= ? GROUP BY 1, 2`).all(new Date(nowMs - 90 * 86400e3).toISOString())
      .forEach((r) => { (reasons[r.key] ||= []).push(r); });
    const rows = camps.map((c) => {
      const st = stats[c.name] || { leads: 0, perfil: 0 };
      const inv = budget[c.id] || 0;
      const lastAt = last[c.name] || null;
      const days = lastAt ? Math.floor((nowMs - new Date(lastAt).getTime()) / 86400e3) : null;
      const rs = (reasons[c.name] || []).sort((a, b) => b.n - a.n);
      const decl = rs.reduce((t, r) => t + r.n, 0);
      return { id: c.id, key: c.name, inversion_mes: inv || null, leads_mes: st.leads, perfil_mes: st.perfil || 0, cplq_mes: inv && st.perfil ? inv / st.perfil : null,
        ultimo_lead: lastAt, dias_sin_leads: days, descarte_top: rs[0] ? { key: rs[0].reason, share: rs[0].n / decl, n: decl } : null };
    }).filter((r) => r.inversion_mes || r.leads_mes);
    const invTot = rows.reduce((t, r) => t + (r.inversion_mes || 0), 0);
    const perfTot = rows.filter((r) => r.inversion_mes).reduce((t, r) => t + r.perfil_mes, 0);
    const avg = invTot && perfTot ? invTot / perfTot : null;
    rows.forEach((r) => {
      const why = []; let status = 'green';
      if (r.inversion_mes && (r.dias_sin_leads == null || r.dias_sin_leads >= 7)) { status = 'red'; why.push(r.dias_sin_leads == null ? 'tiene inversión y nunca ha traído leads' : `tiene inversión y lleva ${r.dias_sin_leads} días sin traer leads`); }
      if (r.inversion_mes && r.leads_mes >= 5 && !r.perfil_mes) { status = 'red'; why.push(`${r.leads_mes} leads este mes y ninguno cumple perfil`); }
      if (r.cplq_mes && avg && r.cplq_mes > 2 * avg) { status = 'red'; why.push(`cada lead con perfil cuesta ${Math.round(r.cplq_mes / avg * 10) / 10} veces el promedio`); }
      if (r.leads_mes && !r.inversion_mes) { if (status === 'green') status = 'yellow'; why.push('trajo leads este mes y no tiene inversión capturada: sus costos salen en cero'); }
      if (r.descarte_top && r.descarte_top.n >= 4 && r.descarte_top.share >= 0.5) { if (status === 'green') status = 'yellow'; why.push(`${Math.round(r.descarte_top.share * 100)}% de sus descartes son por "${r.descarte_top.key}"`); }
      r.status = status; r.motivos = why;
    });
    const order = { red: 0, yellow: 1, green: 2 };
    rows.sort((a, b) => order[a.status] - order[b.status] || (b.inversion_mes || 0) - (a.inversion_mes || 0));
    res.json({ month, campaigns: rows, cplq_promedio: avg });
  });

  // Ficha de campaña: tendencia semanal, inversión contra leads por mes y lo que dicen sus leads (perfil rápido).
  app.get('/api/campaign-detail', auth.requireRole('gerente', 'marketing', 'analista'), (req, res) => {
    const name = String(req.query.name || '');
    const c = db.prepare("SELECT id, name, channel_id FROM catalog_items WHERE kind = 'campana' AND name = ?").get(name);
    if (!c) return res.status(404).json({ error: 'No existe esa campaña' });
    const since = new Date(Date.now() - 12 * 7 * 86400e3);
    const weekStart = (iso) => { const d = new Date(iso); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
    const leads = db.prepare('SELECT created_at, profiled_at, quoted_at, won_at, decision_maker, budget_status, start_window FROM leads WHERE campaign = ?').all(name);
    const weeks = new Map();
    for (let t = new Date(weekStart(since.toISOString())).getTime(); t <= Date.now(); t += 7 * 86400e3) weeks.set(new Date(t).toISOString().slice(0, 10), { week: new Date(t).toISOString().slice(0, 10), leads: 0, perfil: 0 });
    const months = new Map();
    const fit = (l) => Boolean(l.profiled_at || l.quoted_at || l.won_at);
    for (const l of leads) {
      const w = weeks.get(weekStart(l.created_at));
      if (w) { w.leads++; if (fit(l)) w.perfil++; }
      const m = l.created_at.slice(0, 7);
      const mm = months.get(m) || { month: m, leads: 0, perfil: 0, inversion: null };
      mm.leads++; if (fit(l)) mm.perfil++; months.set(m, mm);
    }
    for (const b of db.prepare('SELECT month, amount FROM campaign_budgets WHERE campaign_id = ?').all(c.id)) {
      const mm = months.get(b.month) || { month: b.month, leads: 0, perfil: 0, inversion: null };
      mm.inversion = b.amount; months.set(b.month, mm);
    }
    const perfilRapido = Object.fromEntries(Object.keys(QUICK_PROFILE).map((k) => {
      const answered = leads.filter((l) => l[k]);
      return [k, { label: QUICK_PROFILE[k].label, total: answered.length,
        options: Object.entries(QUICK_PROFILE[k].options).map(([v, t]) => ({ value: v, label: t, n: answered.filter((l) => l[k] === v).length })) }];
    }));
    res.json({ id: c.id, name: c.name, weeks: [...weeks.values()], months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 6), perfil_rapido: perfilRapido });
  });

  // Equipo hoy: una fila por vendedor con lo que requiere atención del gerente.
  const FIRST_TOUCH_HOURS = 2; const COLD_DAYS = 15;
  app.get('/api/team', auth.requireRole('gerente', 'analista'), (req, res) => {
    const nowMs = Date.now();
    const sellers = db.prepare("SELECT id, name, can_assign FROM users WHERE role = 'vendedor' AND active = 1 ORDER BY name").all();
    // Vendedores que también asignan: cuántos leads repartieron en 7 días y cuántos se quedaron ellos (para que se note si se quedan de más).
    const assignEvents = db.prepare(`SELECT user_id, content FROM lead_events WHERE type = 'asignacion' AND content LIKE 'Asignado%' AND created_at >= ?`)
      .all(new Date(nowMs - 7 * 86400e3).toISOString());
    const leads = db.prepare(`SELECT * FROM leads WHERE assigned_to IS NOT NULL AND (status IN ('nuevo', 'nuevo_perfil', 'cotizando')
      OR (status = 'declinado' AND recontact_at IS NOT NULL) OR status = 'vendido')`).all();
    const touches = Object.fromEntries(db.prepare('SELECT user_id, COUNT(*) AS n FROM lead_touches WHERE created_at >= ? GROUP BY user_id')
      .all(new Date(nowMs - 7 * 86400e3).toISOString()).map((r) => [r.user_id, r.n]));
    // Datos incompletos (últimos 90 días): sin ellos los reportes engañan.
    const since90 = new Date(nowMs - 90 * 86400e3).toISOString();
    const incomplete = db.prepare(`SELECT id, name, phone, email, status, assigned_to FROM leads WHERE assigned_to IS NOT NULL AND updated_at >= ? AND (
        (status = 'vendido' AND COALESCE(sale_amount, 0) = 0) OR (status = 'cotizando' AND COALESCE(quote_amount, 0) = 0)
        OR (status = 'declinado' AND decline_reason IS NULL))`).all(since90);
    const MISSING = { vendido: 'venta sin monto', cotizando: 'cotización sin monto', declinado: 'declinado sin motivo' };
    // Pedidos del gerente de los últimos 30 días: cuántos se atendieron en menos de 24 h y cuáles siguen abiertos.
    const reqs = db.prepare(`SELECT r.*, l.name, l.phone, l.email FROM manager_requests r JOIN leads l ON l.id = r.lead_id
      WHERE r.cancelled = 0 AND (r.created_at >= ? OR r.done_at IS NULL)`).all(new Date(nowMs - 30 * 86400e3).toISOString());
    const DAY_MS = 86400e3;
    const rows = sellers.map((u) => {
      const mine = leads.filter((l) => l.assigned_to === u.id);
      const active = mine.filter((l) => ['nuevo', 'nuevo_perfil', 'cotizando'].includes(l.status));
      const r = { id: u.id, name: u.name, en_curso: active.length, vencidos: 0, hoy: 0, sin_primer_toque: 0, frias: 0, acuerdos_vencidos: 0,
        pedidos: 0, en_cotizacion: 0, toques_7d: touches[u.id] || 0, alertas: [] };
      for (const l of mine) {
        const a = FOLLOWUP.nextAction(l);
        const d = a ? FOLLOWUP.dayDiff(a.due) : null;
        const alert = (why) => r.alertas.push({ id: l.id, name: l.name || l.phone || l.email, why });
        if (d != null && d < 0) r.vencidos++;
        if (d === 0) r.hoy++;
        if (l.status === 'nuevo' && !l.touch_count && nowMs - new Date(l.created_at).getTime() > FIRST_TOUCH_HOURS * 3600e3) { r.sin_primer_toque++; alert(`sin primer toque desde hace ${Math.round((nowMs - new Date(l.created_at).getTime()) / 3600e3)} h`); }
        if (l.status === 'cotizando') {
          r.en_cotizacion += l.quote_amount || 0;
          const last = new Date(l.last_touch_at || l.quoted_at || l.updated_at).getTime();
          if (nowMs - last > COLD_DAYS * 86400e3) { r.frias++; alert(`cotización fría: ${Math.round((nowMs - last) / 86400e3)} días sin contacto`); }
        }
        if (l.next_step_at && new Date(l.next_step_at).getTime() < nowMs - 3600e3) { r.acuerdos_vencidos++; alert(`acuerdo vencido: ${l.next_step || 'dar seguimiento'}`); }
        if (l.manager_request) r.pedidos++;
        if (d != null && d < -2 && !r.alertas.some((x) => x.id === l.id)) alert(`${a.label}: ${-d} días tarde`);
      }
      r.alertas = r.alertas.slice(0, 8);
      r.incompletos = incomplete.filter((l) => l.assigned_to === u.id).map((l) => ({ id: l.id, name: l.name || l.phone || l.email, why: MISSING[l.status] }));
      const myReqs = reqs.filter((q) => q.seller_id === u.id);
      const closed = myReqs.filter((q) => q.done_at);
      r.pedidos_a_tiempo = closed.length ? closed.filter((q) => new Date(q.done_at) - new Date(q.created_at) <= DAY_MS).length / closed.length : null;
      r.pedidos_abiertos = myReqs.filter((q) => !q.done_at).map((q) => ({ id: q.lead_id, name: q.name || q.phone || q.email, text: q.text,
        horas: Math.round((nowMs - new Date(q.created_at).getTime()) / 3600e3) }));
      r.pedidos_tarde = r.pedidos_abiertos.filter((q) => q.horas > 24).length;
      r.asigna = Boolean(u.can_assign);
      if (r.asigna) {
        const made = assignEvents.filter((e) => e.user_id === u.id);
        r.asigno_7d = made.length;
        r.autoasignados_7d = made.filter((e) => e.content === `Asignado a ${u.name}`).length;
      }
      return r;
    });
    // Las cotizaciones vivas más grandes del equipo: los tratos que el gerente debe empujar en persona.
    const names = Object.fromEntries(sellers.map((u) => [u.id, u.name]));
    const top = leads.filter((l) => l.status === 'cotizando' && l.quote_amount > 0).sort((a, b) => b.quote_amount - a.quote_amount).slice(0, 5)
      .map((l) => {
        const a = FOLLOWUP.nextAction(l);
        const last = new Date(l.last_touch_at || l.quoted_at || l.updated_at).getTime();
        return { id: l.id, name: l.name || l.phone || l.email, seller: names[l.assigned_to] || '—', amount: l.quote_amount,
          dias_sin_contacto: Math.floor((nowMs - last) / DAY_MS), siguiente: l.next_step || a?.label || null,
          vence: a ? FOLLOWUP.dayDiff(a.due) : null, pedido: l.manager_request };
      });
    const unassigned = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE assigned_to IS NULL AND status IN ('nuevo', 'nuevo_perfil', 'cotizando')").get().n;
    res.json({ sellers: rows, unassigned, top_quotes: top, first_touch_hours: FIRST_TOUCH_HOURS, cold_days: COLD_DAYS });
  });

  app.patch('/api/leads/:id', auth.requireUser, (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    let body = req.body || {};
    // Si la ficha se abrió antes de que alguien más cambiara el lead, no se pisa lo nuevo con datos viejos.
    if (body.base_updated_at && body.base_updated_at !== lead.updated_at) {
      return res.status(409).json({ error: 'Alguien más cambió este lead mientras lo tenías abierto. Se recargó con los datos nuevos; revisa y vuelve a guardar.', stale: true });
    }
    if (!canEdit(req.user, lead)) {
      // Sin permiso de ventas solo se cambia el origen (marketing y quien asigna) y el vendedor (quien asigna).
      const allowed = [...(canEditOrigin(req.user) ? ORIGIN_FIELDS : []), ...(canReassign(req.user) ? ['assigned_to'] : [])];
      if (!allowed.length) return res.status(403).json({ error: 'No tienes permiso para editar este lead' });
      body = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k) || k === 'base_updated_at'));
    }
    const err = updateLead(req.user, lead, body);
    if (err) return res.status(err.status).json({ error: err.error });
    res.json({ ok: true });
  });

  // Perfil rápido, próximo paso acordado y fin de campaña. Solo cambia lo que viene en b.
  function saveExtras(user, lead, b, status) {
    const set = {};
    for (const k of Object.keys(QUICK_PROFILE)) if (b[k] !== undefined) set[k] = b[k] || null;
    if (b.campaign_end !== undefined) set.campaign_end = b.campaign_end || null;
    if (b.next_step !== undefined) set.next_step = String(b.next_step || '').trim().slice(0, 300) || null;
    if (b.next_step_at !== undefined) set.next_step_at = b.next_step_at ? new Date(b.next_step_at).toISOString() : null;
    // Un lead cerrado no tiene próximo paso pendiente.
    if (['declinado', 'vendido'].includes(status)) { set.next_step = null; set.next_step_at = null; }
    const keys = Object.keys(set);
    if (!keys.length) return;
    db.prepare(`UPDATE leads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), lead.id);
    const answers = Object.keys(QUICK_PROFILE).filter((k) => set[k] && set[k] !== lead[k]).map((k) => QUICK_PROFILE[k].options[set[k]]);
    if (answers.length) addEvent(db, lead.id, user.id, 'perfil', `Perfil: ${answers.join(' · ')}`);
    if (set.campaign_end && set.campaign_end !== lead.campaign_end) addEvent(db, lead.id, user.id, 'estado', `La campaña termina el ${set.campaign_end}`);
    if (set.next_step_at) {
      const when = new Date(set.next_step_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });
      addEvent(db, lead.id, user.id, 'estado', `Próximo paso acordado para el ${when}`);
    }
  }

  // Aplica cambios a un lead (desde la ficha, el tablero o un toque) y registra los hitos del embudo.
  // Devuelve { status, error } si algo no es válido.
  function updateLead(user, lead, b) {
    let next; let channelId; let productId; let campaign; let saleAmount; let quoteAmount;
    try {
      quoteAmount = b.quote_amount !== undefined ? money(b.quote_amount) : lead.quote_amount;
      if (b.recontact_at && !isDate(b.recontact_at)) throw new Error('Fecha inválida');
      if (b.campaign_end && !isDate(b.campaign_end)) throw new Error('Fecha de fin de campaña inválida');
      if (b.next_step_at && !isDateTime(b.next_step_at)) throw new Error('Fecha del próximo paso inválida');
      for (const k of Object.keys(QUICK_PROFILE)) {
        if (b[k] && !Object.hasOwn(QUICK_PROFILE[k].options, String(b[k]))) throw new Error('Respuesta de perfil inválida');
      }
      campaign = b.campaign !== undefined ? campaignName(db, b.campaign) : lead.campaign;
      saleAmount = b.sale_amount !== undefined ? money(b.sale_amount) : lead.sale_amount;
      next = resolveStatusProfile(lead, { status: b.status, profile: b.profile });
      channelId = catalogId('canal', b.channel_id) ?? (b.channel_id === undefined ? lead.channel_id : null);
      productId = catalogId('producto', b.product_id) ?? (b.product_id === undefined ? lead.product_id : null);
    } catch (err) {
      return { status: 400, error: err.message };
    }
    // Cantidad (piezas, meses…) y precio fijo: con un producto de precio fijo el monto es precio × cantidad y el vendedor
    // no lo puede cambiar, para evitar equivocaciones. El gerente sí puede corregirlo.
    let quantity = lead.quantity;
    if (b.quantity !== undefined) {
      if (b.quantity === null || b.quantity === '') quantity = null;
      else {
        quantity = Number(String(b.quantity).replace(',', '.'));
        if (!(quantity > 0) || quantity > 100000) return { status: 400, error: 'Cantidad inválida' };
      }
    }
    const product = productId ? db.prepare('SELECT price, fixed_price FROM catalog_items WHERE id = ?').get(productId) : null;
    if (product?.fixed_price && product.price > 0 && user.role !== 'gerente') {
      const total = Math.round(product.price * (quantity || 1) * 100) / 100;
      const settingQuote = b.quote_amount !== undefined || b.quantity !== undefined || b.product_id !== undefined || (next.status === 'cotizando' && lead.status !== 'cotizando');
      const settingSale = b.sale_amount !== undefined || b.quantity !== undefined || b.product_id !== undefined || (next.status === 'vendido' && lead.status !== 'vendido');
      if (settingQuote && ['cotizando', 'vendido'].includes(next.status)) quoteAmount = total;
      if (settingSale && next.status === 'vendido') saleAmount = total;
    }
    // Sin montos no hay pipeline, venta esperada, ticket ni descuento: son obligatorios al cotizar y al vender.
    if (next.status === 'cotizando' && lead.status !== 'cotizando' && !(quoteAmount > 0)) {
      return { status: 400, error: 'Escribe el monto de la cotización' };
    }
    if (next.status === 'vendido' && lead.status !== 'vendido' && !(saleAmount > 0)) {
      return { status: 400, error: 'Escribe el monto de la venta' };
    }

    let assigned = lead.assigned_to;
    if (b.assigned_to !== undefined) {
      if (!canReassign(user)) return { status: 403, error: 'Solo quien asigna leads o el gerente pueden asignarlos' };
      assigned = b.assigned_to ? Number(b.assigned_to) : null;
      if (assigned && !db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(assigned)) {
        return { status: 400, error: 'Usuario inválido' };
      }
    }

    const field = (k) => (b[k] !== undefined ? (String(b[k] ?? '').trim() || null) : lead[k]);
    const phone = field('phone');
    const declineReason = next.status === 'declinado' ? field('decline_reason') : null;
    // La fecha para volver a contactar solo aplica a leads declinados.
    const recontactAt = next.status === 'declinado' ? (b.recontact_at !== undefined ? (b.recontact_at || null) : lead.recontact_at) : null;

    // Hitos del embudo: se fijan la primera vez que el lead llega a cada paso.
    const ts = now();
    const m = {
      assigned_at: assigned !== lead.assigned_to ? (assigned ? ts : null) : lead.assigned_at,
      contacted_at: b.contacted === false && !lead.quoted_at && !lead.won_at ? null : lead.contacted_at,
      profiled_at: lead.profiled_at, quoted_at: lead.quoted_at, won_at: lead.won_at,
      declined_at: next.status === 'declinado' && lead.status !== 'declinado' ? ts : lead.declined_at,
    };
    if (b.contacted === true && !m.contacted_at) m.contacted_at = ts;
    if (next.profile === 'cumple' && !m.profiled_at) m.profiled_at = ts;
    if (['cotizando', 'vendido'].includes(next.status)) {
      m.quoted_at ||= ts;
      m.contacted_at ||= ts; // si ya cotizó, el cliente contestó
    }
    if (next.status === 'vendido') { m.won_at ||= ts; m.quoted_at ||= ts; }

    // En qué toque respondió y en qué toque se cotizó (si ya hubo toques registrados).
    const touchNow = lead.touch_count > 0 ? lead.touch_count : null;
    let responseTouch = m.contacted_at ? lead.response_touch : null;
    if (m.contacted_at && !lead.contacted_at && !responseTouch) responseTouch = touchNow;
    const quoteTouch = m.quoted_at && !lead.quoted_at ? touchNow : lead.quote_touch;

    db.prepare(`UPDATE leads SET name = ?, phone = ?, phone_key = ?, email = ?, campaign = ?, status = ?, profile = ?,
      decline_reason = ?, assigned_to = ?, channel_id = ?, product_id = ?, assigned_at = ?, contacted_at = ?,
      profiled_at = ?, quoted_at = ?, won_at = ?, declined_at = ?, sale_amount = ?, response_touch = ?, quote_touch = ?,
      quote_amount = ?, recontact_at = ?, quantity = ?, updated_at = ? WHERE id = ?`)
      .run(field('name'), phone, phoneKey(phone), field('email'), campaign, next.status, next.profile,
        declineReason, assigned, channelId, productId, m.assigned_at, m.contacted_at,
        m.profiled_at, m.quoted_at, m.won_at, m.declined_at, saleAmount, responseTouch, quoteTouch,
        quoteAmount, recontactAt, quantity, ts, lead.id);
    // Cambio de etapa a mano (o reactivación): la cuenta de seguimientos sin respuesta empieza de nuevo.
    if (next.status !== lead.status) db.prepare('UPDATE leads SET silent_streak = 0 WHERE id = ?').run(lead.id);

    if (quoteAmount !== lead.quote_amount && quoteAmount != null) {
      addEvent(db, lead.id, user.id, 'estado', `Monto cotizado: $${quoteAmount.toLocaleString('es-MX')}`);
    }
    if (recontactAt && recontactAt !== lead.recontact_at) addEvent(db, lead.id, user.id, 'estado', `Volver a contactar el ${recontactAt}`);
    saveExtras(user, lead, b, next.status);

    if (campaign !== lead.campaign) addEvent(db, lead.id, user.id, 'perfil', `Campaña: ${campaign || 'ninguna'}`);
    if (saleAmount !== lead.sale_amount && saleAmount != null) {
      addEvent(db, lead.id, user.id, 'estado', `Monto de venta: $${saleAmount.toLocaleString('es-MX')}`);
    }

    if (m.contacted_at && !lead.contacted_at) addEvent(db, lead.id, user.id, 'contacto', 'El cliente contestó');
    if (!m.contacted_at && lead.contacted_at) addEvent(db, lead.id, user.id, 'contacto', 'Se desmarcó "El cliente contestó"');

    const itemName = (id) => (id ? db.prepare('SELECT name FROM catalog_items WHERE id = ?').get(id).name : 'ninguno');
    if (productId !== lead.product_id) addEvent(db, lead.id, user.id, 'perfil', `Producto: ${itemName(productId)}`);
    if (channelId !== lead.channel_id) addEvent(db, lead.id, user.id, 'perfil', `Se enteró por: ${itemName(channelId)}`);

    if (next.status !== lead.status) {
      addEvent(db, lead.id, user.id, 'estado',
        `${LABELS[lead.status]} → ${LABELS[next.status]}${declineReason ? ` (motivo: ${declineReason})` : ''}`);
    }
    if (next.profile !== lead.profile) addEvent(db, lead.id, user.id, 'perfil', `Perfil: ${LABELS[next.profile]}`);
    if (assigned !== lead.assigned_to) {
      const name = assigned ? db.prepare('SELECT name FROM users WHERE id = ?').get(assigned).name : 'nadie';
      addEvent(db, lead.id, user.id, 'asignacion', `Asignado a ${name}`);
    }
    return null;
  }

  // ---------- Toques ----------
  // Cada toque es un intento de contacto; su resultado mueve al lead de etapa.
  app.get('/api/leads/:id/touches', auth.requireUser, (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    res.json(db.prepare(`SELECT t.*, u.name AS user_name FROM lead_touches t LEFT JOIN users u ON u.id = t.user_id
      WHERE t.lead_id = ? ORDER BY t.n`).all(lead.id));
  });

  app.post('/api/leads/:id/touches', auth.requireUser, (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    if (!canTouch(req.user, lead)) return res.status(403).json({ error: 'Los toques los registra el vendedor que atiende el lead' });
    const { channel, outcome } = req.body || {};
    // Doble clic o reintento por mala conexión: el mismo request_id no registra el toque dos veces.
    const requestId = req.body?.request_id ? String(req.body.request_id).slice(0, 80) : null;
    if (requestId) {
      const dup = db.prepare('SELECT n FROM lead_touches WHERE request_id = ?').get(requestId);
      if (dup) return res.status(200).json({ ok: true, n: dup.n, duplicate: true, auto_declined: false });
    }
    if (!TOUCH_CHANNELS.includes(channel)) return res.status(400).json({ error: 'Indica por qué medio fue el toque' });
    const allowed = OUTCOMES_BY_STATUS[lead.status];
    if (!allowed) return res.status(409).json({ error: 'Este lead ya está cerrado; reábrelo para registrar más toques' });
    if (!allowed.includes(outcome)) return res.status(400).json({ error: 'Ese resultado no aplica en esta etapa' });

    // Postventa: el resultado tiene que corresponder a lo que toca (referidos o renovación).
    if (lead.status === 'vendido') {
      const kind = FOLLOWUP.nextAction(lead)?.kind;
      if (outcome === 'referidos' && kind !== 'postventa') return res.status(400).json({ error: 'Ya se pidieron referidos a este cliente' });
      if (['renovo', 'no_renueva'].includes(outcome) && !lead.campaign_end) return res.status(400).json({ error: 'Primero captura cuándo termina la campaña' });
      if (['renovo', 'no_renueva'].includes(outcome) && kind !== 'renovacion') return res.status(400).json({ error: 'Todavía no toca la renovación de este cliente' });
      if (req.body.campaign_end && !isDate(req.body.campaign_end)) return res.status(400).json({ error: 'Fecha de fin de campaña inválida' });
    }
    let renewalAmount = null;
    try { renewalAmount = outcome === 'renovo' ? money(req.body.renewal_amount) : null; } catch (e) { return res.status(400).json({ error: e.message }); }

    const changes = {};
    if (outcome !== 'sin_respuesta' && lead.status !== 'vendido') changes.contacted = true;
    // Lo que se acordó y cuándo (opcional). Cada toque reemplaza el acuerdo anterior.
    changes.next_step = req.body.next_step ?? null;
    changes.next_step_at = req.body.next_step_at || null;
    for (const k of Object.keys(QUICK_PROFILE)) if (req.body[k] !== undefined) changes[k] = req.body[k];
    if (outcome === 'vendido' && req.body.campaign_end) changes.campaign_end = req.body.campaign_end;
    if (outcome === 'cumple') changes.profile = 'cumple';
    if (outcome === 'no_cumple') Object.assign(changes, { profile: 'no_cumple', status: 'declinado', decline_reason: 'No cumple perfil' });
    if (outcome === 'cotizado') {
      changes.status = 'cotizando';
      if (req.body.quote_amount != null && req.body.quote_amount !== '') changes.quote_amount = req.body.quote_amount;
      if (lead.profile === 'sin_perfilar') changes.profile = 'cumple';
    }
    if (outcome === 'vendido') Object.assign(changes, { status: 'vendido', sale_amount: req.body.sale_amount ?? undefined });
    // Al cotizar o vender se puede elegir el producto y la cantidad (con precio fijo, el monto sale de ahí).
    if (['cotizado', 'vendido'].includes(outcome)) {
      if (req.body.product_id !== undefined && req.body.product_id !== '') changes.product_id = req.body.product_id;
      if (req.body.quantity !== undefined && req.body.quantity !== '') changes.quantity = req.body.quantity;
    }
    if (outcome === 'rechazo') {
      if (!DECLINE_REASONS.includes(req.body.decline_reason)) return res.status(400).json({ error: 'Elige el motivo' });
      Object.assign(changes, { status: 'declinado', decline_reason: req.body.decline_reason });
      if (req.body.decline_reason === POSTPONED && req.body.recontact_at) changes.recontact_at = req.body.recontact_at;
    }
    const n = (lead.touch_count || 0) + 1;
    // Cinco toques sin que el cliente haya respondido nunca: se declina solo.
    const neverAnswered = outcome === 'sin_respuesta' && !lead.contacted_at && n === MAX_TOUCHES;
    // Ya había contestado y lleva SILENT_MAX seguimientos seguidos sin respuesta: también se declina solo.
    const streak = outcome === 'sin_respuesta' ? (lead.silent_streak || 0) + 1 : 0;
    const wentSilent = outcome === 'sin_respuesta' && Boolean(lead.contacted_at) && streak >= FOLLOWUP.SILENT_MAX;
    const autoDecline = neverAnswered || wentSilent;
    if (autoDecline) Object.assign(changes, { status: 'declinado', decline_reason: neverAnswered ? NO_ANSWER : GHOSTED });

    const ts = now();
    db.prepare('INSERT INTO lead_touches (lead_id, n, user_id, channel, outcome, created_at, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(lead.id, n, req.user.id, channel, outcome, ts, requestId);
    db.prepare('UPDATE leads SET touch_count = ?, silent_streak = ?, last_touch_at = ?, first_touch_at = COALESCE(first_touch_at, ?), updated_at = ? WHERE id = ?')
      .run(n, streak, ts, ts, ts, lead.id);
    addEvent(db, lead.id, req.user.id, 'toque', `Toque ${n} por ${LABELS[channel]}: ${TOUCH_OUTCOMES[outcome]}`);
    const note = String(req.body.note || '').trim();
    if (note) addEvent(db, lead.id, req.user.id, 'nota', note.slice(0, 5000));
    if (lead.manager_request) {
      db.prepare('UPDATE leads SET manager_request = NULL, manager_request_at = NULL WHERE id = ?').run(lead.id);
      db.prepare('UPDATE manager_requests SET done_at = ? WHERE lead_id = ? AND done_at IS NULL').run(ts, lead.id);
      addEvent(db, lead.id, req.user.id, 'estado', 'Atendió el seguimiento que pidió el gerente');
    }
    if (outcome === 'referidos') db.prepare('UPDATE leads SET postsale_at = ? WHERE id = ?').run(ts, lead.id);
    if (outcome === 'no_renueva') db.prepare('UPDATE leads SET renewal_for = campaign_end WHERE id = ?').run(lead.id);
    if (outcome === 'renovo') {
      // Renovó: se registra el monto y, si viene, el nuevo fin de campaña (arranca otro ciclo de renovación).
      const amount = renewalAmount;
      db.prepare(`UPDATE leads SET renewal_for = campaign_end, renewal_amount = renewal_amount + ?,
        campaign_end = COALESCE(?, campaign_end) WHERE id = ?`).run(amount || 0, req.body.campaign_end || null, lead.id);
      addEvent(db, lead.id, req.user.id, 'estado', `Renovó${amount ? ` por $${amount.toLocaleString('es-MX')}` : ''}${req.body.campaign_end ? `; la campaña ahora termina el ${req.body.campaign_end}` : ''}`);
    }

    const err = updateLead(req.user, getLead(req, lead.id), changes);
    if (err) return res.status(err.status).json({ error: err.error });
    // El monto queda en el toque con su fecha: los reportes por periodo suman cotizaciones, ventas y renovaciones del periodo.
    const after = db.prepare('SELECT quote_amount, sale_amount FROM leads WHERE id = ?').get(lead.id);
    const touchAmount = outcome === 'cotizado' ? after.quote_amount : outcome === 'vendido' ? after.sale_amount : outcome === 'renovo' ? renewalAmount : null;
    if (touchAmount != null) db.prepare('UPDATE lead_touches SET amount = ? WHERE lead_id = ? AND n = ?').run(touchAmount, lead.id, n);
    res.status(201).json({ ok: true, n, auto_declined: autoDecline, reason: autoDecline ? changes.decline_reason : null });
  });

  app.post('/api/leads/:id/notes', auth.requireUser, (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    if (!canEdit(req.user, lead) && !canEditOrigin(req.user)) return res.status(403).json({ error: 'No tienes permiso' });
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'La nota está vacía' });
    addEvent(db, lead.id, req.user.id, 'nota', content.slice(0, 5000));
    db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(now(), lead.id);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/leads/:id', auth.requireRole('gerente'), (req, res) => {
    const r = db.prepare('DELETE FROM leads WHERE id = ?').run(Number(req.params.id));
    res.status(r.changes ? 200 : 404).json({ ok: r.changes > 0 });
  });

  // ---------- Resumen ----------
  app.get('/api/stats', auth.requireRole('gerente', 'marketing', 'vendedor', 'analista'), (req, res) => {
    const { sql, params } = leadFilters(req);
    const group = (col) => db.prepare(`SELECT ${col} AS key, COUNT(*) AS n FROM leads l ${sql} GROUP BY ${col}`).all(...params);
    const bySeller = db.prepare(`SELECT COALESCE(u.name, 'Sin asignar') AS key, COUNT(*) AS n,
        SUM(l.status = 'vendido') AS vendidos, SUM(l.status = 'cotizando') AS cotizando
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ${sql} GROUP BY l.assigned_to ORDER BY n DESC`).all(...params);
    const byCampaign = db.prepare(`SELECT COALESCE(l.campaign, 'Sin campaña') AS key, COUNT(*) AS n,
        SUM(l.profile = 'cumple') AS cumple, SUM(l.status = 'vendido') AS vendidos
      FROM leads l ${sql} GROUP BY l.campaign ORDER BY n DESC LIMIT 20`).all(...params);
    const byItem = (col, empty) => db.prepare(`SELECT COALESCE(c.name, '${empty}') AS key, COUNT(*) AS n,
        SUM(l.profile = 'cumple') AS cumple, SUM(l.status = 'vendido') AS vendidos
      FROM leads l LEFT JOIN catalog_items c ON c.id = ${col} ${sql} GROUP BY ${col} ORDER BY n DESC`).all(...params);
    // Cruces etapa × dimensión para las barras de batería del Resumen.
    const byStage = (keyExpr, join) => db.prepare(`SELECT ${keyExpr} AS key, ${STAGE_SQL} AS stage, COUNT(*) AS n
      FROM leads l ${join} ${sql} GROUP BY 1, 2`).all(...params);
    const since = new Date(Date.now() - 29 * 86400e3).toISOString().slice(0, 10);
    const byDay = db.prepare(`SELECT substr(l.created_at, 1, 10) AS day, COUNT(*) AS n FROM leads l
      ${sql ? `${sql} AND` : 'WHERE'} l.created_at >= ? GROUP BY 1 ORDER BY 1`).all(...params, since);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM leads l ${sql}`).get(...params).n;

    // Embudo acumulado: cada paso cuenta a quien llegó ahí o más adelante, así nunca crece hacia abajo.
    const funnelCols = `COUNT(*) AS recibidos,
      COALESCE(SUM(COALESCE(l.contacted_at, l.profiled_at, l.quoted_at, l.won_at) IS NOT NULL), 0) AS contactados,
      COALESCE(SUM(COALESCE(l.profiled_at, l.quoted_at, l.won_at) IS NOT NULL), 0) AS perfilados,
      COALESCE(SUM(COALESCE(l.quoted_at, l.won_at) IS NOT NULL), 0) AS cotizados,
      COALESCE(SUM(l.won_at IS NOT NULL), 0) AS cerrados,
      COALESCE(SUM(l.status = 'declinado'), 0) AS declinados,
      COALESCE(SUM(l.sale_amount), 0) AS ingresos,
      COALESCE(SUM(CASE WHEN l.status = 'cotizando' THEN l.quote_amount END), 0) AS en_cotizacion,
      COALESCE(SUM(l.status = 'cotizando'), 0) AS cotizando_ahora,
      AVG(CASE WHEN l.won_at IS NOT NULL THEN julianday(l.won_at) - julianday(l.created_at) END) AS dias_cierre,
      COALESCE(SUM(l.campaign IS NULL AND ${CHANNEL_EXPR} IS NULL), 0) AS sin_origen`;
    const funnel = db.prepare(`SELECT ${funnelCols} FROM leads l ${sql}`).get(...params);
    // Por campaña, con su inversión para sacar costo por lead, por cotización y por cierre.
    const campaignFunnel = db.prepare(`SELECT COALESCE(l.campaign, 'Sin campaña') AS key, MAX(cp.id) AS campaign_id, ${funnelCols}
      FROM leads l LEFT JOIN catalog_items cp ON cp.kind = 'campana' AND cp.name = l.campaign
      ${sql} GROUP BY 1 ORDER BY cerrados DESC, recibidos DESC`).all(...params);
    // Inversión del periodo: suma de los meses que toca el filtro. Sin inversión mensual se usa el total (solo sin periodo).
    const fromM = req.query.from ? String(req.query.from).slice(0, 7) : '0000-00';
    const toM = req.query.to ? new Date(new Date(String(req.query.to)).getTime() - 1).toISOString().slice(0, 7) : '9999-99';
    const monthly = db.prepare('SELECT campaign_id, month, amount FROM campaign_budgets').all();
    campaignFunnel.forEach((r) => {
      const rows = monthly.filter((b) => b.campaign_id === r.campaign_id);
      if (rows.length) {
        r.inversion = rows.filter((b) => b.month >= fromM && b.month <= toM).reduce((t, b) => t + b.amount, 0) || null;
        r.inversion_mensual = true;
      } else {
        const total = r.campaign_id ? db.prepare('SELECT budget FROM catalog_items WHERE id = ?').get(r.campaign_id).budget : null;
        r.inversion = req.query.from || req.query.to ? null : total;
        r.inversion_mensual = false;
        r.falta_inversion_mes = Boolean(total && (req.query.from || req.query.to));
      }
    });
    // Por anuncio (utm_content): qué creativo trae leads que cierran.
    const adFunnel = db.prepare(`SELECT l.utm_content AS key, GROUP_CONCAT(DISTINCT l.campaign) AS campaign, ${funnelCols} FROM leads l
      ${sql ? `${sql} AND` : 'WHERE'} l.utm_content IS NOT NULL GROUP BY 1 ORDER BY cerrados DESC, recibidos DESC LIMIT 30`).all(...params);
    // Eficiencia por vendedor: lo que recibe, cuántos contestan, cotiza y cierra, y horas promedio hasta que el cliente contesta.
    const sellerFunnel = db.prepare(`SELECT l.assigned_to AS id, COALESCE(u.name, 'Sin asignar') AS key, ${funnelCols},
      AVG(CASE WHEN l.contacted_at IS NOT NULL THEN (julianday(l.contacted_at) - julianday(l.created_at)) * 24 END) AS horas_contacto,
      AVG(CASE WHEN l.first_touch_at IS NOT NULL THEN (julianday(l.first_touch_at) - julianday(l.created_at)) * 24 END) AS horas_primer_toque,
      AVG(l.response_touch) AS toques_respuesta, AVG(l.quote_touch) AS toques_cotizacion,
      AVG(CASE WHEN l.won_at IS NOT NULL AND l.sale_amount > 0 THEN l.sale_amount END) AS ticket,
      AVG(CASE WHEN l.won_at IS NOT NULL AND l.quote_amount > 0 AND l.sale_amount > 0 THEN (l.quote_amount - l.sale_amount) / l.quote_amount END) AS descuento
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ${sql} GROUP BY l.assigned_to
      ORDER BY l.assigned_to IS NULL, cerrados DESC, recibidos DESC`).all(...params);

    // Toques: en qué toque responden, en qué toque se cotiza, por qué se pierden y qué toques están vencidos.
    const where = (cond) => `${sql ? `${sql} AND` : 'WHERE'} ${cond}`;
    const byTouch = (col) => db.prepare(`SELECT l.${col} AS n, COUNT(*) AS c FROM leads l ${where(`l.${col} IS NOT NULL`)}
      GROUP BY 1 ORDER BY 1`).all(...params);
    const touches = {
      response: byTouch('response_touch'),
      quote: byTouch('quote_touch'),
      noAnswer: db.prepare(`SELECT COUNT(*) AS n FROM leads l ${where('l.decline_reason = ?')}`).get(...params, NO_ANSWER).n,
      declineReasons: db.prepare(`SELECT COALESCE(l.decline_reason, 'Sin motivo') AS key, COUNT(*) AS n FROM leads l
        ${where("l.status = 'declinado'")} GROUP BY 1 ORDER BY n DESC`).all(...params),
      ...pendingTouches(db.prepare(`SELECT l.* FROM leads l ${where("l.status IN ('nuevo', 'nuevo_perfil', 'cotizando')")}`).all(...params)),
      speed: db.prepare(`SELECT AVG((julianday(l.first_touch_at) - julianday(l.created_at)) * 24) AS h FROM leads l
        ${where('l.first_touch_at IS NOT NULL')}`).get(...params).h,
    };
    // Por qué se descartan los leads de cada campaña y de cada anuncio (retroalimentación de calidad para marketing).
    const reasonsBy = (keyExpr) => {
      const m = {};
      db.prepare(`SELECT ${keyExpr} AS key, COALESCE(l.decline_reason, 'Sin motivo') AS reason, COUNT(*) AS n FROM leads l
        ${where("l.status = 'declinado'")} GROUP BY 1, 2 ORDER BY n DESC`).all(...params)
        .forEach((r) => { (m[r.key] ||= []).push({ key: r.reason, n: r.n }); });
      return m;
    };
    const campReasons = reasonsBy("COALESCE(l.campaign, 'Sin campaña')");
    campaignFunnel.forEach((r) => { r.descartes = campReasons[r.key] || []; });
    const adReasons = reasonsBy('l.utm_content');
    adFunnel.forEach((r) => { r.descartes = adReasons[r.key] || []; });
    // Actividad de la última semana (toques registrados) y por qué pierde cada vendedor.
    const weekTouches = Object.fromEntries(db.prepare('SELECT user_id, COUNT(*) AS n FROM lead_touches WHERE created_at >= ? GROUP BY user_id')
      .all(new Date(Date.now() - 7 * 86400e3).toISOString()).map((r) => [r.user_id, r.n]));
    const sellerReasons = reasonsBy('l.assigned_to');
    sellerFunnel.forEach((r) => { r.toques_7d = r.id ? weekTouches[r.id] || 0 : null; r.pierde_por = sellerReasons[r.id] || []; });
    sellerFunnel.forEach((r) => { r.toques_vencidos = touches.overdueBySeller[r.id ?? 'none'] || 0; });
    // Audiencias para remarketing con los filtros actuales (los que nunca contestaron no se incluyen).
    const audiences = Object.fromEntries(Object.entries(AUDIENCES).map(([k, [cond, extra]]) => [k,
      db.prepare(`SELECT COUNT(*) AS n FROM leads l ${where(cond)}`).get(...params, ...extra).n]));
    // Al vendedor no se le muestra la inversión de marketing.
    if (req.user.role === 'vendedor') campaignFunnel.forEach((r) => { r.inversion = null; });
    // Al vendedor: el promedio del equipo con los mismos filtros, sin nombres, para compararse. Con un solo vendedor no aplica.
    let team = null;
    if (req.user.role === 'vendedor') {
      const all = leadFilters({ user: { role: 'gerente' }, query: { ...req.query, assigned: undefined } });
      const t = db.prepare(`SELECT COUNT(DISTINCT l.assigned_to) AS vendedores, COUNT(*) AS recibidos,
          COALESCE(SUM(COALESCE(l.quoted_at, l.won_at) IS NOT NULL), 0) AS cotizados, COALESCE(SUM(l.won_at IS NOT NULL), 0) AS cerrados,
          AVG(CASE WHEN l.won_at IS NOT NULL AND l.sale_amount > 0 THEN l.sale_amount END) AS ticket,
          AVG(CASE WHEN l.won_at IS NOT NULL AND l.quote_amount > 0 AND l.sale_amount > 0 THEN (l.quote_amount - l.sale_amount) / l.quote_amount END) AS descuento,
          AVG(CASE WHEN l.first_touch_at IS NOT NULL THEN (julianday(l.first_touch_at) - julianday(l.created_at)) * 24 END) AS primer_toque
        FROM leads l ${all.sql ? `${all.sql} AND` : 'WHERE'} l.assigned_to IS NOT NULL`).get(...all.params);
      if (t.vendedores > 1) team = t;
    }

    // Pipeline: cotizaciones abiertas hoy (sin importar cuándo llegó el lead), vivas y frías, y venta esperada con la tasa histórica de cierre.
    const cur = leadFilters({ user: req.user, query: { ...req.query, from: undefined, to: undefined } });
    const open = db.prepare(`SELECT l.assigned_to AS id, COALESCE(u.name, 'Sin asignar') AS name, l.quote_amount, l.last_touch_at, l.quoted_at, l.updated_at
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ${cur.sql ? `${cur.sql} AND` : 'WHERE'} l.status = 'cotizando'`).all(...cur.params);
    const rates = Object.fromEntries(db.prepare(`SELECT assigned_to AS id, SUM(status = 'vendido') AS won, COUNT(*) AS closed FROM leads
      WHERE quoted_at IS NOT NULL AND status IN ('vendido', 'declinado') GROUP BY assigned_to`).all().map((r) => [r.id, r]));
    const coldMs = 15 * 86400e3;
    const pipeMap = new Map();
    for (const l of open) {
      const p = pipeMap.get(l.id) || { id: l.id, key: l.name, vivas: 0, vivas_monto: 0, frias: 0, frias_monto: 0 };
      const cold = Date.now() - new Date(l.last_touch_at || l.quoted_at || l.updated_at).getTime() > coldMs;
      if (cold) { p.frias++; p.frias_monto += l.quote_amount || 0; } else { p.vivas++; p.vivas_monto += l.quote_amount || 0; }
      pipeMap.set(l.id, p);
    }
    const pipeline = [...pipeMap.values()].map((p) => {
      const r = rates[p.id];
      const tasa = r && r.closed >= 3 ? r.won / r.closed : null; // con menos de 3 cotizaciones cerradas no hay historial suficiente
      return { ...p, tasa, cerradas: r ? r.closed : 0, esperado: tasa == null ? null : p.vivas_monto * tasa };
    }).sort((a, b) => b.vivas_monto - a.vivas_monto);

    res.json({
      funnel, campaignFunnel, sellerFunnel, touches, adFunnel, audiences, pipeline, team,
      byDay,
      productStages: byStage("COALESCE(c.name, 'Sin producto')", 'LEFT JOIN catalog_items c ON c.id = l.product_id'),
      channelStages: byStage("COALESCE(c.name, 'Sin dato')", `LEFT JOIN catalog_items c ON c.id = ${CHANNEL_EXPR}`),
      sellerStages: byStage("COALESCE(u.name, 'Sin asignar')", 'LEFT JOIN users u ON u.id = l.assigned_to'),
      total, byStatus: group('l.status'), byStage: group(STAGE_SQL), byProfile: group('l.profile'), bySource: group('l.source'), bySeller, byCampaign,
      byChannel: byItem(CHANNEL_EXPR, 'Sin dato'), byProduct: byItem('l.product_id', 'Sin producto'),
    });
  });

  // ---------- Fallas del navegador: la app las reporta sola para el panel de Maass Leads ----------
  const clientErrors = rateLimiter(20, 60 * 60e3);
  app.post('/api/ops/client-error', auth.requireUser, (req, res) => {
    if (clientErrors.hit(req.user.id)) return res.json({ ok: true }); // un navegador en bucle no llena el registro
    logOpsError(db, 'navegador', `${String(req.body?.view || '').slice(0, 30)} (${req.user.role})`, req.body?.message);
    res.json({ ok: true });
  });

  // ---------- Estado técnico para el panel de Maass Leads (con OPS_TOKEN). Sin nombres, correos ni teléfonos. ----------
  app.get('/api/ops/status', (req, res) => {
    const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const expected = config.opsToken ? Buffer.from(String(config.opsToken)) : null;
    if (!expected || token.length !== expected.length || !require('node:crypto').timingSafeEqual(Buffer.from(token), expected)) {
      return res.status(404).json({ error: 'No existe' });
    }
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const since7 = new Date(Date.now() - 7 * 86400e3).toISOString();
    const since24 = new Date(Date.now() - 86400e3).toISOString();
    const file = config.dbPath;
    const backups = file && file !== ':memory:' ? listBackups(file) : [];
    res.json({
      company: getSetting(db, 'company_name') || '',
      version: `${require('../package.json').version}${process.env.RAILWAY_GIT_COMMIT_SHA ? `+${process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7)}` : ''}`,
      started_at: STARTED_AT,
      db_ok: one('PRAGMA quick_check').quick_check === 'ok',
      db_size: file && file !== ':memory:' && fs.existsSync(file) ? fs.statSync(file).size : null,
      storage_warning: Boolean(config.storageWarning),
      captcha: Boolean(config.turnstileSecret),
      setup_pending: userCount() === 0,
      backups: { local_last: backups.at(-1)?.file.slice(4, 14) || null, local_count: backups.length,
        offsite: { configured: Boolean(offsiteConfig()), last: getSetting(db, 'offsite_last'), error: getSetting(db, 'offsite_error') } },
      activity: {
        users_active: one("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND password_hash != ''").n,
        users_pending: one("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND password_hash = ''").n,
        leads_total: one('SELECT COUNT(*) AS n FROM leads').n,
        leads_7d: one('SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?', since7).n,
        touches_7d: one('SELECT COUNT(*) AS n FROM lead_touches WHERE created_at >= ?', since7).n,
        last_lead_at: one('SELECT MAX(created_at) AS t FROM leads').t,
        last_login_at: one('SELECT MAX(last_login_at) AS t FROM users').t,
      },
      errors: { last_24h: one('SELECT COUNT(*) AS n FROM ops_errors WHERE at >= ?', since24).n,
        recent: db.prepare('SELECT at, source, place, message FROM ops_errors ORDER BY id DESC LIMIT 20').all() },
    });
  });

  // ---------- Reporte de actividad de un periodo (lo que pasó entre dos fechas, por fecha de cada hecho) ----------
  // A diferencia del Resumen (que sigue a los leads que llegaron en el periodo), aquí cuenta la venta el día que se cerró,
  // la cotización el día que se envió y la renovación el día que se registró. Cada rol ve lo suyo.
  app.get('/api/activity', auth.requireRole('gerente', 'analista', 'vendedor', 'operador'), (req, res) => {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(0);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60e3);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return res.status(400).json({ error: 'Periodo inválido' });
    const F = from.toISOString(); const T = to.toISOString();
    const seller = req.user.role === 'vendedor';
    const coord = req.user.role === 'operador';
    const sellers = db.prepare(`SELECT id, name, active FROM users WHERE role = 'vendedor' ${seller ? 'AND id = ?' : ''}
      AND (active = 1 OR id IN (SELECT assigned_to FROM leads WHERE assigned_at >= ? AND assigned_at < ?)) ORDER BY name`)
      .all(...(seller ? [req.user.id] : []), F, T);
    const ids = sellers.map((u) => u.id);
    const inIds = ids.length ? `IN (${ids.map(() => '?').join(',')})` : 'IN (NULL)';
    const by = (sql, ...extra) => Object.fromEntries(db.prepare(sql).all(...ids, ...extra).map((r) => [r.k, r]));
    const assigned = by(`SELECT assigned_to AS k, COUNT(*) AS n, AVG(CASE WHEN first_touch_at IS NOT NULL THEN (julianday(first_touch_at) - julianday(assigned_at)) * 24 END) AS h
      FROM leads WHERE assigned_to ${inIds} AND assigned_at >= ? AND assigned_at < ? GROUP BY 1`, F, T);
    const touches = by(`SELECT user_id AS k, COUNT(*) AS n FROM lead_touches WHERE user_id ${inIds} AND created_at >= ? AND created_at < ? GROUP BY 1`, F, T);
    const contacted = by(`SELECT assigned_to AS k, COUNT(*) AS n FROM leads WHERE assigned_to ${inIds} AND contacted_at >= ? AND contacted_at < ? GROUP BY 1`, F, T);
    const quotes = by(`SELECT assigned_to AS k, COUNT(*) AS n, COALESCE(SUM(quote_amount), 0) AS m FROM leads WHERE assigned_to ${inIds} AND quoted_at >= ? AND quoted_at < ? GROUP BY 1`, F, T);
    const sales = by(`SELECT assigned_to AS k, COUNT(*) AS n, COALESCE(SUM(sale_amount), 0) AS m FROM leads WHERE assigned_to ${inIds} AND won_at >= ? AND won_at < ? GROUP BY 1`, F, T);
    const renewals = by(`SELECT user_id AS k, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS m FROM lead_touches WHERE user_id ${inIds} AND outcome = 'renovo' AND created_at >= ? AND created_at < ? GROUP BY 1`, F, T);
    const declined = by(`SELECT assigned_to AS k, COUNT(*) AS n FROM leads WHERE assigned_to ${inIds} AND declined_at >= ? AND declined_at < ? AND status = 'declinado' GROUP BY 1`, F, T);
    const rows = sellers.map((u) => ({ id: u.id, name: u.name, asignados: assigned[u.id]?.n || 0, horas_primer_toque: assigned[u.id]?.h ?? null,
      toques: touches[u.id]?.n || 0, contestaron: contacted[u.id]?.n || 0, cotizaciones: quotes[u.id]?.n || 0, cotizado: quotes[u.id]?.m || 0,
      ventas: sales[u.id]?.n || 0, vendido: sales[u.id]?.m || 0, renovaciones: renewals[u.id]?.n || 0, renovado: renewals[u.id]?.m || 0,
      declinados: declined[u.id]?.n || 0 }));
    // Leads que llegaron en el periodo y cómo se repartieron (lo que mide el coordinador).
    const own = seller ? 'AND l.assigned_to = ?' : '';
    const ownP = seller ? [req.user.id] : [];
    const received = db.prepare(`SELECT COUNT(*) AS n, SUM(l.assigned_at IS NOT NULL) AS asignados,
        AVG(CASE WHEN l.assigned_at IS NOT NULL THEN (julianday(l.assigned_at) - julianday(l.created_at)) * 24 END) AS horas_asignar
      FROM leads l WHERE l.created_at >= ? AND l.created_at < ? ${own}`).get(F, T, ...ownP);
    const porOrigen = db.prepare(`SELECT COALESCE(l.campaign, c.name, 'Sin origen') AS key, COUNT(*) AS n FROM leads l
      LEFT JOIN catalog_items c ON c.id = l.channel_id WHERE l.created_at >= ? AND l.created_at < ? ${own} GROUP BY 1 ORDER BY n DESC`).all(F, T, ...ownP);
    const out = { from: F, to: T, sellers: rows,
      recibidos: { n: received.n || 0, asignados: received.asignados || 0, horas_asignar: received.horas_asignar, por_origen: porOrigen,
        sin_asignar_hoy: seller ? 0 : db.prepare("SELECT COUNT(*) AS n FROM leads WHERE assigned_to IS NULL AND status IN ('nuevo', 'nuevo_perfil', 'cotizando')").get().n } };
    if (coord) return res.json(out); // el coordinador ve recepción y reparto, no montos
    const list = (col, amount) => db.prepare(`SELECT l.id, COALESCE(l.name, l.phone, l.email) AS name, u.name AS seller, l.${col} AS at, l.${amount} AS amount,
        l.status, p.name AS product, l.quantity FROM leads l LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN catalog_items p ON p.id = l.product_id
      WHERE l.${col} >= ? AND l.${col} < ? AND l.assigned_to ${inIds} ORDER BY l.${col}`).all(F, T, ...ids);
    out.ventas = list('won_at', 'sale_amount');
    out.cotizaciones = list('quoted_at', 'quote_amount');
    out.renovaciones = db.prepare(`SELECT l.id, COALESCE(l.name, l.phone, l.email) AS name, u.name AS seller, t.created_at AS at, t.amount FROM lead_touches t
      JOIN leads l ON l.id = t.lead_id LEFT JOIN users u ON u.id = t.user_id
      WHERE t.outcome = 'renovo' AND t.created_at >= ? AND t.created_at < ? AND t.user_id ${inIds} ORDER BY t.created_at`).all(F, T, ...ids);
    out.motivos = db.prepare(`SELECT COALESCE(decline_reason, 'Sin motivo') AS key, COUNT(*) AS n FROM leads
      WHERE status = 'declinado' AND declined_at >= ? AND declined_at < ? AND assigned_to ${inIds} GROUP BY 1 ORDER BY n DESC`).all(F, T, ...ids);
    res.json(out);
  });

  // ---------- Tu cartera completa en Excel: los datos son de la empresa y se los puede llevar cuando quiera ----------
  // Una hoja por clasificación, más toques, historial, productos, campañas e inversión, y el equipo. Solo el gerente.
  app.get('/api/export/cartera.xlsx', auth.requireRole('gerente'), (req, res) => {
    const when = (iso) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }) : '');
    const day = (v) => (v ? String(v).slice(0, 10) : '');
    const yes = (v) => (v ? 'Sí' : 'No');
    const company = getSetting(db, 'company_name') || 'Mi empresa';
    const term = FOLLOWUP.term();
    const leads = db.prepare(`${leadSelect} ORDER BY l.created_at`).all();
    const answer = (l, k) => (l[k] ? QUICK_PROFILE[k].options[l[k]] || l[k] : '');
    const head = ['ID', 'Nombre', 'Teléfono', 'Email', 'Clasificación', 'Perfil', 'Producto', 'Cantidad', 'Monto cotizado', 'Monto vendido',
      'Renovaciones', `Fin de ${term}`, 'Motivo de declinación', 'Volver a contactar', 'Vendedor', 'Llegó por', 'Campaña', 'Canal', 'Anuncio',
      QUICK_PROFILE.decision_maker.label, QUICK_PROFILE.budget_status.label, QUICK_PROFILE.start_window.label,
      'Toques', 'Último toque', 'Próximo paso', 'Fecha del próximo paso', 'Recibido', 'Contestó', 'Cotizado', 'Vendido', 'Mensaje', 'Última nota'];
    const row = (l) => [l.id, l.name || '', l.phone || '', l.email || '', LABELS[FOLLOWUP.stageOf(l)] || l.status, LABELS[l.profile] || l.profile,
      l.product_name || '', l.quantity ?? '', l.quote_amount ?? '', l.sale_amount ?? '', l.renewal_amount || '', day(l.campaign_end),
      l.decline_reason || '', day(l.recontact_at), l.assigned_name || 'Sin asignar', LABELS[l.source] || l.source, l.campaign || '', l.channel_name || '',
      l.utm_content || '', answer(l, 'decision_maker'), answer(l, 'budget_status'), answer(l, 'start_window'),
      l.touch_count || 0, when(l.last_touch_at), l.next_step || '', when(l.next_step_at), when(l.created_at), when(l.contacted_at), when(l.quoted_at),
      when(l.won_at), l.message || '', l.last_note || ''];
    const groups = [
      ['Clientes', ['vendido']], ['Cotizando', ['cotizando']], ['En proceso', ['nuevo', 'contactando', 'contesto', 'nuevo_perfil']],
      ['Declinados con perfil', ['declinado_perfil']], ['Declinados sin perfil', ['declinado_sin']],
    ].map(([name, stages]) => ({ name, list: leads.filter((l) => stages.includes(FOLLOWUP.stageOf(l))) }));
    const sum = (list, k) => list.reduce((t, l) => t + (l[k] || 0), 0);
    const resumen = [
      ['Cartera de', company], ['Descargada el', when(new Date().toISOString())], ['Descargó', req.user.name], [],
      ['Clasificación', 'Contactos', 'Monto'],
      ...groups.map((g) => [g.name, g.list.length,
        g.name === 'Clientes' ? sum(g.list, 'sale_amount') + sum(g.list, 'renewal_amount') : g.name === 'Cotizando' ? sum(g.list, 'quote_amount') : '']),
      ['Total', leads.length, ''], [],
      ['Qué trae este archivo'],
      ['Toda la cartera', 'Todos los contactos con todos sus datos, en una sola hoja'],
      ['Una hoja por clasificación', 'Clientes (vendidos, con ventas y renovaciones), Cotizando, En proceso y Declinados con o sin perfil'],
      ['Toques', 'Cada intento de contacto: fecha, medio, resultado y monto'],
      ['Historial', 'Todo lo que pasó con cada contacto: notas, cambios de etapa, asignaciones'],
      ['Productos, Campañas, Inversión por mes y Equipo', 'Tus listas y tu equipo, para volver a armar todo en otro sistema'],
    ];
    const touches = db.prepare(`SELECT t.*, COALESCE(l.name, l.phone, l.email) AS lead, u.name AS who FROM lead_touches t
      JOIN leads l ON l.id = t.lead_id LEFT JOIN users u ON u.id = t.user_id ORDER BY t.created_at`).all();
    const events = db.prepare(`SELECT e.*, COALESCE(l.name, l.phone, l.email) AS lead, u.name AS who FROM lead_events e
      JOIN leads l ON l.id = e.lead_id LEFT JOIN users u ON u.id = e.user_id ORDER BY e.created_at, e.id`).all();
    const items = db.prepare('SELECT c.*, ch.name AS channel FROM catalog_items c LEFT JOIN catalog_items ch ON ch.id = c.channel_id ORDER BY c.kind, c.name').all();
    const budgets = db.prepare(`SELECT c.name, b.month, b.amount FROM campaign_budgets b JOIN catalog_items c ON c.id = b.campaign_id ORDER BY c.name, b.month`).all();
    const users = db.prepare('SELECT name, email, role, active FROM users ORDER BY active DESC, name').all();
    const ROLE = { gerente: 'Gerente', marketing: 'Gerente de marketing', vendedor: 'Vendedor', analista: 'Analista', operador: 'Coordinador de leads' };
    const file = xlsx.workbook([
      { name: 'Resumen', rows: resumen },
      { name: 'Toda la cartera', rows: [head, ...leads.map(row)] },
      ...groups.map((g) => ({ name: g.name, rows: [head, ...g.list.map(row)] })),
      { name: 'Toques', rows: [['Fecha', 'ID', 'Contacto', 'Toque', 'Medio', 'Resultado', 'Monto', 'Registró'],
        ...touches.map((t) => [when(t.created_at), t.lead_id, t.lead || '', t.n, LABELS[t.channel] || t.channel, TOUCH_OUTCOMES[t.outcome] || t.outcome, t.amount ?? '', t.who || ''])] },
      { name: 'Historial', rows: [['Fecha', 'ID', 'Contacto', 'Tipo', 'Detalle', 'Usuario'],
        ...events.map((e) => [when(e.created_at), e.lead_id, e.lead || '', e.type, e.content || '', e.who || ''])] },
      { name: 'Productos', rows: [['Producto', 'Precio de lista', 'Precio fijo', 'En uso'],
        ...items.filter((i) => i.kind === 'producto').map((i) => [i.name, i.price ?? '', yes(i.fixed_price), yes(i.active)])] },
      { name: 'Campañas', rows: [['Campaña', 'Canal', 'En uso'], ...items.filter((i) => i.kind === 'campana').map((i) => [i.name, i.channel || '', yes(i.active)])] },
      { name: 'Inversión por mes', rows: [['Campaña', 'Mes', 'Inversión'], ...budgets.map((b) => [b.name, b.month, b.amount])] },
      { name: 'Canales', rows: [['Canal', 'En uso'], ...items.filter((i) => i.kind === 'canal').map((i) => [i.name, yes(i.active)])] },
      { name: 'Equipo', rows: [['Nombre', 'Email', 'Rol', 'Activo'], ...users.map((u) => [u.name, u.email, ROLE[u.role] || u.role, yes(u.active)])] },
    ]);
    const slugName = company.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'empresa';
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="cartera-${slugName}-${new Date().toISOString().slice(0, 10)}.xlsx"` });
    res.send(file);
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe' }));
  // Cualquier falla inesperada: se registra en el servidor y al usuario se le dice algo claro, sin detalles internos.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    if (!err.status || err.status >= 500) logOpsError(db, 'servidor', `${req.method} ${req.path.replace(/\/\d+/g, '/:id')}`, err.message);
    if (res.headersSent) return;
    const status = err.status && err.status < 500 ? err.status : 500;
    const msg = status === 500 ? 'Algo salió mal y no se guardó. Intenta de nuevo; si sigue, avisa al gerente.'
      : err.type === 'entity.parse.failed' ? 'Datos inválidos' : err.type === 'entity.too.large' ? 'Lo que mandaste es demasiado grande' : err.message;
    res.status(status).json({ error: msg });
  });
  return app;
}

// Acciones pendientes (toques de la cadencia, seguimientos y cotizaciones) vencidas o de hoy.
function pendingTouches(leads) {
  let overdue = 0; let today = 0; const overdueBySeller = {};
  for (const l of leads) {
    const a = FOLLOWUP.nextAction(l);
    if (!a || a.kind === 'recontacto') continue;
    const d = FOLLOWUP.dayDiff(a.due);
    if (d > 0) continue;
    if (d < 0) {
      overdue++;
      const k = l.assigned_to ?? 'none';
      overdueBySeller[k] = (overdueBySeller[k] || 0) + 1;
    } else today++;
  }
  return { overdue, today, overdueBySeller };
}

function seedAdmin(db, config) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0 || !config.adminEmail || !config.adminPassword) return false;
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(config.adminName || 'Gerente', config.adminEmail, auth.hashPassword(config.adminPassword), 'gerente');
  return true;
}

function loadConfig(env = process.env) {
  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
  return {
    // En Railway sin volumen la base vive en el contenedor y se borra en cada actualización: hay que avisar.
    storageWarning: onRailway && !env.RAILWAY_VOLUME_MOUNT_PATH && !env.DB_PATH,
    port: Number(env.PORT) || 3000,
    // En Railway el disco persistente se monta en RAILWAY_VOLUME_MOUNT_PATH; ahí va la base de datos.
    dbPath: env.DB_PATH || (env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(env.RAILWAY_VOLUME_MOUNT_PATH, 'crm.db')
      : path.join(__dirname, '..', 'data', 'crm.db')),
    adminName: env.ADMIN_NAME,
    adminEmail: env.ADMIN_EMAIL,
    adminPassword: env.ADMIN_PASSWORD,
    formApiKey: env.FORM_API_KEY,
    cookieSecure: env.COOKIE_SECURE === 'true',
    setupCode: env.SETUP_CODE,
    // Captcha de Cloudflare Turnstile (opcional): sitio y secreto del widget. Sin ellos no se pide captcha.
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    turnstileSecret: env.TURNSTILE_SECRET_KEY,
    // Clave del panel de Maass Leads para leer el estado técnico (misma en todos los proyectos).
    opsToken: env.OPS_TOKEN,
  };
}

if (require.main === module && process.env.PANEL_INSTANCES) {
  // Este mismo código corre como "Panel de Maass Leads" (servicio aparte) si tiene PANEL_INSTANCES.
  require('./panel').startPanel();
} else if (require.main === module) {
  try { process.loadEnvFile(); } catch { /* sin .env: se usan las variables del entorno */ }
  const config = loadConfig();
  const db = openDb(config.dbPath);
  if (seedAdmin(db, config)) console.log(`Usuario gerente creado: ${config.adminEmail}`);
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    console.log(`Primer uso: abre la app en el navegador. Código de instalación: ${setupCode(db, config)}`);
  }
  const check = db.prepare('PRAGMA quick_check').get().quick_check;
  if (check !== 'ok') console.error(`ATENCIÓN: la revisión de la base de datos encontró problemas: ${check}. Restaura el último respaldo.`);
  if (config.storageWarning) {
    console.error('ATENCIÓN: no hay volumen conectado. La base de datos se BORRARÁ en la próxima actualización. Agrega un volumen en Railway montado en /data.');
  }
  // Respaldo del día al arrancar y revisión cada 6 horas (solo crea uno por día; guarda los últimos 14).
  // Si hay almacenamiento externo (R2/S3), el respaldo del día también se sube allá, una vez al día.
  const offsite = offsiteConfig();
  const backup = () => {
    let file;
    try { file = dailyBackup(db, config.dbPath); } catch (err) {
      console.error('No se pudo hacer el respaldo diario:', err.message); logOpsError(db, 'respaldo', 'diario', err.message); return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (!offsite || !file || String(getSetting(db, 'offsite_last') || '').startsWith(today)) return;
    uploadBackup(file, offsite).then((key) => {
      setSetting(db, 'offsite_last', new Date().toISOString()); db.prepare("DELETE FROM settings WHERE key = 'offsite_error'").run();
      console.log(`Respaldo copiado fuera del servidor: ${key}`);
    }).catch((err) => {
      setSetting(db, 'offsite_error', `${new Date().toISOString()} ${err.message}`.slice(0, 300));
      console.error('No se pudo copiar el respaldo fuera del servidor:', err.message); logOpsError(db, 'respaldo', 'externo', err.message);
    });
  };
  backup();
  const timer = setInterval(backup, 6 * 3600e3); timer.unref();
  const server = createApp({ db, config }).listen(config.port, () => console.log(`CRM en http://localhost:${config.port}`));
  // Apagado ordenado (Railway manda SIGTERM al actualizar): termina las peticiones en curso y cierra la base limpia.
  const shutdown = (signal) => {
    console.log(`${signal}: cerrando…`);
    server.close(() => { try { db.close(); } catch { /* ya cerrada */ } process.exit(0); });
    setTimeout(() => { try { db.close(); } catch { /* ya cerrada */ } process.exit(0); }, 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { createApp, seedAdmin, loadConfig };
