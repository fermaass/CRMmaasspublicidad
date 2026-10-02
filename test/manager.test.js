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

test('montos obligatorios al cotizar y al vender', async () => {
  const id = await mk('5580000030');
  await touch(id, 'cumple');
  const r = await touch(id, 'cotizado');
  assert.equal(r.status, 400); assert.match(r.json.error, /monto de la cotización/);
  assert.equal((await req(`/api/leads/${id}`, { cookie: gerente })).json.touch_count, 1, 'el toque no quedó a medias');
  await touch(id, 'cotizado', { quote_amount: 70000 });
  assert.equal((await touch(id, 'vendido')).status, 400);
  assert.equal((await touch(id, 'vendido', { sale_amount: '65,000' })).status, 201);
});

test('pedidos: a tiempo, tarde y abiertos; cotizaciones más grandes; datos incompletos', async () => {
  const a = await mk('5580000040'); const b = await mk('5580000041');
  await req(`/api/leads/${a}/request`, { method: 'POST', cookie: gerente, body: { text: 'Llámale hoy' } });
  await req(`/api/leads/${b}/request`, { method: 'POST', cookie: gerente, body: { text: 'Mándale la propuesta' } });
  // el pedido de b lleva 30 horas abierto
  db.prepare('UPDATE manager_requests SET created_at = ? WHERE lead_id = ?').run(new Date(Date.now() - 30 * 3600e3).toISOString(), b);
  await touch(a, 'sin_respuesta'); // atiende a tiempo
  // un lead viejo quedó cotizando sin monto (datos de antes de la regla)
  db.prepare("UPDATE leads SET status = 'cotizando', quote_amount = NULL WHERE id = ?").run(b);
  const t = (await req('/api/team', { cookie: gerente })).json;
  const ana = t.sellers.find((s) => s.name === 'Ana');
  assert.equal(ana.pedidos_tarde, 1);
  assert.ok(ana.pedidos_abiertos.some((p) => p.id === b && p.horas >= 30));
  assert.ok(ana.pedidos_a_tiempo > 0);
  assert.ok(ana.incompletos.some((x) => x.id === b && /sin monto/.test(x.why)));
  assert.ok(t.top_quotes.length > 0);
  assert.ok(t.top_quotes.every((q, i, arr) => i === 0 || arr[i - 1].amount >= q.amount), 'de mayor a menor');
});

test('Resumen del vendedor: promedio del equipo sin nombres, solo si hay más de un vendedor', async () => {
  const solo = (await req('/api/stats', { cookie: ana })).json;
  assert.equal(solo.team, null, 'con un solo vendedor no hay contra quién comparar');
  const beoId = (await req('/api/users', { method: 'POST', cookie: gerente, body: { name: 'Beo', email: 'b@t.com', password: 'password123', role: 'vendedor' } })).json.id;
  const sold = (await req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'whatsapp', channel_id: 1, phone: '5580009991', assigned_to: beoId } })).json.id;
  db.prepare("UPDATE leads SET status = 'vendido', quoted_at = ?, won_at = ?, quote_amount = 100000, sale_amount = 80000 WHERE id = ?")
    .run(new Date().toISOString(), new Date().toISOString(), sold);
  const s = (await req('/api/stats', { cookie: ana })).json;
  assert.equal(s.team.vendedores, 2);
  assert.ok(s.team.recibidos > s.funnel.recibidos, 'el equipo incluye los leads de Beo');
  assert.ok(s.team.cerrados >= 1);
  assert.ok(s.sellerFunnel.every((r) => r.id === anaId), 'Ana solo ve su propia fila, no la de Beo');
  assert.equal((await req('/api/stats', { cookie: gerente })).json.team, null, 'al gerente no se le manda');
});
