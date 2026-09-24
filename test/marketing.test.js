const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k' };
let server; let base; let gerente; let mkt; let ana; let anaId;
async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* texto */ }
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const login = async (email) => (await req('/api/login', { method: 'POST', body: { email, password: 'password123' } })).cookie;

before(async () => {
  const db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  gerente = (await req('/api/login', { method: 'POST', body: { email: 'g@t.com', password: 'clave-gerente' } })).cookie;
  anaId = (await req('/api/users', { method: 'POST', cookie: gerente, body: { name: 'Ana', email: 'a@t.com', password: 'password123', role: 'vendedor' } })).json.id;
  await req('/api/users', { method: 'POST', cookie: gerente, body: { name: 'Mar', email: 'm@t.com', password: 'password123', role: 'marketing' } });
  ana = await login('a@t.com'); mkt = await login('m@t.com');
});
after(() => server.close());

test('el origen es obligatorio al capturar a mano', async () => {
  const r = await req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'whatsapp', phone: '5570000001' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /de dónde viene/);
});

test('marketing corrige el origen pero no toca el avance de ventas', async () => {
  const id = (await req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'whatsapp', phone: '5570000002', channel_id: 1, assigned_to: anaId } })).json.id;
  assert.equal((await req(`/api/leads/${id}/touches`, { method: 'POST', cookie: mkt, body: { channel: 'llamada', outcome: 'cumple' } })).status, 403);
  await req(`/api/leads/${id}`, { method: 'PATCH', cookie: mkt, body: { status: 'vendido', channel_id: 3, name: 'Corregido' } });
  const l = (await req(`/api/leads/${id}`, { cookie: mkt })).json;
  assert.equal(l.status, 'nuevo', 'la etapa no cambia');
  assert.equal(l.channel_id, 3); assert.equal(l.name, 'Corregido');
  assert.equal(l.can_edit, false); assert.equal(l.can_edit_origin, true);
  assert.equal((await req(`/api/leads/${id}/notes`, { method: 'POST', cookie: mkt, body: { content: 'Vino del evento' } })).status, 201);
  assert.equal((await req('/api/settings', { method: 'PATCH', cookie: mkt, body: { auto_assign: true } })).status, 403, 'el reparto no es de marketing');
});

test('calidad por campaña: por qué se descartan, días a cerrar y audiencia para anuncios', async () => {
  const mk = async (phone, name, email) => (await req('/api/leads', { method: 'POST', cookie: gerente,
    body: { source: 'whatsapp', phone, name, email, campaign: 'FB-Prueba', assigned_to: anaId } })).json.id;
  await req('/api/catalog', { method: 'POST', cookie: gerente, body: { kind: 'campana', name: 'FB-Prueba' } });
  const t = (id, outcome, extra = {}) => req(`/api/leads/${id}/touches`, { method: 'POST', cookie: ana, body: { channel: 'whatsapp', outcome, ...extra } });
  const a = await mk('55 7000 0010', 'Laura Gómez Ruiz', 'Laura@Mail.com'); await t(a, 'no_cumple');
  const b = await mk('5570000011', 'Pedro'); await t(b, 'no_cumple');
  const c = await mk('5570000012', 'Sofía'); await t(c, 'cumple'); await t(c, 'cotizado'); await t(c, 'vendido', { sale_amount: 1000 });
  const s = (await req('/api/stats', { cookie: mkt })).json;
  const row = s.campaignFunnel.find((r) => r.key === 'FB-Prueba');
  assert.deepEqual(row.descartes, [{ key: 'No cumple perfil', n: 2 }]);
  assert.ok(row.dias_cierre >= 0 && row.dias_cierre < 1);
  assert.equal(row.perfilados, 1);
  const csv = (await req('/api/leads.csv?audience=contestaron&format=ads', { cookie: mkt })).text;
  const lines = csv.replace(/^﻿/, '').split('\n');
  assert.equal(lines[0], 'email,phone,fn,ln,country');
  assert.ok(lines.includes('laura@mail.com,+525570000010,Laura,Gómez Ruiz,MX'), csv);
});
