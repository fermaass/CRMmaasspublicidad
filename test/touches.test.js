const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k', autoAssign: false };
let server; let base; let gerente; let ana; let anaId;

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* texto */ }
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const newLead = async (tel) => (await req('/webhooks/form?key=k', { method: 'POST', body: { nombre: `L${tel}`, telefono: tel } })).json.id;
const touch = (id, outcome, extra = {}) => req(`/api/leads/${id}/touches`, { method: 'POST', cookie: ana, body: { channel: 'llamada', outcome, ...extra } });
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

test('los toques mueven la etapa: responde en el 2, cumple perfil, se cotiza en el 3 y cierra en el 4', async () => {
  const id = await newLead('5510000001');
  assert.equal((await touch(id, 'sin_respuesta')).status, 403, 'sin asignar no se puede tocar');
  await req(`/api/leads/${id}`, { method: 'PATCH', cookie: gerente, body: { assigned_to: anaId } });

  assert.equal((await touch(id, 'cotizado')).status, 400, 'en Nuevo no se puede cotizar directo');
  assert.equal((await req(`/api/leads/${id}/touches`, { method: 'POST', cookie: ana, body: { outcome: 'sin_respuesta' } })).status, 400);

  await touch(id, 'sin_respuesta');
  let l = await lead(id);
  assert.equal(l.status, 'nuevo'); assert.equal(l.touch_count, 1); assert.equal(l.contacted_at, null);

  await touch(id, 'cumple');
  l = await lead(id);
  assert.equal(l.status, 'nuevo_perfil'); assert.equal(l.response_touch, 2); assert.ok(l.profiled_at);

  await touch(id, 'cotizado');
  l = await lead(id);
  assert.equal(l.status, 'cotizando'); assert.equal(l.quote_touch, 3);

  await touch(id, 'vendido', { sale_amount: '50,000' });
  l = await lead(id);
  assert.equal(l.status, 'vendido'); assert.equal(l.sale_amount, 50000); assert.equal(l.touch_count, 4);
  assert.equal((await touch(id, 'seguimiento')).status, 409, 'un lead cerrado ya no lleva toques');

  const list = (await req(`/api/leads/${id}/touches`, { cookie: ana })).json;
  assert.deepEqual(list.map((t) => [t.n, t.outcome]), [[1, 'sin_respuesta'], [2, 'cumple'], [3, 'cotizado'], [4, 'vendido']]);
});

test('no cumple perfil y rechazo declinan con su motivo', async () => {
  const a = await newLead('5510000002');
  const b = await newLead('5510000003');
  for (const id of [a, b]) await req(`/api/leads/${id}`, { method: 'PATCH', cookie: gerente, body: { assigned_to: anaId } });

  await touch(a, 'no_cumple');
  let l = await lead(a);
  assert.equal(l.status, 'declinado'); assert.equal(l.decline_reason, 'No cumple perfil'); assert.equal(l.response_touch, 1);

  await touch(b, 'cumple');
  assert.equal((await touch(b, 'rechazo', { decline_reason: 'lo que sea' })).status, 400);
  await touch(b, 'rechazo', { decline_reason: 'Precio' });
  l = await lead(b);
  assert.equal(l.status, 'declinado'); assert.equal(l.decline_reason, 'Precio');
});

test('cinco toques sin respuesta declinan solos; los reportes cuentan en qué toque responden y cotizan', async () => {
  const id = await newLead('5510000004');
  await req(`/api/leads/${id}`, { method: 'PATCH', cookie: gerente, body: { assigned_to: anaId } });
  for (let i = 1; i <= 4; i++) assert.equal((await touch(id, 'sin_respuesta')).json.auto_declined, false);
  const fifth = await touch(id, 'sin_respuesta');
  assert.equal(fifth.json.auto_declined, true);
  const l = await lead(id);
  assert.equal(l.status, 'declinado'); assert.equal(l.decline_reason, 'No contestó (5 toques)');

  const s = (await req('/api/stats', { cookie: gerente })).json;
  assert.deepEqual(s.touches.response, [{ n: 1, c: 2 }, { n: 2, c: 1 }]);
  assert.deepEqual(s.touches.quote, [{ n: 3, c: 1 }]);
  assert.equal(s.touches.noAnswer, 1);
  assert.deepEqual(s.touches.declineReasons.map((r) => r.key).sort(), ['No contestó (5 toques)', 'No cumple perfil', 'Precio']);
  const anaRow = s.sellerFunnel.find((r) => r.key === 'Ana');
  assert.equal(Math.round(anaRow.toques_respuesta * 100) / 100, 1.33);
  assert.equal(anaRow.toques_cotizacion, 3);
});

test('cadencia: un lead asignado hace días sin tocar cuenta como toque vencido', async () => {
  const db = openDb(':memory:');
  seedAdmin(db, config);
  const { ingestLead } = require('../src/leads');
  const { id } = ingestLead(db, { source: 'formulario', name: 'Viejo', phone: '5520000000' });
  const old = new Date(Date.now() - 3 * 86400e3).toISOString();
  db.prepare('UPDATE leads SET assigned_to = 1, assigned_at = ?, created_at = ? WHERE id = ?').run(old, old, id);
  const srv = createApp({ db, config }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const cookie = (await fetch(`${b}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'g@t.com', password: 'clave-gerente' }) })).headers.get('set-cookie').split(';')[0];
  const s = await (await fetch(`${b}/api/stats`, { headers: { cookie } })).json();
  srv.close();
  assert.equal(s.touches.overdue, 1);
  assert.equal(s.sellerFunnel[0].toques_vencidos, 1);
});
