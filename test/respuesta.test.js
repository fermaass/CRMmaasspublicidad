const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };

test('cada toque guarda cuándo tocaba; el reporte trae respuesta por lead, seguimientos y vencidos de cada asesor', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'RESP-1234', formApiKey: 'k' } }));
  const call = async (method, path, body, cookie) => {
    const r = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
  };
  const ck = (await call('POST', '/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'X', setup_code: 'RESP-1234', can_assign: '1' })).headers.get('set-cookie').split(';')[0];
  const ana = (await call('POST', '/api/users', { name: 'Ana', email: 'a@x.mx', password: 'clave12345', role: 'vendedor' }, ck)).json.id;
  const ack = (await call('POST', '/api/login', { email: 'a@x.mx', password: 'clave12345' })).headers.get('set-cookie').split(';')[0];
  const ids = [];
  for (const t of ['5581000001', '5581000002']) {
    const id = (await call('POST', '/webhooks/form?key=k', { nombre: 'Cliente', telefono: t })).json.id;
    await call('POST', `/api/leads/${id}/assign`, { assigned_to: ana }, ck);
    ids.push(id);
  }
  // Ana toca el primero; el segundo sigue sin primer toque.
  await call('POST', `/api/leads/${ids[0]}/touches`, { channel: 'llamada', outcome: 'sin_respuesta' }, ack);
  const t = db.prepare('SELECT due_at, created_at FROM lead_touches WHERE lead_id = ?').get(ids[0]);
  assert.ok(t.due_at, 'el toque guarda cuándo tocaba');
  // Un lead con su seguimiento vencido desde hace dos días.
  db.prepare('UPDATE leads SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 3 * 864e5).toISOString(), ids[1]);

  const from = new Date(Date.now() - 864e5).toISOString(); const to = new Date(Date.now() + 60e3).toISOString();
  const a = (await call('GET', `/api/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, null, ck)).json;
  assert.equal(a.respuestas.length, 2);
  assert.ok(a.respuestas.find((x) => x.id === ids[0]).first_touch_at);
  assert.equal(a.respuestas.find((x) => x.id === ids[1]).first_touch_at, null);
  assert.equal(a.seguimientos.length, 1);
  assert.equal(a.sellers.find((r) => r.id === ana).vencidos_hoy, 1);
  // La vendedora solo ve lo suyo.
  const mine = (await call('GET', `/api/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, null, ack)).json;
  assert.ok(mine.respuestas.every((x) => x.seller_id === ana));
  s.close();
});
