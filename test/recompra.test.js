const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k' };
let server; let base; let gerente; let ana; let anaId;
async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
}
const touch = (id, outcome, extra = {}) => req(`/api/leads/${id}/touches`, { method: 'POST', cookie: ana, body: { channel: 'llamada', outcome, ...extra } });

before(async () => {
  const db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = async (email, password) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return r.headers.get('set-cookie').split(';')[0];
  };
  gerente = await login('g@t.com', 'clave-gerente');
  anaId = (await req('/api/users', { method: 'POST', cookie: gerente, body: { name: 'Ana', email: 'a@t.com', password: 'password123', role: 'vendedor' } })).json.id;
  ana = await login('a@t.com', 'password123');
});
after(() => server.close());

test('un cliente que ya compró y vuelve a escribir abre una oportunidad nueva sin tocar su venta', async () => {
  const id = (await req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'whatsapp', channel_id: 1, phone: '5566001100', name: 'Laura', assigned_to: anaId } })).json.id;
  await touch(id, 'cumple');
  await touch(id, 'cotizado', { quote_amount: 150000 });
  await touch(id, 'vendido', { sale_amount: 135000, campaign_end: '2099-01-01' });
  // Toca pedir referidos: todavía no se puede registrar la renovación.
  assert.equal((await touch(id, 'renovo', { renewal_amount: 1 })).status, 400);

  const again = await req('/webhooks/form?key=k', { method: 'POST', body: { nombre: 'Laura', telefono: '55 6600 1100', mensaje: 'Quiero otra cara' } });
  assert.equal(again.status, 201);
  assert.equal(again.json.repeat_of, id);
  const nuevo = (await req(`/api/leads/${again.json.id}`, { cookie: gerente })).json;
  assert.equal(nuevo.status, 'nuevo'); assert.equal(nuevo.assigned_to, anaId, 'se queda con su vendedora');
  const viejo = (await req(`/api/leads/${id}`, { cookie: gerente })).json;
  assert.equal(viejo.status, 'vendido'); assert.equal(viejo.sale_amount, 135000);

  // Si vuelve a escribir, se suma a la oportunidad abierta.
  const third = await req('/webhooks/form?key=k', { method: 'POST', body: { telefono: '5566001100', mensaje: '¿Me mandas precio?' } });
  assert.equal(third.json.id, again.json.id); assert.equal(third.json.created, false);
});
