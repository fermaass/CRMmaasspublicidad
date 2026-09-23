const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');

const config = {
  adminEmail: 'gerente@test.com', adminPassword: 'clave-gerente', adminName: 'Gerente',
  formApiKey: 'form-key', whatsappVerifyToken: 'verify-me', whatsappAppSecret: 'app-secret', cookieSecure: false,
};
let server; let base; let db;

before(async () => {
  db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function req(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function login(email, password) {
  const r = await req('/api/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, r.text);
  return r.headers.get('set-cookie').split(';')[0];
}

function waPayload(from, name, text) {
  return { object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    contacts: [{ wa_id: from, profile: { name } }],
    messages: [{ from, type: 'text', text: { body: text } }],
  } }] }] };
}
function waSign(body) {
  return 'sha256=' + crypto.createHmac('sha256', config.whatsappAppSecret).update(JSON.stringify(body)).digest('hex');
}

let gerente; let vendedorA; let vendedorB; let analista; let idA; let idB;

test('gerente crea usuarios de cada rol', async () => {
  gerente = await login('gerente@test.com', 'clave-gerente');
  for (const [name, email, role] of [['Ana', 'ana@test.com', 'vendedor'], ['Beto', 'beto@test.com', 'vendedor'],
    ['Carla', 'carla@test.com', 'analista'], ['Mar', 'mar@test.com', 'marketing']]) {
    const r = await req('/api/users', { method: 'POST', cookie: gerente, body: { name, email, password: 'password123', role } });
    assert.equal(r.status, 201, r.text);
    if (email === 'ana@test.com') idA = r.json.id;
    if (email === 'beto@test.com') idB = r.json.id;
  }
  vendedorA = await login('ana@test.com', 'password123');
  vendedorB = await login('beto@test.com', 'password123');
  analista = await login('carla@test.com', 'password123');
  const r = await req('/api/users', { method: 'POST', cookie: vendedorA, body: { name: 'X', email: 'x@x.com', password: 'password123', role: 'gerente' } });
  assert.equal(r.status, 403);
});

test('formulario: rechaza sin clave y crea lead con clave', async () => {
  assert.equal((await req('/webhooks/form', { method: 'POST', body: { nombre: 'Juan', telefono: '5512345678' } })).status, 401);
  const r = await req('/webhooks/form?key=form-key', { method: 'POST',
    body: { nombre: 'Juan Pérez', telefono: '55 1234 5678', email: 'juan@mail.com', utm_campaign: 'fb-septiembre', mensaje: 'Quiero info' } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.created, true);
});

test('formulario urlencoded con redirect (formulario HTML simple)', async () => {
  const res = await fetch(`${base}/webhooks/form`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key: 'form-key', nombre: 'Luisa', email: 'luisa@mail.com', redirect: 'https://maass.com/gracias' }),
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://maass.com/gracias');
});

test('WhatsApp: verificación, firma y deduplicación con el lead del formulario', async () => {
  const v = await req('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc');
  assert.equal(v.text, 'abc');
  assert.equal((await req('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=abc')).status, 403);

  const body = waPayload('5215512345678', 'Juan WA', 'Hola, sigo interesado');
  assert.equal((await req('/webhooks/whatsapp', { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=00' } })).status, 401);
  assert.equal((await req('/webhooks/whatsapp', { method: 'POST', body, headers: { 'x-hub-signature-256': waSign(body) } })).status, 200);

  const nuevo = waPayload('5213300000000', 'María', 'Precio?');
  await req('/webhooks/whatsapp', { method: 'POST', body: nuevo, headers: { 'x-hub-signature-256': waSign(nuevo) } });

  const leads = (await req('/api/leads', { cookie: gerente })).json;
  assert.equal(leads.length, 3, 'el mensaje de Juan por WhatsApp no debe duplicar su lead');
  const juan = leads.find((l) => l.email === 'juan@mail.com');
  const detail = (await req(`/api/leads/${juan.id}`, { cookie: gerente })).json;
  assert.ok(detail.events.some((e) => e.type === 'contacto' && e.content.includes('sigo interesado')));
  assert.ok(leads.some((l) => l.source === 'whatsapp' && l.name === 'María'));
});

test('perfil y estado se mantienen coherentes; el perfil sobrevive al declinar', async () => {
  const juan = (await req('/api/leads?q=juan', { cookie: gerente })).json[0];
  await req(`/api/leads/${juan.id}`, { method: 'PATCH', cookie: gerente, body: { profile: 'cumple' } });
  let l = (await req(`/api/leads/${juan.id}`, { cookie: gerente })).json;
  assert.equal(l.status, 'nuevo_perfil');

  await req(`/api/leads/${juan.id}`, { method: 'PATCH', cookie: gerente, body: { status: 'declinado', decline_reason: 'Presupuesto' } });
  l = (await req(`/api/leads/${juan.id}`, { cookie: gerente })).json;
  assert.equal(l.status, 'declinado');
  assert.equal(l.profile, 'cumple');
  assert.equal(l.decline_reason, 'Presupuesto');

  // Base para otra campaña: declinados que cumplen perfil
  const reuse = (await req('/api/leads?status=declinado&profile=cumple', { cookie: gerente })).json;
  assert.deepEqual(reuse.map((x) => x.id), [juan.id]);

  // Si vuelve a escribir, se reabre conservando el perfil
  const again = waPayload('5215512345678', 'Juan', 'Ahora sí tengo presupuesto');
  await req('/webhooks/whatsapp', { method: 'POST', body: again, headers: { 'x-hub-signature-256': waSign(again) } });
  l = (await req(`/api/leads/${juan.id}`, { cookie: gerente })).json;
  assert.equal(l.status, 'nuevo_perfil');
  assert.equal(l.profile, 'cumple');
});

test('permisos: vendedor ve lo suyo y lo libre, analista solo lee', async () => {
  const leads = (await req('/api/leads', { cookie: gerente })).json;
  const [l1, l2] = leads;
  await req(`/api/leads/${l1.id}`, { method: 'PATCH', cookie: gerente, body: { assigned_to: idA } });

  // Beto no ve el lead de Ana ni puede tocarlo
  const betoLeads = (await req('/api/leads', { cookie: vendedorB })).json;
  assert.ok(!betoLeads.some((l) => l.id === l1.id));
  assert.equal((await req(`/api/leads/${l1.id}`, { cookie: vendedorB })).status, 404);

  // Beto no puede editar un lead sin asignar, pero sí tomarlo
  assert.equal((await req(`/api/leads/${l2.id}`, { method: 'PATCH', cookie: vendedorB, body: { status: 'cotizando' } })).status, 403);
  assert.equal((await req(`/api/leads/${l2.id}/take`, { method: 'POST', cookie: vendedorB, body: {} })).status, 200);
  assert.equal((await req(`/api/leads/${l2.id}/take`, { method: 'POST', cookie: vendedorA, body: {} })).status, 404);
  assert.equal((await req(`/api/leads/${l2.id}`, { method: 'PATCH', cookie: vendedorB, body: { status: 'cotizando' } })).status, 200);

  // Vendedor no reasigna
  assert.equal((await req(`/api/leads/${l2.id}`, { method: 'PATCH', cookie: vendedorB, body: { assigned_to: idA } })).status, 403);

  // Analista ve todo, no edita, sí exporta
  assert.equal((await req('/api/leads', { cookie: analista })).json.length, leads.length);
  assert.equal((await req(`/api/leads/${l1.id}`, { method: 'PATCH', cookie: analista, body: { status: 'vendido' } })).status, 403);
  assert.equal((await req(`/api/leads/${l1.id}/notes`, { method: 'POST', cookie: analista, body: { content: 'x' } })).status, 403);
  const csv = await req('/api/leads.csv?profile=cumple', { cookie: analista });
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Juan Pérez/);
  assert.equal((await req('/api/leads.csv', { cookie: vendedorA })).status, 403);
});

test('sin sesión no hay acceso y la API rechaza formularios de otros sitios', async () => {
  assert.equal((await req('/api/leads')).status, 401);
  const r = await fetch(`${base}/api/users`, {
    method: 'POST', headers: { cookie: gerente, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=h&email=h@h.com&password=password123&role=gerente',
  });
  assert.equal(r.status, 415);
});

test('usuario desactivado pierde la sesión', async () => {
  await req(`/api/users/${idB}`, { method: 'PATCH', cookie: gerente, body: { active: false } });
  assert.equal((await req('/api/leads', { cookie: vendedorB })).status, 401);
  assert.equal((await req('/api/login', { method: 'POST', body: { email: 'beto@test.com', password: 'password123' } })).status, 401);
});
