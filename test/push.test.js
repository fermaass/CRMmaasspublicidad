const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('notificaciones: le llegan a quien le asignan un lead, a quienes asignan si llega sin vendedor, y nada más', async () => {
  const sent = [];
  let fail = null;
  const pushSender = async (sub, payload) => { if (fail) throw fail; sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); };
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'PUSH-1234', formApiKey: 'k', pushSender } }));
  const call = async (method, path, body, cookie) => {
    const r = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
  };
  const ck = (await call('POST', '/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'X', setup_code: 'PUSH-1234', can_assign: '1' })).headers.get('set-cookie').split(';')[0];
  const ana = (await call('POST', '/api/users', { name: 'Ana', email: 'a@x.mx', password: 'clave12345', role: 'vendedor' }, ck)).json.id;
  await call('POST', '/api/users', { name: 'Beto', email: 'b@x.mx', password: 'clave12345', role: 'vendedor' }, ck);
  const ack = (await call('POST', '/api/login', { email: 'a@x.mx', password: 'clave12345' })).headers.get('set-cookie').split(';')[0];
  const sub = (n) => ({ endpoint: `https://push.example.com/${n}`, keys: { p256dh: 'BKey', auth: 'auth' } });

  assert.match((await call('GET', '/api/push', null, ack)).json.public_key, /^[A-Za-z0-9_-]{80,}$/, 'la clave se genera sola');
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://x' } }, ack)).status, 400);
  await call('POST', '/api/push/subscribe', { subscription: sub('ana') }, ack);
  await call('POST', '/api/push/subscribe', { subscription: sub('fer') }, ck);

  // Llega un lead sin vendedor: aviso a quien asigna (Fer), no a Ana.
  const id = (await call('POST', '/webhooks/form?key=k', { nombre: 'Margarita Pase', telefono: '5512340000' })).json.id;
  await wait(150);
  assert.deepEqual(sent.map((x) => x.endpoint), ['https://push.example.com/fer']);
  assert.match(sent[0].title, /Lead por asignar: Margarita Pase/);
  // Se lo asignan a Ana: le llega a ella, con la liga para abrirlo.
  sent.length = 0;
  await call('POST', `/api/leads/${id}/assign`, { assigned_to: ana }, ck);
  await wait(150);
  assert.equal(sent.length, 1); assert.equal(sent[0].endpoint, 'https://push.example.com/ana');
  assert.equal(sent[0].title, 'Nuevo lead: Margarita Pase'); assert.equal(sent[0].url, `/?lead=${id}`);
  // Registrar un toque o mover el lead no manda nada.
  sent.length = 0;
  await call('POST', `/api/leads/${id}/touches`, { channel: 'llamada', outcome: 'sin_respuesta' }, ack);
  await wait(150);
  assert.equal(sent.length, 0);
  // Si el celular ya no existe (desinstaló la app), se borra solo.
  fail = Object.assign(new Error('gone'), { statusCode: 410 });
  const id2 = (await call('POST', '/webhooks/form?key=k', { nombre: 'Luis', telefono: '5512340001' })).json.id;
  await call('POST', `/api/leads/${id2}/assign`, { assigned_to: ana }, ck);
  await wait(150);
  assert.equal((await call('GET', '/api/push', null, ack)).json.devices, 0);
  s.close();
});
