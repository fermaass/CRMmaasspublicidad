// Sitio público (rentaypunto.com): páginas, mapa del sitio y formularios. Sin login ni enlaces al panel.
const path = require('node:path');
const express = require('express');
const V = require('./views');
const { siteSettings, phone10, VISIBLE, EXTRAS } = require('./db');
const { visibleProps, publicProp, similar, slotsFor, localNow, isDate, originOf, PROP_SQL, shapeProp } = require('./data');
const { transactionalRoutes } = require('./tx');
const { opinionStats } = require('./insights');
const { CITY, landingsFor, landing, IDEAL_LINK } = require('./landings');
const { indexNowKey } = require('./indexnow');
const { parseCookies } = require('./auth');
const { publicDocsRoutes } = require('./docs');

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse/i;
const clientIp = (req) => String(req.get('cf-connecting-ip') || req.ip || '');
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function rateLimiter(max, ms) {
  const hits = new Map();
  return {
    hit(key) {
      const now = Date.now(); const h = hits.get(key);
      if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + ms }); if (hits.size > 5000) hits.clear(); return false; }
      h.n += 1; return h.n > max;
    },
  };
}

function siteRouter({ db, config, notify, onLead, meta, vlt, onFileReceived }) {
  const app = transactionalRoutes(express.Router(), db);
  const forms = rateLimiter(20, 10 * 60e3); // 20 envíos por conexión cada 10 minutos
  const zones = () => db.prepare('SELECT * FROM zones WHERE active = 1 ORDER BY name').all();
  const ctxOf = (req) => ({
    siteUrl: config.siteUrl || `${req.protocol}://${req.get('host')}`,
    settings: siteSettings(db), today: localNow().date, version: config.version,
  });
  const visible = () => visibleProps(db).map((p) => ({ ...publicProp(p), zone_id: p.zone_id, photos_all: p.photos }));
  const html = (res, body, status = 200) => res.status(status).type('html').set('Cache-Control', 'no-cache').send(body);

  app.use('/sitio', express.static(path.join(__dirname, '..', 'public', 'sitio'), { maxAge: '7d' }));
  app.use('/api', express.json({ limit: '100kb' }));

  // ---------- Páginas ----------
  app.get('/', (req, res) => {
    const q = req.query;
    const f = { zona: clip(q.zona, 60), min: Number(q.min) || '', max: Number(q.max) || '', rec: Number(q.rec) || '', ban: Number(q.ban) || '', m2: Number(q.m2) || '', extra: EXTRAS.includes(q.extra) ? q.extra : '', orden: ['precio', '-precio'].includes(q.orden) ? q.orden : '' };
    const all = visible();
    let list = all.filter((p) => (!f.zona || p.zone_slug === f.zona) && (!f.min || p.rent >= f.min) && (!f.max || p.rent <= f.max)
      && (!f.rec || p.bedrooms >= f.rec) && (!f.ban || p.bathrooms >= f.ban) && (!f.m2 || p.m2 >= f.m2) && (!f.extra || p.extras.includes(f.extra)));
    if (f.orden) list = list.slice().sort((a, b) => (f.orden === 'precio' ? a.rent - b.rent : b.rent - a.rent));
    html(res, V.home(ctxOf(req), { list, all, zones: zones(), f, cityLandings: landingsFor({ id: 0, slug: CITY.slug, name: CITY.name }, all) }));
  });

  app.get('/renta-tu-propiedad', (req, res) => {
    // Referencia para el estimador: rentas de nuestras propiedades (sin datos de nadie).
    const ref = db.prepare(`SELECT z.name AS zone, p.bedrooms, p.rent FROM properties p JOIN zones z ON z.id = p.zone_id WHERE p.status != 'borrador' AND p.rent > 0`).all();
    html(res, V.owners(ctxOf(req), { zones: zones(), ref }));
  });
  app.get('/ayuda', (req, res) => html(res, V.help(ctxOf(req))));
  app.get('/quejas', (req, res) => html(res, V.complaints(ctxOf(req))));
  app.get('/certeza-juridica', (req, res) => html(res, V.legal(ctxOf(req))));
  app.get('/aviso-de-privacidad', (req, res) => html(res, V.privacy(ctxOf(req))));

  const CITY_ZONE = { id: 0, slug: CITY.slug, name: CITY.name };
  const zoneBySlug = (slug) => (slug === CITY.slug ? CITY_ZONE : db.prepare('SELECT * FROM zones WHERE slug = ? AND active = 1').get(slug));
  const inZone = (zone, all) => (zone.slug === CITY.slug ? all : all.filter((p) => p.zone_slug === zone.slug));

  // Zona (o todo Querétaro en /renta/queretaro): listado, texto propio de la zona y páginas por búsqueda.
  app.get('/renta/:zona', (req, res) => {
    const zone = zoneBySlug(req.params.zona);
    if (!zone) return html(res, V.notFound(ctxOf(req)), 404);
    const list = inZone(zone, visible());
    html(res, V.zonePage(ctxOf(req), { zone, list, zones: zones(), landings: landingsFor(zone, list) }));
  });

  // /renta/<zona>/<algo>: si termina en el código (rp-0001) es una ficha; si no, una página por búsqueda.
  app.get('/renta/:zona/:slug', (req, res) => {
    if (!/rp-\d+$/i.test(req.params.slug)) {
      const zone = zoneBySlug(req.params.zona);
      const all = visible();
      const lg = zone && landing(req.params.slug, zone, inZone(zone, all));
      if (!lg) return html(res, V.notFound(ctxOf(req)), 404);
      // Sin propiedades por ahora: a la zona (temporal, para que la página regrese cuando haya).
      if (!lg.n) return res.redirect(302, `/renta/${zone.slug}`);
      const related = landingsFor(zone, inZone(zone, all)).filter((x) => x.key !== lg.key);
      const sameInZones = zone.slug === CITY.slug ? zones().map((z) => landing(lg.key, z, inZone(z, all))).filter((x) => x && x.n) : [];
      return html(res, V.landingPage(ctxOf(req), { lg, related, sameInZones }));
    }
    const want = `renta/${req.params.zona}/${req.params.slug}`;
    let row = db.prepare(`${PROP_SQL} WHERE p.seo_slug = ?`).get(want);
    if (!row) {
      const m = req.params.slug.match(/(rp-\d+)$/i);
      const byCode = m && db.prepare(`${PROP_SQL} WHERE p.code = ? COLLATE NOCASE`).get(m[1]);
      if (byCode && byCode.status !== 'borrador') return res.redirect(301, `/${byCode.seo_slug}`);
      return html(res, V.notFound(ctxOf(req)), 404);
    }
    if (row.status === 'borrador') return html(res, V.notFound(ctxOf(req)), 404);
    // Rentada hace más de 30 días: su dirección manda a la página de su zona, así no se pierde lo que ganó en Google.
    if (row.status === 'rentada' && row.rented_at && Date.now() - new Date(row.rented_at).getTime() > 30 * 86400e3) return res.redirect(301, `/renta/${row.zone_slug}`);
    const full = shapeProp(db, row);
    const gone = !VISIBLE.includes(full.status);
    if (!gone && !BOT.test(req.get('user-agent') || '')) {
      db.prepare('UPDATE properties SET views = views + 1 WHERE id = ?').run(full.id);
      db.prepare('INSERT INTO property_days (property_id, day, views) VALUES (?, ?, 1) ON CONFLICT(property_id, day) DO UPDATE SET views = views + 1').run(full.id, localNow().date);
    }
    const p = { ...publicProp(full), photos: full.photos, seo_title: full.seo_title, seo_desc: full.seo_desc, published_at: full.published_at, created_at: full.created_at, h1: `${full.title} en renta en ${full.zone}` };
    const ctx = ctxOf(req);
    const s = ctx.settings;
    const all = visible();
    const sim = similar(all, { ...p, zone_id: full.zone_id });
    // "Ideal para estudiantes" enlaza a la página de estudiantes de su zona; abajo, más búsquedas de la zona.
    const zone = { id: full.zone_id, slug: full.zone_slug, name: full.zone };
    const zl = landingsFor(zone, inZone(zone, all));
    const idealLinks = Object.fromEntries(Object.entries(IDEAL_LINK).map(([who, key]) => [who, zl.some((l) => l.key === key) ? `/renta/${zone.slug}/${key}` : `/renta/${CITY.slug}/${key}`]));
    // Rentada (menos de 30 días) o pausada: se ve con similares, pero no se indexa.
    html(res, V.ficha(ctx, { p, sim, op: opinionStats(db, full.id), idealLinks, zoneLandings: zl, slots: gone ? [] : slotsFor(db, full.id, s.visit_hours, s.visit_days) }));
  });

  app.get('/robots.txt', (req, res) => {
    const base = config.siteUrl || `${req.protocol}://${req.get('host')}`;
    res.type('text').send(`User-agent: *\nDisallow: /api/\nDisallow: /expediente/\nDisallow: /portal/\nDisallow: /opinion/\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
  });
  // Llave de IndexNow (Bing y otros buscadores la piden para aceptar los avisos de páginas nuevas).
  app.get('/:key.txt', (req, res, next) => {
    const key = indexNowKey(db);
    if (req.params.key !== key) return next();
    res.type('text').send(key);
  });
  // El mapa del sitio solo lleva lo publicado: sin rentadas, pausadas ni borradores. Las páginas por búsqueda, solo si tienen 2 o más.
  app.get('/sitemap.xml', (req, res) => {
    const all = visible().map((p) => ({ ...p, updated_at: db.prepare('SELECT updated_at FROM properties WHERE id = ?').get(p.id).updated_at }));
    const latest = (L) => L.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), '');
    const zs = zones().filter((z) => all.some((p) => p.zone_slug === z.slug)).map((z) => ({ ...z, lastmod: [latest(all.filter((p) => p.zone_slug === z.slug)), z.updated_at || ''].sort().pop() }));
    const lgs = [CITY_ZONE, ...zs].flatMap((z) => landingsFor(z, inZone(z, all)).filter((l) => l.indexable).map((l) => ({ ...l, lastmod: latest(l.list) })));
    const props = all.map((p) => ({ seo_slug: p.slug, updated_at: p.updated_at, photos: p.photos_all }));
    res.type('application/xml').send(V.sitemap(ctxOf(req), { props, zones: zs, landings: lgs, lastmod: latest(all) }));
  });

  // ---------- Formularios (JSON) ----------
  const guard = (req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Se espera JSON' });
    if (forms.hit(clientIp(req))) return res.status(429).json({ error: 'Demasiados envíos. Espera unos minutos e intenta de nuevo.' });
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true, folio: '—' }); // trampa para robots: se finge éxito y no se guarda
    if (!b.privacy) return res.status(400).json({ error: 'Acepta el aviso de privacidad para continuar.' });
    next();
  };

  // Agendar visita: crea el lead con la propiedad elegida y se lo asigna al asesor de esa propiedad.
  app.post('/api/visita', guard, (req, res) => {
    const b = req.body;
    const p = db.prepare(`SELECT id, code, title, status, advisor_id, rent, seo_slug FROM properties WHERE id = ?`).get(Number(b.property_id));
    if (!p || !VISIBLE.includes(p.status)) return res.status(404).json({ error: 'Esta propiedad ya no está disponible.' });
    const name = clip(b.name, 80); const phone = phone10(b.phone);
    if (!name) return res.status(400).json({ error: 'Escribe tu nombre.' });
    if (!phone) return res.status(400).json({ error: 'Escribe tu WhatsApp a 10 dígitos.' });
    const s = siteSettings(db);
    const now = localNow();
    const slots = slotsFor(db, p.id, s.visit_hours, s.visit_days, now);
    const day = slots.find((d) => d.date === b.date);
    const slot = day && day.slots.find((x) => x.time === b.time);
    if (!isDate(b.date) || !slot) return res.status(400).json({ error: 'Elige un día y una hora de los que aparecen.' });
    if (!slot.free) return res.status(409).json({ error: 'Ese horario ya no está disponible. Elige otro.' });
    const u = b.utm && typeof b.utm === 'object' ? b.utm : {};
    const id = Number(db.prepare(`INSERT INTO leads (property_id, name, phone, visit_date, visit_time, advisor_id, origin, utm_source, utm_medium, utm_campaign, utm_content, search_context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, name, phone, b.date, b.time, p.advisor_id, originOf(u.source),
      clip(u.source, 80) || null, clip(u.medium, 80) || null, clip(u.campaign, 120) || null, clip(u.content, 120) || null, clip(b.busca, 300) || null).lastInsertRowid);
    db.prepare("INSERT INTO lead_events (lead_id, type, content) VALUES (?, 'creado', ?)").run(id, `Solicitó visita a ${p.code} el ${b.date} a las ${b.time}`);
    const ck = parseCookies(req.headers.cookie);
    const capi = { pixelId: s.meta_pixel_id, leadId: id, phone, firstName: name.split(' ')[0], url: `${config.siteUrl || `${req.protocol}://${req.get('host')}`}/${p.seo_slug}`,
      ip: clientIp(req), ua: req.get('user-agent'), fbp: ck._fbp, fbc: ck._fbc, code: p.code, rent: p.rent };
    res.on('finish', () => { if (res.statusCode < 400) { onLead(id); meta.sendLead(capi); } });
    // event_id: el píxel del navegador manda el mismo, así Meta no la cuenta dos veces.
    res.status(201).json({ ok: true, folio: `C-${id}`, event_id: `lead-${id}`, code: p.code, rent: p.rent });
  });

  app.post('/api/avisame', guard, (req, res) => {
    const b = req.body; const phone = phone10(b.phone);
    if (!phone) return res.status(400).json({ error: 'Escribe tu WhatsApp a 10 dígitos.' });
    const f = b.filters && typeof b.filters === 'object' ? b.filters : {};
    const clean = { zona: clip(f.zona, 60), min: Number(f.min) || 0, max: Number(f.max) || 0, rec: Number(f.rec) || 0, ban: Number(f.ban) || 0, m2: Number(f.m2) || 0, extra: EXTRAS.includes(f.extra) ? f.extra : '' };
    const text = V.filtersText(clean, db.prepare('SELECT * FROM zones').all());
    const id = Number(db.prepare('INSERT INTO alerts (name, phone, filters, filters_text) VALUES (?, ?, ?, ?)').run(clip(b.name, 80) || null, phone, JSON.stringify(clean), text).lastInsertRowid);
    res.status(201).json({ ok: true, folio: `A-${id}` });
  });

  app.post('/api/propietario', guard, (req, res) => {
    const b = req.body; const phone = phone10(b.phone); const name = clip(b.name, 80);
    if (!name) return res.status(400).json({ error: 'Escribe tu nombre.' });
    if (!phone) return res.status(400).json({ error: 'Escribe tu WhatsApp a 10 dígitos.' });
    if (!Number(b.bedrooms)) return res.status(400).json({ error: 'Elige cuántas recámaras tiene.' });
    if (!Number(b.expected_rent)) return res.status(400).json({ error: 'Escribe la renta que esperas.' });
    const id = Number(db.prepare(`INSERT INTO owners (name, phone, best_time, prop_type, zone, colonia, bedrooms, m2, expected_rent, occupied, available_from, furnished, pets, listed_elsewhere, lives_outside, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(name, phone, clip(b.best_time, 20), clip(b.prop_type, 30), clip(b.zone, 60), clip(b.colonia, 120),
      Number(b.bedrooms) || null, Number(b.m2) || null, Number(b.expected_rent) || null, clip(b.occupied, 40), isDate(b.available_from) ? b.available_from : null,
      clip(b.furnished, 10), clip(b.pets, 10), clip(b.listed_elsewhere, 5), clip(b.lives_outside, 5), clip(b.notes, 1000)).lastInsertRowid);
    res.on('finish', () => { if (res.statusCode < 400) notify.staff('Nuevo propietario registrado', `${name} (${phone}) registró ${b.prop_type || 'una propiedad'} en ${b.zone || '—'}. Revísalo en el panel → Seguimiento.`); });
    res.status(201).json({ ok: true, folio: `P-${id}` });
  });

  app.post('/api/queja', guard, (req, res) => {
    const b = req.body; const message = clip(b.message, 2000); const contact = clip(b.contact, 120);
    if (!message) return res.status(400).json({ error: 'Escribe tu mensaje.' });
    if (!contact) return res.status(400).json({ error: 'Déjanos un WhatsApp o correo para responderte.' });
    const kind = ['Queja', 'Inconformidad', 'Sugerencia'].includes(b.kind) ? b.kind : 'Queja';
    const id = Number(db.prepare('INSERT INTO tickets (kind, name, contact, property_ref, message) VALUES (?, ?, ?, ?, ?)')
      .run(kind, clip(b.name, 80) || null, contact, clip(b.property_ref, 40) || null, message).lastInsertRowid);
    res.on('finish', () => { if (res.statusCode < 400) notify.staff(`${kind} #${id}`, `${message}\n\nContacto: ${contact}`); });
    res.status(201).json({ ok: true, folio: `#${id}` });
  });

  app.post('/api/juridico', guard, (req, res) => {
    const b = req.body; const phone = phone10(b.phone); const name = clip(b.name, 80);
    if (!name || !phone) return res.status(400).json({ error: 'Completa nombre y WhatsApp a 10 dígitos.' });
    const id = Number(db.prepare('INSERT INTO legal_requests (name, phone, who) VALUES (?, ?, ?)').run(name, phone, b.who === 'Propietario' ? 'Propietario' : 'Inquilino').lastInsertRowid);
    res.status(201).json({ ok: true, folio: `J-${id}` });
  });

  // Conteo de clics a WhatsApp (por propiedad, o 0 = el botón general de la portada).
  app.post('/api/wa-click', (req, res) => {
    const id = Number(req.body?.property_id) || 0;
    if (forms.hit(`wa:${clientIp(req)}`)) return res.status(204).end();
    if (id && db.prepare('UPDATE properties SET wa_clicks = wa_clicks + 1 WHERE id = ?').run(id).changes) {
      db.prepare('INSERT INTO property_days (property_id, day, wa_clicks) VALUES (?, ?, 1) ON CONFLICT(property_id, day) DO UPDATE SET wa_clicks = wa_clicks + 1').run(id, localNow().date);
    }
    else db.prepare("INSERT INTO settings (key, value) VALUES ('wa_clicks_home', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1").run();
    res.status(204).end();
  });

  publicDocsRoutes(app, { db, vlt, views: V, ctxOf, limiter: rateLimiter(80, 10 * 60e3), clientIp, onFileReceived });

  // Opinión después de la visita: el asesor manda el enlace por WhatsApp; sirve una sola vez y no pide nombre.
  const opinionLead = (token) => (/^[\w-]{16,64}$/.test(String(token || '')) ? db.prepare(`SELECT l.id, l.property_id, p.title, p.code FROM leads l
    JOIN properties p ON p.id = l.property_id WHERE l.opinion_token = ?`).get(String(token)) : null);
  app.get('/opinion/:token', (req, res) => {
    const l = opinionLead(req.params.token);
    const done = l && db.prepare('SELECT 1 FROM opinions WHERE lead_id = ?').get(l.id);
    html(res, V.opinion(ctxOf(req), { l, done, token: req.params.token }), l ? 200 : 404);
  });
  app.post('/api/opinion', (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Se espera JSON' });
    if (forms.hit(clientIp(req))) return res.status(429).json({ error: 'Demasiados envíos. Espera unos minutos.' });
    const b = req.body || {};
    const l = opinionLead(b.token);
    if (!l) return res.status(404).json({ error: 'Este enlace ya no sirve.' });
    if (db.prepare('SELECT 1 FROM opinions WHERE lead_id = ?').get(l.id)) return res.status(409).json({ error: 'Ya recibimos tu opinión. ¡Gracias!' });
    if (!['si', 'mas_o_menos', 'no'].includes(b.liked) || !['justa', 'alta', 'baja'].includes(b.rent_opinion)) return res.status(400).json({ error: 'Contesta las dos preguntas.' });
    const reasons = ['Precio', 'Ubicación', 'Tamaño', 'Estado de la propiedad', 'Encontré otra opción', 'Otro'];
    db.prepare('INSERT INTO opinions (property_id, lead_id, liked, rent_opinion, reason) VALUES (?, ?, ?, ?, ?)').run(l.property_id, l.id, b.liked, b.rent_opinion, reasons.includes(b.reason) ? b.reason : null);
    db.prepare("INSERT INTO lead_events (lead_id, type, content) VALUES (?, 'opinion', 'Dejó su opinión de la visita')").run(l.id);
    res.status(201).json({ ok: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe' }));

  app.use((req, res) => html(res, V.notFound(ctxOf(req)), 404));
  return app;
}

module.exports = { siteRouter, rateLimiter, clientIp };
