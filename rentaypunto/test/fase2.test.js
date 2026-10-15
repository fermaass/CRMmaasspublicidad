const test = require('node:test');
const assert = require('node:assert');
const { localNow, addDays } = require('../src/data');
const { start, client, owner, invite, JPEG } = require('./helpers');

const site = (t) => client(t.base, '');
const prop = (extra = {}) => ({ title: 'Casa familiar en privada', zone_id: 2, colonia: 'Privada con caseta', rent: 19800, m2: 160, bedrooms: 3, bathrooms: 2,
  extras: ['Mascotas'], description: 'Jardín y cochera para 2 autos. Privada tranquila con áreas verdes y vigilancia, cerca de escuelas.', status: 'disponible', ...extra });
const book = (t, pid, time = '10:00', extra = {}) => site(t).post('/api/visita', { property_id: pid, date: addDays(localNow().date, 1), time, name: 'Laura Prospecto', phone: '4421234567', privacy: true, ...extra });

test('embudo con hitos, perdidos que sí visitaron y costo por cita solo para el Dueño', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const { c: ger } = await invite(app, dueno, { name: 'Gerardo', email: 'ger@example.com', role: 'gerente' });
  const p = (await dueno.post('/api/properties', prop())).body;
  await book(app, p.id, '10:00', { utm: { source: 'instagram' } });
  await book(app, p.id, '11:00', { utm: { source: 'ig' } });
  await book(app, p.id, '12:00');
  const [a, b] = (await dueno.get('/api/leads')).body.filter((l) => l.origin === 'Meta Ads');
  await dueno.patch(`/api/leads/${a.id}`, { stage: 'visito' });
  await dueno.patch(`/api/leads/${a.id}`, { stage: 'perdido', lost_reason: 'Precio' });
  await dueno.patch(`/api/leads/${b.id}`, { stage: 'firmado' });
  await dueno.put('/api/meta-spend', { month: localNow().date.slice(0, 7), amount: 3000 });
  const r = (await dueno.get('/api/summary?period=mes')).body;
  assert.deepEqual(r.funnel, { leads: 3, confirmed: 2, visited: 2, signed: 1 }, 'el perdido que visitó sigue contando como visita');
  assert.deepEqual(r.lost, [['Precio', 1]]);
  assert.equal(r.cost.perLead, 1500);
  assert.equal(r.cost.perSigned, 3000);
  assert.equal(r.byOrigin.find((x) => x.key === 'Meta Ads').leads, 2);
  const g = (await ger.get('/api/summary')).body;
  assert.equal(g.cost, undefined, 'el Gerente no ve la inversión en Meta');
  assert.equal((await ger.put('/api/meta-spend', { month: '2026-10', amount: 1 })).status, 403);
  assert.equal(app.metaEvents.length, 3, 'cada cita se manda a la API de Conversiones');
  assert.equal(app.metaEvents[0].phone, '4421234567');
  assert.match(app.metaEvents[0].ua || 'node', /node|undici/i);
});

test('alertas: se cruzan con lo que se publica después y se marcan como avisadas', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  await site(app).post('/api/avisame', { phone: '4425550001', privacy: true, filters: { zona: 'el-refugio', max: 20000, rec: 3 } });
  await site(app).post('/api/avisame', { phone: '4425550002', privacy: true, filters: { zona: 'juriquilla' } });
  await new Promise((ok) => setTimeout(ok, 5));
  const created = (await dueno.post('/api/properties', prop({ status: 'borrador' }))).body;
  assert.equal(created.alert_matches, 0, 'un borrador no avisa');
  const pub = (await dueno.post(`/api/properties/${created.id}/status`, { status: 'disponible' })).body;
  assert.equal(pub.alert_matches, 1);
  let alerts = (await dueno.get('/api/follow')).body.alerts;
  assert.deepEqual(alerts.find((a) => a.phone === '4425550001').matches.map((m) => m.code), ['RP-0001']);
  assert.equal(alerts.find((a) => a.phone === '4425550002').matches.length, 0);
  const id = alerts.find((a) => a.phone === '4425550001').id;
  await dueno.post(`/api/follow/alerts/${id}/notified`);
  alerts = (await dueno.get('/api/follow')).body.alerts;
  assert.equal(alerts.find((a) => a.id === id).matches.length, 0, 'ya avisada: no se repite');
  assert.equal(alerts.find((a) => a.id === id).status, 'contactado');
});

test('opinión de la visita: enlace de un solo uso, anónima y resumen en la ficha', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const p = (await dueno.post('/api/properties', prop())).body;
  for (const time of ['10:00', '11:00', '12:00']) await book(app, p.id, time);
  const leads = (await dueno.get('/api/leads')).body;
  assert.equal((await dueno.post(`/api/leads/${leads[0].id}/opinion-link`)).status, 400, 'sin visita no hay opinión');
  const answers = [['si', 'justa'], ['si', 'alta'], ['no', 'alta']];
  for (const [i, l] of leads.entries()) {
    await dueno.patch(`/api/leads/${l.id}`, { stage: 'visito' });
    const link = (await dueno.post(`/api/leads/${l.id}/opinion-link`)).body.url;
    assert.equal((await dueno.post(`/api/leads/${l.id}/opinion-link`)).body.url, link, 'siempre el mismo enlace');
    const token = link.split('/').pop();
    const page = await site(app).get(`/opinion/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /noindex/);
    assert.equal((await site(app).post('/api/opinion', { token, liked: answers[i][0], rent_opinion: answers[i][1], reason: i === 2 ? 'Precio' : '' })).status, 201);
    assert.equal((await site(app).post('/api/opinion', { token, liked: 'si', rent_opinion: 'justa' })).status, 409);
  }
  assert.equal((await site(app).post('/api/opinion', { token: 'x'.repeat(22), liked: 'si', rent_opinion: 'justa' })).status, 404);
  const html = (await site(app).get(`/${p.seo_slug}`)).text;
  assert.match(html, /A <b>2 de 3<\/b> personas que la visitaron les gustó/);
  const rep = (await dueno.get('/api/reports')).body.find((x) => x.id === p.id);
  assert.equal(rep.op.high, 2);
  assert.match(rep.recommendation, /ajustar el precio/);
});

test('reporte al propietario, solicitudes del propietario y acta privada', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const { c: ven, id: venId } = await invite(app, dueno, { name: 'Ana', email: 'ana@example.com', role: 'vendedor' });
  const { c: otro } = await invite(app, dueno, { name: 'Beto', email: 'beto@example.com', role: 'vendedor' });
  await site(app).post('/api/propietario', { name: 'Don Pepe', phone: '4425550000', bedrooms: 3, expected_rent: 21000, privacy: true });
  const ownerId = (await dueno.get('/api/follow')).body.owners[0].id;
  const p = (await dueno.post('/api/properties', prop({ owner_id: ownerId, advisor_id: venId }))).body;
  await site(app).get(`/${p.seo_slug}`);
  await site(app).get(`/${p.seo_slug}`);
  await book(app, p.id);
  let rep = (await dueno.get('/api/reports')).body[0];
  assert.equal(rep.owner.name, 'Don Pepe');
  assert.equal(rep.week.views, 2);
  assert.equal(rep.week.leads, 1);
  assert.match(rep.message, /^Hola Don, este es el resumen semanal de Casa familiar en privada \(RP-0001\)\. Esta semana: 2 visitas a la ficha, 1 cita/);
  assert.equal(rep.last_sent, null);
  await dueno.post(`/api/properties/${p.id}/report-sent`);
  rep = (await dueno.get('/api/reports')).body[0];
  assert.ok(rep.last_sent);
  assert.equal((await ven.get('/api/reports')).status, 403);

  // El asesor registra que el propietario pide bajar el precio; el Gerente/Dueño lo aplica.
  assert.equal((await otro.post(`/api/properties/${p.id}/requests`, { kind: 'precio', new_rent: 18500 })).status, 403);
  const rq = await ven.post(`/api/properties/${p.id}/requests`, { kind: 'precio', new_rent: 18500, note: 'Lo pidió por WhatsApp' });
  assert.equal(rq.status, 201);
  assert.equal((await ven.post(`/api/requests/${rq.body.id}/aplicar`)).status, 403);
  await dueno.post(`/api/requests/${rq.body.id}/aplicar`);
  const after = (await dueno.get(`/api/properties/${p.id}`)).body;
  assert.equal(after.rent, 18500);
  assert.match(after.seo_title + after.seo_desc, /18,500/);
  assert.equal((await dueno.post(`/api/requests/${rq.body.id}/aplicar`)).status, 409);
  const pause = (await ven.post(`/api/properties/${p.id}/requests`, { kind: 'pausar' })).body;
  await dueno.post(`/api/requests/${pause.id}/aplicar`);
  assert.equal((await dueno.get(`/api/properties/${p.id}`)).body.status, 'pausada');

  // Acta de entrega: lista y fotos privadas.
  assert.equal((await ven.put(`/api/properties/${p.id}/acta`, { items: [true, true] })).status, 200);
  assert.equal((await otro.get(`/api/properties/${p.id}/acta`)).status, 403);
  const ph = await ven.post(`/api/properties/${p.id}/acta/photos`, { big: JPEG, small: JPEG });
  assert.equal(ph.status, 201);
  const acta = (await dueno.get(`/api/properties/${p.id}/acta`)).body;
  assert.deepEqual(acta.items.slice(0, 3), [true, true, false]);
  assert.equal((await dueno.get(`/api/acta-photo/${ph.body.id}`)).status, 200);
  assert.equal((await otro.get(`/api/acta-photo/${ph.body.id}`)).status, 404);
  assert.equal((await fetch(`${app.base}/panel/api/acta-photo/${ph.body.id}`)).status, 401, 'sin sesión no se ve');

  // Contrato: fechas válidas.
  assert.equal((await dueno.patch(`/api/properties/${p.id}`, { contract_start: '2026-11-01', contract_end: '2026-10-01' })).status, 400);
  assert.equal((await dueno.patch(`/api/properties/${p.id}`, { contract_start: '2026-11-01', contract_end: '2027-11-01' })).body.contract_end, '2027-11-01');
});

test('mis números, píxel de Meta y comisión configurables por el Dueño', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const { c: ven, id: venId } = await invite(app, dueno, { name: 'Ana', email: 'ana@example.com', role: 'vendedor' });
  const p = (await dueno.post('/api/properties', prop({ advisor_id: venId }))).body;
  await book(app, p.id);
  const l = (await ven.get('/api/leads')).body[0];
  await ven.patch(`/api/leads/${l.id}`, { stage: 'firmado' });
  assert.deepEqual((await ven.get('/api/my-numbers')).body, { month: localNow().date.slice(0, 7), leads: 1, visited: 1, signed: 1, commission: Math.round(19800 * 1 * 0.2) });
  assert.equal((await ven.patch('/api/settings', { commission_pct: 50 })).status, 403);
  await dueno.patch('/api/settings', { commission_months: 0.5, commission_pct: 50, meta_pixel_id: '123456789012345' });
  assert.equal((await ven.get('/api/my-numbers')).body.commission, Math.round(19800 * 0.5 * 0.5));
  assert.equal((await dueno.patch('/api/settings', { meta_pixel_id: 'abc' })).status, 400);
  const html = (await site(app).get('/')).text;
  assert.match(html, /fbq\('init','123456789012345'\)/);
});

test('API de Conversiones: teléfono cifrado y mismo event_id que el píxel', async () => {
  const { metaCapi, sha } = require('../src/meta');
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, text: async () => '' }; };
  try {
    const off = metaCapi({});
    assert.equal(await off.sendLead({ pixelId: '123', leadId: 1 }), false, 'sin token no manda nada');
    const m = metaCapi({ metaToken: 'TOKEN', metaApiVersion: 'v23.0' });
    assert.equal(await m.sendLead({ pixelId: '123456', leadId: 7, phone: '4421234567', firstName: 'Laura', url: 'https://x', ip: '1.2.3.4', ua: 'UA', fbp: 'fb.1.1.1', code: 'RP-0001', rent: 100 }), true);
  } finally { global.fetch = orig; }
  assert.equal(calls[0].url, 'https://graph.facebook.com/v23.0/123456/events', 'el token no va en la dirección');
  assert.equal(calls[0].body.access_token, 'TOKEN');
  const e = calls[0].body.data[0];
  assert.equal(e.event_name, 'Lead');
  assert.equal(e.event_id, 'lead-7');
  assert.deepEqual(e.user_data.ph, [sha('524421234567')]);
  assert.ok(!JSON.stringify(calls[0].body).includes('4421234567'), 'el teléfono nunca va legible');
});
