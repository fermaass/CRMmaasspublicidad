const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k' };
let server; let base; let gerente; let vendedor;

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* texto */ }
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

before(async () => {
  const db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  gerente = (await req('/api/login', { method: 'POST', body: { email: 'g@t.com', password: 'clave-gerente' } })).cookie;
  await req('/api/users', { method: 'POST', cookie: gerente, body: { name: 'Ana', email: 'a@t.com', password: 'password123', role: 'vendedor' } });
  vendedor = (await req('/api/login', { method: 'POST', body: { email: 'a@t.com', password: 'password123' } })).cookie;
});
after(() => server.close());

test('canales iniciales y alta de productos solo para gerente/marketing', async () => {
  const cat = (await req('/api/catalog', { cookie: vendedor })).json;
  assert.ok(cat.canal.some((c) => c.name === 'Facebook'));
  assert.deepEqual(cat.producto, []);
  assert.equal((await req('/api/catalog', { method: 'POST', cookie: vendedor, body: { kind: 'producto', name: 'X' } })).status, 403);
  assert.equal((await req('/api/catalog', { method: 'POST', cookie: gerente, body: { kind: 'producto', name: 'Espectacular' } })).status, 201);
  assert.equal((await req('/api/catalog', { method: 'POST', cookie: gerente, body: { kind: 'producto', name: 'espectacular' } })).status, 409);
  assert.equal((await req('/api/catalog', { method: 'POST', cookie: gerente, body: { kind: 'producto', name: 'Pantalla LED' } })).status, 201);
});

test('lead con producto y canal; filtros, resumen y CSV', async () => {
  const cat = (await req('/api/catalog', { cookie: gerente })).json;
  const esp = cat.producto.find((p) => p.name === 'Espectacular');
  const led = cat.producto.find((p) => p.name === 'Pantalla LED');
  const fb = cat.canal.find((c) => c.name === 'Facebook');

  assert.equal((await req('/api/leads', { method: 'POST', cookie: vendedor, body: { source: 'whatsapp', phone: '5511111111', product_id: 999 } })).status, 400);
  const r = await req('/api/leads', { method: 'POST', cookie: vendedor,
    body: { source: 'whatsapp', phone: '5511111111', name: 'Laura', product_id: String(esp.id), channel_id: String(fb.id) } });
  assert.equal(r.status, 201, r.text);

  // Formulario: reconoce por nombre; lo desconocido va al mensaje
  const f = await req('/webhooks/form?key=k', { method: 'POST', body: { nombre: 'Pepe', telefono: '5522222222', producto: 'pantalla led', canal: 'Radio' } });
  assert.equal(f.status, 201);
  const pepe = (await req(`/api/leads/${f.json.id}`, { cookie: gerente })).json;
  assert.equal(pepe.product_name, 'Pantalla LED');
  assert.equal(pepe.channel_id, null);
  assert.match(pepe.message, /Se enteró por: Radio/);

  const byProduct = (await req(`/api/leads?product=${esp.id}`, { cookie: gerente })).json;
  assert.deepEqual(byProduct.map((l) => l.name), ['Laura']);
  assert.equal(byProduct[0].channel_name, 'Facebook');
  assert.deepEqual((await req('/api/leads?channel=none', { cookie: gerente })).json.map((l) => l.name), ['Pepe']);

  // Cambiar producto queda en el historial
  await req(`/api/leads/${r.json.id}`, { method: 'PATCH', cookie: vendedor, body: { product_id: led.id } });
  const laura = (await req(`/api/leads/${r.json.id}`, { cookie: gerente })).json;
  assert.equal(laura.product_name, 'Pantalla LED');
  assert.ok(laura.events.some((e) => e.content === 'Producto: Pantalla LED'));

  const stats = (await req('/api/stats', { cookie: gerente })).json;
  assert.equal(stats.byProduct.find((x) => x.key === 'Pantalla LED').n, 2);
  assert.equal(stats.byChannel.find((x) => x.key === 'Facebook').n, 1);
  assert.deepEqual(stats.productStages.find((x) => x.key === 'Pantalla LED'), { key: 'Pantalla LED', status: 'nuevo', n: 2 });
  assert.equal(stats.byDay.reduce((t, d) => t + d.n, 0), 2);

  const csv = await req('/api/leads.csv', { cookie: gerente });
  assert.match(csv.text, /Se enteró por,Producto/);
  assert.match(csv.text, /Laura,.*Facebook,Pantalla LED/);
});

test('quitar un producto lo oculta pero el lead lo conserva', async () => {
  const cat = (await req('/api/catalog', { cookie: gerente })).json;
  const led = cat.producto.find((p) => p.name === 'Pantalla LED');
  await req(`/api/catalog/${led.id}`, { method: 'PATCH', cookie: gerente, body: { active: false } });
  const after = (await req('/api/catalog', { cookie: gerente })).json.producto.find((p) => p.id === led.id);
  assert.equal(after.active, 0);
  const leads = (await req(`/api/leads?product=${led.id}`, { cookie: gerente })).json;
  assert.equal(leads.length, 2);
  assert.equal(leads[0].product_name, 'Pantalla LED');
  // Volver a agregarlo con el mismo nombre lo reactiva
  assert.equal((await req('/api/catalog', { method: 'POST', cookie: gerente, body: { kind: 'producto', name: 'Pantalla LED' } })).status, 200);
});
