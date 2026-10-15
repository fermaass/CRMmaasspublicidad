const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { localNow, addDays } = require('../src/data');
const { start, client, owner, invite } = require('./helpers');

const KEY = crypto.randomBytes(32);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(300)]);
const site = (t) => client(t.base, '');
const prop = (extra = {}) => ({ title: 'Casa familiar en privada', zone_id: 2, rent: 19800, m2: 160, bedrooms: 3, bathrooms: 2, status: 'disponible', ...extra });
const book = (t, pid, time = '10:00') => site(t).post('/api/visita', { property_id: pid, date: addDays(localNow().date, 1), time, name: 'Laura Prospecto', phone: '4421234567', privacy: true });
const up = (t, url, buf, name = 'doc.pdf') => fetch(t.base + url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': name }, body: buf });
const tokenOf = (url) => url.split('/').pop();

test('expediente del inquilino: enlace privado, archivos cifrados, revisión y bitácora', async (t) => {
  const app = await start({ docsKey: KEY }); t.after(app.close);
  const dueno = await owner(app);
  const { c: ven, id: venId } = await invite(app, dueno, { name: 'Ana', email: 'ana@example.com', role: 'vendedor' });
  const { c: otro } = await invite(app, dueno, { name: 'Beto', email: 'beto@example.com', role: 'vendedor' });
  const p = (await dueno.post('/api/properties', prop({ advisor_id: venId }))).body;
  await book(app, p.id);
  const lead = (await ven.get('/api/leads')).body[0];

  assert.equal((await otro.post(`/api/files/lead/${lead.id}/link`)).status, 404, 'otro vendedor no puede');
  const link = await ven.post(`/api/files/lead/${lead.id}/link`);
  assert.equal(link.status, 201);
  assert.match(link.body.url, /^https:\/\/www\.rentaypunto\.com\/expediente\/[\w-]+$/);
  const tk = tokenOf(link.body.url);
  const page = await site(app).get(`/expediente/${tk}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(page.text, /INE/);

  assert.equal((await up(app, `/api/expediente/${tk}/docs?kind=ine`, Buffer.from('<html>no</html>'))).status, 400, 'solo PDF, JPG o PNG');
  assert.equal((await up(app, `/api/expediente/${tk}/docs?kind=pasaporte`, PDF)).status, 400);
  assert.equal((await up(app, `/api/expediente/${tk}/docs?kind=ine`, PDF, 'ine.pdf')).status, 201);
  const miss = await site(app).post(`/api/expediente/${tk}/enviar`, {});
  assert.equal(miss.status, 400);
  assert.match(miss.body.error, /Constancia de Situación Fiscal/);
  assert.equal((await up(app, `/api/expediente/${tk}/docs?kind=csf`, PDF)).status, 201);
  assert.equal((await up(app, `/api/expediente/${tk}/docs?kind=ingresos`, PDF)).status, 201);
  assert.equal((await site(app).post(`/api/expediente/${tk}/enviar`, { budget: 20000, occupants: 3, pets: 'No' })).status, 200);
  assert.equal((await up(app, `/api/expediente/${tk}/docs?kind=aval`, PDF)).status, 410, 'enviado: el enlace se cierra');
  assert.match((await site(app).get(`/expediente/${tk}`)).text, /Recibimos tus documentos/);

  const l2 = (await ven.get(`/api/leads/${lead.id}`)).body;
  assert.equal(l2.stage, 'expediente');
  assert.equal(l2.file_status, 'recibido');
  const f = (await ven.get(`/api/files/lead/${lead.id}`)).body;
  assert.equal(f.docs.length, 3);
  assert.equal(f.profile.budget, 20000);

  // En disco está cifrado; en el panel se ve el original y queda registrado.
  const row = app.db.prepare('SELECT * FROM documents WHERE id = ?').get(f.docs[0].id);
  const onDisk = fs.readFileSync(path.join(app.config.dataDir, 'docs', `${row.file}.bin`));
  assert.ok(!onDisk.includes(Buffer.from('%PDF')), 'el archivo guardado no es legible');
  const r = await fetch(`${app.base}/panel/api/documents/${f.docs[0].id}/file`, { headers: { cookie: ven.cookie() } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(PDF));
  assert.equal((await fetch(`${app.base}/panel/api/documents/${f.docs[0].id}/file`, { headers: { cookie: otro.cookie() } })).status, 404);
  assert.equal((await fetch(`${app.base}/panel/api/documents/${f.docs[0].id}/file`)).status, 401);
  assert.equal((await ven.get(`/api/files/lead/${lead.id}`)).body.log[0].action, 'ver');

  assert.equal((await ven.post(`/api/documents/${f.docs[0].id}/review`, { status: 'rechazado' })).status, 400, 'rechazar pide motivo');
  assert.equal((await ven.post(`/api/documents/${f.docs[0].id}/review`, { status: 'rechazado', note: 'Se ve borrosa' })).status, 200);
  assert.equal((await ven.post(`/api/files/lead/${lead.id}/status`, { status: 'aprobado' })).status, 403, 'aprobar es del Gerente o Dueño');
  assert.equal((await dueno.post(`/api/files/lead/${lead.id}/status`, { status: 'rechazado' })).status, 200);

  // Enlace nuevo: el anterior deja de servir; el rechazado se puede volver a subir.
  const link2 = tokenOf((await ven.post(`/api/files/lead/${lead.id}/link`)).body.url);
  assert.equal((await site(app).get(`/expediente/${tk}`)).status, 404);
  const pg = (await site(app).get(`/expediente/${link2}`)).text;
  assert.match(pg, /Se ve borrosa/);
  assert.equal((await up(app, `/api/expediente/${link2}/docs?kind=ine`, PDF)).status, 201);

  assert.equal((await ven.del(`/api/documents/${f.docs[0].id}`)).status, 403);
  assert.equal((await dueno.del(`/api/documents/${f.docs[0].id}`)).status, 200);
  await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(!fs.existsSync(path.join(app.config.dataDir, 'docs', `${row.file}.bin`)), 'borrado de verdad');
});

test('sin DOCS_KEY no se piden expedientes', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const p = (await dueno.post('/api/properties', prop())).body;
  await book(app, p.id);
  const lead = (await dueno.get('/api/leads')).body[0];
  const r = await dueno.post(`/api/files/lead/${lead.id}/link`);
  assert.equal(r.status, 503);
  assert.match(r.body.error, /DOCS_KEY/);
});

test('documentos del propietario y portal de pagos del inquilino', async (t) => {
  const app = await start({ docsKey: KEY }); t.after(app.close);
  const dueno = await owner(app);
  await site(app).post('/api/propietario', { name: 'Don Pepe', phone: '4425550000', bedrooms: 3, expected_rent: 21000, privacy: true });
  const ow = (await dueno.get('/api/follow')).body.owners[0];
  const ol = tokenOf((await dueno.post(`/api/files/owner/${ow.id}/link`)).body.url);
  assert.match((await site(app).get(`/expediente/${ol}`)).text, /Predial o escritura/);
  await up(app, `/api/expediente/${ol}/docs?kind=identificacion`, PDF);
  await up(app, `/api/expediente/${ol}/docs?kind=predial`, PDF);
  assert.equal((await site(app).post(`/api/expediente/${ol}/enviar`, {})).status, 200);
  assert.equal((await dueno.get('/api/follow')).body.owners[0].file_status, 'recibido');

  const p = (await dueno.post('/api/properties', prop({ includes: ['Agua'] }))).body;
  assert.equal((await dueno.post(`/api/files/tenancy/${p.id}/link`)).status, 400, 'solo para rentadas');
  await book(app, p.id);
  const lead = (await dueno.get('/api/leads')).body[0];
  await dueno.patch(`/api/leads/${lead.id}`, { stage: 'firmado' });
  const pl = await dueno.post(`/api/files/tenancy/${p.id}/link`);
  assert.equal(pl.body.phone, '4421234567', 'el inquilino es quien firmó');
  const tk = tokenOf(pl.body.url);
  assert.match(pl.body.url, /\/portal\//);
  const month = localNow().date.slice(0, 7);
  assert.equal((await up(app, `/api/portal/${tk}/comprobante?month=${month}&concept=renta`, PDF)).status, 201);
  assert.equal((await up(app, `/api/portal/${tk}/comprobante?month=${month}&concept=renta`, PDF)).status, 201, 'el portal no se cierra');
  assert.equal((await up(app, `/api/portal/${tk}/comprobante?month=13-2026&concept=renta`, PDF)).status, 400);
  const pay = (await dueno.get(`/api/properties/${p.id}/payments`)).body;
  assert.deepEqual(pay.concepts, ['renta', 'luz', 'gas', 'internet'], 'el agua va incluida en la renta');
  assert.equal(pay.rows[0].status, 'pendiente');
  assert.equal((await dueno.get('/api/payments/pending')).body.length, 1);
  await dueno.post(`/api/documents/${pay.rows[0].document_id}/review`, { status: 'validado' });
  assert.equal((await dueno.get(`/api/properties/${p.id}/payments`)).body.rows[0].status, 'validado');
  assert.equal((await up(app, `/api/portal/${tk}/comprobante?month=${month}&concept=renta`, PDF)).status, 409, 'ya validado');
  assert.match((await site(app).get(`/portal/${tk}`)).text, /Validado/);
  await dueno.put(`/api/properties/${p.id}/payments`, { month, concept: 'luz', status: 'rechazado' });
  assert.equal((await dueno.get(`/api/properties/${p.id}/payments`)).body.rows.find((r) => r.concept === 'luz').status, 'rechazado');
});

test('WhatsApp oficial: plantillas al agendar, sin duplicados, y recordatorio la víspera', async (t) => {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://graph.facebook.com/')) { calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization }); return new Response(JSON.stringify({ messages: [{ id: `wamid.${calls.length}` }] }), { status: 200 }); }
    return orig(url, opts);
  };
  t.after(() => { global.fetch = orig; });
  const app = await start({ waToken: 'WTOKEN', waPhoneId: '999', metaApiVersion: 'v23.0' }); t.after(app.close);
  const dueno = await owner(app);
  const { id: venId } = await invite(app, dueno, { name: 'Ana López', email: 'ana@example.com', role: 'vendedor', phone: '4429990000' });
  const p = (await dueno.post('/api/properties', prop({ advisor_id: venId }))).body;
  await book(app, p.id);
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(calls.length, 0, 'apagado de fábrica');
  await dueno.patch('/api/settings', { wa_auto: { prospect: true, advisor: true, reminder: true } });
  await book(app, p.id, '11:00');
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(calls.length, 2);
  const pr = calls.find((c) => c.body.template.name === 'rp_cita_solicitada');
  assert.equal(pr.url, 'https://graph.facebook.com/v23.0/999/messages');
  assert.equal(pr.auth, 'Bearer WTOKEN');
  assert.equal(pr.body.to, '524421234567');
  assert.equal(pr.body.template.language.code, 'es_MX');
  assert.equal(pr.body.template.components[0].parameters[0].text, 'Laura');
  assert.equal(calls.find((c) => c.body.template.name === 'rp_lead_nuevo').body.to, '524429990000');

  // Recordatorio: cita confirmada para mañana, después de las 18:00; una sola vez.
  const lead = (await dueno.get('/api/leads')).body.find((l) => l.visit_time === '11:00');
  await dueno.patch(`/api/leads/${lead.id}`, { stage: 'cita' });
  const { whatsapp } = require('../src/whatsapp');
  const wa = whatsapp(app.db, { ...app.config, waToken: 'WTOKEN', waPhoneId: '999', metaApiVersion: 'v23.0' }, { error() {} });
  const today = localNow().date;
  await wa.tick({ date: today, time: '17:00' });
  assert.equal(calls.filter((c) => c.body.template.name === 'rp_recordatorio_cita').length, 0);
  await wa.tick({ date: today, time: '18:30' });
  await wa.tick({ date: today, time: '19:40' });
  assert.equal(calls.filter((c) => c.body.template.name === 'rp_recordatorio_cita').length, 1);
  // Reporte semanal: solo lunes después de las 10:00 y solo a propiedades con propietario ligado; uno por semana.
  await site(app).post('/api/propietario', { name: 'Don Pepe', phone: '4425550000', bedrooms: 3, expected_rent: 21000, privacy: true });
  const ow = (await dueno.get('/api/follow')).body.owners[0];
  await dueno.patch(`/api/properties/${p.id}`, { owner_id: ow.id });
  await dueno.patch('/api/settings', { wa_auto: { weekly: true } });
  await wa.tick({ date: '2026-10-19', time: '09:00' }); // lunes temprano
  await wa.tick({ date: '2026-10-20', time: '11:00' }); // martes
  assert.equal(calls.filter((c) => c.body.template.name === 'rp_reporte_semanal').length, 0);
  await wa.tick({ date: '2026-10-19', time: '10:05' });
  await wa.tick({ date: '2026-10-19', time: '10:15' });
  const weekly = calls.filter((c) => c.body.template.name === 'rp_reporte_semanal');
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].body.to, '524425550000');
  assert.equal(weekly[0].body.template.components[0].parameters.length, 6);
  assert.ok((await dueno.get('/api/reports')).body.find((x) => x.id === p.id).last_sent, 'queda como enviado');
  const log = (await dueno.get('/api/wa-log')).body;
  assert.ok(log.every((m) => m.status === 'enviado'));
});
