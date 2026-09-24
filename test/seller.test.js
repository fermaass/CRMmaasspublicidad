const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');
const F = require('../public/followup.js');

const DAY = 86400e3;
test('regla: lo acordado manda sobre la cadencia; postventa pide referidos y luego renovación', () => {
  const base = { status: 'nuevo_perfil', touch_count: 2, contacted_at: new Date().toISOString(), created_at: new Date().toISOString() };
  const agreed = new Date(Date.now() + 5 * DAY).toISOString();
  const a = F.nextAction({ ...base, next_step: 'Llamar para ver ubicaciones', next_step_at: agreed });
  assert.equal(a.agreed, true);
  assert.equal(a.due.toISOString(), agreed);
  assert.match(a.label, /ubicaciones/);

  const won = new Date(Date.now() - 30 * DAY).toISOString();
  const sold = { status: 'vendido', won_at: won, campaign_end: '2030-06-30' };
  const p = F.nextAction(sold);
  assert.equal(p.kind, 'postventa');
  assert.equal(Math.round((p.due - new Date(won)) / DAY), F.REFERRAL_AFTER);
  const r = F.nextAction({ ...sold, postsale_at: new Date().toISOString() });
  assert.equal(r.kind, 'renovacion');
  assert.equal(F.dayDiff(new Date('2030-06-30T09:00:00'), r.due), F.RENEW_BEFORE);
  assert.equal(F.nextAction({ ...sold, postsale_at: 'x', renewal_for: '2030-06-30' }), null);
});

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k' };
let server; let base; let gerente; let ana; let anaId;
async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const touch = (id, outcome, extra = {}) => req(`/api/leads/${id}/touches`, { method: 'POST', cookie: ana, body: { channel: 'whatsapp', outcome, ...extra } });
const lead = async (id) => (await req(`/api/leads/${id}`, { cookie: gerente })).json;

before(async () => {
  const db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  gerente = (await req('/api/login', { method: 'POST', body: { email: 'g@t.com', password: 'clave-gerente' } })).cookie;
  anaId = (await req('/api/users', { method: 'POST', cookie: gerente, body: { name: 'Ana', email: 'a@t.com', password: 'password123', role: 'vendedor' } })).json.id;
  ana = (await req('/api/login', { method: 'POST', body: { email: 'a@t.com', password: 'password123' } })).cookie;
});
after(() => server.close());

test('perfil rápido, nota y acuerdo en el mismo toque; la última nota viaja con el lead', async () => {
  const id = (await req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'whatsapp', phone: '5560000001', name: 'Cliente', assigned_to: anaId } })).json.id;
  const when = new Date(Date.now() + 2 * DAY); when.setSeconds(0, 0);
  const local = `${when.toISOString().slice(0, 16)}`;
  assert.equal((await touch(id, 'cumple', { decision_maker: 'quizas' })).status, 400, 'respuesta de perfil inválida');
  assert.equal((await touch(id, 'cumple', { next_step_at: 'mañana' })).status, 400);
  const r = await touch(id, 'cumple', { decision_maker: 'si', budget_status: 'por_definir', start_window: 'mes',
    note: 'Quiere 2 caras en Periférico', next_step: 'Enviar propuesta', next_step_at: local });
  assert.equal(r.status, 201);
  const l = await lead(id);
  assert.deepEqual([l.decision_maker, l.budget_status, l.start_window], ['si', 'por_definir', 'mes']);
  assert.equal(l.next_step, 'Enviar propuesta');
  assert.equal(l.last_note, 'Quiere 2 caras en Periférico');
  assert.ok(l.events.some((e) => /Perfil: Sí, decide · Por definir · Este mes/.test(e.content)));
  const list = (await req('/api/leads', { cookie: ana })).json;
  assert.equal(list.find((x) => x.id === id).last_note, 'Quiere 2 caras en Periférico');
  assert.equal(F.nextAction(l).agreed, true);

  // El siguiente toque reemplaza el acuerdo; sin acuerdo vuelve la cadencia
  await touch(id, 'seguimiento');
  const l2 = await lead(id);
  assert.equal(l2.next_step_at, null);
  assert.notEqual(F.nextAction(l2).agreed, true);
});

test('postventa: fin de campaña al vender, referidos y renovación', async () => {
  const id = (await req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'llamada', phone: '5560000002', assigned_to: anaId } })).json.id;
  await touch(id, 'cumple');
  await touch(id, 'cotizado', { quote_amount: 90000 });
  assert.equal((await touch(id, 'renovo')).status, 400, 'aún no está vendido');
  await touch(id, 'vendido', { sale_amount: 80000, campaign_end: '2030-03-31' });
  let l = await lead(id);
  assert.equal(l.campaign_end, '2030-03-31');
  assert.equal(F.nextAction(l).kind, 'postventa');

  await touch(id, 'referidos', { note: 'Recomendó a su primo' });
  assert.equal((await touch(id, 'referidos')).status, 400, 'los referidos se piden una vez');
  l = await lead(id);
  assert.equal(F.nextAction(l).kind, 'renovacion');

  assert.equal((await touch(id, 'renovo', { renewal_amount: 'abc' })).status, 400);
  await touch(id, 'renovo', { renewal_amount: '40,000', campaign_end: '2030-09-30' });
  l = await lead(id);
  assert.equal(l.renewal_amount, 40000);
  assert.equal(l.campaign_end, '2030-09-30');
  assert.equal(l.sale_amount, 80000, 'la venta original no cambia');
  assert.equal(F.nextAction(l).kind, 'renovacion', 'arranca el siguiente ciclo');
  await touch(id, 'no_renueva');
  assert.equal(F.nextAction(await lead(id)), null);
});

test('etapas que se ven: nuevo, contactando, contestó y declinados con o sin perfil', async () => {
  assert.equal(F.stageOf({ status: 'nuevo', touch_count: 0 }), 'nuevo');
  assert.equal(F.stageOf({ status: 'nuevo', touch_count: 1 }), 'contactando');
  assert.equal(F.stageOf({ status: 'nuevo', touch_count: 2, contacted_at: 'x' }), 'contesto');
  assert.equal(F.stageOf({ status: 'declinado', profile: 'cumple' }), 'declinado_perfil');
  assert.equal(F.stageOf({ status: 'declinado', profile: 'no_cumple' }), 'declinado_sin');
  assert.equal(F.stageOf({ status: 'cotizando' }), 'cotizando');

  const mk = async (phone) => (await req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'whatsapp', phone, assigned_to: anaId } })).json.id;
  const fresh = await mk('5561000001');
  const tried = await mk('5561000002'); await touch(tried, 'sin_respuesta');
  const answered = await mk('5561000003'); await touch(answered, 'conversacion');
  const lostFit = await mk('5561000004'); await touch(lostFit, 'cumple'); await touch(lostFit, 'rechazo', { decline_reason: 'Precio' });
  const lostNoFit = await mk('5561000005'); await touch(lostNoFit, 'no_cumple');
  const ids = async (stage) => (await req(`/api/leads?stage=${stage}`, { cookie: gerente })).json.map((l) => l.id);
  assert.ok((await ids('nuevo')).includes(fresh));
  assert.deepEqual((await ids('contactando')).filter((i) => i === tried), [tried]);
  assert.ok((await ids('contesto')).includes(answered));
  assert.ok((await ids('declinado_perfil')).includes(lostFit));
  assert.ok((await ids('declinado_sin')).includes(lostNoFit));
  assert.ok(!(await ids('declinado_perfil')).includes(lostNoFit));
  // El conteo del Resumen coincide con el filtro
  const s = (await req('/api/stats', { cookie: gerente })).json;
  for (const st of F.STAGES) {
    const n = s.byStage.find((r) => r.key === st)?.n || 0;
    assert.equal(n, (await ids(st)).length, `conteo de ${st}`);
  }
});
