const { phoneKey, STATUSES, PROFILES, LABELS } = require('./db');

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
  };
  if (!lead.phone && !lead.email) throw new Error('Se necesita teléfono o email');

  const existing = findExisting(db, lead);
  if (existing) {
    const reopen = ['declinado', 'vendido'].includes(existing.status);
    db.prepare(`UPDATE leads SET
        name = COALESCE(name, ?), phone = COALESCE(phone, ?), phone_key = COALESCE(phone_key, ?),
        email = COALESCE(email, ?), campaign = COALESCE(?, campaign),
        channel_id = COALESCE(channel_id, ?), product_id = COALESCE(?, product_id),
        status = ?, updated_at = ? WHERE id = ?`)
      .run(lead.name, lead.phone, phoneKey(lead.phone), lead.email, lead.campaign, lead.channel_id, lead.product_id,
        reopen ? (existing.profile === 'cumple' ? 'nuevo_perfil' : 'nuevo') : existing.status, now(), existing.id);
    addEvent(db, existing.id, data.userId, 'contacto',
      `Nuevo contacto por ${LABELS[lead.source] || lead.source}${lead.campaign ? ` (${lead.campaign})` : ''}${lead.message ? `: ${lead.message}` : ''}`);
    if (reopen) addEvent(db, existing.id, data.userId, 'estado', `Reabierto (estaba ${existing.status})`);
    return { id: existing.id, created: false };
  }

  const ts = now();
  const { lastInsertRowid } = db.prepare(`INSERT INTO leads
      (name, phone, phone_key, email, source, campaign, message, channel_id, product_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(lead.name, lead.phone, phoneKey(lead.phone), lead.email, lead.source, lead.campaign, lead.message,
      lead.channel_id, lead.product_id, ts, ts);
  const id = Number(lastInsertRowid);
  addEvent(db, id, data.userId, 'creado', `Lead recibido por ${LABELS[lead.source] || lead.source}`);
  return { id, created: true };
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

module.exports = { ingestLead, addEvent, resolveStatusProfile, now };
