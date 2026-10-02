const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k' };
let server; let base; let db; let mkt;
async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
}
before(async () => {
  db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = async (email, password) => (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).headers.get('set-cookie').split(';')[0];
  const g = await login('g@t.com', 'clave-gerente');
  await req('/api/users', { method: 'POST', cookie: g, body: { name: 'Mar', email: 'm@t.com', password: 'password123', role: 'marketing' } });
  mkt = await login('m@t.com', 'password123');
});
after(() => server.close());

test('campañas a revisar: sin leads con inversión, sin inversión capturada y costo alto', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const add = async (name, amount) => {
    const { id } = (await req('/api/catalog', { method: 'POST', cookie: mkt, body: { kind: 'campana', name } })).json;
    if (amount) await req(`/api/catalog/${id}/budgets`, { method: 'PUT', cookie: mkt, body: { month, amount } });
    return id;
  };
  await add('Muerta', 5000); await add('Sin inversión', 0); await add('Buena', 1000); await add('Cara', 20000);
  const ins = db.prepare(`INSERT INTO leads (name, phone, phone_key, source, campaign, status, profile, profiled_at, decision_maker, budget_status, created_at, updated_at)
    VALUES (?, ?, ?, 'formulario', ?, 'nuevo', ?, ?, ?, ?, ?, ?)`);
  const now = new Date().toISOString(); let i = 0;
  const lead = (camp, fitOk, budget) => { i++; ins.run(`L${i}`, `55700${String(i).padStart(5, '0')}`, `55700${String(i).padStart(5, '0')}`, camp, fitOk ? 'cumple' : 'sin_perfilar', fitOk ? now : null, fitOk ? 'si' : null, budget, now, now); };
  for (let k = 0; k < 4; k++) lead('Buena', true, 'si');
  lead('Cara', true, 'por_definir');
  for (let k = 0; k < 2; k++) lead('Sin inversión', false, null);
  const h = (await req('/api/campaign-health', { cookie: mkt })).json;
  const by = Object.fromEntries(h.campaigns.map((c) => [c.key, c]));
  assert.equal(by.Muerta.status, 'red'); assert.match(by.Muerta.motivos[0], /nunca ha traído leads/);
  assert.equal(by['Sin inversión'].status, 'yellow'); assert.match(by['Sin inversión'].motivos.join(), /no tiene inversión capturada/);
  assert.equal(by.Cara.status, 'red'); assert.match(by.Cara.motivos.join(), /veces el promedio/);
  assert.equal(by.Buena.status, 'green');
  assert.equal(h.campaigns[0].status, 'red', 'las rojas van primero');

  const d = (await req('/api/campaign-detail?name=Buena', { cookie: mkt })).json;
  assert.equal(d.weeks.at(-1).leads, 4); assert.equal(d.weeks.at(-1).perfil, 4);
  assert.equal(d.months[0].inversion, 1000);
  assert.equal(d.perfil_rapido.budget_status.options.find((o) => o.value === 'si').n, 4);
  assert.equal((await req('/api/campaign-detail?name=NoExiste', { cookie: mkt })).status, 404);
});
