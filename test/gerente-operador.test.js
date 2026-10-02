const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

let server; let base;
async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const login = async (email) => (await req('/api/login', { method: 'POST', body: { email, password: 'password123' } })).cookie;

before(async () => {
  const db = openDb(':memory:');
  server = createApp({ db, config: { formApiKey: 'k' } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('en equipos chicos el gerente también opera: se decide al crearlo y se puede cambiar', async () => {
  // Primer uso: el gerente dice que también asignará
  const setup = await req('/api/setup', { method: 'POST', body: { name: 'Dueño', email: 'd@t.com', password: 'password123', can_assign: '1' } });
  assert.equal(setup.json.can_assign, 1);
  const boss = setup.cookie;
  assert.equal((await req('/api/me', { cookie: boss })).json.can_assign, 1);
  assert.equal((await req('/api/workload', { cookie: boss })).status, 200, 've Asignación');
  assert.equal((await req('/api/team', { cookie: boss })).status, 200, 'y sigue viendo Equipo hoy');

  // Otro gerente sin funciones de operador
  const g2 = (await req('/api/users', { method: 'POST', cookie: boss, body: { name: 'G2', email: 'g2@t.com', password: 'password123', role: 'gerente', can_assign: '' } })).json.id;
  assert.equal((await req('/api/workload', { cookie: await login('g2@t.com') })).status, 403);
  // Se le puede activar después
  await req(`/api/users/${g2}`, { method: 'PATCH', cookie: boss, body: { can_assign: true } });
  assert.equal((await req('/api/workload', { cookie: await login('g2@t.com') })).status, 200);
  // Si cambia de rol, conserva la función; al pasar a Coordinador de leads ya no hace falta la casilla
  await req(`/api/users/${g2}`, { method: 'PATCH', cookie: boss, body: { role: 'analista' } });
  assert.equal((await req('/api/users', { cookie: boss })).json.find((x) => x.id === g2).can_assign, 1);
  assert.equal((await req('/api/workload', { cookie: await login('g2@t.com') })).status, 200, 'un analista que asigna ve Asignación');
  await req(`/api/users/${g2}`, { method: 'PATCH', cookie: boss, body: { role: 'operador' } });
  assert.equal((await req('/api/users', { cookie: boss })).json.find((x) => x.id === g2).can_assign, 0);
  assert.equal((await req('/api/me', { cookie: await login('g2@t.com') })).json.can_assign, 1, 'el coordinador asigna por su rol');
});

test('cualquier usuario puede asignar; el coordinador asigna desde Asignación; se ve si un vendedor se autoasigna', async () => {
  const boss = await login('d@t.com');
  const mkUser = async (name, role, can) => (await req('/api/users', { method: 'POST', cookie: boss,
    body: { name, email: `${name.toLowerCase()}@t.com`, password: 'password123', role, can_assign: can ? '1' : '' } })).json.id;
  const vId = await mkUser('Vale', 'vendedor', true);
  const pId = await mkUser('Pepe', 'vendedor', false);
  await mkUser('Coco', 'operador', false);
  await mkUser('Mara', 'marketing', true);
  const vale = await login('vale@t.com'); const pepe = await login('pepe@t.com'); const coco = await login('coco@t.com'); const mara = await login('mara@t.com');
  assert.equal((await req('/api/me', { cookie: vale })).json.can_assign, 1);
  assert.equal((await req('/api/workload', { cookie: pepe })).status, 403, 'sin la casilla no asigna');

  const mk = async (phone, cookie = coco) => (await req('/api/leads', { method: 'POST', cookie, body: { source: 'whatsapp', channel_id: 1, phone } })).json.id;
  // El coordinador asigna desde Asignación (antes el PATCH se descartaba sin avisar)
  const a = await mk('5570000001');
  assert.equal((await req(`/api/leads/${a}`, { method: 'PATCH', cookie: coco, body: { assigned_to: pId } })).status, 200);
  assert.equal((await req(`/api/leads/${a}`, { cookie: boss })).json.assigned_to, pId);
  assert.equal((await req(`/api/leads/${a}`, { method: 'PATCH', cookie: coco, body: { status: 'vendido', sale_amount: 5 } })).status, 200);
  assert.equal((await req(`/api/leads/${a}`, { cookie: boss })).json.status, 'nuevo', 'el coordinador no mueve etapas');

  // Vale (vendedora que asigna) ve los sin asignar en Asignación, pero no los leads de Pepe
  const b = await mk('5570000002'); const c = await mk('5570000003'); const d = await mk('5570000004');
  const none = (await req('/api/leads?assigned=none', { cookie: vale })).json.map((l) => l.id);
  assert.ok([b, c, d].every((id) => none.includes(id)));
  assert.equal((await req(`/api/leads/${a}`, { cookie: vale })).status, 404, 'no ve leads de otro vendedor');
  assert.ok(!(await req('/api/leads', { cookie: vale })).json.some((l) => l.id === b), 'su tablero solo trae los suyos');
  for (const id of [b, c]) assert.equal((await req(`/api/leads/${id}/assign`, { method: 'POST', cookie: vale, body: { assigned_to: vId } })).status, 200);
  assert.equal((await req(`/api/leads/${d}/assign`, { method: 'POST', cookie: mara, body: { assigned_to: pId } })).status, 200, 'marketing con la casilla asigna');

  const row = (await req('/api/team', { cookie: boss })).json.sellers.find((r) => r.id === vId);
  assert.equal(row.asigna, true); assert.equal(row.asigno_7d, 2); assert.equal(row.autoasignados_7d, 2);
  assert.equal((await req('/api/team', { cookie: boss })).json.sellers.find((r) => r.id === pId).asigna, false);
});
