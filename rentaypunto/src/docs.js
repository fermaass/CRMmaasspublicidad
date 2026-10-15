// Fase 3: expediente del inquilino y documentos del propietario, con enlace privado y archivos cifrados.
// Fase 4: portal del inquilino para subir comprobantes de pago (administración de la renta).
const crypto = require('node:crypto');
const express = require('express');
const { DOC_KINDS, PAY_CONCEPTS, STAGES } = require('./db');
const { localNow, isDate } = require('./data');
const auth = require('./auth');

const LINK_DAYS = { lead: 7, owner: 14 };
const isoNow = () => new Date().toISOString();
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const MANAGERS = ['gerente', 'dueno'];
const monthOk = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));

function docsCore(db, vlt) {
  const linkRow = (token) => (/^[\w-]{20,64}$/.test(String(token || '')) ? db.prepare('SELECT * FROM doc_links WHERE token_hash = ?').get(auth.sha256(token)) : null);
  // Un enlace sirve si no venció, no se revocó y (salvo el portal de pagos) no se ha enviado todavía.
  const liveLink = (token, types) => {
    const l = linkRow(token);
    if (!l || !types.includes(l.subject_type) || l.revoked_at || l.expires_at < isoNow()) return null;
    if (l.subject_type !== 'tenancy' && l.submitted_at) return { ...l, closed: true };
    return l;
  };
  const docsOf = (type, id) => db.prepare(`SELECT id, kind, mime, size, original_name, status, note, uploaded_at, reviewed_at FROM documents
    WHERE subject_type = ? AND subject_id = ? AND deleted_at IS NULL ORDER BY id`).all(type, id);
  const subject = (type, id) => {
    if (type === 'lead') return db.prepare(`SELECT l.id, l.name, l.phone, l.advisor_id, l.stage, l.file_status, l.tenant_profile, l.property_id, p.code, p.title, p.requirements
      FROM leads l LEFT JOIN properties p ON p.id = l.property_id WHERE l.id = ?`).get(id);
    if (type === 'owner') return db.prepare('SELECT id, name, phone, advisor_id, file_status, prop_type, zone FROM owners WHERE id = ?').get(id);
    if (type === 'tenancy') return db.prepare(`SELECT p.id, p.code, p.title, p.advisor_id, p.created_by, p.status, p.contract_end, p.includes, p.maintenance, l.name, l.phone
      FROM properties p LEFT JOIN leads l ON l.id = p.tenant_lead_id WHERE p.id = ?`).get(id);
    return null;
  };
  // Guarda un archivo que sube el inquilino o el propietario.
  function store(type, id, kind, buf, name) {
    const spec = DOC_KINDS[type][kind];
    if (!spec) return { status: 400, error: 'Tipo de documento inválido.' };
    const n = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE subject_type = ? AND subject_id = ? AND kind = ? AND deleted_at IS NULL AND status != 'rechazado'").get(type, id, kind).n;
    if (n >= spec[2]) return { status: 400, error: `Ya subiste el máximo para "${spec[0]}" (${spec[2]}). Si te equivocaste, quita uno.` };
    const r = vlt.put(buf);
    if (r.error) return { status: r.error.includes('DOCS_KEY') ? 503 : 400, error: r.error };
    const docId = Number(db.prepare('INSERT INTO documents (subject_type, subject_id, kind, file, iv, tag, mime, size, original_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(type, id, kind, r.file, r.iv, r.tag, r.mime, r.size, clip(name, 120) || `${kind}.${r.ext}`).lastInsertRowid);
    return { id: docId, file: r.file };
  }
  return { linkRow, liveLink, docsOf, subject, store };
}

// ---------- Rutas públicas (sin login, con el enlace privado) ----------
function publicDocsRoutes(app, { db, vlt, views, ctxOf, limiter, clientIp, onFileReceived }) {
  const core = docsCore(db, vlt);
  const raw = express.raw({ type: () => true, limit: '9mb' });
  // Páginas privadas: no se indexan, no se guardan en caché y no mandan el enlace a otros sitios.
  const privateHtml = (res, body, status = 200) => res.status(status).type('html')
    .set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }).send(body);
  const guard = (req, res) => {
    if (limiter.hit(`docs:${clientIp(req)}`)) { res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' }); return false; }
    return true;
  };

  app.get('/expediente/:token', (req, res) => {
    const l = core.liveLink(req.params.token, ['lead', 'owner']);
    if (!l) return privateHtml(res, views.fileGone(ctxOf(req)), 404);
    const s = core.subject(l.subject_type, l.subject_id);
    privateHtml(res, views.filePage(ctxOf(req), { link: l, s, docs: core.docsOf(l.subject_type, l.subject_id), kinds: DOC_KINDS[l.subject_type], enabled: vlt.enabled }));
  });
  app.post('/api/expediente/:token/docs', raw, (req, res) => {
    if (!guard(req, res)) return;
    const l = core.liveLink(req.params.token, ['lead', 'owner']);
    if (!l || l.closed) return res.status(410).json({ error: 'Este enlace ya no sirve. Pide uno nuevo a tu asesor.' });
    const out = core.store(l.subject_type, l.subject_id, String(req.query.kind || ''), Buffer.isBuffer(req.body) ? req.body : null, decodeURIComponent(req.get('x-file-name') || ''));
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.status(201).json({ id: out.id });
  });
  app.post('/api/expediente/:token/docs/:id/quitar', express.json(), (req, res) => {
    if (!guard(req, res)) return;
    const l = core.liveLink(req.params.token, ['lead', 'owner']);
    if (!l || l.closed) return res.status(410).json({ error: 'Este enlace ya no sirve.' });
    const d = db.prepare("SELECT * FROM documents WHERE id = ? AND subject_type = ? AND subject_id = ? AND deleted_at IS NULL AND status = 'pendiente'").get(Number(req.params.id), l.subject_type, l.subject_id);
    if (!d) return res.status(404).json({ error: 'No existe o ya se revisó.' });
    db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(isoNow(), d.id);
    vlt.remove(d.file);
    res.json({ ok: true });
  });
  app.post('/api/expediente/:token/enviar', express.json(), (req, res) => {
    if (!guard(req, res)) return;
    if (!req.is('application/json')) return res.status(415).json({ error: 'Se espera JSON' });
    const l = core.liveLink(req.params.token, ['lead', 'owner']);
    if (!l || l.closed) return res.status(410).json({ error: 'Este enlace ya no sirve. Pide uno nuevo a tu asesor.' });
    const docs = core.docsOf(l.subject_type, l.subject_id).filter((d) => d.status !== 'rechazado');
    const missing = Object.entries(DOC_KINDS[l.subject_type]).filter(([k, v]) => v[1] && !docs.some((d) => d.kind === k)).map(([, v]) => v[0]);
    if (missing.length) return res.status(400).json({ error: `Falta: ${missing.join(', ')}.` });
    const now = isoNow();
    if (l.subject_type === 'lead') {
      const b = req.body || {};
      const profile = { budget: Number(b.budget) || null, move_date: isDate(b.move_date) ? b.move_date : null, occupants: Number(b.occupants) || null, pets: clip(b.pets, 60) || null,
        occupation: clip(b.occupation, 80) || null, notes: clip(b.notes, 500) || null };
      const lead = db.prepare('SELECT stage FROM leads WHERE id = ?').get(l.subject_id);
      const toExp = lead && STAGES.indexOf(lead.stage) < STAGES.indexOf('expediente') && lead.stage !== 'perdido';
      db.prepare(`UPDATE leads SET tenant_profile = ?, file_status = 'recibido', updated_at = ?${toExp ? ", stage = 'expediente'" : ''} WHERE id = ?`).run(JSON.stringify(profile), now, l.subject_id);
      if (toExp) db.prepare('UPDATE leads SET confirmed_at = COALESCE(confirmed_at, ?), visited_at = COALESCE(visited_at, ?) WHERE id = ?').run(now, now, l.subject_id);
      db.prepare("INSERT INTO lead_events (lead_id, type, content) VALUES (?, 'expediente', ?)").run(l.subject_id, `Envió su expediente (${docs.length} documento(s))`);
    } else {
      db.prepare("UPDATE owners SET file_status = 'recibido' WHERE id = ?").run(l.subject_id);
    }
    db.prepare('UPDATE doc_links SET submitted_at = ? WHERE id = ?').run(now, l.id);
    res.on('finish', () => { if (res.statusCode < 400) onFileReceived(l.subject_type, l.subject_id); });
    res.json({ ok: true });
  });

  // Portal del inquilino: sube comprobantes de pago mes con mes (no se cierra al enviar; vence con el contrato).
  app.get('/portal/:token', (req, res) => {
    const l = core.liveLink(req.params.token, ['tenancy']);
    if (!l) return privateHtml(res, views.fileGone(ctxOf(req)), 404);
    const s = core.subject('tenancy', l.subject_id);
    const pays = db.prepare('SELECT month, concept, status, note FROM payments WHERE property_id = ? ORDER BY month DESC, concept LIMIT 120').all(l.subject_id);
    privateHtml(res, views.portalPage(ctxOf(req), { s, pays, concepts: PAY_CONCEPTS, enabled: vlt.enabled, month: localNow().date.slice(0, 7) }));
  });
  app.post('/api/portal/:token/comprobante', raw, (req, res) => {
    if (!guard(req, res)) return;
    const l = core.liveLink(req.params.token, ['tenancy']);
    if (!l) return res.status(410).json({ error: 'Este enlace ya no sirve. Pide uno nuevo a tu asesor.' });
    const month = String(req.query.month || ''); const concept = String(req.query.concept || '');
    if (!monthOk(month) || !PAY_CONCEPTS[concept]) return res.status(400).json({ error: 'Elige el mes y el concepto.' });
    const existing = db.prepare('SELECT status FROM payments WHERE property_id = ? AND month = ? AND concept = ?').get(l.subject_id, month, concept);
    if (existing && existing.status === 'validado') return res.status(409).json({ error: 'Ese pago ya está validado.' });
    const out = core.store('tenancy', l.subject_id, 'comprobante', Buffer.isBuffer(req.body) ? req.body : null, decodeURIComponent(req.get('x-file-name') || ''));
    if (out.error) return res.status(out.status).json({ error: out.error });
    db.prepare(`INSERT INTO payments (property_id, month, concept, status, document_id, updated_at) VALUES (?, ?, ?, 'pendiente', ?, ?)
      ON CONFLICT(property_id, month, concept) DO UPDATE SET status = 'pendiente', document_id = excluded.document_id, note = NULL, updated_at = excluded.updated_at`)
      .run(l.subject_id, month, concept, out.id, isoNow());
    res.on('finish', () => { if (res.statusCode < 400) onFileReceived('tenancy', l.subject_id); });
    res.status(201).json({ ok: true });
  });
}

// ---------- Rutas del panel ----------
function panelDocsRoutes(app, { db, vlt, config }) {
  const core = docsCore(db, vlt);
  const isMgr = (u) => MANAGERS.includes(u.role);
  // Acceso mínimo: el asesor de ese lead/propietario/propiedad, el Gerente y el Dueño. Nadie más.
  function canSee(u, type, id) {
    const s = core.subject(type, id);
    if (!s) return null;
    if (isMgr(u) || s.advisor_id === u.id || (type === 'tenancy' && s.created_by === u.id)) return s;
    return null;
  }
  const logAccess = (docId, userId, action) => db.prepare('INSERT INTO doc_access (document_id, user_id, action) VALUES (?, ?, ?)').run(docId, userId, action);
  const types = ['lead', 'owner', 'tenancy'];
  const base = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;

  app.get('/api/files/:type/:id', auth.requireUser, (req, res) => {
    const { type } = req.params; const id = Number(req.params.id);
    if (!types.includes(type)) return res.status(404).json({ error: 'No existe' });
    const s = canSee(req.user, type, id);
    if (!s) return res.status(404).json({ error: 'No existe o no es tuyo' });
    const docs = core.docsOf(type, id);
    const links = db.prepare('SELECT id, created_at, expires_at, submitted_at, revoked_at FROM doc_links WHERE subject_type = ? AND subject_id = ? ORDER BY id DESC LIMIT 5').all(type, id);
    const log = docs.length ? db.prepare(`SELECT a.action, a.at, a.document_id, u.name AS user_name FROM doc_access a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.document_id IN (SELECT id FROM documents WHERE subject_type = ? AND subject_id = ?) ORDER BY a.id DESC LIMIT 40`).all(type, id) : [];
    let profile = null; try { profile = s.tenant_profile ? JSON.parse(s.tenant_profile) : null; } catch { /* sin perfil */ }
    res.json({ enabled: vlt.enabled, kinds: DOC_KINDS[type], status: s.file_status || null, profile, docs, links, log });
  });

  // Nuevo enlace privado (el anterior deja de servir). Se manda por WhatsApp desde el panel.
  app.post('/api/files/:type/:id/link', auth.requireUser, (req, res) => {
    const { type } = req.params; const id = Number(req.params.id);
    if (!types.includes(type)) return res.status(404).json({ error: 'No existe' });
    const s = canSee(req.user, type, id);
    if (!s) return res.status(404).json({ error: 'No existe o no es tuyo' });
    if (!vlt.enabled) return res.status(503).json({ error: 'La bóveda de documentos no está activa: falta la variable DOCS_KEY en Railway (ver PUBLICAR.md).' });
    if (type === 'tenancy' && s.status !== 'rentada') return res.status(400).json({ error: 'El portal de pagos es para propiedades rentadas.' });
    if (type === 'tenancy' && !s.phone) return res.status(400).json({ error: 'Falta el inquilino: marca como Firmado el lead de quien rentó.' });
    const now = isoNow();
    db.prepare('UPDATE doc_links SET revoked_at = ? WHERE subject_type = ? AND subject_id = ? AND revoked_at IS NULL').run(now, type, id);
    const token = crypto.randomBytes(24).toString('base64url');
    const days = type === 'tenancy' ? null : LINK_DAYS[type];
    const expires = days ? new Date(Date.now() + days * 86400e3).toISOString()
      : new Date(Math.max(Date.now() + 400 * 86400e3, s.contract_end ? new Date(`${s.contract_end}T12:00:00Z`).getTime() + 60 * 86400e3 : 0)).toISOString();
    db.prepare('INSERT INTO doc_links (subject_type, subject_id, token_hash, created_by, expires_at) VALUES (?, ?, ?, ?, ?)').run(type, id, auth.sha256(token), req.user.id, expires);
    if (type === 'lead') {
      db.prepare("UPDATE leads SET file_status = CASE WHEN file_status IN ('sin_iniciar','rechazado') THEN 'enviado' ELSE file_status END WHERE id = ?").run(id);
      db.prepare("INSERT INTO lead_events (lead_id, user_id, type, content) VALUES (?, ?, 'expediente', 'Se generó el enlace del expediente')").run(id, req.user.id);
    }
    if (type === 'owner') db.prepare("UPDATE owners SET file_status = CASE WHEN file_status IN ('sin_iniciar','rechazado') THEN 'enviado' ELSE file_status END WHERE id = ?").run(id);
    res.status(201).json({ url: `${base(req)}/${type === 'tenancy' ? 'portal' : 'expediente'}/${token}`, expires_at: expires, phone: s.phone, name: s.name });
  });

  app.get('/api/documents/:id/file', auth.requireUser, (req, res) => {
    const d = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
    if (!d || !canSee(req.user, d.subject_type, d.subject_id)) return res.status(404).json({ error: 'No existe o no es tuyo' });
    let buf;
    try { buf = vlt.get(d); } catch { return res.status(500).json({ error: 'No se pudo abrir el documento (revisa DOCS_KEY).' }); }
    logAccess(d.id, req.user.id, 'ver');
    const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[d.mime];
    res.set({ 'Content-Type': d.mime, 'Cache-Control': 'no-store', 'Content-Disposition': `inline; filename="${d.kind}-${d.id}.${ext}"`, 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'" }).send(buf);
  });
  app.post('/api/documents/:id/review', auth.requireUser, (req, res) => {
    const d = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
    if (!d || !canSee(req.user, d.subject_type, d.subject_id)) return res.status(404).json({ error: 'No existe o no es tuyo' });
    const status = req.body?.status;
    if (!['validado', 'rechazado', 'pendiente'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    if (status === 'rechazado' && !clip(req.body?.note, 300)) return res.status(400).json({ error: 'Escribe por qué se rechaza (lo verá quien lo subió).' });
    db.prepare('UPDATE documents SET status = ?, note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run(status, clip(req.body?.note, 300) || null, req.user.id, isoNow(), d.id);
    logAccess(d.id, req.user.id, status);
    if (d.subject_type === 'tenancy') db.prepare('UPDATE payments SET status = ?, note = ?, updated_by = ?, updated_at = ? WHERE document_id = ?').run(status, clip(req.body?.note, 300) || null, req.user.id, isoNow(), d.id);
    res.json({ ok: true });
  });
  // Borrar un documento (p. ej. cuando el titular ejerce su derecho de cancelación): solo Gerente o Dueño.
  app.delete('/api/documents/:id', auth.requireRole(...MANAGERS), (req, res) => {
    const d = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'No existe' });
    db.prepare('UPDATE documents SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(isoNow(), req.user.id, d.id);
    logAccess(d.id, req.user.id, 'eliminó');
    res.on('finish', () => { if (res.statusCode < 400) vlt.remove(d.file); });
    res.json({ ok: true });
  });
  // Resultado del expediente completo: lo decide el Gerente o el Dueño.
  app.post('/api/files/:type/:id/status', auth.requireRole(...MANAGERS), (req, res) => {
    const { type } = req.params; const id = Number(req.params.id);
    if (!['lead', 'owner'].includes(type)) return res.status(404).json({ error: 'No existe' });
    const st = req.body?.status;
    if (!['aprobado', 'rechazado', 'recibido'].includes(st)) return res.status(400).json({ error: 'Estado inválido' });
    if (!core.subject(type, id)) return res.status(404).json({ error: 'No existe' });
    db.prepare(`UPDATE ${type === 'lead' ? 'leads' : 'owners'} SET file_status = ? WHERE id = ?`).run(st, id);
    if (type === 'lead') db.prepare("INSERT INTO lead_events (lead_id, user_id, type, content) VALUES (?, ?, 'expediente', ?)").run(id, req.user.id, `Expediente ${st}`);
    res.json({ ok: true });
  });

  // Comprobantes por validar (para "Hoy"): los de las propiedades del asesor, o todos para Gerente y Dueño.
  app.get('/api/payments/pending', auth.requireUser, (req, res) => {
    const rows = db.prepare(`SELECT pa.id, pa.property_id, pa.month, pa.concept, pa.document_id, p.code, p.title, p.advisor_id, p.created_by FROM payments pa JOIN properties p ON p.id = pa.property_id
      WHERE pa.status = 'pendiente' AND pa.document_id IS NOT NULL ORDER BY pa.updated_at`).all();
    res.json(rows.filter((r) => isMgr(req.user) || r.advisor_id === req.user.id || r.created_by === req.user.id));
  });

  // Administración: pagos del inquilino por mes y concepto.
  app.get('/api/properties/:id/payments', auth.requireUser, (req, res) => {
    const s = canSee(req.user, 'tenancy', Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'No existe o no es tuyo' });
    const rows = db.prepare('SELECT * FROM payments WHERE property_id = ? ORDER BY month DESC').all(s.id);
    let inc = []; try { inc = JSON.parse(s.includes || '[]'); } catch { /* nada */ }
    // Conceptos que paga el inquilino: renta siempre, y los servicios que no van incluidos en la renta.
    const concepts = ['renta', ...['luz', 'agua', 'gas', 'internet'].filter((c) => !inc.map((x) => x.toLowerCase()).includes(c)), ...(s.maintenance && !inc.includes('Mantenimiento') ? ['mantenimiento'] : [])];
    res.json({ tenant: s.name ? { name: s.name, phone: s.phone } : null, concepts, rows });
  });
  app.put('/api/properties/:id/payments', auth.requireUser, (req, res) => {
    const s = canSee(req.user, 'tenancy', Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'No existe o no es tuyo' });
    const { month, concept, status } = req.body || {};
    if (!monthOk(month) || !PAY_CONCEPTS[concept] || !['pendiente', 'validado', 'rechazado'].includes(status)) return res.status(400).json({ error: 'Datos inválidos' });
    db.prepare(`INSERT INTO payments (property_id, month, concept, status, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(property_id, month, concept) DO UPDATE SET status = excluded.status, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(s.id, month, concept, status, clip(req.body.note, 300) || null, req.user.id, isoNow());
    res.json({ ok: true });
  });
}

module.exports = { publicDocsRoutes, panelDocsRoutes, docsCore };
