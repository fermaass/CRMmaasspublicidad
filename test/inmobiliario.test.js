const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const F = require('../public/followup.js');

const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };

test('bienes raíces: Perfil, Cita (reprogramar y segunda visita), Apartado con trámite, Vendido por medio, Nutrición y Descartado', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'CASA-1234', formApiKey: 'k' } }));
  const call = async (method, path, body, cookie) => {
    const r = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
  };
  const ck = (await call('POST', '/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'Cumbre', setup_code: 'CASA-1234', can_sell: '1' })).headers.get('set-cookie').split(';')[0];
  const get = async (id) => (await call('GET', `/api/leads/${id}`, null, ck)).json;
  const touch = (id, outcome, extra = {}) => call('POST', `/api/leads/${id}/touches`, { channel: 'whatsapp', outcome, ...extra }, ck);
  const lead = async (tel) => (await call('POST', '/webhooks/form?key=k', { nombre: 'Cliente', telefono: tel })).json.id;
  const inDays = (d) => new Date(Date.now() + d * 86400e3).toISOString();
  const ymd = (d) => inDays(d).slice(0, 10);

  await call('PATCH', '/api/company', { industry: 'bienes_raices' }, ck);
  const meta = (await call('GET', '/api/meta', null, ck)).json;
  assert.deepEqual(meta.stages, ['nuevo', 'contactando', 'perfil', 'cita', 'cotizando', 'apartado', 'vendido', 'nutricion', 'descartado']);
  assert.ok(meta.declineReasons.includes('Ubicación') && !meta.declineReasons.includes(meta.postponed), 'lo que se pospone va a Nutrición, no a Descartado');
  assert.equal(meta.labels.nutricion, 'Nutrición');
  assert.match((await call('GET', '/api/wa-templates', null, ck)).json.cadencia, /precio y ficha/);

  // Contesta: pasa a Perfil. El perfil se llena de un toque; con crédito precalificado y presupuesto, cumple solo.
  const a = await lead('5511110001');
  await touch(a, 'conversacion');
  let l = await get(a);
  assert.equal(F.stageOf(l), 'perfil');
  assert.equal((await call('PATCH', `/api/leads/${a}`, { credit_types: 'infonavit,xx' }, ck)).status, 400);
  assert.equal((await call('PATCH', `/api/leads/${a}`, { credit_types: 'infonavit,contado', credit_status: 'precalificado', budget_amount: '2,500,000' }, ck)).status, 200);
  l = await get(a);
  assert.equal(l.credit_types, 'infonavit,contado'); assert.equal(l.budget_amount, 2500000); assert.equal(l.profile, 'cumple');
  assert.ok(F.reMissing(l).length > 0, 'faltan datos: perfil incompleto');

  // Se puede agendar la cita sin el perfil completo; el recordatorio pide completarlo.
  assert.equal((await touch(a, 'cita_agendada', { appt_at: inDays(2) })).status, 201);
  l = await get(a);
  assert.equal(F.stageOf(l), 'cita'); assert.match(F.nextAction(l).label, /completa el perfil/);
  await touch(a, 'confirmo');
  await touch(a, 'reagendo', { appt_at: inDays(3) });
  l = await get(a);
  assert.equal(l.appt_reschedules, 1); assert.equal(l.appt_state, 'agendada', 'reprogramar pide confirmar de nuevo');
  await touch(a, 'asistio', { channel: 'visita' });
  l = await get(a);
  assert.equal(F.stageOf(l), 'cotizando', 'sí vino: pasa a Cotizando'); assert.equal(l.appt_visits, 1);
  await touch(a, 'segunda_visita', { appt_at: inDays(5) });
  await touch(a, 'asistio', { channel: 'visita' });
  l = await get(a);
  assert.equal(l.appt_visits, 2); assert.equal(l.appt_reschedules, 1, 'la segunda visita no cuenta como cita caída');

  // Aparta: lleva el precio, el monto del apartado y la unidad; luego avanza el trámite y firma por Infonavit.
  assert.equal((await touch(a, 'aparto', { apartado_amount: '20000' })).status, 400, 'sin precio no hay cotización');
  assert.equal((await touch(a, 'aparto', { quote_amount: '2450000', apartado_amount: '20000', unit: 'Casa 14' })).status, 201);
  l = await get(a);
  assert.equal(F.stageOf(l), 'apartado'); assert.equal(l.tramite, 'expediente'); assert.equal(l.unit, 'Casa 14'); assert.equal(l.apartado_amount, 20000);
  assert.deepEqual(F.outcomesFor(l).slice(0, 3), ['tramite_revision', 'tramite_aprobado', 'vendido']);
  await touch(a, 'tramite_revision');
  assert.equal((await touch(a, 'vendido', { sale_amount: '2450000' })).status, 400, 'pide por qué medio se vendió');
  assert.equal((await touch(a, 'vendido', { sale_amount: '2450000', sale_method: 'infonavit' })).status, 201);
  l = await get(a);
  assert.equal(F.stageOf(l), 'vendido'); assert.equal(l.sale_method, 'infonavit');

  // Nutrición: motivo y fecha obligatorios; vuelve sola a Mi día en su fecha.
  const b = await lead('5511110002');
  await touch(b, 'conversacion');
  assert.equal((await touch(b, 'nutricion', { recontact_at: ymd(90) })).status, 400);
  assert.equal((await touch(b, 'nutricion', { nurture_reason: 'momento', recontact_at: ymd(90) })).status, 201);
  l = await get(b);
  assert.equal(F.stageOf(l), 'nutricion'); assert.equal(F.nextAction(l).kind, 'recontacto');
  // Al reactivarlo deja de estar en Nutrición.
  await call('PATCH', `/api/leads/${b}`, { status: 'nuevo', recontact_at: null }, ck);
  l = await get(b);
  assert.equal(l.nurture_reason, null); assert.equal(F.stageOf(l), 'perfil');

  // Crédito rechazado en el apartado: pasa a Nutrición con su motivo.
  const c = await lead('5511110003');
  await touch(c, 'conversacion');
  await touch(c, 'cotizado', { quote_amount: '1800000' });
  assert.equal((await touch(c, 'aparto')).status, 201);
  await touch(c, 'credito_rechazado', { recontact_at: ymd(90) });
  l = await get(c);
  assert.equal(F.stageOf(l), 'nutricion'); assert.equal(l.nurture_reason, 'credito'); assert.equal(l.tramite, 'rechazado');

  // Descartado: solo con los motivos de la lista corta.
  const d = await lead('5511110004');
  assert.equal((await touch(d, 'rechazo', { decline_reason: 'Eligió a otro proveedor' })).status, 400);
  assert.equal((await touch(d, 'rechazo', { decline_reason: 'Ubicación' })).status, 201);
  assert.equal(F.stageOf(await get(d)), 'descartado');

  // Si cumplía perfil y deja de contestar, no se descarta: se enfría y va a Nutrición en 3 meses.
  const e = await lead('5511110005');
  await touch(e, 'conversacion');
  await call('PATCH', `/api/leads/${e}`, { credit_status: 'aprobado', budget_amount: '3000000' }, ck);
  for (let i = 0; i < 3; i++) await touch(e, 'sin_respuesta');
  l = await get(e);
  assert.equal(F.stageOf(l), 'nutricion'); assert.equal(l.nurture_reason, 'enfrio'); assert.ok(l.recontact_at);

  // Resumen: citas caídas, segundas visitas, apartados, rechazos, ventas por medio y por qué se pausan.
  const st = (await call('GET', '/api/stats', null, ck)).json;
  assert.equal(st.funnel.apartados, 2);
  assert.deepEqual({ ...st.re.citas }, { agendadas: 1, visitas: 2, no_vinieron: 0, reprogramaciones: 1, segundas_visitas: 1 });
  assert.equal(st.re.rechazados, 1);
  assert.deepEqual(st.re.porMedio.map((r) => [r.key, r.n]), [['infonavit', 1]]);
  assert.deepEqual(st.re.nutricion.map((r) => r.key).sort(), ['credito', 'enfrio']);
  assert.equal((await call('GET', '/api/leads?stage=nutricion', null, ck)).json.length, 2);
  const cartera = await fetch(`${url}/api/export/cartera.xlsx`, { headers: { cookie: ck } });
  assert.equal(cartera.status, 200);

  // Horario de atención para el semáforo de 15 minutos.
  assert.equal((await call('PATCH', '/api/company', { work_hours: { days: [], start: 540, end: 1140 } }, ck)).status, 400);
  const co = (await call('PATCH', '/api/company', { work_hours: { days: [1, 2, 3, 4, 5], start: 480, end: 1080 } }, ck)).json;
  assert.deepEqual(co.work_hours, { days: [1, 2, 3, 4, 5], start: 480, end: 1080 });
  s.close();
});

test('semáforo de 15 minutos: solo cuenta el horario de atención', () => {
  F.configure({ industry: 'bienes_raices', hours: { days: [1, 2, 3, 4, 5, 6], start: 540, end: 1140 } });
  // Sábado 18:50 → lunes 9:10: 10 minutos del sábado + 10 del lunes (el domingo no cuenta).
  assert.equal(F.businessMinutes('2026-10-24T18:50:00', new Date('2026-10-26T09:10:00').getTime()), 20);
  // Llegó a las 23:00: a las 9:10 del día siguiente apenas lleva 10 minutos.
  assert.equal(F.businessMinutes('2026-10-21T23:00:00', new Date('2026-10-22T09:10:00').getTime()), 10);
  const recien = { status: 'nuevo', touch_count: 0, created_at: new Date(Date.now() - 60e3).toISOString() };
  assert.equal(F.slaLate(recien), false);
  F.configure({ industry: 'general' });
});
