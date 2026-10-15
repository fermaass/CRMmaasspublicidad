// Fase 4: WhatsApp oficial (WhatsApp Cloud API de Meta). Solo manda plantillas aprobadas por Meta, porque los mensajes
// que inicia la empresa así lo exigen. Sin WA_TOKEN y WA_PHONE_ID no manda nada y el panel sigue con los enlaces wa.me.
// Cada mensaje lleva una llave única: aunque el proceso se repita, nunca sale dos veces el mismo.
const { localNow, addDays, PROP_SQL, shapeProp } = require('./data');
const { siteSettings, VISIBLE } = require('./db');
const { ownerReport } = require('./insights');

// Plantillas que el cliente debe dar de alta en Meta con estos nombres y en este orden de variables (ver WHATSAPP.md).
const TEMPLATES = {
  prospect: 'rp_cita_solicitada', // {{1}} nombre, {{2}} propiedad, {{3}} fecha, {{4}} hora, {{5}} folio
  advisor: 'rp_lead_nuevo', // {{1}} asesor, {{2}} prospecto, {{3}} WhatsApp del prospecto, {{4}} propiedad, {{5}} fecha y hora
  reminder: 'rp_recordatorio_cita', // {{1}} nombre, {{2}} propiedad, {{3}} hora, {{4}} zona
  weekly: 'rp_reporte_semanal', // {{1}} propietario, {{2}} propiedad, {{3}} visitas, {{4}} citas, {{5}} visitas realizadas, {{6}} recomendación
  file: 'rp_expediente_recibido', // {{1}} asesor, {{2}} quién, {{3}} qué (expediente, documentos o comprobante)
};
// Meta no acepta saltos de línea ni muchos espacios seguidos dentro de una variable.
const param = (v) => String(v == null || v === '' ? '—' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 900);
const fdate = (s) => { const a = String(s || '').split('-'); return a.length === 3 ? `${a[2]}/${a[1]}/${a[0]}` : '—'; };

function whatsapp(db, config, log = console) {
  const enabled = Boolean(config.waToken && config.waPhoneId);
  const already = db.prepare('SELECT 1 FROM wa_messages WHERE key = ?');
  const record = db.prepare('INSERT OR IGNORE INTO wa_messages (key, to_phone, template, status, error, wa_id) VALUES (?, ?, ?, ?, ?, ?)');

  async function sendTemplate(key, phone, template, params) {
    if (!enabled || !phone || already.get(key)) return false;
    // Se aparta la llave antes de mandar: si dos procesos coinciden, solo uno manda.
    if (!record.run(key, phone, template, 'enviando', null, null).changes) return false;
    try {
      const r = await fetch(`https://graph.facebook.com/${config.metaApiVersion}/${encodeURIComponent(config.waPhoneId)}/messages`, {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${config.waToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: `52${phone}`, type: 'template',
          template: { name: template, language: { code: config.waLang || 'es_MX' }, components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: param(t) })) }] } }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out?.error?.message || `Meta respondió ${r.status}`);
      db.prepare("UPDATE wa_messages SET status = 'enviado', wa_id = ? WHERE key = ?").run(out?.messages?.[0]?.id || null, key);
      return true;
    } catch (err) {
      db.prepare("UPDATE wa_messages SET status = 'error', error = ? WHERE key = ?").run(String(err.message).slice(0, 300), key);
      log.error(`WhatsApp (${template}) no salió:`, err.message);
      return false;
    }
  }
  const on = (k) => enabled && siteSettings(db).wa_auto[k];

  // Al agendar: confirmación al prospecto y aviso al asesor.
  function onLead(id) {
    const l = db.prepare(`SELECT l.*, p.code, p.title, u.name AS advisor_name, u.phone AS advisor_phone FROM leads l
      LEFT JOIN properties p ON p.id = l.property_id LEFT JOIN users u ON u.id = l.advisor_id WHERE l.id = ?`).get(id);
    if (!l) return;
    const prop = l.code ? `${l.title} (${l.code})` : 'la propiedad';
    if (on('prospect') && l.visit_date) sendTemplate(`prospect:${id}`, l.phone, TEMPLATES.prospect, [l.name.split(' ')[0], prop, fdate(l.visit_date), l.visit_time, `C-${id}`]);
    if (on('advisor') && l.advisor_phone) sendTemplate(`advisor:${id}:${l.advisor_id}`, l.advisor_phone, TEMPLATES.advisor, [l.advisor_name.split(' ')[0], l.name, l.phone, prop, l.visit_date ? `${fdate(l.visit_date)} ${l.visit_time}` : 'sin cita']);
  }
  // Expediente, documentos o comprobante recibido: aviso al asesor.
  function onFile(type, id) {
    if (!on('file')) return;
    const row = type === 'lead' ? db.prepare('SELECT l.name, u.name AS an, u.phone AS ap, u.id AS aid FROM leads l LEFT JOIN users u ON u.id = l.advisor_id WHERE l.id = ?').get(id)
      : type === 'owner' ? db.prepare('SELECT o.name, u.name AS an, u.phone AS ap, u.id AS aid FROM owners o LEFT JOIN users u ON u.id = o.advisor_id WHERE o.id = ?').get(id)
        : db.prepare('SELECT p.code AS name, u.name AS an, u.phone AS ap, u.id AS aid FROM properties p LEFT JOIN users u ON u.id = p.advisor_id WHERE p.id = ?').get(id);
    if (!row || !row.ap) return;
    const what = type === 'lead' ? 'su expediente' : type === 'owner' ? 'los documentos de su propiedad' : 'un comprobante de pago';
    sendTemplate(`file:${type}:${id}:${Date.now()}`, row.ap, TEMPLATES.file, [row.an.split(' ')[0], row.name, what]);
  }

  // Revisión periódica (cada 10 minutos): recordatorios de cita y reporte semanal del lunes.
  async function tick(now = localNow()) {
    if (!enabled) return;
    const s = siteSettings(db);
    if (s.wa_auto.reminder && now.time >= '18:00') {
      const tomorrow = addDays(now.date, 1);
      const L = db.prepare(`SELECT l.id, l.name, l.phone, l.visit_time, p.title, z.name AS zone FROM leads l JOIN properties p ON p.id = l.property_id JOIN zones z ON z.id = p.zone_id
        WHERE l.stage = 'cita' AND l.visit_date = ?`).all(tomorrow);
      for (const l of L) await sendTemplate(`reminder:${l.id}:${tomorrow}`, l.phone, TEMPLATES.reminder, [l.name.split(' ')[0], l.title, l.visit_time, l.zone]);
    }
    const monday = new Date(`${now.date}T12:00:00Z`).getUTCDay() === 1;
    if (s.wa_auto.weekly && monday && now.time >= '10:00') {
      const props = db.prepare(`${PROP_SQL} WHERE p.owner_id IS NOT NULL AND p.status IN (${[...VISIBLE, 'pausada'].map(() => '?').join(',')})`).all(...VISIBLE, 'pausada');
      for (const r of props) {
        const p = shapeProp(db, r);
        const o = db.prepare('SELECT name, phone FROM owners WHERE id = ?').get(p.owner_id);
        if (!o) continue;
        const rep = ownerReport(db, p, now.date);
        const ok = await sendTemplate(`weekly:${p.id}:${now.date}`, o.phone, TEMPLATES.weekly, [o.name.split(' ')[0], `${p.title} (${p.code})`, rep.week.views, rep.week.leads, rep.week.visited, rep.recommendation]);
        if (ok) db.prepare('INSERT INTO owner_reports (property_id, sent_by) VALUES (?, NULL)').run(p.id);
      }
    }
  }
  function start() {
    if (!enabled) return null;
    const run = () => tick().catch((err) => log.error('WhatsApp automático:', err.message));
    run();
    const t = setInterval(run, 10 * 60e3); t.unref();
    return t;
  }
  return { enabled, sendTemplate, onLead, onFile, tick, start, TEMPLATES };
}

module.exports = { whatsapp, TEMPLATES };
