// Consultas que comparten el sitio público y el panel.
const { VISIBLE } = require('./db');

const TZ = 'America/Mexico_City'; // Querétaro
// Fecha y hora de Querétaro (el servidor corre en UTC).
function localNow(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime());

const parseList = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

const PROP_SQL = `SELECT p.*, z.name AS zone, z.slug AS zone_slug, u.name AS advisor_name, u.phone AS advisor_phone
  FROM properties p JOIN zones z ON z.id = p.zone_id LEFT JOIN users u ON u.id = p.advisor_id`;

function shapeProp(db, row) {
  if (!row) return null;
  const photos = db.prepare('SELECT id, file FROM photos WHERE property_id = ? ORDER BY position, id').all(row.id);
  return { ...row, extras: parseList(row.extras), includes: parseList(row.includes), photos };
}
function getProp(db, id) { return shapeProp(db, db.prepare(`${PROP_SQL} WHERE p.id = ?`).get(id)); }
function visibleProps(db) {
  return db.prepare(`${PROP_SQL} WHERE p.status IN (${VISIBLE.map(() => '?').join(',')}) ORDER BY p.published_at DESC, p.id DESC`).all(...VISIBLE)
    .map((r) => shapeProp(db, r));
}

// Lo que se puede mostrar en público (sin dirección exacta, propietario ni datos internos).
function publicProp(p) {
  return {
    id: p.id, code: p.code, title: p.title, prop_type: p.prop_type, zone: p.zone, zone_slug: p.zone_slug, colonia: p.colonia,
    rent: p.rent, deposit_months: p.deposit_months, maintenance: p.maintenance, m2: p.m2, bedrooms: p.bedrooms, bathrooms: p.bathrooms,
    parking: p.parking, max_occupants: p.max_occupants, min_term: p.min_term, extras: p.extras, includes: p.includes, near: p.near,
    consider_note: p.consider_note, description: p.description, requirements: p.requirements, available_from: p.available_from,
    status: p.status, slug: p.seo_slug, photo: p.photos[0] ? p.photos[0].file : null, advisor: p.advisor_name ? p.advisor_name.split(' ')[0] : '',
  };
}

// Similares: misma zona primero y luego renta más parecida.
function similar(list, p, n = 3) {
  return list.filter((x) => x.id !== p.id)
    .sort((a, b) => ((a.zone_id === p.zone_id ? 0 : 1e6) + Math.abs(a.rent - p.rent)) - ((b.zone_id === p.zone_id ? 0 : 1e6) + Math.abs(b.rent - p.rent)))
    .slice(0, n);
}

// Horarios ocupados de una propiedad: citas que siguen vivas (no perdidas).
function takenSlots(db, propertyId, from) {
  return db.prepare(`SELECT visit_date, visit_time FROM leads WHERE property_id = ? AND visit_date >= ? AND stage NOT IN ('perdido')`)
    .all(propertyId, from).map((r) => `${r.visit_date} ${r.visit_time}`);
}

// Los próximos días con sus horarios libres (en hora de Querétaro).
function slotsFor(db, propertyId, hours, days, now = localNow()) {
  const taken = new Set(takenSlots(db, propertyId, now.date));
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(now.date, i);
    out.push({ date, slots: hours.map((h) => ({ time: h, free: !taken.has(`${date} ${h}`) && !(i === 0 && h <= now.time) })) });
  }
  return out;
}

// Origen del lead según el utm_source del anuncio.
function originOf(source) {
  const s = String(source || '').trim();
  if (!s) return 'Directo';
  if (/face|insta|meta|fb|ig/i.test(s)) return 'Meta Ads';
  if (/goo|adwords|gads/i.test(s)) return 'Google';
  return s.slice(0, 40);
}

module.exports = { TZ, localNow, addDays, isDate, parseList, PROP_SQL, shapeProp, getProp, visibleProps, publicProp, similar, takenSlots, slotsFor, originOf };
