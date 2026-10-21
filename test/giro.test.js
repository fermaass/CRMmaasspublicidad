const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const F = require('../public/followup.js');

const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };

test('giro Bienes raíces: se mide en citas (agendar, confirmar, llegó, no llegó) y se puede cambiar sin perder datos', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'GIRO-1234', formApiKey: 'k' } }));
  const call = async (method, path, body, cookie) => {
    const r = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
  };
  const ck = (await call('POST', '/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'Casas', setup_code: 'GIRO-1234', can_sell: '1' })).headers.get('set-cookie').split(';')[0];
  const get = async (id) => (await call('GET', `/api/leads/${id}`, null, ck)).json;
  const touch = (id, outcome, extra = {}) => call('POST', `/api/leads/${id}/touches`, { channel: 'whatsapp', outcome, ...extra }, ck);
  const inDays = (d) => new Date(Date.now() + d * 86400e3).toISOString();

  // Elegir el giro trae sus valores: lo que vende es "propiedad", sin renovaciones y con citas.
  let co = (await call('PATCH', '/api/company', { industry: 'bienes_raices' }, ck)).json;
  assert.deepEqual([co.industry, co.term, co.renewals, co.appointments], ['bienes_raices', 'propiedad', false, true]);
  let meta = (await call('GET', '/api/meta', null, ck)).json;
  assert.ok(meta.stages.includes('cita') && meta.stages.includes('asistio'));
  assert.equal(meta.quickProfile.decision_maker.label, '¿Cómo va a pagar?');
  assert.equal(meta.labels.cita, 'Cita agendada');
  assert.equal(meta.touches.outcomes.cita_agendada, 'Agendó cita');
  assert.ok(meta.industries.some((g) => g.key === 'salud' && g.appt === 'valoración'));
  assert.equal((await call('PATCH', '/api/company', { industry: 'nada' }, ck)).status, 400);

  // Llega un lead, contesta y agenda la cita.
  const a = (await call('POST', '/webhooks/form?key=k', { nombre: 'Laura', telefono: '5511112222' })).json.id;
  assert.equal((await touch(a, 'conversacion')).status, 201);
  let l = await get(a);
  assert.equal(F.stageOf(l), 'contesto'); assert.ok(F.outcomesFor(l).includes('cita_agendada'));
  assert.match(F.nextAction(l).label, /Agendar cita/);
  assert.equal((await touch(a, 'cita_agendada')).status, 400, 'sin fecha no se agenda');
  assert.equal((await touch(a, 'cita_agendada', { appt_at: inDays(2) })).status, 201);
  l = await get(a);
  assert.equal(l.appt_state, 'agendada'); assert.ok(l.appt_set_at); assert.equal(F.stageOf(l), 'cita');
  assert.equal(F.nextAction(l).kind, 'cita', 'toca confirmarla un día antes');
  assert.ok(l.events.some((e) => /Cita agendada para el/.test(e.content)));
  assert.equal((await call('GET', '/api/leads?stage=cita', null, ck)).json.length, 1);

  // Confirma y llega.
  assert.equal((await touch(a, 'confirmo')).status, 201);
  l = await get(a);
  assert.equal(l.appt_state, 'confirmada'); assert.equal(F.nextAction(l).kind, 'asistencia');
  assert.ok(!F.outcomesFor(l).includes('confirmo'));
  assert.equal((await touch(a, 'asistio', { channel: 'visita' })).status, 201);
  l = await get(a);
  assert.equal(F.stageOf(l), 'asistio'); assert.ok(l.appt_done_at);
  assert.match(F.nextAction(l).label, /Enviar cotización/);

  // Otro lead agenda y no llega: queda en Cita agendada y toca reagendar al día siguiente.
  const b = (await call('POST', '/webhooks/form?key=k', { nombre: 'Pedro', telefono: '5533334444' })).json.id;
  await touch(b, 'cita_agendada', { appt_at: inDays(-0.1) });
  l = await get(b);
  assert.equal(F.nextAction(l).kind, 'asistencia', 'ya pasó la hora: preguntar si llegó');
  await touch(b, 'no_asistio');
  l = await get(b);
  assert.equal(l.appt_state, 'no_asistio'); assert.equal(F.stageOf(l), 'cita'); assert.equal(F.nextAction(l).kind, 'reagendar');
  assert.equal((await touch(b, 'no_asistio')).status, 400, 'ya está marcado: lo que sigue es reagendar');
  await touch(b, 'cita_agendada', { appt_at: inDays(3) });
  l = await get(b);
  assert.equal(l.appt_state, 'agendada'); assert.equal(l.touch_count, 3);

  // El Resumen cuenta citas y asistencias.
  const st = (await call('GET', '/api/stats', null, ck)).json;
  assert.equal(st.funnel.citas, 2); assert.equal(st.funnel.asistieron, 1);
  assert.equal(st.byStage.find((r) => r.key === 'cita').n, 1);
  assert.equal(st.byStage.find((r) => r.key === 'asistio').n, 1);

  // Perfil rápido del giro: crédito aprobado + le alcanza = cumple perfil solo. Respuestas de otro giro no se aceptan.
  const c = (await call('POST', '/webhooks/form?key=k', { nombre: 'Rita', telefono: '5555556666' })).json.id;
  assert.equal((await call('PATCH', `/api/leads/${c}`, { decision_maker: 'si' }, ck)).status, 400);
  assert.equal((await call('PATCH', `/api/leads/${c}`, { decision_maker: 'credito', budget_status: 'si' }, ck)).status, 200);
  l = await get(c);
  assert.equal(l.profile, 'cumple'); assert.equal(l.status, 'nuevo_perfil');
  assert.ok(l.events.some((e) => /Crédito aprobado y sí alcanza/.test(e.content)));

  // WhatsApp: la plantilla de confirmar trae la fecha de la cita.
  const tpl = (await call('GET', '/api/wa-templates', null, ck)).json;
  const link = F.waLink('5511112222', tpl.cita, { nombre: 'Laura', vendedor: 'Fer', empresa: 'Casas', fecha: 'jueves 23 de octubre a las 10:00' });
  assert.match(decodeURIComponent(link), /tu cita el jueves 23 de octubre a las 10:00/);

  // Cambiar de giro no borra nada: sin citas las etapas vuelven a las de siempre, y los datos de la cita se quedan.
  co = (await call('PATCH', '/api/company', { industry: 'general' }, ck)).json;
  assert.deepEqual([co.term, co.renewals, co.appointments], ['campana', true, false]);
  meta = (await call('GET', '/api/meta', null, ck)).json;
  assert.ok(!meta.stages.includes('cita'));
  l = await get(a);
  assert.equal(F.stageOf(l), 'contesto'); assert.equal(l.appt_state, 'asistio');
  assert.ok(!F.outcomesFor(l).includes('cita_agendada'));
  assert.equal((await touch(a, 'cita_agendada', { appt_at: inDays(1) })).status, 400);
  l = await get(c);
  assert.equal(F.answerLabel('decision_maker', l.decision_maker), 'Crédito aprobado', 'la respuesta de otro giro se sigue leyendo');

  // Lo que se mande explícito manda sobre los valores del giro.
  co = (await call('PATCH', '/api/company', { industry: 'servicios', appointments: false }, ck)).json;
  assert.deepEqual([co.industry, co.term, co.appointments], ['servicios', 'servicio', false]);
  co = (await call('PATCH', '/api/company', { appointments: true }, ck)).json;
  assert.equal(co.appointments, true);
  meta = (await call('GET', '/api/meta', null, ck)).json;
  assert.equal(meta.touches.outcomes.cita_agendada, 'Agendó reunión');
  s.close();
});
