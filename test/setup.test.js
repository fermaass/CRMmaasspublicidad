const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

let server; let base;
before(async () => {
  server = createApp({ db: openDb(':memory:'), config: {} }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, cookie, method = 'POST') => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});

test('primer uso: se crea el gerente desde la pantalla y solo una vez', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/setup`)).json(), { needed: true });
  const r = await post('/api/setup', { name: 'Fer', email: 'fer@maass.com', password: 'clave1234' });
  assert.equal(r.status, 201);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()).role, 'gerente');

  assert.equal((await post('/api/setup', { name: 'X', email: 'x@x.com', password: 'clave1234' })).status, 409);
  assert.deepEqual(await (await fetch(`${base}/api/setup`)).json(), { needed: false });

  // Las claves se generaron solas y sirven para recibir leads
  const s = await (await fetch(`${base}/api/settings`, { headers: { cookie } })).json();
  assert.ok(s.form_api_key);
  assert.equal(s.form_url, `${base}/webhooks/form`);
  assert.equal((await post(`/webhooks/form?key=${s.form_api_key}`, { nombre: 'Ana', telefono: '5500000000' })).status, 201);

  // Cambiar la clave invalida la anterior
  await post('/api/settings', { regenerate_form_key: true }, cookie, 'PATCH');
  assert.equal((await post(`/webhooks/form?key=${s.form_api_key}`, { nombre: 'B', telefono: '5500000001' })).status, 401);
});

test('la configuración es solo para el gerente', async () => {
  assert.equal((await fetch(`${base}/api/settings`)).status, 401);
});
