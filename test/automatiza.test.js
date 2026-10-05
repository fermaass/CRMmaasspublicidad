const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const F = require('../public/followup.js');

const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };

test('una sola persona atiende leads: los del formulario se le asignan solos; lo que captura por WhatsApp ya cuenta como toque 1', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'AUTO-1234', formApiKey: 'k' } }));
  const post = (path, body, cookie) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const ck = (await post('/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'Maass', setup_code: 'AUTO-1234', can_sell: '1' })).headers.get('set-cookie').split(';')[0];
  const get = async (id) => (await (await fetch(`${url}/api/leads/${id}`, { headers: { cookie: ck } })).json());

  // Formulario: se asigna solo al único que atiende, aunque el reparto automático esté apagado.
  const f = await (await post('/webhooks/form?key=k', { nombre: 'Laura', telefono: '5511112222' })).json();
  let l = await get(f.id);
  assert.equal(l.assigned_name, 'Fer'); assert.equal(F.stageOf(l), 'nuevo');

  // Captura manual de alguien que le escribió por WhatsApp: toque 1 "Contestó" y etapa Contestó.
  const fb = db.prepare("SELECT id FROM catalog_items WHERE kind = 'canal' LIMIT 1").get().id;
  const m = await (await post('/api/leads', { source: 'whatsapp', phone: '5533334444', name: 'Pedro', channel_id: String(fb) }, ck)).json();
  l = await get(m.id);
  assert.equal(l.assigned_name, 'Fer'); assert.equal(l.touch_count, 1); assert.ok(l.contacted_at); assert.equal(F.stageOf(l), 'contesto');
  const t = await (await fetch(`${url}/api/leads/${m.id}/touches`, { headers: { cookie: ck } })).json();
  assert.equal(t[0].channel, 'whatsapp'); assert.equal(t[0].outcome, 'conversacion');

  // "Otro" origen no se toma como conversación.
  const o = await (await post('/api/leads', { source: 'otro', phone: '5555556666', name: 'Rita', channel_id: String(fb) }, ck)).json();
  l = await get(o.id);
  assert.equal(l.touch_count, 0); assert.equal(F.stageOf(l), 'nuevo');
  s.close();
});

test('nombres limpios, producto con duración calcula la renovación y primeros pasos se marcan solos', async () => {
  const { niceName } = require('../src/leads');
  assert.equal(niceName('laura   gomez de la cruz'), 'Laura Gomez de la Cruz');
  assert.equal(niceName('JUAN PÉREZ'), 'Juan Pérez');
  assert.equal(niceName('McDonald López'), 'McDonald López', 'si ya trae mayúsculas y minúsculas se respeta');

  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'DUR-1234', formApiKey: 'k' } }));
  const call = (method, path, body, cookie) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ck = (await call('POST', '/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'Gym', setup_code: 'DUR-1234' })).headers.get('set-cookie').split(';')[0];

  let ob = await (await call('GET', '/api/onboarding', null, ck)).json();
  assert.equal(ob.done, false); assert.ok(ob.steps.every((st) => !st.done));

  assert.equal((await call('POST', '/api/catalog', { kind: 'producto', name: 'Mala', price: '100', duration_months: '0' }, ck)).status, 400);
  const prod = await (await call('POST', '/api/catalog', { kind: 'producto', name: 'Membresía anual', price: '6000', duration_months: '12' }, ck)).json();
  await call('PATCH', `/api/users/${(await (await call('GET', '/api/me', null, ck)).json()).id}`, { can_sell: true }, ck);
  const f = await (await call('POST', '/webhooks/form?key=k', { nombre: 'ana ruiz', telefono: '5512121212', email: 'ANA@Correo.MX' })).json();
  let l = await (await call('GET', `/api/leads/${f.id}`, null, ck)).json();
  assert.equal(l.name, 'Ana Ruiz'); assert.equal(l.email, 'ana@correo.mx');

  ob = await (await call('GET', '/api/onboarding', null, ck)).json();
  assert.deepEqual(ob.steps.filter((st) => st.done).map((st) => st.key).sort(), ['equipo', 'formulario', 'productos']);

  // Vender la membresía: la fecha de término queda a 12 meses sin capturarla.
  const r = await call('POST', `/api/leads/${f.id}/touches`, { channel: 'llamada', outcome: 'vendido', product_id: String(prod.id), sale_amount: '6000' }, ck);
  assert.equal(r.status, 201, await r.text());
  l = await (await call('GET', `/api/leads/${f.id}`, null, ck)).json();
  const expected = new Date(); expected.setMonth(expected.getMonth() + 12);
  assert.equal(l.campaign_end, expected.toISOString().slice(0, 10));
  s.close();
});
