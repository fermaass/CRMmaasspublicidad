const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };

test('contacto repetido: se queda con su asesor y el gerente recibe aviso; solo el gerente cambia de asesor y queda en el historial', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'AVIS-1234', formApiKey: 'k' } }));
  const call = async (method, path, body, cookie) => {
    const r = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
  };
  const login = async (email) => (await call('POST', '/api/login', { email, password: 'clave12345' })).headers.get('set-cookie').split(';')[0];
  const admin = (await call('POST', '/api/setup', { name: 'Fer', email: 'f@x.mx', password: 'clave12345', company: 'X', setup_code: 'AVIS-1234' })).headers.get('set-cookie').split(';')[0];
  const ids = {};
  for (const [n, e, role, extra] of [['Gina', 'g@x.mx', 'gerente'], ['Oscar', 'o@x.mx', 'operador'], ['Ana', 'a@x.mx', 'vendedor'],
    ['Beto', 'b@x.mx', 'vendedor'], ['Edgar', 'e@x.mx', 'vendedor', { can_assign: '1' }]]) {
    ids[n] = (await call('POST', '/api/users', { name: n, email: e, password: 'clave12345', role, ...extra }, admin)).json.id;
  }
  const [gina, oscar, beto, edgar] = await Promise.all(['g@x.mx', 'o@x.mx', 'b@x.mx', 'e@x.mx'].map(login));
  const fb = db.prepare("SELECT id FROM catalog_items WHERE kind = 'canal' LIMIT 1").get().id;

  // Llega un lead y se le asigna a Ana.
  const id = (await call('POST', '/webhooks/form?key=k', { nombre: 'Juan Pérez', telefono: '5512340000' })).json.id;
  assert.equal((await call('POST', `/api/leads/${id}/assign`, { assigned_to: ids.Ana }, oscar)).status, 200);

  // Vuelve a llegar por el formulario: se queda con Ana y hay aviso.
  await call('POST', '/webhooks/form?key=k', { nombre: 'Juan Pérez', telefono: '55 1234 0000', mensaje: 'Sigo interesado' });
  // Beto lo captura a mano: no se le da, queda en el historial y el aviso dice quién lo registró.
  const taken = await call('POST', '/api/leads', { source: 'whatsapp', channel_id: fb, phone: '5512340000', message: 'Me escribió a mí' }, beto);
  assert.deepEqual(taken.json, { existing: true, taken_by: 'Ana' });
  let l = (await call('GET', `/api/leads/${id}`, null, admin)).json;
  assert.equal(l.assigned_to, ids.Ana);
  assert.ok(l.events.some((e) => /Me escribió a mí/.test(e.content)), 'lo que capturó Beto quedó en el historial');

  // Mismo nombre completo con otro teléfono: no se junta, pero se avisa como posible duplicado.
  const twin = (await call('POST', '/webhooks/form?key=k', { nombre: 'juan pérez', telefono: '5599990000' })).json;
  assert.equal(twin.created, true);

  assert.equal((await call('GET', '/api/notifications', null, beto)).status, 403, 'los avisos son del gerente');
  let n = (await call('GET', '/api/notifications', null, gina)).json;
  assert.equal(n.unseen, 3);
  assert.deepEqual(n.items.map((x) => x.kind), ['posible', 'duplicado', 'duplicado']);
  assert.match(n.items[1].text, /lo registró Beto.*Se quedó con Ana/);
  assert.match(n.items[0].text, /Posible duplicado: Juan Pérez/);
  await call('POST', '/api/notifications/seen', {}, gina);
  assert.equal((await call('GET', '/api/notifications', null, admin)).json.unseen, 0);

  // Cambiar de asesor: ni un vendedor (aunque asigne), ni el Asignador; solo el gerente, y queda en el historial.
  assert.equal((await call('POST', `/api/leads/${id}/assign`, { assigned_to: ids.Beto }, edgar)).status, 403);
  assert.equal((await call('POST', `/api/leads/${id}/assign`, { assigned_to: ids.Beto }, oscar)).status, 403);
  assert.equal((await call('POST', `/api/leads/${id}/assign`, {}, oscar)).status, 403, 'tampoco quitárselo');
  assert.equal((await call('PATCH', `/api/leads/${id}`, { assigned_to: ids.Beto }, oscar)).status, 403);
  assert.equal((await call('GET', `/api/leads/${id}`, null, oscar)).json.can_reassign, false);
  assert.equal((await call('POST', `/api/leads/${id}/assign`, { assigned_to: ids.Beto }, gina)).status, 200);
  l = (await call('GET', `/api/leads/${id}`, null, admin)).json;
  const ev = l.events.find((e) => /Cambió de asesor/.test(e.content));
  assert.equal(ev.content, 'Cambió de asesor: Ana → Beto'); assert.equal(ev.user_name, 'Gina');
  // Un lead sin asesor sí lo reparte quien asigna (incluido el vendedor con "También asigna leads").
  assert.equal((await call('POST', `/api/leads/${twin.id}/assign`, { assigned_to: ids.Ana }, edgar)).status, 200);
  s.close();
});
