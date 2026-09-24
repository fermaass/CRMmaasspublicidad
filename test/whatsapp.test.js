const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');
const F = require('../public/followup.js');

test('número de WhatsApp: lada de México y sin el 1 viejo', () => {
  assert.equal(F.waNumber('55 1234 5678'), '525512345678');
  assert.equal(F.waNumber('+52 1 55 1234 5678'), '525512345678');
  assert.equal(F.waNumber('+52 (81) 2222-3333'), '528122223333');
  assert.equal(F.waNumber('+1 415 555 0100'), '14155550100');
  assert.equal(F.waNumber('1234'), null);
  assert.equal(F.waNumber(null), null);
});

test('liga con el mensaje ya escrito', () => {
  const url = F.waLink('55 1234 5678', 'Hola {nombre}, soy {vendedor}. Sobre {producto}…', { nombre: 'Laura Gómez', vendedor: 'Ana', producto: 'Espectacular' });
  assert.ok(url.startsWith('https://wa.me/525512345678?text='));
  assert.equal(decodeURIComponent(url.split('text=')[1]), 'Hola Laura, soy Ana. Sobre Espectacular…');
  // Sin nombre no queda "Hola ,"
  assert.equal(decodeURIComponent(F.waLink('5512345678', 'Hola {nombre}, ¿qué tal?').split('text=')[1]), 'Hola, ¿qué tal?');
  assert.equal(F.waLink('abc', 'x'), null);
});

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k' };
let server; let base; let gerente;
async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
before(async () => {
  const db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  gerente = (await req('/api/login', { method: 'POST', body: { email: 'g@t.com', password: 'clave-gerente' } })).cookie;
});
after(() => server.close());

test('plantillas de WhatsApp: de fábrica, editables por gerente y visibles para todos', async () => {
  const { id } = (await req('/api/users', { method: 'POST', cookie: gerente, body: { name: 'Ana', email: 'a@t.com', password: 'password123', role: 'vendedor' } })).json;
  const ana = (await req('/api/login', { method: 'POST', body: { email: 'a@t.com', password: 'password123' } })).cookie;
  const t = (await req('/api/wa-templates', { cookie: ana })).json;
  assert.deepEqual(Object.keys(t).sort(), ['cadencia', 'cotizacion', 'postventa', 'recontacto', 'renovacion', 'seguimiento']);
  await req('/api/settings', { method: 'PATCH', cookie: gerente, body: { wa_templates: { cotizacion: 'Hola {nombre}, ¿revisaste la propuesta?', otra: 'x' } } });
  const t2 = (await req('/api/wa-templates', { cookie: ana })).json;
  assert.equal(t2.cotizacion, 'Hola {nombre}, ¿revisaste la propuesta?');
  assert.equal(t2.cadencia, t.cadencia);
  assert.equal(t2.otra, undefined);
  // Vacía vuelve a la de fábrica
  await req('/api/settings', { method: 'PATCH', cookie: gerente, body: { wa_templates: { cotizacion: '  ' } } });
  assert.equal((await req('/api/wa-templates', { cookie: ana })).json.cotizacion, t.cotizacion);
  assert.equal((await req('/api/settings', { method: 'PATCH', cookie: ana, body: { wa_templates: { cadencia: 'x' } } })).status, 403);

  // Al desactivar a la vendedora, sus leads en curso quedan sin asignar
  const lead = (await req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'whatsapp', channel_id: 1, phone: '5512340000', assigned_to: id } })).json.id;
  const w0 = (await req('/api/workload', { cookie: gerente })).json;
  assert.equal(w0.unassigned, 0);
  assert.equal((await req('/api/users', { cookie: gerente })).json.find((u) => u.id === id).en_curso, 1);
  const r = (await req(`/api/users/${id}`, { method: 'PATCH', cookie: gerente, body: { active: false } })).json;
  assert.equal(r.released, 1);
  const l = (await req(`/api/leads/${lead}`, { cookie: gerente })).json;
  assert.equal(l.assigned_to, null);
  assert.ok(l.events.some((e) => /Ana ya no está activo/.test(e.content)));
  const w = (await req('/api/workload', { cookie: gerente })).json;
  assert.equal(w.unassigned, 1);
  assert.ok(w.oldest_unassigned_at);
});
