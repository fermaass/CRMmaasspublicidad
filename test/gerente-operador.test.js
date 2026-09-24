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
  // Si deja de ser gerente, pierde las funciones de operador
  await req(`/api/users/${g2}`, { method: 'PATCH', cookie: boss, body: { role: 'analista' } });
  const u = (await req('/api/users', { cookie: boss })).json.find((x) => x.id === g2);
  assert.equal(u.can_assign, 0);

  // En otros roles no aplica
  const v = (await req('/api/users', { method: 'POST', cookie: boss, body: { name: 'V', email: 'v@t.com', password: 'password123', role: 'vendedor', can_assign: '1' } })).json.id;
  assert.equal((await req('/api/users', { cookie: boss })).json.find((x) => x.id === v).can_assign, 0);
  assert.equal((await req('/api/workload', { cookie: await login('v@t.com') })).status, 403);
});
