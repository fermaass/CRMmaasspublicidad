const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

let server; let base; let boss;
async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const login = async (email, password) => req('/api/login', { method: 'POST', body: { email, password } });
const tokenOf = (link) => new URL(link).searchParams.get('acceso');

before(async () => {
  const db = openDb(':memory:');
  server = createApp({ db, config: { formApiKey: 'k', setupCode: 'PRUEBA-1234' } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const s = await req('/api/setup', { method: 'POST', body: { name: 'Dueña', email: 'd@t.com', password: 'password123', company: 'Gimnasio Fuerte', setup_code: 'prueba1234' } });
  boss = s.cookie;
});
after(() => server.close());

test('empresa: nombre del primer uso, palabra de lo que vende y renovaciones', async () => {
  assert.equal((await req('/api/company')).json.name, 'Gimnasio Fuerte', 'se ve sin iniciar sesión (pantalla de entrada)');
  const c = (await req('/api/company', { method: 'PATCH', cookie: boss, body: { term: 'membresia', renewals: true } })).json;
  assert.equal(c.term, 'membresia');
  assert.equal((await req('/api/company', { method: 'PATCH', cookie: boss, body: { term: 'otra' } })).status, 400);
  assert.equal((await req('/api/company', { method: 'PATCH', cookie: boss, body: { logo: 'data:image/svg+xml;base64,PHN2Zz4=' } })).status, 400, 'SVG no');
  assert.equal((await req('/api/company', { method: 'PATCH', cookie: boss, body: { logo: 'data:image/png;base64,iVBORw0KGgo=' } })).status, 200);
});

test('usuarios: alta por invitación, link de un solo uso, contraseña propia, olvido y bloqueo', async () => {
  const r = await req('/api/users', { method: 'POST', cookie: boss, body: { name: 'Ana', email: 'ana@t.com', role: 'vendedor' } });
  assert.equal(r.status, 201); assert.equal(r.json.kind, 'invite'); assert.ok(r.json.link.includes('?acceso='));
  const users = (await req('/api/users', { cookie: boss })).json;
  assert.equal(users.find((u) => u.email === 'ana@t.com').pendiente, 1, 'aparece como invitación pendiente');
  assert.match((await login('ana@t.com', 'cualquiera1')).json.error, /invitación/);

  const tok = tokenOf(r.json.link);
  assert.equal((await req(`/api/access/${tok}`)).json.name, 'Ana');
  assert.equal((await req(`/api/access/${tok}`, { method: 'POST', body: { password: 'corta' } })).status, 400);
  const ok = await req(`/api/access/${tok}`, { method: 'POST', body: { password: 'anaClave2026' } });
  assert.equal(ok.status, 200); assert.ok(ok.cookie, 'entra directo');
  assert.equal((await req(`/api/access/${tok}`, { method: 'POST', body: { password: 'otraClave2026' } })).status, 410, 'un solo uso');
  assert.equal((await login('ana@t.com', 'anaClave2026')).status, 200);
  assert.ok((await req('/api/users', { cookie: boss })).json.find((u) => u.email === 'ana@t.com').last_login_at);

  // El gerente ya no escribe contraseñas
  const anaId = users.find((u) => u.email === 'ana@t.com').id;
  assert.equal((await req(`/api/users/${anaId}`, { method: 'PATCH', cookie: boss, body: { password: 'ponerla123' } })).status, 400);

  // Cambiar mi contraseña (pide la actual) y cierra mis otras sesiones
  const other = (await login('ana@t.com', 'anaClave2026')).cookie;
  const mine = (await login('ana@t.com', 'anaClave2026')).cookie;
  assert.equal((await req('/api/me/password', { method: 'POST', cookie: mine, body: { current: 'mala', password: 'nuevaClave2026' } })).status, 400);
  assert.equal((await req('/api/me/password', { method: 'POST', cookie: mine, body: { current: 'anaClave2026', password: 'nuevaClave2026' } })).status, 200);
  assert.equal((await req('/api/me', { cookie: mine })).status, 200, 'esta sesión sigue');
  assert.equal((await req('/api/me', { cookie: other })).status, 401, 'las otras se cerraron');

  // Bloqueo: 5 intentos fallidos
  for (let i = 0; i < 4; i++) assert.equal((await login('ana@t.com', 'equivocada')).status, 401);
  assert.match((await login('ana@t.com', 'equivocada')).json.error, /Demasiados intentos/);
  assert.equal((await login('ana@t.com', 'nuevaClave2026')).status, 429, 'bloqueada aunque ahora la ponga bien');

  // Olvidó su contraseña: el gerente genera un link nuevo, que también la desbloquea
  const reset = (await req(`/api/users/${anaId}/access-link`, { method: 'POST', cookie: boss, body: {} })).json;
  assert.equal(reset.kind, 'reset');
  assert.equal((await req(`/api/access/${tokenOf(reset.link)}`, { method: 'POST', body: { password: 'recuperada2026' } })).status, 200);
  assert.equal((await login('ana@t.com', 'recuperada2026')).status, 200);
  // Un link nuevo invalida el anterior
  const l1 = (await req(`/api/users/${anaId}/access-link`, { method: 'POST', cookie: boss, body: {} })).json;
  await req(`/api/users/${anaId}/access-link`, { method: 'POST', cookie: boss, body: {} });
  assert.equal((await req(`/api/access/${tokenOf(l1.link)}`)).status, 410);
  assert.equal((await req(`/api/users/${anaId}/access-link`, { method: 'POST', cookie: (await login('ana@t.com', 'recuperada2026')).cookie, body: {} })).status, 403, 'solo el gerente');
});

test('precio fijo: el monto sale de precio × cantidad y el vendedor no lo cambia', async () => {
  const pf = (await req('/api/catalog', { method: 'POST', cookie: boss, body: { kind: 'producto', name: 'Membresía mensual', price: 800, fixed_price: true } })).json.id;
  const pl = (await req('/api/catalog', { method: 'POST', cookie: boss, body: { kind: 'producto', name: 'Entrenamiento personal', price: 1500 } })).json.id;
  assert.equal((await req('/api/catalog', { method: 'POST', cookie: boss, body: { kind: 'producto', name: 'Sin precio', fixed_price: true } })).status, 400);
  const items = (await req('/api/catalog', { cookie: boss })).json.producto;
  assert.equal(items.find((i) => i.id === pf).fixed_price, 1);

  const ana = (await login('ana@t.com', 'recuperada2026')).cookie;
  const anaId = (await req('/api/me', { cookie: ana })).json.id;
  const mk = async (phone) => (await req('/api/leads', { method: 'POST', cookie: boss, body: { source: 'whatsapp', channel_id: 1, phone, assigned_to: anaId } })).json.id;
  const t = (id, outcome, body = {}) => req(`/api/leads/${id}/touches`, { method: 'POST', cookie: ana, body: { channel: 'llamada', outcome, ...body } });
  const get = async (id) => (await req(`/api/leads/${id}`, { cookie: boss })).json;

  const a = await mk('5510000001');
  await t(a, 'cumple');
  // Sin monto pero con producto de precio fijo y cantidad: se calcula solo
  assert.equal((await t(a, 'cotizado', { product_id: pf, quantity: 3 })).status, 201);
  let l = await get(a);
  assert.equal(l.quote_amount, 2400); assert.equal(l.quantity, 3); assert.equal(l.product_id, pf);
  // Aunque el vendedor mande otro monto, se respeta el precio fijo
  await t(a, 'vendido', { sale_amount: 1000 });
  l = await get(a);
  assert.equal(l.sale_amount, 2400, 'precio fijo × 3');
  assert.equal((await req(`/api/leads/${a}`, { method: 'PATCH', cookie: ana, body: { sale_amount: 500 } })).status, 200);
  assert.equal((await get(a)).sale_amount, 2400, 'el vendedor no lo cambia desde la ficha');
  // El gerente sí corrige
  await req(`/api/leads/${a}`, { method: 'PATCH', cookie: boss, body: { sale_amount: 2000 } });
  assert.equal((await get(a)).sale_amount, 2000);

  // Precio de lista sin ser fijo: el vendedor captura el real
  const b = await mk('5510000002');
  await t(b, 'cumple');
  assert.equal((await t(b, 'cotizado', { product_id: pl })).status, 400, 'sin precio fijo hay que escribir el monto');
  await t(b, 'cotizado', { product_id: pl, quantity: 2, quote_amount: 2800 });
  assert.equal((await get(b)).quote_amount, 2800);
});

test('reporte de actividad: ventas por fecha de cierre, y cada rol ve lo suyo', async () => {
  const ana = (await login('ana@t.com', 'recuperada2026')).cookie;
  const r = (await req('/api/users', { method: 'POST', cookie: boss, body: { name: 'Beto', email: 'beto@t.com', role: 'vendedor', password: 'password123' } }));
  const beto = (await login('beto@t.com', 'password123')).cookie;
  await req('/api/users', { method: 'POST', cookie: boss, body: { name: 'Coco', email: 'coco@t.com', role: 'operador', password: 'password123' } });
  const coco = (await login('coco@t.com', 'password123')).cookie;
  const from = new Date(Date.now() - 86400e3).toISOString(); const to = new Date(Date.now() + 60e3).toISOString();
  const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const g = (await req(`/api/activity${q}`, { cookie: boss })).json;
  const ga = g.sellers.find((s) => s.name === 'Ana');
  assert.equal(ga.ventas, 1); assert.equal(ga.vendido, 2000); assert.equal(ga.cotizaciones, 2); assert.equal(ga.cotizado, 5200);
  assert.ok(g.ventas.length === 1 && g.ventas[0].product === 'Membresía mensual' && g.ventas[0].quantity === 3);
  assert.equal(g.sellers.find((s) => s.name === 'Beto').ventas, 0);

  const a = (await req(`/api/activity${q}`, { cookie: ana })).json;
  assert.equal(a.sellers.length, 1, 'la vendedora solo se ve a sí misma'); assert.equal(a.sellers[0].name, 'Ana');
  const b = (await req(`/api/activity${q}`, { cookie: beto })).json;
  assert.equal(b.ventas.length, 0, 'Beto no ve las ventas de Ana');
  const c = (await req(`/api/activity${q}`, { cookie: coco })).json;
  assert.equal(c.ventas, undefined, 'el coordinador no ve montos'); assert.ok(c.recibidos.n >= 2);
  assert.equal((await req('/api/activity?from=x', { cookie: boss })).status, 400);
  assert.equal(r.status, 201);
});

test('cartera en Excel: el gerente se lleva todo, con una hoja por clasificación; nadie más la descarga', async () => {
  const zlib = require('node:zlib');
  // Lee las partes del .xlsx (zip con encabezados locales).
  const unzip = (buf) => {
    const out = {}; let i = 0;
    while (buf.readUInt32LE(i) === 0x04034b50) {
      const size = buf.readUInt32LE(i + 18); const nameLen = buf.readUInt16LE(i + 26); const extra = buf.readUInt16LE(i + 28);
      const name = buf.subarray(i + 30, i + 30 + nameLen).toString(); const start = i + 30 + nameLen + extra;
      out[name] = zlib.inflateRawSync(buf.subarray(start, start + size)).toString(); i = start + size;
    }
    return out;
  };
  const r = await fetch(`${base}/api/export/cartera.xlsx`, { headers: { cookie: boss } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /cartera-gimnasio-fuerte-\d{4}-\d{2}-\d{2}\.xlsx/);
  const parts = unzip(Buffer.from(await r.arrayBuffer()));
  for (const sheet of ['Resumen', 'Toda la cartera', 'Clientes', 'Cotizando', 'En proceso', 'Declinados con perfil', 'Declinados sin perfil', 'Toques', 'Historial', 'Productos', 'Equipo']) {
    assert.ok(parts['xl/workbook.xml'].includes(`name="${sheet}"`), sheet);
  }
  const all = Object.keys(parts).filter((k) => k.startsWith('xl/worksheets/')).map((k) => parts[k]).join('');
  assert.ok(all.includes('Membresía mensual') && all.includes('Fin de membresía'), 'trae productos y usa la palabra de la empresa');
  const ana = (await login('ana@t.com', 'recuperada2026')).cookie;
  assert.equal((await fetch(`${base}/api/export/cartera.xlsx`, { headers: { cookie: ana } })).status, 403);
});
