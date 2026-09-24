const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k' };
let server; let base; let db; let gerente; let ana; let anaId;
async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
}
const mk = async (phone, extra = {}) => (await req('/api/leads', { method: 'POST', cookie: gerente,
  body: { source: 'whatsapp', channel_id: 1, phone, assigned_to: anaId, ...extra } })).json.id;
const touch = (id, outcome, extra = {}) => req(`/api/leads/${id}/touches`, { method: 'POST', cookie: ana, body: { channel: 'llamada', outcome, ...extra } });

before(async () => {
  db = openDb(':memory:');
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

test('el gerente no registra toques en leads de otros, pero puede pedir seguimiento', async () => {
  const id = await mk('5580000001');
  assert.equal((await req(`/api/leads/${id}/touches`, { method: 'POST', cookie: gerente, body: { channel: 'llamada', outcome: 'sin_respuesta' } })).status, 403);
  const l0 = (await req(`/api/leads/${id}`, { cookie: gerente })).json;
  assert.equal(l0.can_touch, false); assert.equal(l0.can_reassign, true);

  assert.equal((await req(`/api/leads/${id}/request`, { method: 'POST', cookie: ana, body: { text: 'x' } })).status, 403);
  await req(`/api/leads/${id}/request`, { method: 'POST', cookie: gerente, body: { text: 'Llámale hoy, ofrécele 2 caras' } });
  const mine = (await req('/api/leads', { cookie: ana })).json.find((l) => l.id === id);
  assert.equal(mine.manager_request, 'Llámale hoy, ofrécele 2 caras');
  const team = (await req('/api/team', { cookie: gerente })).json;
  assert.equal(team.sellers.find((s) => s.name === 'Ana').pedidos, 1);
  assert.equal((await req('/api/team', { cookie: ana })).status, 403);

  await touch(id, 'sin_respuesta');
  const after1 = (await req(`/api/leads/${id}`, { cookie: gerente })).json;
  assert.equal(after1.manager_request, null, 'el toque atiende el pedido');
  assert.ok(after1.events.some((e) => /Atendió el seguimiento/.test(e.content)));
});

test('Equipo hoy marca leads sin primer toque, cotizaciones frías y acuerdos vencidos', async () => {
  const old = new Date(Date.now() - 5 * 3600e3).toISOString();
  const fresh = await mk('5580000002');
  db.prepare('UPDATE leads SET created_at = ? WHERE id = ?').run(old, fresh);
  const cold = await mk('5580000003');
  await touch(cold, 'cumple'); await touch(cold, 'cotizado', { quote_amount: 50000 });
  db.prepare('UPDATE leads SET last_touch_at = ?, quoted_at = ? WHERE id = ?').run(new Date(Date.now() - 20 * 86400e3).toISOString(), new Date(Date.now() - 20 * 86400e3).toISOString(), cold);
  const agreed = await mk('5580000004');
  await touch(agreed, 'conversacion', { note: 'Le marco', next_step: 'Le marco', next_step_at: new Date(Date.now() - 3 * 3600e3).toISOString() });
  const row = (await req('/api/team', { cookie: gerente })).json.sellers.find((s) => s.name === 'Ana');
  assert.equal(row.sin_primer_toque, 1);
  assert.equal(row.frias, 1);
  assert.equal(row.acuerdos_vencidos, 1);
  assert.ok(row.toques_7d >= 4);
  assert.ok(row.alertas.some((a) => a.id === cold && /fría/.test(a.why)));
});

test('pipeline y tabla de vendedores: vivas, frías, venta esperada, ticket y descuento', async () => {
  // Historial: 3 cotizaciones cerradas (2 ganadas) → tasa 2/3
  for (const [i, won] of [[10, true], [11, true], [12, false]]) {
    const id = await mk(`55800000${i}`);
    await touch(id, 'cumple'); await touch(id, 'cotizado', { quote_amount: 100000 });
    if (won) await touch(id, 'vendido', { sale_amount: 90000 }); else await touch(id, 'rechazo', { decline_reason: 'Precio' });
  }
  const live = await mk('5580000020'); await touch(live, 'cumple'); await touch(live, 'cotizado', { quote_amount: 60000 });
  const s = (await req('/api/stats', { cookie: gerente })).json;
  const p = s.pipeline.find((r) => r.key === 'Ana');
  assert.equal(p.vivas, 1); assert.equal(p.vivas_monto, 60000);
  assert.equal(p.frias, 1); assert.equal(p.frias_monto, 50000);
  assert.ok(Math.abs(p.tasa - 2 / 3) < 1e-9);
  assert.equal(Math.round(p.esperado), 40000);
  const a = s.sellerFunnel.find((r) => r.key === 'Ana');
  assert.equal(a.ticket, 90000);
  assert.ok(Math.abs(a.descuento - 0.1) < 1e-9, 'cotizó 100 mil y vendió en 90 mil');
  assert.ok(a.toques_7d > 0);
  assert.ok(a.pierde_por.some((x) => x.key === 'Precio'));
});
