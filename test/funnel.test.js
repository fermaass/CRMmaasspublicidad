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
const form = (nombre, telefono, campana) => req('/webhooks/form?key=k', { method: 'POST', body: { nombre, telefono, campana } });
const patch = (id, body, cookie = gerente) => req(`/api/leads/${id}`, { method: 'PATCH', cookie, body });

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

test('el embudo cuenta avances aunque el lead retroceda o se decline', async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await form(`L${i}`, `550000000${i}`, i < 3 ? 'FB-Sep' : 'Google')).json.id);
  for (const id of ids.slice(0, 4)) await patch(id, { assigned_to: anaId });

  // L0: contesta, cumple, cotiza, cierra
  await patch(ids[0], { contacted: true }, ana);
  await patch(ids[0], { profile: 'cumple' }, ana);
  await patch(ids[0], { status: 'cotizando' }, ana);
  await patch(ids[0], { status: 'vendido', sale_amount: '$45,000' }, ana);
  // L1: cotiza (sin marcar contacto) y luego se declina: sigue contando como contactado y cotizado
  await patch(ids[1], { profile: 'cumple' }, ana);
  await patch(ids[1], { status: 'cotizando' }, ana);
  await patch(ids[1], { status: 'declinado', decline_reason: 'Precio' }, ana);
  // L2: solo contesta
  await patch(ids[2], { contacted: true }, ana);
  // L3: nada; L4: sin asignar

  const s = (await req('/api/stats', { cookie: gerente })).json;
  const { dias_cierre: diasCierre, sin_origen: sinOrigen, ...funnel } = s.funnel;
  assert.ok(diasCierre >= 0); assert.equal(sinOrigen, 0);
  assert.deepEqual(funnel, { recibidos: 5, contactados: 3, perfilados: 2, cotizados: 2, cerrados: 1, declinados: 1, ingresos: 45000, en_cotizacion: 0, cotizando_ahora: 0 });

  const fb = s.campaignFunnel.find((c) => c.key === 'FB-Sep');
  assert.equal(fb.recibidos, 3); assert.equal(fb.cotizados, 2); assert.equal(fb.cerrados, 1);
  assert.equal(s.campaignFunnel[0].key, 'FB-Sep', 'las campañas que más cierran van primero');

  const anaRow = s.sellerFunnel.find((r) => r.key === 'Ana');
  assert.equal(anaRow.recibidos, 4); assert.equal(anaRow.contactados, 3); assert.equal(anaRow.cotizados, 2); assert.equal(anaRow.cerrados, 1);
  assert.ok(anaRow.horas_contacto >= 0 && anaRow.horas_contacto < 1);
  assert.equal(s.sellerFunnel.at(-1).key, 'Sin asignar');

  // Filtro por campaña y lista de campañas
  assert.equal((await req('/api/stats?campaign=Google', { cookie: gerente })).json.funnel.recibidos, 2);
  // Las campañas que llegan por formulario se agregan solas a la lista
  assert.deepEqual((await req('/api/catalog', { cookie: gerente })).json.campana.map((c) => c.name), ['FB-Sep', 'Google']);

  // El historial registra el contacto; se puede desmarcar si no ha cotizado
  const l2 = (await req(`/api/leads/${ids[2]}`, { cookie: gerente })).json;
  assert.ok(l2.contacted_at);
  assert.ok(l2.events.some((e) => e.content === 'El cliente contestó'));
  await patch(ids[2], { contacted: false }, ana);
  assert.equal((await req(`/api/leads/${ids[2]}`, { cookie: gerente })).json.contacted_at, null);
  await patch(ids[1], { contacted: false }, ana);
  assert.ok((await req(`/api/leads/${ids[1]}`, { cookie: gerente })).json.contacted_at, 'si ya cotizó no se desmarca');
});

test('campañas de la lista: el vendedor solo elige, marketing pone inversión y se mide el costo', async () => {
  const cat = () => req('/api/catalog', { cookie: gerente }).then((r) => r.json.campana);
  const fb = (await cat()).find((c) => c.name === 'FB-Sep');

  // El vendedor no puede inventar campañas; sí elegir una de la lista (sin importar mayúsculas)
  assert.equal((await req('/api/leads', { method: 'POST', cookie: ana, body: { source: 'whatsapp', phone: '5599999999', campaign: 'Inventada' } })).status, 400);
  assert.equal((await req('/api/catalog', { method: 'POST', cookie: ana, body: { kind: 'campana', name: 'X' } })).status, 403);
  const r = await req('/api/leads', { method: 'POST', cookie: ana, body: { source: 'whatsapp', phone: '5599999999', campaign: 'fb-sep' } });
  assert.equal(r.status, 201, r.text);
  assert.equal((await req(`/api/leads/${r.json.id}`, { cookie: ana })).json.campaign, 'FB-Sep');

  // Marketing captura inversión y los costos salen en el resumen
  assert.equal((await req(`/api/catalog/${fb.id}`, { method: 'PATCH', cookie: gerente, body: { budget: 'abc' } })).status, 400);
  await req(`/api/catalog/${fb.id}`, { method: 'PATCH', cookie: gerente, body: { budget: '12,000' } });
  const row = (await req('/api/stats', { cookie: gerente })).json.campaignFunnel.find((c) => c.key === 'FB-Sep');
  assert.equal(row.inversion, 12000);
  assert.equal(row.recibidos, 4);
  assert.equal(row.ingresos, 45000);

  // Renombrar la campaña actualiza sus leads
  await req(`/api/catalog/${fb.id}`, { method: 'PATCH', cookie: gerente, body: { name: 'Facebook Septiembre' } });
  assert.equal((await req('/api/leads?campaign=Facebook%20Septiembre', { cookie: gerente })).json.length, 4);

  const csv = await req('/api/leads.csv', { cookie: gerente });
  assert.match(csv.text, /Monto de venta/);
  assert.match(csv.text, /45000/);
});
