// Fase 2: cruce de alertas, reporte semanal al propietario, opiniones y Resumen con números.
const { VISIBLE } = require('./db');
const { localNow, addDays, PROP_SQL, shapeProp } = require('./data');
const { money } = require('./seo');

// ---------- Alertas "Avísame" ----------
// filters = { zona, min, max, rec, ban, m2, extra } tal como los dejó el prospecto en el sitio.
function matchAlert(f, p) {
  return VISIBLE.includes(p.status) && (!f.zona || p.zone_slug === f.zona) && (!f.min || p.rent >= f.min) && (!f.max || p.rent <= f.max)
    && (!f.rec || (p.bedrooms || 0) >= f.rec) && (!f.ban || (p.bathrooms || 0) >= f.ban) && (!f.m2 || (p.m2 || 0) >= f.m2) && (!f.extra || p.extras.includes(f.extra));
}
const parseFilters = (v) => { try { return JSON.parse(v || '{}'); } catch { return {}; } };
// Solo cuentan las propiedades publicadas después de que se creó la alerta (o después del último aviso):
// lo que ya estaba cuando el prospecto buscó, ya lo vio.
function alertMatches(db) {
  const props = db.prepare(`${PROP_SQL} WHERE p.status IN (${VISIBLE.map(() => '?').join(',')})`).all(...VISIBLE).map((r) => shapeProp(db, r));
  return db.prepare("SELECT * FROM alerts WHERE status != 'cerrado' ORDER BY id DESC").all().map((a) => {
    const f = parseFilters(a.filters);
    const since = a.notified_at || a.created_at;
    const matches = props.filter((p) => matchAlert(f, p) && String(p.published_at || p.created_at) > since)
      .map((p) => ({ id: p.id, code: p.code, title: p.title, rent: p.rent, slug: p.seo_slug }));
    return { ...a, filters: f, matches };
  });
}
// Cuántas alertas abiertas coinciden con una propiedad recién publicada.
function alertsFor(db, propertyId) {
  const p = shapeProp(db, db.prepare(`${PROP_SQL} WHERE p.id = ?`).get(propertyId));
  if (!p || !VISIBLE.includes(p.status)) return 0;
  return db.prepare("SELECT filters FROM alerts WHERE status != 'cerrado'").all().filter((a) => matchAlert(parseFilters(a.filters), p)).length;
}

// ---------- Opiniones de visitas ----------
function opinionStats(db, propertyId) {
  const L = db.prepare('SELECT liked, rent_opinion, reason FROM opinions WHERE property_id = ?').all(propertyId);
  const reasons = {};
  L.forEach((o) => { if (o.reason) reasons[o.reason] = (reasons[o.reason] || 0) + 1; });
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
  return { n: L.length, liked: L.filter((o) => o.liked === 'si').length, high: L.filter((o) => o.rent_opinion === 'alta').length, top: top ? { reason: top[0], n: top[1] } : null };
}

// ---------- Reporte semanal al propietario ----------
// Recomendaciones por reglas simples (no adivinan: solo leen visitas, citas y opiniones).
function recommendation(p, s) {
  if (p.status === 'rentada') return 'Rentada. Revisar la renovación del contrato.';
  if (p.status === 'pausada') return 'Pausada por solicitud.';
  if (s.op.high >= 2 || (s.total.visited >= 3 && !s.total.signed)) {
    return `Considera ajustar el precio: ${s.op.high ? `${s.op.high} visitante(s) dicen que la renta es alta; ` : ''}${s.total.visited} visita(s) sin renta.`;
  }
  if (!s.total.leads && s.days >= 14) return `Sin citas en ${s.days} días: revisar fotos, título y precio.`;
  if (s.week.views >= 20 && !s.week.leads) return 'Muchas visitas a la ficha pero sin citas esta semana: revisar precio y fotos.';
  return 'Va bien: sin cambios por ahora.';
}
function ownerReport(db, p, today = localNow().date) {
  const from = addDays(today, -6);
  const week = db.prepare('SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(wa_clicks),0) AS wa FROM property_days WHERE property_id = ? AND day >= ?').get(p.id, from);
  const wl = db.prepare("SELECT COUNT(*) AS leads, SUM(visited_at IS NOT NULL AND substr(visited_at,1,10) >= ?) AS visited FROM leads WHERE property_id = ? AND substr(created_at,1,10) >= ?").get(from, p.id, from);
  const tl = db.prepare('SELECT COUNT(*) AS leads, SUM(visited_at IS NOT NULL) AS visited, SUM(signed_at IS NOT NULL) AS signed FROM leads WHERE property_id = ?').get(p.id);
  const pub = String(p.published_at || '').slice(0, 10);
  const days = pub ? Math.max(0, Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${pub}T12:00:00Z`)) / 864e5)) : 0;
  const s = { week: { views: week.views, wa: week.wa, leads: wl.leads, visited: wl.visited || 0 }, total: { views: p.views, leads: tl.leads, visited: tl.visited || 0, signed: tl.signed || 0 }, days, op: opinionStats(db, p.id) };
  s.recommendation = recommendation(p, s);
  const last = db.prepare('SELECT sent_at FROM owner_reports WHERE property_id = ? ORDER BY id DESC LIMIT 1').get(p.id);
  s.last_sent = last ? last.sent_at : null;
  return s;
}
function reportMessage(p, owner, s) {
  const op = s.op.n ? ` Opiniones de quienes la visitaron: a ${s.op.liked} de ${s.op.n} les gustó${s.op.high ? `, ${s.op.high} dicen que la renta es alta` : ''}${s.op.top ? `; lo más mencionado: ${s.op.top.reason.toLowerCase()}` : ''}.` : '';
  return `Hola${owner ? ` ${String(owner.name).split(' ')[0]}` : ''}, este es el resumen semanal de ${p.title} (${p.code}).`
    + ` Esta semana: ${s.week.views} visitas a la ficha, ${s.week.leads} cita(s) solicitada(s) y ${s.week.visited} visita(s) realizada(s).`
    + ` Desde que se publicó (${s.days} días): ${s.total.views} visitas a la ficha, ${s.total.leads} citas y ${s.total.visited} visitas realizadas.${op}`
    + ` Recomendación: ${s.recommendation}`;
}

// ---------- Resumen por periodo ----------
function periodRange(kind, today = localNow().date) {
  const m = today.slice(0, 7);
  if (kind === 'mes_pasado') {
    const d = new Date(`${m}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1);
    const pm = d.toISOString().slice(0, 7);
    return { from: `${pm}-01`, to: addDays(`${m}-01`, -1), months: [pm] };
  }
  if (kind === 'anio') {
    const y = today.slice(0, 4);
    return { from: `${y}-01-01`, to: today, months: Array.from({ length: Number(today.slice(5, 7)) }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`) };
  }
  if (kind === 'todo') return { from: '2000-01-01', to: today, months: null };
  return { from: `${m}-01`, to: today, months: [m] }; // este mes
}

function summary(db, kind, withCost) {
  const r = periodRange(kind);
  const leads = db.prepare(`SELECT l.origin, l.stage, l.confirmed_at, l.visited_at, l.signed_at, l.lost_reason, z.name AS zone, u.name AS advisor
    FROM leads l LEFT JOIN properties p ON p.id = l.property_id LEFT JOIN zones z ON z.id = p.zone_id LEFT JOIN users u ON u.id = l.advisor_id
    WHERE substr(l.created_at,1,10) BETWEEN ? AND ?`).all(r.from, r.to);
  const days = db.prepare('SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(wa_clicks),0) AS wa FROM property_days WHERE day BETWEEN ? AND ?').get(r.from, r.to);
  const count = (L) => ({ leads: L.length, confirmed: L.filter((l) => l.confirmed_at).length, visited: L.filter((l) => l.visited_at).length, signed: L.filter((l) => l.signed_at).length });
  const group = (key, none) => {
    const g = {};
    leads.forEach((l) => { const k = l[key] || none; (g[k] = g[k] || []).push(l); });
    return Object.entries(g).map(([k, L]) => ({ key: k, ...count(L) })).sort((a, b) => b.leads - a.leads);
  };
  const lost = {};
  leads.filter((l) => l.stage === 'perdido').forEach((l) => { lost[l.lost_reason || 'Sin motivo'] = (lost[l.lost_reason || 'Sin motivo'] || 0) + 1; });
  const out = { range: r, views: days.views, wa: days.wa, funnel: count(leads), byOrigin: group('origin', 'Directo'), byZone: group('zone', 'Sin propiedad'), byAdvisor: group('advisor', 'Sin asesor'),
    lost: Object.entries(lost).sort((a, b) => b[1] - a[1]) };
  if (withCost) {
    const spend = r.months
      ? db.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM meta_spend WHERE month IN (${r.months.map(() => '?').join(',')})`).get(...r.months).n
      : db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM meta_spend').get().n;
    const meta = count(leads.filter((l) => l.origin === 'Meta Ads'));
    const per = (n) => (n && spend ? Math.round(spend / n) : null);
    out.cost = { spend, meta, perLead: per(meta.leads), perVisit: per(meta.visited), perSigned: per(meta.signed) };
    out.spendMonths = db.prepare('SELECT * FROM meta_spend ORDER BY month DESC LIMIT 12').all();
  }
  return out;
}

// "Mis números" del asesor y comisión estimada con los supuestos del Dueño.
function myNumbers(db, userId, settings) {
  const m = localNow().date.slice(0, 7);
  const row = db.prepare(`SELECT COUNT(*) AS leads, SUM(visited_at IS NOT NULL) AS visited, SUM(signed_at IS NOT NULL) AS signed FROM leads WHERE advisor_id = ? AND substr(created_at,1,7) = ?`).get(userId, m);
  const signedRent = db.prepare(`SELECT COALESCE(SUM(p.rent),0) AS n FROM leads l JOIN properties p ON p.id = l.property_id WHERE l.advisor_id = ? AND substr(l.signed_at,1,7) = ?`).get(userId, m).n;
  const signedMonth = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE advisor_id = ? AND substr(signed_at,1,7) = ?').get(userId, m).n;
  return { month: m, leads: row.leads, visited: row.visited || 0, signed: signedMonth, commission: Math.round(signedRent * settings.commission_months * settings.commission_pct / 100) };
}

module.exports = { matchAlert, alertMatches, alertsFor, opinionStats, ownerReport, reportMessage, summary, periodRange, myNumbers, money };
