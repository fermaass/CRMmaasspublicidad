const { phoneKey, STATUSES, PROFILES, LABELS, FOLLOWUP, getSetting } = require('./db');

const now = () => new Date().toISOString();

function addEvent(db, leadId, userId, type, content) {
  db.prepare('INSERT INTO lead_events (lead_id, user_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(leadId, userId ?? null, type, content ?? null, now());
}

function findExisting(db, { phone, email }) {
  const key = phoneKey(phone);
  if (key) {
    const byPhone = db.prepare('SELECT * FROM leads WHERE phone_key = ? ORDER BY id LIMIT 1').get(key);
    if (byPhone) return byPhone;
  }
  if (email) {
    return db.prepare('SELECT * FROM leads WHERE email = ? ORDER BY id LIMIT 1').get(String(email).trim()) || null;
  }
  return null;
}

// Nombre de campaña tal como está en la lista (sin importar mayúsculas). Si no existe y se permite, se agrega.
function campaignName(db, value, { create = false } = {}) {
  const name = value == null ? '' : String(value).trim().slice(0, 120);
  if (!name) return null;
  const found = db.prepare("SELECT name FROM catalog_items WHERE kind = 'campana' AND name = ? COLLATE NOCASE").get(name);
  if (found) return found.name;
  if (!create) throw new Error('Esa campaña no está en la lista');
  db.prepare("INSERT INTO catalog_items (kind, name) VALUES ('campana', ?)").run(name);
  return name;
}

/**
 * Alta de un lead (formulario o captura manual). Si el contacto ya existe no se duplica:
 * se registra el nuevo mensaje en su historial y, si estaba declinado o vendido, se reabre como nuevo
 * (conservando su perfil) para que ventas lo vea.
 */
function ingestLead(db, data) {
  const clean = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, 2000));
  const lead = {
    name: clean(data.name), phone: clean(data.phone), email: clean(data.email),
    campaign: clean(data.campaign), message: clean(data.message), source: data.source,
    channel_id: data.channel_id || null, product_id: data.product_id || null,
    utm_source: clean(data.utm_source), utm_medium: clean(data.utm_medium), utm_content: clean(data.utm_content),
  };
  if (!lead.phone && !lead.email) throw new Error('Se necesita teléfono o email');

  const existing = findExisting(db, lead);
  if (existing) {
    const reopen = ['declinado', 'vendido'].includes(existing.status);
    db.prepare(`UPDATE leads SET
        name = COALESCE(name, ?), phone = COALESCE(phone, ?), phone_key = COALESCE(phone_key, ?),
        email = COALESCE(email, ?), campaign = COALESCE(?, campaign),
        channel_id = COALESCE(channel_id, ?), product_id = COALESCE(?, product_id),
        utm_source = COALESCE(?, utm_source), utm_medium = COALESCE(?, utm_medium), utm_content = COALESCE(?, utm_content),
        recontact_at = CASE WHEN ? THEN NULL ELSE recontact_at END,
        status = ?, updated_at = ? WHERE id = ?`)
      .run(lead.name, lead.phone, phoneKey(lead.phone), lead.email, lead.campaign, lead.channel_id, lead.product_id,
        lead.utm_source, lead.utm_medium, lead.utm_content, reopen ? 1 : 0,
        reopen ? (existing.profile === 'cumple' ? 'nuevo_perfil' : 'nuevo') : existing.status, now(), existing.id);
    addEvent(db, existing.id, data.userId, 'contacto',
      `Nuevo contacto por ${LABELS[lead.source] || lead.source}${lead.campaign ? ` (${lead.campaign})` : ''}${lead.message ? `: ${lead.message}` : ''}`);
    if (reopen) addEvent(db, existing.id, data.userId, 'estado', `Reabierto (estaba ${existing.status})`);
    return { id: existing.id, created: false };
  }

  const ts = now();
  const { lastInsertRowid } = db.prepare(`INSERT INTO leads
      (name, phone, phone_key, email, source, campaign, message, channel_id, product_id,
       utm_source, utm_medium, utm_content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(lead.name, lead.phone, phoneKey(lead.phone), lead.email, lead.source, lead.campaign, lead.message,
      lead.channel_id, lead.product_id, lead.utm_source, lead.utm_medium, lead.utm_content, ts, ts);
  const id = Number(lastInsertRowid);
  addEvent(db, id, data.userId, 'creado', `Lead recibido por ${LABELS[lead.source] || lead.source}`);
  return { id, created: true };
}

const ACTIVE = "('nuevo', 'nuevo_perfil', 'cotizando')";

// Carga de cada vendedor activo: leads en curso, pendientes vencidos y cuántos recibió en los últimos 7 días.
function workload(db) {
  const sellers = db.prepare(`SELECT u.id, u.name,
      COUNT(CASE WHEN l.status IN ${ACTIVE} THEN 1 END) AS activos,
      COUNT(CASE WHEN l.status IN ('nuevo', 'nuevo_perfil') THEN 1 END) AS por_cotizar,
      COUNT(CASE WHEN l.status = 'cotizando' THEN 1 END) AS cotizando,
      COUNT(CASE WHEN l.assigned_at >= ? THEN 1 END) AS asignados_semana
    FROM users u LEFT JOIN leads l ON l.assigned_to = u.id
    WHERE u.role = 'vendedor' AND u.active = 1 GROUP BY u.id ORDER BY u.name`).all(new Date(Date.now() - 7 * FOLLOWUP.DAY).toISOString());
  const vencidos = {};
  for (const l of db.prepare(`SELECT * FROM leads WHERE assigned_to IS NOT NULL AND status IN ${ACTIVE}`).all()) {
    const a = FOLLOWUP.nextAction(l);
    if (a && FOLLOWUP.dayDiff(a.due) < 0) vencidos[l.assigned_to] = (vencidos[l.assigned_to] || 0) + 1;
  }
  sellers.forEach((s) => { s.vencidos = vencidos[s.id] || 0; });
  return sellers;
}

// A quién le toca: el vendedor con menos leads en curso; si empatan, el que recibió menos esta semana.
function suggestSeller(db) {
  return [...workload(db)].sort((a, b) => a.activos - b.activos || a.asignados_semana - b.asignados_semana || a.id - b.id)[0] || null;
}

function assignTo(db, leadId, seller, userId, how) {
  const ts = now();
  db.prepare('UPDATE leads SET assigned_to = ?, assigned_at = ?, updated_at = ? WHERE id = ?').run(seller.id, ts, ts, leadId);
  addEvent(db, leadId, userId, 'asignacion', `${how} a ${seller.name}`);
}

// Asignación automática al vendedor con menos carga. Está apagada salvo que se encienda en Configuración.
function autoAssign(db, leadId) {
  if (getSetting(db, 'auto_assign') !== '1') return null;
  const lead = db.prepare('SELECT l.assigned_to, u.active FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = ?').get(leadId);
  if (!lead || (lead.assigned_to && lead.active)) return null;
  const next = suggestSeller(db);
  if (!next) return null;
  assignTo(db, leadId, next, null, 'Asignado automáticamente');
  return next.name;
}

// Reparte todos los leads en curso sin dueño, uno por uno, siempre al de menor carga.
function balanceUnassigned(db, userId) {
  const ids = db.prepare(`SELECT id FROM leads WHERE assigned_to IS NULL AND status IN ${ACTIVE} ORDER BY created_at`).all();
  let n = 0;
  for (const { id } of ids) {
    const next = suggestSeller(db);
    if (!next) break;
    assignTo(db, id, next, userId, 'Asignado por carga pareja');
    n++;
  }
  return n;
}

/**
 * Aplica cambios de estado/perfil manteniéndolos coherentes:
 * - pasar a "nuevo_perfil" marca el perfil como "cumple"
 * - marcar "cumple" a un lead en "nuevo" lo pasa a "nuevo_perfil" (y al revés)
 * El perfil nunca se borra al declinar: es lo que permite recuperar leads para otras campañas.
 */
function resolveStatusProfile(current, changes) {
  let status = changes.status ?? current.status;
  let profile = changes.profile ?? current.profile;
  if (!STATUSES.includes(status)) throw new Error('Estado inválido');
  if (!PROFILES.includes(profile)) throw new Error('Perfil inválido');

  if (changes.status === 'nuevo_perfil') profile = 'cumple';
  if (status === 'nuevo' && profile === 'cumple') status = 'nuevo_perfil';
  if (status === 'nuevo_perfil' && profile !== 'cumple') status = 'nuevo';
  return { status, profile };
}

// Cuando un vendedor se desactiva o deja de ser vendedor, sus leads en curso quedan sin asignar para repartirlos.
function releaseLeads(db, userId, byUserId, name) {
  const ids = db.prepare(`SELECT id FROM leads WHERE assigned_to = ? AND status IN ${ACTIVE}`).all(userId);
  const ts = now();
  for (const { id } of ids) {
    db.prepare('UPDATE leads SET assigned_to = NULL, assigned_at = NULL, updated_at = ? WHERE id = ?').run(ts, id);
    addEvent(db, id, byUserId, 'asignacion', `Quedó sin vendedor: ${name} ya no está activo`);
  }
  return ids.length;
}

module.exports = { releaseLeads, ingestLead, campaignName, autoAssign, workload, suggestSeller, balanceUnassigned, addEvent, resolveStatusProfile, now };
