const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k' };
let server; let base; let gerente; const sellers = {};

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* texto */ }
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const lead = async (id) => (await req(`/api/leads/${id}`, { cookie: gerente })).json;
const capture = (phone, extra = {}) => req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'whatsapp', channel_id: 1, phone, ...extra } });

before(async () => {
  const db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  gerente = (await req('/api/login', { method: 'POST', body: { email: 'g@t.com', password: 'clave-gerente' } })).cookie;
  for (const name of ['Ana', 'Beto', 'Caro']) {
    const email = `${name.toLowerCase()}@t.com`;
    const { id } = (await req('/api/users', { method: 'POST', cookie: gerente, body: { name, email, password: 'password123', role: 'vendedor' } })).json;
    sellers[name] = { id, cookie: (await req('/api/login', { method: 'POST', body: { email, password: 'password123' } })).cookie };
  }
});
after(() => server.close());

test('de fábrica no se reparte solo: el lead capturado queda sin dueño', async () => {
  assert.equal((await req('/api/settings', { cookie: gerente })).json.auto_assign, false);
  const { id } = (await capture('5540000001')).json;
  assert.equal((await lead(id)).assigned_to, null);
});

test('el gerente asigna al capturar y la carga sugiere al de menos leads', async () => {
  const a1 = (await capture('5540000002', { assigned_to: sellers.Ana.id })).json.id;
  await capture('5540000003', { assigned_to: sellers.Ana.id });
  await capture('5540000004', { assigned_to: sellers.Beto.id });
  const l = await lead(a1);
  assert.equal(l.assigned_name, 'Ana');
  assert.ok(l.events.some((e) => e.content === 'Asignado a Ana'));

  const w = (await req('/api/workload', { cookie: gerente })).json;
  const byName = Object.fromEntries(w.sellers.map((s) => [s.name, s]));
  assert.deepEqual([byName.Ana.activos, byName.Beto.activos, byName.Caro.activos], [2, 1, 0]);
  assert.equal(w.suggested, sellers.Caro.id);
  assert.equal(w.unassigned, 1);

  // Un lead cerrado ya no cuenta como carga
  await req(`/api/leads/${a1}`, { method: 'PATCH', cookie: gerente, body: { status: 'declinado', decline_reason: 'Precio' } });
  const w2 = (await req('/api/workload', { cookie: gerente })).json;
  assert.equal(w2.sellers.find((s) => s.name === 'Ana').activos, 1);

  // Validaciones y permisos
  assert.equal((await capture('5540000005', { assigned_to: 9999 })).status, 400);
  assert.equal((await req('/api/workload', { cookie: sellers.Ana.cookie })).status, 403);
  // Si un vendedor manda assigned_to se ignora: se queda con su lead
  const own = (await req('/api/leads', { method: 'POST', cookie: sellers.Beto.cookie, body: { source: 'llamada', channel_id: 1, phone: '5540000006', assigned_to: sellers.Ana.id } })).json.id;
  assert.equal((await lead(own)).assigned_name, 'Beto');
});

test('repartir parejo asigna todos los sin dueño al de menor carga', async () => {
  for (const p of ['5540000010', '5540000011', '5540000012']) await capture(p);
  const before = (await req('/api/workload', { cookie: gerente })).json;
  assert.equal(before.unassigned, 4);
  assert.equal((await req('/api/leads/balance', { method: 'POST', cookie: gerente, body: {} })).json.assigned, 4);
  const after = (await req('/api/workload', { cookie: gerente })).json;
  assert.equal(after.unassigned, 0);
  const counts = after.sellers.map((s) => s.activos);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `carga dispareja: ${counts}`);
});

test('con el reparto automático encendido, va al de menor carga', async () => {
  await req('/api/settings', { method: 'PATCH', cookie: gerente, body: { auto_assign: true } });
  const w = (await req('/api/workload', { cookie: gerente })).json;
  const { id } = (await capture('5540000020')).json;
  assert.equal((await lead(id)).assigned_to, w.suggested);
});

test('"Administra leads" es un permiso por usuario, no depende del rol', async () => {
  const mk = async (name, role, extra = {}) => {
    const email = `${name}@t.com`;
    const { id } = (await req('/api/users', { method: 'POST', cookie: gerente, body: { name, email, password: 'password123', role, ...extra } })).json;
    return { id, cookie: (await req('/api/login', { method: 'POST', body: { email, password: 'password123' } })).cookie };
  };
  await req('/api/settings', { method: 'PATCH', cookie: gerente, body: { auto_assign: false } });
  const mkt = await mk('mkt', 'marketing');
  assert.equal((await req('/api/workload', { cookie: mkt.cookie })).status, 403, 'marketing sin permiso no asigna');
  const admin = await mk('admin', 'vendedor', { can_assign: true });
  assert.equal((await req('/api/me', { cookie: admin.cookie })).json.can_assign, 1);
  assert.equal((await req('/api/workload', { cookie: admin.cookie })).status, 200);

  // Quien administra ve los leads sin dueño y los asigna
  const { id } = (await capture('5540000030')).json;
  assert.ok((await req('/api/leads?assigned=none', { cookie: admin.cookie })).json.some((l) => l.id === id));
  assert.equal((await req(`/api/leads/${id}/assign`, { method: 'POST', cookie: admin.cookie, body: { assigned_to: sellers.Caro.id } })).status, 200);
  assert.equal((await lead(id)).assigned_name, 'Caro');
  assert.equal((await req(`/api/leads/${id}/assign`, { method: 'POST', cookie: admin.cookie, body: { assigned_to: 99999 } })).status, 400);

  // El gerente da o quita el permiso
  await req(`/api/users/${mkt.id}`, { method: 'PATCH', cookie: gerente, body: { can_assign: true } });
  assert.equal((await req('/api/workload', { cookie: mkt.cookie })).status, 200);
});

test('audiencias: no incluyen a los que nunca contestaron y se exportan tal cual', async () => {
  const fit = (await capture('5540000040', { assigned_to: sellers.Ana.id })).json.id;
  await req(`/api/leads/${fit}/touches`, { method: 'POST', cookie: sellers.Ana.cookie, body: { channel: 'llamada', outcome: 'cumple' } });
  await req(`/api/leads/${fit}/touches`, { method: 'POST', cookie: sellers.Ana.cookie, body: { channel: 'llamada', outcome: 'rechazo', decline_reason: 'Precio' } });
  const ghost = (await capture('5540000041', { assigned_to: sellers.Ana.id })).json.id;
  for (let i = 0; i < 5; i++) await req(`/api/leads/${ghost}/touches`, { method: 'POST', cookie: sellers.Ana.cookie, body: { channel: 'llamada', outcome: 'sin_respuesta' } });
  assert.equal((await lead(ghost)).decline_reason, 'No contestó (5 toques)');

  const s = (await req('/api/stats', { cookie: gerente })).json;
  assert.equal(s.audiences.perfil, 1);
  const csv = await fetch(`${base}/api/leads.csv?audience=perfil`, { headers: { cookie: gerente } }).then((r) => r.text());
  assert.match(csv, /5540000040/);
  assert.doesNotMatch(csv, /5540000041/);
});

test('el Resumen del vendedor es solo suyo y sin inversión', async () => {
  const s = (await req('/api/stats', { cookie: sellers.Ana.cookie })).json;
  assert.deepEqual(s.sellerFunnel.map((r) => r.key), ['Ana']);
  assert.ok(s.campaignFunnel.every((r) => r.inversion == null));
});
