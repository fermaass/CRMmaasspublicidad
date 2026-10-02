const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

let server; let base;
before(async () => {
  server = createApp({ db: openDb(':memory:'), config: { setupCode: 'ABCD-2345' } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, cookie, method = 'POST', b = base) => fetch(b + path, {
  method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});

test('primer uso: pide el código de instalación, se crea el gerente y solo una vez', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/setup`)).json(), { needed: true });
  const data = { name: 'Fer', email: 'fer@maass.com', password: 'clave1234', company: 'Maass Publicidad' };
  assert.equal((await post('/api/setup', data)).status, 403, 'sin código no');
  assert.equal((await post('/api/setup', { ...data, setup_code: 'ZZZZ-9999' })).status, 403, 'con código equivocado no');
  const r = await post('/api/setup', { ...data, setup_code: 'abcd 2345' });
  assert.equal(r.status, 201, 'el código acepta minúsculas y espacios');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()).role, 'gerente');

  assert.equal((await post('/api/setup', { ...data, email: 'x@x.com', setup_code: 'ABCD-2345' })).status, 409);
  assert.deepEqual(await (await fetch(`${base}/api/setup`)).json(), { needed: false });

  // Las claves se generaron solas y sirven para recibir leads
  const s = await (await fetch(`${base}/api/settings`, { headers: { cookie } })).json();
  assert.ok(s.form_api_key);
  assert.equal(s.form_url, `${base}/webhooks/form`);
  assert.equal((await post(`/webhooks/form?key=${s.form_api_key}`, { nombre: 'Ana', telefono: '5500000000' })).status, 201);

  // Cambiar la clave invalida la anterior
  await post('/api/settings', { regenerate_form_key: true }, cookie, 'PATCH');
  assert.equal((await post(`/webhooks/form?key=${s.form_api_key}`, { nombre: 'B', telefono: '5500000001' })).status, 401);
});

test('la configuración es solo para el gerente', async () => {
  assert.equal((await fetch(`${base}/api/settings`)).status, 401);
});

test('instalar para un cliente: se deja creado su gerente y sale el link para que él ponga su contraseña', async () => {
  const db = openDb(':memory:');
  const srv = createApp({ db, config: {} }).listen(0); await new Promise((r) => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  // Sin SETUP_CODE se genera uno y se guarda (el servidor lo muestra en su registro al arrancar)
  const { getSetting } = require('../src/db');
  assert.equal((await post('/api/setup', { name: 'Lu', email: 'lu@gym.mx', company: 'Gimnasio', setup_code: 'NOPE' }, null, 'POST', b)).status, 403);
  const code = getSetting(db, 'setup_code');
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const r = await post('/api/setup', { name: 'Lu', email: 'lu@gym.mx', company: 'Gimnasio', setup_code: code }, null, 'POST', b);
  const j = await r.json();
  assert.equal(r.status, 201); assert.equal(j.invited, true); assert.ok(j.link.includes('?acceso='));
  assert.equal(r.headers.get('set-cookie'), null, 'quien instala no queda dentro');
  assert.equal(getSetting(db, 'setup_code'), null, 'el código ya no sirve');
  const tok = new URL(j.link).searchParams.get('acceso');
  const ok = await post(`/api/access/${tok}`, { password: 'gerenteGym1' }, null, 'POST', b);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).role, 'gerente');
  srv.close();
});

test('captcha: con claves de Turnstile, entrar pide la verificación y se valida en el servidor', async () => {
  // Verificador falso de Cloudflare: acepta solo el token "bueno".
  const fake = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => { const p = new URLSearchParams(body); res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: p.get('secret') === 'secreto' && p.get('response') === 'bueno' })); });
  }).listen(0);
  await new Promise((r) => fake.once('listening', r));
  const srv = createApp({ db: openDb(':memory:'), config: { setupCode: 'C0DE-C0DE', turnstileSiteKey: 'sitio', turnstileSecret: 'secreto',
    turnstileVerifyUrl: `http://127.0.0.1:${fake.address().port}/` } }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  assert.equal((await (await fetch(`${b}/api/company`)).json()).captcha_site_key, 'sitio', 'la pantalla sabe que debe mostrarlo');
  const setup = { name: 'G', email: 'g@c.mx', password: 'clave12345', company: 'C', setup_code: 'C0DE-C0DE' };
  assert.equal((await post('/api/setup', setup, null, 'POST', b)).status, 400, 'sin captcha no');
  assert.equal((await post('/api/setup', { ...setup, captcha: 'malo' }, null, 'POST', b)).status, 400);
  assert.equal((await post('/api/setup', { ...setup, captcha: 'bueno' }, null, 'POST', b)).status, 201);
  assert.equal((await post('/api/login', { email: 'g@c.mx', password: 'clave12345' }, null, 'POST', b)).status, 400);
  assert.equal((await post('/api/login', { email: 'g@c.mx', password: 'clave12345', captcha: 'bueno' }, null, 'POST', b)).status, 200);
  srv.close(); fake.close();
});

test('formulario público: una misma IP no puede mandar cientos de leads', async () => {
  const srv = createApp({ db: openDb(':memory:'), config: { formApiKey: 'kk' } }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  let last;
  for (let i = 0; i < 21; i++) last = await post('/webhooks/form?key=kk', { nombre: `Bot ${i}`, telefono: `55000011${String(i).padStart(2, '0')}` }, null, 'POST', b);
  assert.equal(last.status, 429);
  srv.close();
});
