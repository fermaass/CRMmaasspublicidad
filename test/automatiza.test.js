const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const F = require('../public/followup.js');

const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };

test('una sola persona atiende leads: los del formulario se le asignan solos; lo que captura de una llamada ya cuenta como toque 1', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'AUTO-1234', formApiKey: 'k' } }));
  const post = (path, body, cookie) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const ck = (await post('/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'Maass', setup_code: 'AUTO-1234', can_sell: '1' })).headers.get('set-cookie').split(';')[0];
  const get = async (id) => (await (await fetch(`${url}/api/leads/${id}`, { headers: { cookie: ck } })).json());

  // Formulario: se asigna solo al único que atiende, aunque el reparto automático esté apagado.
  const f = await (await post('/webhooks/form?key=k', { nombre: 'Laura', telefono: '5511112222' })).json();
  let l = await get(f.id);
  assert.equal(l.assigned_name, 'Fer'); assert.equal(F.stageOf(l), 'nuevo');

  // Captura manual de alguien que le llamó: ya hablaron, así que el toque 1 "Contestó" queda solo.
  const fb = db.prepare("SELECT id FROM catalog_items WHERE kind = 'canal' LIMIT 1").get().id;
  const m = await (await post('/api/leads', { source: 'llamada', phone: '5533334444', name: 'Pedro', channel_id: String(fb) }, ck)).json();
  l = await get(m.id);
  assert.equal(l.assigned_name, 'Fer'); assert.equal(l.touch_count, 1); assert.ok(l.contacted_at); assert.equal(F.stageOf(l), 'contesto');
  const t = await (await fetch(`${url}/api/leads/${m.id}/touches`, { headers: { cookie: ck } })).json();
  assert.equal(t[0].channel, 'llamada'); assert.equal(t[0].outcome, 'conversacion');

  // Por WhatsApp el cliente escribió pero falta contestarle: entra como Nuevo, sin toques.
  const w = await (await post('/api/leads', { source: 'whatsapp', phone: '5533335555', name: 'Lupe', channel_id: String(fb) }, ck)).json();
  l = await get(w.id);
  assert.equal(l.assigned_name, 'Fer'); assert.equal(l.touch_count, 0); assert.equal(F.stageOf(l), 'nuevo');

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

test('lead sin asignar: quien atiende leads lo toma al registrar el toque; al gerente que no atiende se le ofrece tomarlo', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'TAKE-1234', formApiKey: 'k' } }));
  const call = (method, path, body, cookie) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const g = (await call('POST', '/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'X', setup_code: 'TAKE-1234', can_assign: '1' })).headers.get('set-cookie').split(';')[0];
  for (const [n, e] of [['Ana', 'a@x.mx'], ['Beto', 'b@x.mx']]) await call('POST', '/api/users', { name: n, email: e, password: 'password123', role: 'vendedor' }, g);
  const id = (await (await call('POST', '/webhooks/form?key=k', { nombre: 'Lead', telefono: '5519191919' })).json()).id;

  let l = await (await call('GET', `/api/leads/${id}`, null, g)).json();
  assert.equal(l.assigned_to, null, 'con dos vendedores, reparto apagado y alguien que asigna, queda sin asignar');
  assert.equal(l.can_touch, false); assert.equal(l.can_take, true, 'al gerente que no atiende se le ofrece tomarlo');

  // El gerente activa "También atiende leads": ya puede registrar el toque y el lead queda suyo.
  const me = (await (await call('GET', '/api/me', null, g)).json());
  await call('PATCH', `/api/users/${me.id}`, { can_sell: true }, g);
  l = await (await call('GET', `/api/leads/${id}`, null, g)).json();
  assert.equal(l.can_touch, true); assert.equal(l.can_take, false);
  const r = await call('POST', `/api/leads/${id}/touches`, { channel: 'llamada', outcome: 'sin_respuesta' }, g);
  assert.equal(r.status, 201);
  l = await (await call('GET', `/api/leads/${id}`, null, g)).json();
  assert.equal(l.assigned_name, 'Fer'); assert.equal(l.touch_count, 1); assert.equal(F.stageOf(l), 'contactando');
  s.close();
});

test('si nadie tiene la función de asignar, los leads se reparten solos entre los vendedores', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'AUTO-5678', formApiKey: 'k' } }));
  const call = (method, path, body, cookie) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const g = (await call('POST', '/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'X', setup_code: 'AUTO-5678' })).headers.get('set-cookie').split(';')[0];
  for (const [n, e] of [['Ana', 'a@x.mx'], ['Beto', 'b@x.mx']]) await call('POST', '/api/users', { name: n, email: e, password: 'password123', role: 'vendedor' }, g);
  const ids = [];
  for (const t of ['5519191911', '5519191912']) ids.push((await (await call('POST', '/webhooks/form?key=k', { nombre: 'Lead', telefono: t })).json()).id);
  const owners = [];
  for (const id of ids) owners.push((await (await call('GET', `/api/leads/${id}`, null, g)).json()).assigned_name);
  assert.deepEqual(owners.sort(), ['Ana', 'Beto'], 'parejo, uno a cada quien');

  // En cuanto alguien asigna (Asignador), el reparto vuelve a ser manual.
  await call('POST', '/api/users', { name: 'Oscar', email: 'o@x.mx', password: 'password123', role: 'operador' }, g);
  const id = (await (await call('POST', '/webhooks/form?key=k', { nombre: 'Lead', telefono: '5519191913' })).json()).id;
  assert.equal((await (await call('GET', `/api/leads/${id}`, null, g)).json()).assigned_to, null);
  s.close();
});

test('quien asigna y captura un lead no se lo queda: si no elige vendedor, queda en Asignación', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'ASIG-1234', formApiKey: 'k' } }));
  const call = async (method, path, body, cookie) => { const r = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { r, json: await r.json().catch(() => null) }; };
  // El Administrador asigna y también atiende leads (como en un equipo chico).
  const ck = (await call('POST', '/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'X', setup_code: 'ASIG-1234', can_assign: '1', can_sell: '1' })).r.headers.get('set-cookie').split(';')[0];
  const ana = (await call('POST', '/api/users', { name: 'Ana', email: 'a@x.mx', password: 'password123', role: 'vendedor' }, ck)).json.id;
  const fb = db.prepare("SELECT id FROM catalog_items WHERE kind = 'canal' LIMIT 1").get().id;
  const sinElegir = (await call('POST', '/api/leads', { source: 'llamada', phone: '5577770001', channel_id: String(fb), assigned_to: '' }, ck)).json.id;
  const paraAna = (await call('POST', '/api/leads', { source: 'llamada', phone: '5577770002', channel_id: String(fb), assigned_to: String(ana) }, ck)).json.id;
  const get = async (id) => (await call('GET', `/api/leads/${id}`, null, ck)).json;
  assert.equal((await get(sinElegir)).assigned_to, null, 'queda en Asignación');
  assert.equal((await get(sinElegir)).touch_count, 0);
  assert.equal((await get(paraAna)).assigned_to, ana);
  s.close();
});
