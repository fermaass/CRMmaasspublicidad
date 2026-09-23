const path = require('node:path');
const express = require('express');
const { openDb, ROLES, STATUSES, PROFILES, SOURCES, phoneKey, getSetting, setSetting, ensureSettings } = require('./db');
const auth = require('./auth');
const { ingestLead, addEvent, resolveStatusProfile, now } = require('./leads');
const { webhooksRouter } = require('./webhooks');

const EDITORS = ['gerente', 'marketing'];
const LABELS = {
  nuevo: 'Nuevo', nuevo_perfil: 'Nuevo – cumple perfil', cotizando: 'Cotizando', declinado: 'Declinado', vendido: 'Vendido',
  sin_perfilar: 'Sin perfilar', cumple: 'Cumple perfil', no_cumple: 'No cumple',
};

function createApp({ db, config }) {
  ensureSettings(db, config);
  const app = express();
  app.disable('x-powered-by');
  // Detrás del proxy HTTPS del hosting: así sabemos si la conexión es segura y la URL pública real.
  app.set('trust proxy', 1);
  app.get('/health', (req, res) => res.send('ok'));
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

  const startSession = (req, res, userId) => {
    const { token, expires } = auth.createSession(db, userId);
    res.set('Set-Cookie', auth.sessionCookie(token, expires, config.cookieSecure || req.secure));
  };
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  // ---------- Primer uso: crear el gerente desde la pantalla ----------
  app.get('/api/setup', (req, res) => res.json({ needed: userCount() === 0 }));

  app.post('/api/setup', (req, res) => {
    if (userCount() > 0) return res.status(409).json({ error: 'La app ya está configurada' });
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Faltan datos' });
    if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(String(name).trim(), String(email).trim(), auth.hashPassword(String(password)), 'gerente');
    startSession(req, res, Number(lastInsertRowid));
    res.status(201).json({ id: Number(lastInsertRowid), name, email, role: 'gerente' });
  });

  // ---------- Sesión ----------
  app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').trim());
    if (!user || !auth.verifyPassword(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    startSession(req, res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.set('Set-Cookie', auth.clearCookie()).json({ ok: true });
  });

  app.get('/api/me', auth.requireUser, (req, res) => res.json(req.user));

  app.get('/api/meta', (req, res) => res.json({ statuses: STATUSES, profiles: PROFILES, roles: ROLES, sources: SOURCES, labels: LABELS }));

  // ---------- Configuración (solo gerente) ----------
  app.get('/api/settings', auth.requireRole('gerente'), (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      form_url: `${base}/webhooks/form`,
      form_api_key: getSetting(db, 'form_api_key'),
      whatsapp_url: `${base}/webhooks/whatsapp`,
      whatsapp_verify_token: getSetting(db, 'whatsapp_verify_token'),
      whatsapp_app_secret_set: Boolean(getSetting(db, 'whatsapp_app_secret')),
      whatsapp_last_message: getSetting(db, 'whatsapp_last_message'),
    });
  });

  app.patch('/api/settings', auth.requireRole('gerente'), (req, res) => {
    const b = req.body || {};
    if (b.whatsapp_app_secret !== undefined) setSetting(db, 'whatsapp_app_secret', String(b.whatsapp_app_secret).trim());
    if (b.regenerate_form_key) setSetting(db, 'form_api_key', require('node:crypto').randomBytes(18).toString('base64url'));
    res.json({ ok: true });
  });

  // ---------- Usuarios ----------
  app.get('/api/users', auth.requireUser, (req, res) => {
    res.json(db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY active DESC, name').all());
  });

  app.post('/api/users', auth.requireRole('gerente'), (req, res) => {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password || !ROLES.includes(role)) return res.status(400).json({ error: 'Faltan datos' });
    if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    try {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(String(name).trim(), String(email).trim(), auth.hashPassword(String(password)), role);
      res.status(201).json({ id: Number(lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    }
  });

  app.patch('/api/users/:id', auth.requireRole('gerente'), (req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'No existe' });
    const { name, role, active, password } = req.body || {};
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
    if (id === req.user.id && (active === false || (role && role !== 'gerente'))) {
      return res.status(400).json({ error: 'No puedes desactivarte ni quitarte el rol de gerente' });
    }
    if (password !== undefined && String(password).length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    db.prepare('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?').run(
      name ? String(name).trim() : user.name, role || user.role,
      active === undefined ? user.active : (active ? 1 : 0),
      password ? auth.hashPassword(String(password)) : user.password_hash, id);
    if (active === false || password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- Leads ----------
  const leadSelect = `SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to`;

  function leadFilters(req) {
    const where = [];
    const params = [];
    const q = req.query;
    if (req.user.role === 'vendedor') { where.push('(l.assigned_to = ? OR l.assigned_to IS NULL)'); params.push(req.user.id); }
    if (STATUSES.includes(q.status)) { where.push('l.status = ?'); params.push(q.status); }
    if (PROFILES.includes(q.profile)) { where.push('l.profile = ?'); params.push(q.profile); }
    if (SOURCES.includes(q.source)) { where.push('l.source = ?'); params.push(q.source); }
    if (q.assigned === 'none') where.push('l.assigned_to IS NULL');
    else if (q.assigned) { where.push('l.assigned_to = ?'); params.push(Number(q.assigned)); }
    if (q.campaign) { where.push('l.campaign = ?'); params.push(String(q.campaign)); }
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
    if (req.user.role === 'vendedor' && lead.assigned_to && lead.assigned_to !== req.user.id) return null;
    return lead;
  }

  function canEdit(user, lead) {
    if (EDITORS.includes(user.role)) return true;
    return user.role === 'vendedor' && lead.assigned_to === user.id;
  }

  app.get('/api/leads', auth.requireUser, (req, res) => {
    const { sql, params } = leadFilters(req);
    res.json(db.prepare(`${leadSelect} ${sql} ORDER BY l.updated_at DESC LIMIT 2000`).all(...params));
  });

  app.get('/api/leads.csv', auth.requireRole('gerente', 'marketing', 'analista'), (req, res) => {
    const { sql, params } = leadFilters(req);
    const rows = db.prepare(`${leadSelect} ${sql} ORDER BY l.created_at DESC`).all(...params);
    const cols = [['id', 'ID'], ['name', 'Nombre'], ['phone', 'Teléfono'], ['email', 'Email'], ['source', 'Origen'],
      ['campaign', 'Campaña'], ['status', 'Estado'], ['profile', 'Perfil'], ['decline_reason', 'Motivo declinado'],
      ['assigned_name', 'Vendedor'], ['created_at', 'Fecha']];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map(([k]) => esc(['status', 'profile'].includes(k) ? LABELS[r[k]] : r[k])).join(','))].join('\n');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="leads.csv"' });
    res.send('﻿' + csv);
  });

  app.get('/api/leads/:id', auth.requireUser, (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    const events = db.prepare(`SELECT e.*, u.name AS user_name FROM lead_events e
      LEFT JOIN users u ON u.id = e.user_id WHERE e.lead_id = ? ORDER BY e.id DESC`).all(lead.id);
    res.json({ ...lead, events, can_edit: canEdit(req.user, lead) });
  });

  app.post('/api/leads', auth.requireRole('gerente', 'marketing', 'vendedor'), (req, res) => {
    const b = req.body || {};
    try {
      const result = ingestLead(db, { ...b, source: 'manual' });
      if (!result.created) return res.status(409).json({ error: 'Ese contacto ya existe', id: result.id });
      if (req.user.role === 'vendedor') db.prepare('UPDATE leads SET assigned_to = ? WHERE id = ?').run(req.user.id, result.id);
      db.prepare('UPDATE lead_events SET user_id = ?, content = ? WHERE lead_id = ?')
        .run(req.user.id, 'Lead capturado manualmente', result.id);
      res.status(201).json({ id: result.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/leads/:id', auth.requireUser, (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    if (!canEdit(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso para editar este lead' });
    const b = req.body || {};

    let next;
    try {
      next = resolveStatusProfile(lead, { status: b.status, profile: b.profile });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let assigned = lead.assigned_to;
    if (b.assigned_to !== undefined) {
      if (!EDITORS.includes(req.user.role)) return res.status(403).json({ error: 'Solo gerente o marketing asignan leads' });
      assigned = b.assigned_to ? Number(b.assigned_to) : null;
      if (assigned && !db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(assigned)) {
        return res.status(400).json({ error: 'Usuario inválido' });
      }
    }

    const field = (k) => (b[k] !== undefined ? (String(b[k] ?? '').trim() || null) : lead[k]);
    const phone = field('phone');
    const declineReason = next.status === 'declinado' ? field('decline_reason') : null;

    db.prepare(`UPDATE leads SET name = ?, phone = ?, phone_key = ?, email = ?, campaign = ?, status = ?, profile = ?,
      decline_reason = ?, assigned_to = ?, updated_at = ? WHERE id = ?`)
      .run(field('name'), phone, phoneKey(phone), field('email'), field('campaign'), next.status, next.profile,
        declineReason, assigned, now(), lead.id);

    if (next.status !== lead.status) {
      addEvent(db, lead.id, req.user.id, 'estado',
        `${LABELS[lead.status]} → ${LABELS[next.status]}${declineReason ? ` (motivo: ${declineReason})` : ''}`);
    }
    if (next.profile !== lead.profile) addEvent(db, lead.id, req.user.id, 'perfil', `Perfil: ${LABELS[next.profile]}`);
    if (assigned !== lead.assigned_to) {
      const name = assigned ? db.prepare('SELECT name FROM users WHERE id = ?').get(assigned).name : 'nadie';
      addEvent(db, lead.id, req.user.id, 'asignacion', `Asignado a ${name}`);
    }
    res.json({ ok: true });
  });

  app.post('/api/leads/:id/take', auth.requireRole('vendedor'), (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    if (lead.assigned_to) return res.status(409).json({ error: 'Este lead ya tiene vendedor' });
    db.prepare('UPDATE leads SET assigned_to = ?, updated_at = ? WHERE id = ? AND assigned_to IS NULL').run(req.user.id, now(), lead.id);
    addEvent(db, lead.id, req.user.id, 'asignacion', `${req.user.name} tomó el lead`);
    res.json({ ok: true });
  });

  app.post('/api/leads/:id/notes', auth.requireUser, (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    if (!canEdit(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso' });
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
  app.get('/api/stats', auth.requireUser, (req, res) => {
    const { sql, params } = leadFilters(req);
    const group = (col) => db.prepare(`SELECT ${col} AS key, COUNT(*) AS n FROM leads l ${sql} GROUP BY ${col}`).all(...params);
    const bySeller = db.prepare(`SELECT COALESCE(u.name, 'Sin asignar') AS key, COUNT(*) AS n,
        SUM(l.status = 'vendido') AS vendidos, SUM(l.status = 'cotizando') AS cotizando
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ${sql} GROUP BY l.assigned_to ORDER BY n DESC`).all(...params);
    const byCampaign = db.prepare(`SELECT COALESCE(l.campaign, 'Sin campaña') AS key, COUNT(*) AS n,
        SUM(l.profile = 'cumple') AS cumple, SUM(l.status = 'vendido') AS vendidos
      FROM leads l ${sql} GROUP BY l.campaign ORDER BY n DESC LIMIT 20`).all(...params);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM leads l ${sql}`).get(...params).n;
    res.json({ total, byStatus: group('l.status'), byProfile: group('l.profile'), bySource: group('l.source'), bySeller, byCampaign });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe' }));
  return app;
}

function seedAdmin(db, config) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0 || !config.adminEmail || !config.adminPassword) return false;
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(config.adminName || 'Gerente', config.adminEmail, auth.hashPassword(config.adminPassword), 'gerente');
  return true;
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    // En Railway el disco persistente se monta en RAILWAY_VOLUME_MOUNT_PATH; ahí va la base de datos.
    dbPath: env.DB_PATH || (env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(env.RAILWAY_VOLUME_MOUNT_PATH, 'crm.db')
      : path.join(__dirname, '..', 'data', 'crm.db')),
    adminName: env.ADMIN_NAME,
    adminEmail: env.ADMIN_EMAIL,
    adminPassword: env.ADMIN_PASSWORD,
    formApiKey: env.FORM_API_KEY,
    whatsappVerifyToken: env.WHATSAPP_VERIFY_TOKEN,
    whatsappAppSecret: env.WHATSAPP_APP_SECRET,
    cookieSecure: env.COOKIE_SECURE === 'true',
  };
}

if (require.main === module) {
  try { process.loadEnvFile(); } catch { /* sin .env: se usan las variables del entorno */ }
  const config = loadConfig();
  const db = openDb(config.dbPath);
  if (seedAdmin(db, config)) console.log(`Usuario gerente creado: ${config.adminEmail}`);
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    console.log('Primer uso: abre la app en el navegador para crear el usuario gerente.');
  }
  createApp({ db, config }).listen(config.port, () => console.log(`CRM en http://localhost:${config.port}`));
}

module.exports = { createApp, seedAdmin, loadConfig };
