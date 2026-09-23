const path = require('node:path');
const express = require('express');
const {
  openDb, ROLES, STATUSES, PROFILES, SOURCES, MANUAL_SOURCES, LABELS, CATALOG_KINDS, phoneKey, getSetting, setSetting, ensureSettings,
  MAX_TOUCHES, CADENCE_DAYS, TOUCH_CHANNELS, TOUCH_OUTCOMES, OUTCOMES_BY_STATUS, NO_ANSWER, POSTPONED, DECLINE_REASONS, FOLLOWUP, WA_TEMPLATES,
} = require('./db');
const auth = require('./auth');
const { ingestLead, addEvent, resolveStatusProfile, now, campaignName, autoAssign, workload, suggestSeller, balanceUnassigned, releaseLeads } = require('./leads');
const { webhooksRouter } = require('./webhooks');

const EDITORS = ['gerente', 'marketing'];
// Audiencias para remarketing. Los que nunca contestaron no entran: no vale la pena volver a buscarlos.
const AUDIENCES = {
  perfil: ["l.status = 'declinado' AND l.profile = 'cumple'", []],
  contestaron: ["l.status = 'declinado' AND l.contacted_at IS NOT NULL AND l.profile != 'cumple'", []],
  pospuso: ["l.status = 'declinado' AND l.decline_reason = ?", [POSTPONED]],
  clientes: ["l.status = 'vendido'", []],
};
// Asignar leads: el gerente y quien tenga el permiso "Administra leads".
const canAssign = (user) => Boolean(user && (user.role === 'gerente' || user.can_assign));
const requireAssigner = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión' });
  if (!canAssign(req.user)) return res.status(403).json({ error: 'Solo quien administra los leads puede asignarlos' });
  next();
};
// Canal efectivo del lead: el suyo o, si no tiene, el de su campaña.
const CHANNEL_EXPR = `COALESCE(l.channel_id, (SELECT cc.channel_id FROM catalog_items cc WHERE cc.kind = 'campana' AND cc.name = l.campaign))`;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

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
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, can_assign: user.role === 'gerente' || user.can_assign ? 1 : 0 });
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.set('Set-Cookie', auth.clearCookie()).json({ ok: true });
  });

  app.get('/api/me', auth.requireUser, (req, res) => res.json(req.user));

  app.get('/api/meta', (req, res) => res.json({ statuses: STATUSES, profiles: PROFILES, roles: ROLES, sources: SOURCES, manualSources: MANUAL_SOURCES, labels: LABELS,
    touches: { max: MAX_TOUCHES, cadence: CADENCE_DAYS, channels: TOUCH_CHANNELS, outcomes: TOUCH_OUTCOMES, byStatus: OUTCOMES_BY_STATUS },
    declineReasons: DECLINE_REASONS, postponed: POSTPONED, noAnswer: NO_ANSWER }));

  // ---------- Configuración (solo gerente) ----------
  app.get('/api/settings', auth.requireRole(...EDITORS), (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      form_url: `${base}/webhooks/form`,
      form_api_key: getSetting(db, 'form_api_key'),
      auto_assign: getSetting(db, 'auto_assign') === '1',
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
    if (b.auto_assign !== undefined) setSetting(db, 'auto_assign', b.auto_assign ? '1' : '0');
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
    const items = db.prepare('SELECT id, kind, name, active, budget, channel_id FROM catalog_items ORDER BY active DESC, name COLLATE NOCASE').all();
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
    let channelId = null;
    try { channelId = kind === 'campana' ? catalogId('canal', req.body?.channel_id) ?? null : null; } catch (err) { return res.status(400).json({ error: err.message }); }
    const { lastInsertRowid } = db.prepare('INSERT INTO catalog_items (kind, name, budget, channel_id) VALUES (?, ?, ?, ?)')
      .run(kind, name.slice(0, 120), budget, channelId);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  // No se borran: se desactivan para que los leads que ya los tienen conserven el dato.
  app.patch('/api/catalog/:id', auth.requireRole(...EDITORS), (req, res) => {
    const item = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'No existe' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 120) : item.name;
    if (!name) return res.status(400).json({ error: 'Escribe un nombre' });
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : item.active;
    let budget; let channelId;
    try {
      budget = item.kind === 'campana' ? money(req.body?.budget) : undefined;
      channelId = item.kind === 'campana' ? catalogId('canal', req.body?.channel_id) : undefined;
    } catch (err) { return res.status(400).json({ error: err.message }); }
    try {
      db.prepare('UPDATE catalog_items SET name = ?, active = ?, budget = ?, channel_id = ? WHERE id = ?')
        .run(name, active, budget === undefined ? item.budget : budget, channelId === undefined ? item.channel_id : channelId, item.id);
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
    res.json(db.prepare(`SELECT id, name, email, role, active, can_assign, created_at,
      (SELECT COUNT(*) FROM leads l WHERE l.assigned_to = users.id AND l.status IN ('nuevo', 'nuevo_perfil', 'cotizando')) AS en_curso
      FROM users ORDER BY active DESC, name`).all());
  });

  app.post('/api/users', auth.requireRole('gerente'), (req, res) => {
    const { name, email, password, role, can_assign: assigner } = req.body || {};
    if (!name || !email || !password || !ROLES.includes(role)) return res.status(400).json({ error: 'Faltan datos' });
    if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    try {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, password_hash, role, can_assign) VALUES (?, ?, ?, ?, ?)')
        .run(String(name).trim(), String(email).trim(), auth.hashPassword(String(password)), role, assigner ? 1 : 0);
      res.status(201).json({ id: Number(lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    }
  });

  app.patch('/api/users/:id', auth.requireRole('gerente'), (req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'No existe' });
    const { name, role, active, password, can_assign: assigner } = req.body || {};
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
    if (assigner !== undefined) db.prepare('UPDATE users SET can_assign = ? WHERE id = ?').run(assigner ? 1 : 0, id);
    if (active === false || password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    // Si deja de ser vendedor activo, sus leads en curso vuelven a "Sin asignar" para no perderse.
    const leftSales = user.role === 'vendedor' && user.active && (active === false || (role && role !== 'vendedor'));
    const released = leftSales ? releaseLeads(db, id, req.user.id, user.name) : 0;
    res.json({ ok: true, released });
  });

  // ---------- Leads ----------
  const leadSelect = `SELECT l.*, u.name AS assigned_name, ch.name AS channel_name, pr.name AS product_name FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to
    LEFT JOIN catalog_items ch ON ch.id = ${CHANNEL_EXPR}
    LEFT JOIN catalog_items pr ON pr.id = l.product_id`;

  function leadFilters(req) {
    const where = [];
    const params = [];
    const q = req.query;
    // El vendedor ve solo sus leads (si además administra leads, también los que no tienen dueño, para asignarlos).
    if (req.user.role === 'vendedor') {
      where.push(canAssign(req.user) ? '(l.assigned_to = ? OR l.assigned_to IS NULL)' : 'l.assigned_to = ?'); params.push(req.user.id);
    }
    if (STATUSES.includes(q.status)) { where.push('l.status = ?'); params.push(q.status); }
    if (PROFILES.includes(q.profile)) { where.push('l.profile = ?'); params.push(q.profile); }
    if (SOURCES.includes(q.source)) { where.push('l.source = ?'); params.push(q.source); }
    if (q.assigned === 'none') where.push('l.assigned_to IS NULL');
    else if (q.assigned) { where.push('l.assigned_to = ?'); params.push(Number(q.assigned)); }
    if (q.campaign) { where.push('l.campaign = ?'); params.push(String(q.campaign)); }
    if (q.reason) { where.push('l.decline_reason = ?'); params.push(String(q.reason)); }
    if (AUDIENCES[q.audience]) { where.push(`(${AUDIENCES[q.audience][0]})`); params.push(...AUDIENCES[q.audience][1]); }
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
      ['campaign', 'Campaña'], ['channel_name', 'Se enteró por'], ['product_name', 'Producto'], ['status', 'Estado'], ['profile', 'Perfil'], ['decline_reason', 'Motivo declinado'],
      ['assigned_name', 'Vendedor'], ['quote_amount', 'Monto cotizado'], ['sale_amount', 'Monto de venta'],
      ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_content', 'Anuncio (utm_content)'], ['created_at', 'Fecha']];
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
      if (!MANUAL_SOURCES.includes(b.source)) return res.status(400).json({ error: 'Indica por dónde llegó el lead' });
      // Quien administra los leads elige al capturarlo quién le da seguimiento.
      let seller = null;
      if (b.assigned_to && canAssign(req.user)) {
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
      res.status(201).json({ id: result.id });
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
    res.json({ sellers: workload(db), suggested: suggestSeller(db)?.id ?? null, unassigned: u.n, oldest_unassigned_at: u.oldest });
  });
  app.post('/api/leads/balance', requireAssigner, (req, res) => {
    res.json({ assigned: balanceUnassigned(db, req.user.id) });
  });

  // Asignar o reasignar un lead (quien administra los leads).
  app.post('/api/leads/:id/assign', requireAssigner, (req, res) => {
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

  app.patch('/api/leads/:id', auth.requireUser, (req, res) => {
    const lead = getLead(req, Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'No existe' });
    if (!canEdit(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso para editar este lead' });
    const err = updateLead(req.user, lead, req.body || {});
    if (err) return res.status(err.status).json({ error: err.error });
    res.json({ ok: true });
  });

  // Aplica cambios a un lead (desde la ficha, el tablero o un toque) y registra los hitos del embudo.
  // Devuelve { status, error } si algo no es válido.
  function updateLead(user, lead, b) {
    let next; let channelId; let productId; let campaign; let saleAmount; let quoteAmount;
    try {
      quoteAmount = b.quote_amount !== undefined ? money(b.quote_amount) : lead.quote_amount;
      if (b.recontact_at && !isDate(b.recontact_at)) throw new Error('Fecha inválida');
      campaign = b.campaign !== undefined ? campaignName(db, b.campaign) : lead.campaign;
      saleAmount = b.sale_amount !== undefined ? money(b.sale_amount) : lead.sale_amount;
      next = resolveStatusProfile(lead, { status: b.status, profile: b.profile });
      channelId = catalogId('canal', b.channel_id) ?? (b.channel_id === undefined ? lead.channel_id : null);
      productId = catalogId('producto', b.product_id) ?? (b.product_id === undefined ? lead.product_id : null);
    } catch (err) {
      return { status: 400, error: err.message };
    }

    let assigned = lead.assigned_to;
    if (b.assigned_to !== undefined) {
      if (!canAssign(user)) return { status: 403, error: 'Solo quien administra los leads puede asignarlos' };
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
      quote_amount = ?, recontact_at = ?, updated_at = ? WHERE id = ?`)
      .run(field('name'), phone, phoneKey(phone), field('email'), campaign, next.status, next.profile,
        declineReason, assigned, channelId, productId, m.assigned_at, m.contacted_at,
        m.profiled_at, m.quoted_at, m.won_at, m.declined_at, saleAmount, responseTouch, quoteTouch,
        quoteAmount, recontactAt, ts, lead.id);

    if (quoteAmount !== lead.quote_amount && quoteAmount != null) {
      addEvent(db, lead.id, user.id, 'estado', `Monto cotizado: $${quoteAmount.toLocaleString('es-MX')}`);
    }
    if (recontactAt && recontactAt !== lead.recontact_at) addEvent(db, lead.id, user.id, 'estado', `Volver a contactar el ${recontactAt}`);

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
    if (!canEdit(req.user, lead)) return res.status(403).json({ error: 'Toma el lead primero para registrar toques' });
    const { channel, outcome } = req.body || {};
    if (!TOUCH_CHANNELS.includes(channel)) return res.status(400).json({ error: 'Indica por qué medio fue el toque' });
    const allowed = OUTCOMES_BY_STATUS[lead.status];
    if (!allowed) return res.status(409).json({ error: 'Este lead ya está cerrado; reábrelo para registrar más toques' });
    if (!allowed.includes(outcome)) return res.status(400).json({ error: 'Ese resultado no aplica en esta etapa' });

    const changes = {};
    if (outcome !== 'sin_respuesta') changes.contacted = true;
    if (outcome === 'cumple') changes.profile = 'cumple';
    if (outcome === 'no_cumple') Object.assign(changes, { profile: 'no_cumple', status: 'declinado', decline_reason: 'No cumple perfil' });
    if (outcome === 'cotizado') {
      changes.status = 'cotizando';
      if (req.body.quote_amount != null && req.body.quote_amount !== '') changes.quote_amount = req.body.quote_amount;
      if (lead.profile === 'sin_perfilar') changes.profile = 'cumple';
    }
    if (outcome === 'vendido') Object.assign(changes, { status: 'vendido', sale_amount: req.body.sale_amount ?? undefined });
    if (outcome === 'rechazo') {
      if (!DECLINE_REASONS.includes(req.body.decline_reason)) return res.status(400).json({ error: 'Elige el motivo' });
      Object.assign(changes, { status: 'declinado', decline_reason: req.body.decline_reason });
      if (req.body.decline_reason === POSTPONED && req.body.recontact_at) changes.recontact_at = req.body.recontact_at;
    }
    const n = (lead.touch_count || 0) + 1;
    // Cinco toques sin que el cliente haya respondido nunca: se declina solo.
    const autoDecline = outcome === 'sin_respuesta' && !lead.contacted_at && n === MAX_TOUCHES;
    if (autoDecline) Object.assign(changes, { status: 'declinado', decline_reason: NO_ANSWER });

    const ts = now();
    db.prepare('INSERT INTO lead_touches (lead_id, n, user_id, channel, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(lead.id, n, req.user.id, channel, outcome, ts);
    db.prepare('UPDATE leads SET touch_count = ?, last_touch_at = ?, first_touch_at = COALESCE(first_touch_at, ?), updated_at = ? WHERE id = ?')
      .run(n, ts, ts, ts, lead.id);
    addEvent(db, lead.id, req.user.id, 'toque', `Toque ${n} por ${LABELS[channel]}: ${TOUCH_OUTCOMES[outcome]}`);

    const err = updateLead(req.user, getLead(req, lead.id), changes);
    if (err) return res.status(err.status).json({ error: err.error });
    res.status(201).json({ ok: true, n, auto_declined: autoDecline });
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
    const byItem = (col, empty) => db.prepare(`SELECT COALESCE(c.name, '${empty}') AS key, COUNT(*) AS n,
        SUM(l.profile = 'cumple') AS cumple, SUM(l.status = 'vendido') AS vendidos
      FROM leads l LEFT JOIN catalog_items c ON c.id = ${col} ${sql} GROUP BY ${col} ORDER BY n DESC`).all(...params);
    // Cruces etapa × dimensión para las barras de batería del Resumen.
    const byStage = (keyExpr, join) => db.prepare(`SELECT ${keyExpr} AS key, l.status AS status, COUNT(*) AS n
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
      COALESCE(SUM(l.status = 'cotizando'), 0) AS cotizando_ahora`;
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
      AVG(l.response_touch) AS toques_respuesta, AVG(l.quote_touch) AS toques_cotizacion
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
    sellerFunnel.forEach((r) => { r.toques_vencidos = touches.overdueBySeller[r.id ?? 'none'] || 0; });
    // Audiencias para remarketing con los filtros actuales (los que nunca contestaron no se incluyen).
    const audiences = Object.fromEntries(Object.entries(AUDIENCES).map(([k, [cond, extra]]) => [k,
      db.prepare(`SELECT COUNT(*) AS n FROM leads l ${where(cond)}`).get(...params, ...extra).n]));
    // Al vendedor no se le muestra la inversión de marketing.
    if (req.user.role === 'vendedor') campaignFunnel.forEach((r) => { r.inversion = null; });

    res.json({
      funnel, campaignFunnel, sellerFunnel, touches, adFunnel, audiences,
      byDay,
      productStages: byStage("COALESCE(c.name, 'Sin producto')", 'LEFT JOIN catalog_items c ON c.id = l.product_id'),
      channelStages: byStage("COALESCE(c.name, 'Sin dato')", `LEFT JOIN catalog_items c ON c.id = ${CHANNEL_EXPR}`),
      sellerStages: byStage("COALESCE(u.name, 'Sin asignar')", 'LEFT JOIN users u ON u.id = l.assigned_to'),
      total, byStatus: group('l.status'), byProfile: group('l.profile'), bySource: group('l.source'), bySeller, byCampaign,
      byChannel: byItem(CHANNEL_EXPR, 'Sin dato'), byProduct: byItem('l.product_id', 'Sin producto'),
    });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe' }));
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
  return {
    port: Number(env.PORT) || 3000,
    // En Railway el disco persistente se monta en RAILWAY_VOLUME_MOUNT_PATH; ahí va la base de datos.
    dbPath: env.DB_PATH || (env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(env.RAILWAY_VOLUME_MOUNT_PATH, 'crm.db')
      : path.join(__dirname, '..', 'data', 'crm.db')),
    adminName: env.ADMIN_NAME,
    adminEmail: env.ADMIN_EMAIL,
    adminPassword: env.ADMIN_PASSWORD,
    formApiKey: env.FORM_API_KEY,
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
