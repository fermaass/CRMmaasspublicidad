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
const { rateLimiter, clientIp } = require('./site');

const LINK_HOURS = 72;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const isoNow = () => new Date().toISOString();
const MANAGERS = ['gerente', 'dueno'];
const isManager = (u) => MANAGERS.includes(u.role);

function panelRouter({ db, config, photos, onLead }) {
  const app = transactionalRoutes(express.Router(), db);
  const loginFails = new Map();
  const loginByIp = rateLimiter(30, 15 * 60e3);
  const setupTries = rateLimiter(10, 15 * 60e3);
  const codeTries = rateLimiter(10, 15 * 60e3);

  // El panel nunca aparece en Google.
  app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  app.use(express.static(path.join(__dirname, '..', 'public', 'panel'), { index: 'index.html', maxAge: 0 }));
  app.use(auth.authMiddleware(db));
  // Las fotos llegan en JSON más grande; todo lo demás, hasta 1 MB.
  app.use('/api/properties/:id/photos', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Se espera JSON' });
    next();
  });

  const startSession = (req, res, userId, pending) => {
    const { token, expires } = auth.createSession(db, userId, pending);
    res.set('Set-Cookie', auth.sessionCookie(token, expires, config.cookieSecure || req.secure));
  };
  const me = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, publish_direct: u.publish_direct });
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const needsMfa = (u) => auth.MFA_ROLES.includes(u.role) && !config.mfaOff;
  // Tras la contraseña: si es Gerente o Dueño, queda a medias hasta poner el código de la app.
  function afterPassword(req, res, user) {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(isoNow(), user.id);
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
    if (String(password || '').length < 10) return res.status(400).json({ error: 'La contraseña debe tener al menos 10 caracteres.' });
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
    if (user && !user.password_hash) return res.status(401).json({ error: 'Todavía no activas tu acceso: abre el link de invitación que te mandaron.' });
    if (!user || !auth.verifyPassword(String(req.body?.password || ''), user.password_hash)) {
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
    if (codeTries.hit(`${u.id}`)) return res.status(429).json({ error: 'Demasiados códigos equivocados. Espera 15 minutos.' });
    const { totp_secret: secret } = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(u.id);
    if (!auth.verifyTotp(secret, req.body?.code)) return res.status(400).json({ error: 'Código incorrecto. Revisa que la hora de tu celular esté en automático.' });
    if (!u.totp_enabled) db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(u.id);
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    startSession(req, res, u.id, false);
    res.json(me(u));
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    res.set('Set-Cookie', auth.clearCookie()).json({ ok: true });
  });
  app.get('/api/me', auth.requireUser, (req, res) => res.json(me(req.user)));
  app.post('/api/me/password', auth.requireUser, (req, res) => {
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(String(req.body?.current || ''), u.password_hash)) return res.status(400).json({ error: 'Tu contraseña actual no es correcta' });
    if (String(req.body?.password || '').length < 10) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 10 caracteres' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(req.body.password)), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
    res.json({ ok: true });
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
    const t = findToken(req.params.token);
    if (dead(t)) return res.status(410).json({ error: 'Este link ya no sirve: venció o ya se usó. Pide uno nuevo al Dueño.' });
    res.json({ name: t.name, email: t.email, kind: t.kind });
  });
  app.post('/api/access/:token', (req, res) => {
    const t = findToken(req.params.token);
    if (dead(t)) return res.status(410).json({ error: 'Este link ya no sirve: venció o ya se usó. Pide uno nuevo al Dueño.' });
    const password = String(req.body?.password || '');
    if (password.length < 10) return res.status(400).json({ error: 'La contraseña debe tener al menos 10 caracteres' });
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
    res.json({ ok: true });
  });
  app.post('/api/users/:id/link', auth.requireRole('dueno'), (req, res) => {
    const u = db.prepare('SELECT id, active FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u || !u.active) return res.status(404).json({ error: 'No existe o está desactivado' });
    res.json(accessLink(req, u.id, 'reset'));
  });
  // Si alguien cambia de celular, el Dueño le borra la verificación y la vuelve a configurar al entrar.
  app.post('/api/users/:id/reset-2fa', auth.requireRole('dueno'), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'La tuya se reinicia con la variable RESET_2FA en Railway (ver PUBLICAR.md).' });
    db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- Configuración y zonas ----------
  app.get('/api/config', auth.requireUser, (req, res) => {
    res.json({
      settings: siteSettings(db), zones: db.prepare('SELECT * FROM zones ORDER BY name').all(),
      lists: { roles: ROLES, propStatus: PROP_STATUS, stages: STAGES, lostReasons: LOST_REASONS, extras: EXTRAS, includes: INCLUDES, requirements: REQUIREMENTS, propTypes: PROP_TYPES },
      siteUrl: config.siteUrl || '', today: localNow().date, mail: Boolean(config.resendKey && config.mailFrom),
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
    if (db.prepare('SELECT 1 FROM zones WHERE slug = ? OR name = ?').get(slug, name)) return res.status(409).json({ error: 'Esa zona ya existe.' });
    res.status(201).json({ id: Number(db.prepare('INSERT INTO zones (name, slug) VALUES (?, ?)').run(name, slug).lastInsertRowid) });
  });
  app.patch('/api/zones/:id', auth.requireRole(...MANAGERS), (req, res) => {
    const z = db.prepare('SELECT * FROM zones WHERE id = ?').get(Number(req.params.id));
    if (!z) return res.status(404).json({ error: 'No existe' });
    if (req.body?.active !== undefined) db.prepare('UPDATE zones SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, z.id);
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
    const out = { ...p, can_edit: canEdit(u, p), leads: leadCount.get(p.id).n };
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
      owner_id: pick('owner_id', (v) => (num(v) && db.prepare('SELECT 1 FROM owners WHERE id = ?').get(num(v)) ? num(v) : null)),
    };
    for (const k of ['m2', 'bedrooms', 'bathrooms', 'parking', 'max_occupants', 'min_term']) if (data[k] != null && data[k] < 0) return { error: 'Los números no pueden ser negativos.' };
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
    const r = readProp(b);
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
    res.status(201).json(propOut(u, getProp(db, id)));
  });

  app.patch('/api/properties/:id', auth.requireUser, (req, res) => {
    const u = req.user; const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (!canEdit(u, p)) return res.status(403).json({ error: p.status === 'borrador' ? 'Solo puedes editar lo que capturaste o tienes asignado.' : 'Ya está publicada: pide al Gerente que haga el cambio.' });
    const b = req.body || {};
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
    res.json(propOut(u, getProp(db, p.id)));
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
    res.json(propOut(u, getProp(db, p.id)));
  });
  // Eliminar: solo Gerente o Dueño, y solo si no tiene leads (si tiene, mejor pausarla para no perder el historial).
  app.delete('/api/properties/:id', auth.requireRole(...MANAGERS), (req, res) => {
    const p = getProp(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'No existe' });
    if (leadCount.get(p.id).n) return res.status(409).json({ error: 'Tiene leads: mejor ponla en Pausada para no perder su historial.' });
    db.prepare('DELETE FROM properties WHERE id = ?').run(p.id);
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
      event(l.id, u.id, 'etapa', `${l.stage} → ${b.stage}${b.stage === 'perdido' ? ` (${b.lost_reason})` : ''}`);
      // Firmado: la propiedad pasa a Rentada y sale del sitio y del mapa del sitio.
      if (b.stage === 'firmado' && l.property_id) {
        const p = db.prepare('SELECT status FROM properties WHERE id = ?').get(l.property_id);
        if (p && p.status !== 'rentada') {
          db.prepare("UPDATE properties SET status = 'rentada', rented_at = ?, updated_at = ? WHERE id = ?").run(now, now, l.property_id);
          event(l.id, u.id, 'propiedad', `${l.prop_code} pasó a Rentada y salió del sitio`);
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
    out.alerts = out.alerts.map((a) => ({ ...a, filters: (() => { try { return JSON.parse(a.filters); } catch { return {}; } })() }));
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

  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe' }));
  return app;
}

module.exports = { panelRouter };
