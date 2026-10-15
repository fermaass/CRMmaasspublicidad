const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const { start, client, owner, invite } = require('./helpers');
const { passwordProblem } = require('../src/security');

const site = (t) => client(t.base, '');
const raw = (base, path, headers = {}) => new Promise((ok) => {
  http.get({ host: 'localhost', port: new URL(base).port, path, headers }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b })); });
});

test('encabezados: CSP con nonce en el sitio, CSP estricta en el panel y sin caché en datos', async (t) => {
  const app = await start(); t.after(app.close);
  const home = await site(app).get('/');
  const csp = home.headers.get('content-security-policy');
  const nonce = csp.match(/'nonce-([^']+)'/)[1];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/unsafe-inline'[^;]*script|script-src[^;]*unsafe-inline/.test(csp), 'sin scripts en línea libres');
  const inline = home.text.match(/<script(?![^>]*src=)[^>]*>/g);
  assert.ok(inline.length >= 2 && inline.every((s) => s.includes(`nonce="${nonce}"`)), 'cada script en línea lleva el nonce');
  assert.notEqual((await site(app).get('/')).headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1], nonce, 'nonce nuevo en cada respuesta');
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.match(home.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(home.headers.get('x-powered-by'), null);
  const panel = await client(app.base).get('/api/setup');
  assert.match(panel.headers.get('content-security-policy'), /script-src 'self';/);
  assert.equal(panel.headers.get('cache-control'), 'no-store');
  const idx = await client(app.base).get('/');
  assert.ok(!/cdnjs|https:\/\//.test(idx.text.replace(/<meta[^>]*>/g, '')), 'el panel no carga nada de terceros');
});

test('candado de origen: sin el encabezado secreto de Cloudflare no responde', async (t) => {
  const secret = crypto.randomBytes(18).toString('base64');
  const app = await start({ originSecret: secret }); t.after(app.close);
  assert.equal((await raw(app.base, '/')).status, 403);
  assert.equal((await raw(app.base, '/', { 'x-origin-auth': 'otro' })).status, 403);
  assert.equal((await raw(app.base, '/health')).status, 200, 'la revisión de salud de Railway sigue');
  assert.equal((await raw(app.base, '/', { 'x-origin-auth': secret })).status, 200);
});

test('login: mismo mensaje exista o no el correo, contraseñas débiles fuera, bloqueo y bitácora', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const r = await dueno.post('/api/users', { name: 'Ana', email: 'ana@example.com', role: 'vendedor' });
  const c = client(app.base);
  const a = await c.post('/api/login', { email: 'ana@example.com', password: 'loquesea-1234' });
  const b = await c.post('/api/login', { email: 'nadie@example.com', password: 'loquesea-1234' });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.body.error, b.body.error, 'no se distingue una cuenta invitada de una que no existe');
  const tk = new URL(r.body.link).searchParams.get('acceso');
  for (const pw of ['1234567890123', 'contraseña123', 'Rentaypunto-2026', 'corta']) {
    assert.equal((await c.post(`/api/access/${tk}`, { password: pw })).status, 400, pw);
  }
  assert.match(passwordProblem('Fernando-Maass-2026', 'fernando@x.com'), /correo/);
  assert.equal((await c.post(`/api/access/${tk}`, { password: 'Mirador-Sur-4471' })).status, 200);
  const x = client(app.base);
  for (let i = 0; i < 5; i++) await x.post('/api/login', { email: 'ana@example.com', password: 'mala-mala-mala' });
  assert.equal((await x.post('/api/login', { email: 'ana@example.com', password: 'Mirador-Sur-4471' })).status, 429, 'bloqueada 15 minutos tras 5 intentos');
  const log = (await dueno.get('/api/audit')).body;
  assert.ok(log.some((l) => l.action === 'intento fallido de entrar' && l.detail === 'ana@example.com'));
  assert.ok(log.some((l) => l.action === 'dio de alta a un usuario'));
  assert.ok(log.some((l) => l.action === 'activó su acceso con invitación'));
  assert.equal(passwordProblem('Jacaranda-Norte-2026', 'fer@x.com'), null);
});

test('verificación en dos pasos para todos y cerrar otras sesiones', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const { c: ven } = await invite(app, dueno, { name: 'Ana', email: 'ana@example.com', role: 'vendedor' });
  assert.equal((await ven.get('/api/me')).status, 200);
  await dueno.patch('/api/settings', { mfa_all: true });
  const c = client(app.base);
  assert.equal((await c.post('/api/login', { email: 'ana@example.com', password: 'Mirador-Sur-4471' })).body.mfa, 'setup', 'ahora el vendedor también configura su app');
  assert.equal((await ven.post('/api/me/logout-others')).body.closed, 1, 'la sesión a medias del otro navegador se cierra');
  assert.equal((await c.get('/api/2fa')).status, 401);
});

test('un vendedor no puede ligar propietarios ajenos para ver sus datos', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const { c: ven } = await invite(app, dueno, { name: 'Ana', email: 'ana@example.com', role: 'vendedor' });
  await site(app).post('/api/propietario', { name: 'Don Pepe', phone: '4425550000', bedrooms: 3, expected_rent: 21000, privacy: true });
  const ownerId = (await dueno.get('/api/follow')).body.owners[0].id;
  const p = (await ven.post('/api/properties', { title: 'Depto 1', zone_id: 1, rent: 9000, owner_id: ownerId })).body;
  assert.equal(p.owner_id, null);
  await ven.patch(`/api/properties/${p.id}`, { owner_id: ownerId });
  const g = (await ven.get(`/api/properties/${p.id}`)).body;
  assert.equal(g.owner_id, null); assert.equal(g.owner, undefined);
});

test('borrado automático de documentos viejos de leads cerrados', async (t) => {
  const app = await start({ docsKey: crypto.randomBytes(32) }); t.after(app.close);
  const dueno = await owner(app);
  assert.equal((await dueno.patch('/api/settings', { docs_retention_days: 10 })).status, 400, 'mínimo 30 días');
  await dueno.patch('/api/settings', { docs_retention_days: 90 });
  const { localNow, addDays } = require('../src/data');
  const p = (await dueno.post('/api/properties', { title: 'Depto 1', zone_id: 1, rent: 9000, status: 'disponible' })).body;
  await site(app).post('/api/visita', { property_id: p.id, date: addDays(localNow().date, 1), time: '10:00', name: 'Laura', phone: '4421234567', privacy: true });
  const lead = (await dueno.get('/api/leads')).body[0];
  const tk = (await dueno.post(`/api/files/lead/${lead.id}/link`)).body.url.split('/').pop();
  await fetch(`${app.base}/api/expediente/${tk}/docs?kind=ine`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(200)]) });
  const { purgeDocs } = require('../src/server');
  const { vault } = require('../src/vault');
  const vlt = vault(require('node:path').join(app.config.dataDir, 'docs'), app.config.docsKey, null);
  const later = Date.now() + 120 * 86400e3;
  assert.equal(purgeDocs(app.db, vlt, later), 0, 'el lead sigue abierto: no se borra');
  await dueno.patch(`/api/leads/${lead.id}`, { stage: 'perdido', lost_reason: 'Precio' });
  assert.equal(purgeDocs(app.db, vlt, Date.now()), 0, 'todavía no pasan 90 días');
  assert.equal(purgeDocs(app.db, vlt, later), 1);
  assert.equal((await dueno.get(`/api/files/lead/${lead.id}`)).body.docs.length, 0);
  assert.ok((await dueno.get('/api/audit')).body.some((l) => l.action === 'borrado automático de documentos'));
});

test('llave de la bóveda: solo el Dueño, se muestra una vez y no si ya hay', async (t) => {
  const app = await start(); t.after(app.close);
  const dueno = await owner(app);
  const { c: ger } = await invite(app, dueno, { name: 'G', email: 'g@example.com', role: 'gerente' });
  assert.equal((await ger.post('/api/docs-key')).status, 403);
  const k = (await dueno.post('/api/docs-key')).body.key;
  assert.match(k, /^[0-9a-f]{64}$/);
  const app2 = await start({ docsKey: crypto.randomBytes(32) }); t.after(app2.close);
  assert.equal((await (await owner(app2)).post('/api/docs-key')).status, 409);
});
