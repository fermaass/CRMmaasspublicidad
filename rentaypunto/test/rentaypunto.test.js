const test = require('node:test');
const assert = require('node:assert');
const auth = require('../src/auth');
const { localNow, addDays } = require('../src/data');
const { start, client, owner, invite, JPEG } = require('./helpers');

const site = (t) => client(t.base, '');
const propBody = (extra = {}) => ({ title: 'Depto. con vista al parque', zone_id: 1, colonia: 'Cerca del parque lineal', rent: 14500, m2: 85, bedrooms: 2, bathrooms: 2,
  extras: ['Estacionamiento'], includes: ['Agua'], description: 'Piso 3 con cocina integral y vista al parque, cerca de comercios y escuelas de la zona norte.',
  address_private: 'Av. Secreta 123, int. 4', ...extra });
// Una cita libre: mañana a la primera hora del horario.
const slot = () => ({ date: addDays(localNow().date, 1), time: '10:00' });

test('primer uso y verificación en dos pasos del Dueño', async (t) => {
  const app = await start(); t.after(app.close);
  const c = client(app.base);
  assert.equal((await c.get('/api/setup')).body.needed, true);
  assert.equal((await c.post('/api/setup', { setup_code: 'XXXX-0000', name: 'Fer', email: 'fer@example.com', password: 'contrasena-larga' })).status, 403);
  const r = await c.post('/api/setup', { setup_code: 'abcd 1234', name: 'Fer', email: 'fer@example.com', password: 'contrasena-larga' });
  assert.equal(r.status, 201);
  assert.equal(r.body.mfa, 'setup');
  assert.equal((await c.get('/api/me')).status, 401, 'sin el código todavía no entra');
  assert.equal((await c.get('/api/leads')).status, 401);
  const s = await c.get('/api/2fa');
  assert.match(s.body.uri, /^otpauth:\/\/totp\//);
  assert.equal((await c.post('/api/2fa', { code: '000000' })).status, 400);
  const ok = await c.post('/api/2fa', { code: auth.totpCode(s.body.secret, Math.floor(Date.now() / 30000)) });
  assert.equal(ok.body.role, 'dueno');
  assert.equal((await c.get('/api/me')).status, 200);
  assert.equal((await c.get('/api/setup')).body.needed, false);
  // Entrar otra vez: contraseña y luego código.
  const c2 = client(app.base);
  assert.equal((await c2.post('/api/login', { email: 'fer@example.com', password: 'mal' })).status, 401);
  assert.equal((await c2.post('/api/login', { email: 'FER@example.com', password: 'contrasena-larga' })).body.mfa, 'code');
  assert.equal((await c2.get('/api/me')).status, 401);
  assert.equal((await c2.post('/api/2fa', { code: auth.totpCode(s.body.secret, Math.floor(Date.now() / 30000)) })).status, 200);
  assert.equal((await c2.get('/api/me')).status, 200);
});

test('vendedor: captura en borrador, no publica ni elimina; el gerente publica', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const { c: ven, id: venId } = await invite(app, dueno, { name: 'Ana Vendedora', email: 'ana@example.com', role: 'vendedor' });
  const { c: ger } = await invite(app, dueno, { name: 'Gerardo', email: 'ger@example.com', role: 'gerente' });
  assert.equal((await ven.get('/api/me')).body.role, 'vendedor', 'el vendedor entra sin código');
  assert.equal((await ger.get('/api/me')).body.role, 'gerente', 'el gerente entra con código');

  const created = await ven.post('/api/properties', propBody({ status: 'disponible' }));
  assert.equal(created.status, 201);
  const p = created.body;
  assert.equal(p.status, 'borrador', 'sin permiso queda en borrador aunque pida publicar');
  assert.equal(p.advisor_id, venId);
  assert.equal(p.code, 'RP-0001');
  assert.equal(p.seo_slug, 'renta/juriquilla/depto-con-vista-al-parque-rp-0001');
  assert.ok(p.seo_title.length <= 60 && p.seo_desc.length <= 155);
  assert.equal((await ven.post(`/api/properties/${p.id}/status`, { status: 'disponible' })).status, 403);
  assert.equal((await ven.del(`/api/properties/${p.id}`)).status, 403);
  assert.equal((await site(app).get(`/${p.seo_slug}`)).status, 404, 'el borrador no existe en el sitio');

  assert.equal((await ger.post(`/api/properties/${p.id}/status`, { status: 'disponible' })).body.status, 'disponible');
  const page = await site(app).get(`/${p.seo_slug}`);
  assert.equal(page.status, 200);
  assert.equal((await ven.patch(`/api/properties/${p.id}`, { title: 'Otro' })).status, 403, 'ya publicada: el vendedor sin permiso no la cambia');

  // Con "publica sin aprobación" sí publica directo.
  await dueno.patch(`/api/users/${venId}`, { publish_direct: true });
  const direct = await ven.post('/api/properties', propBody({ title: 'Casa familiar en privada', zone_id: 2, status: 'disponible' }));
  assert.equal(direct.body.status, 'disponible');
  assert.equal((await ven.patch(`/api/properties/${direct.body.id}`, { rent: 19000 })).body.rent, 19000);
});

test('SEO de la ficha, redirección de URL vieja, dirección privada y mapa del sitio', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const p = (await dueno.post('/api/properties', propBody({ status: 'disponible' }))).body;
  const html = (await site(app).get(`/${p.seo_slug}`)).text;
  assert.match(html, /<title>Depto\. con vista al parque en renta en Juriquilla<\/title>/);
  assert.match(html, /<meta name="description" content="Renta depto/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.rentaypunto\.com\/renta\/juriquilla\/depto-con-vista-al-parque-rp-0001">/);
  assert.match(html, /<h1 class="zt">Depto\. con vista al parque en renta en Juriquilla<\/h1>/);
  assert.match(html, /"@type":"RealEstateListing"/);
  assert.match(html, /property="og:title"/);
  assert.ok(!html.includes('Av. Secreta'), 'la dirección exacta nunca sale en el sitio');
  assert.ok(!(await site(app).get('/')).text.includes('Av. Secreta'));

  // Cambia la zona: la URL nueva y la vieja redirige.
  const moved = (await dueno.patch(`/api/properties/${p.id}`, { zone_id: 3 })).body;
  assert.equal(moved.seo_slug, 'renta/centro-sur/depto-con-vista-al-parque-rp-0001');
  const old = await site(app).get(`/${p.seo_slug}`);
  assert.equal(old.status, 301);
  assert.equal(old.headers.get('location'), `/${moved.seo_slug}`);

  let map = (await site(app).get('/sitemap.xml')).text;
  assert.ok(map.includes(moved.seo_slug));
  assert.ok(map.includes('/renta/centro-sur<'));
  assert.ok(!map.includes('/renta/juriquilla<'), 'zonas sin propiedades no van al mapa');
  await dueno.post(`/api/properties/${p.id}/status`, { status: 'rentada' });
  map = (await site(app).get('/sitemap.xml')).text;
  assert.ok(!map.includes(moved.seo_slug), 'rentada sale del mapa del sitio');
  const gone = await site(app).get(`/${moved.seo_slug}`);
  assert.equal(gone.status, 200, 'recién rentada: se ve con similares');
  assert.match(gone.text, /noindex/);
  assert.match(gone.text, /ya no está disponible/);
  // A los 30 días, su dirección manda a la página de su zona.
  app.db.prepare("UPDATE properties SET rented_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(p.id);
  const old30 = await site(app).get(`/${moved.seo_slug}`);
  assert.equal(old30.status, 301);
  assert.equal(old30.headers.get('location'), '/renta/centro-sur');
  assert.ok(!(await site(app).get('/')).text.includes('RP-0001'));
});

test('agendar visita: lead al asesor de la propiedad, aviso por correo y horario ocupado', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const { c: ven, id: venId } = await invite(app, dueno, { name: 'Ana Vendedora', email: 'ana@example.com', role: 'vendedor' });
  const { c: otro } = await invite(app, dueno, { name: 'Beto', email: 'beto@example.com', role: 'vendedor' });
  const p = (await dueno.post('/api/properties', propBody({ status: 'disponible', advisor_id: venId }))).body;
  const pub = site(app);
  const s = slot();
  const body = { property_id: p.id, ...s, name: 'Laura Prospecto', phone: '+52 1 442 123 4567', privacy: true, busca: 'Familia pequeña · 4 persona(s)', utm: { source: 'facebook', campaign: 'octubre' } };
  assert.equal((await pub.post('/api/visita', { ...body, privacy: false })).status, 400);
  assert.equal((await pub.post('/api/visita', body, { 'content-type': 'text/plain' })).status, 415);
  const r = await pub.post('/api/visita', body);
  assert.equal(r.status, 201);
  assert.match(r.body.folio, /^C-\d+$/);
  assert.equal((await pub.post('/api/visita', { ...body, phone: '4420000000' })).status, 409, 'el mismo horario ya no está libre');
  assert.equal((await pub.post('/api/visita', { ...body, date: addDays(localNow().date, 40) })).status, 400);
  assert.equal((await pub.post('/api/visita', { ...body, time: '03:00' })).status, 400);
  const bot = await pub.post('/api/visita', { ...body, time: '11:00', website: 'spam' });
  assert.equal(bot.status, 201);

  await new Promise((ok) => setTimeout(ok, 50));
  const mail = app.sent.find((m) => /Nuevo lead/.test(m.subject));
  assert.ok(mail, 'se avisa por correo');
  assert.deepEqual(mail.to, ['ana@example.com']);
  assert.match(mail.text, /Laura Prospecto/);

  const leads = (await ven.get('/api/leads')).body;
  assert.equal(leads.length, 1, 'el robot (campo trampa) no creó lead');
  const l = leads[0];
  assert.equal(l.phone, '4421234567');
  assert.equal(l.origin, 'Meta Ads');
  assert.equal(l.utm_campaign, 'octubre');
  assert.equal(l.prop_code, 'RP-0001');
  assert.equal(l.search_context, 'Familia pequeña · 4 persona(s)');
  assert.equal((await otro.get('/api/leads')).body.length, 0, 'otro vendedor no ve leads ajenos');
  assert.equal((await otro.get(`/api/leads/${l.id}`)).status, 404);
  assert.equal((await otro.patch(`/api/leads/${l.id}`, { stage: 'contactado' })).status, 404);
  assert.equal((await ven.get(`/api/leads/${l.id}`)).body.address_private, 'Av. Secreta 123, int. 4', 'quien atiende ve la dirección');

  // Perdido exige motivo; Firmado renta la propiedad y la saca del sitio.
  assert.equal((await ven.patch(`/api/leads/${l.id}`, { stage: 'perdido' })).status, 400);
  assert.equal((await ven.patch(`/api/leads/${l.id}`, { stage: 'perdido', lost_reason: 'Precio' })).body.lost_reason, 'Precio');
  assert.equal((await ven.patch(`/api/leads/${l.id}`, { stage: 'cita' })).body.lost_reason, null);
  await ven.patch(`/api/leads/${l.id}`, { stage: 'firmado' });
  const after = (await dueno.get(`/api/properties/${p.id}`)).body;
  assert.equal(after.status, 'rentada');
  assert.ok(after.rented_at);
  assert.match((await pub.get(`/${p.seo_slug}`)).text, /noindex/);
  const hist = (await ven.get(`/api/leads/${l.id}`)).body.events.map((e) => e.type);
  assert.ok(hist.includes('creado') && hist.includes('etapa') && hist.includes('propiedad'));
});

test('formularios públicos: propietario, avísame, queja y jurídico llegan al panel', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const pub = site(app);
  assert.equal((await pub.post('/api/propietario', { name: 'Don Pepe', phone: '4425550000', bedrooms: 3, expected_rent: 21000, zone: 'Zibatá', privacy: true })).status, 201);
  assert.equal((await pub.post('/api/avisame', { phone: '4425550001', privacy: true, filters: { zona: 'juriquilla', max: 12000, rec: 2 } })).status, 201);
  const q = await pub.post('/api/queja', { kind: 'Queja', contact: '4425550002', message: 'El portón no cierra', privacy: true });
  assert.equal(q.body.folio, '#1001');
  assert.equal((await pub.post('/api/juridico', { name: 'Ana', phone: '4425550003', who: 'Propietario', privacy: true })).status, 201);
  const f = (await dueno.get('/api/follow')).body;
  assert.equal(f.owners[0].name, 'Don Pepe');
  assert.equal(f.alerts[0].filters_text, 'Juriquilla · hasta $12,000 · 2+ rec.');
  assert.equal(f.tickets[0].message, 'El portón no cierra');
  assert.equal(f.legal[0].who, 'Propietario');
  const { c: ven } = await invite(app, dueno, { name: 'Ana', email: 'ana@example.com', role: 'vendedor' });
  assert.equal((await ven.get('/api/follow')).status, 403, 'el vendedor no ve Seguimiento');
  assert.equal((await ven.get('/api/users')).body.some((u) => u.email), false, 'el vendedor no ve correos del equipo');
  assert.equal((await ven.post('/api/users', { name: 'X', email: 'x@example.com', role: 'dueno' })).status, 403);
});

test('fotos: solo JPEG real, se sirven y se borran', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const p = (await dueno.post('/api/properties', propBody())).body;
  assert.equal((await dueno.post(`/api/properties/${p.id}/photos`, { big: 'data:image/jpeg;base64,PHNjcmlwdD4=', small: JPEG })).status, 400);
  const r = await dueno.post(`/api/properties/${p.id}/photos`, { big: JPEG, small: JPEG });
  assert.equal(r.status, 201);
  const img = await fetch(`${app.base}/fotos/${r.body.file}-sm.jpg`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await dueno.del(`/api/photos/${r.body.id}`)).status, 200);
  await new Promise((ok) => setTimeout(ok, 20));
  assert.equal((await fetch(`${app.base}/fotos/${r.body.file}.jpg`)).status, 404);
});

test('con PANEL_HOST el panel y el sitio no se mezclan', async (t) => {
  const app = await start({ panelHost: 'panel.rentaypunto.com' }); t.after(app.close);
  const onSite = await fetch(`${app.base}/api/setup`);
  assert.equal(onSite.status, 404, 'el panel no existe en el dominio público');
  assert.equal((await fetch(`${app.base}/panel/`)).status, 404);
  const home = await fetch(`${app.base}/`);
  assert.equal(home.status, 200);
  assert.ok(!(await home.text()).toLowerCase().includes('panel'), 'el sitio no enlaza al panel');
  // Node no deja cambiar el Host con fetch; se usa http directo.
  const http = require('node:http');
  const get = (p) => new Promise((ok) => http.get({ host: 'localhost', port: new URL(app.base).port, path: p, headers: { host: 'panel.rentaypunto.com' } }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b })); }));
  const setup = await get('/api/setup');
  assert.equal(setup.status, 200);
  assert.equal(setup.headers['x-robots-tag'], 'noindex, nofollow');
  const idx = await get('/');
  assert.match(idx.body, /noindex/);
  assert.equal((await get('/renta-tu-propiedad')).status, 404, 'el sitio no existe en el panel');
});

test('desactivar a un vendedor deja sus leads sin asesor y cierra su sesión', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const { c: ven, id } = await invite(app, dueno, { name: 'Ana', email: 'ana@example.com', role: 'vendedor' });
  const p = (await dueno.post('/api/properties', propBody({ status: 'disponible', advisor_id: id }))).body;
  await site(app).post('/api/visita', { property_id: p.id, ...slot(), name: 'Laura', phone: '4421234567', privacy: true });
  assert.equal((await dueno.patch(`/api/users/${id}`, { active: false })).status, 200);
  assert.equal((await ven.get('/api/me')).status, 401);
  const l = (await dueno.get('/api/leads')).body[0];
  assert.equal(l.advisor_id, null);
  assert.equal((await dueno.patch(`/api/users/${(await dueno.get('/api/me')).body.id}`, { role: 'vendedor' })).status, 400, 'el Dueño no se quita su perfil');
});
