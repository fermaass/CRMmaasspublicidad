const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { createPanel, parseInstances } = require('../src/panel');
const { signV4, sha256hex, uploadBackup } = require('../src/offsite');

const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };
const json = (url, body, cookie) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

test('estado técnico: solo con la clave del panel y sin datos de los clientes', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'OPS1-OPS1', opsToken: 'clave-del-panel-123', formApiKey: 'kf' } }));
  const g = (await json(`${url}/api/setup`, { name: 'Gerente Secreto', email: 'secreto@cliente.mx', password: 'clave12345', company: 'Cliente Uno', setup_code: 'OPS1-OPS1' })).headers.get('set-cookie').split(';')[0];
  await json(`${url}/webhooks/form?key=kf`, { nombre: 'Laura Privada', telefono: '5511112222', email: 'laura@privada.mx' });
  await json(`${url}/api/ops/client-error`, { message: 'TypeError: x is undefined', view: 'board' }, g);

  assert.equal((await fetch(`${url}/api/ops/status`)).status, 404, 'sin clave no existe');
  assert.equal((await fetch(`${url}/api/ops/status`, { headers: { authorization: 'Bearer otra' } })).status, 404);
  const r = await fetch(`${url}/api/ops/status`, { headers: { authorization: 'Bearer clave-del-panel-123' } });
  assert.equal(r.status, 200);
  const st = await r.json(); const text = JSON.stringify(st);
  assert.equal(st.company, 'Cliente Uno'); assert.equal(st.db_ok, true);
  assert.equal(st.activity.leads_total, 1); assert.equal(st.activity.users_active, 1);
  assert.equal(st.errors.last_24h, 1); assert.equal(st.errors.recent[0].place, 'board (gerente)');
  for (const secret of ['Laura', 'privada', '5511112222', 'secreto@cliente.mx', 'Gerente Secreto']) assert.ok(!text.includes(secret), `no debe incluir ${secret}`);
  s.close();
});

test('panel: con contraseña; muestra cada proyecto bien, por revisar o caído', async () => {
  const a = await listen(createApp({ db: openDb(':memory:'), config: { setupCode: 'A', opsToken: 'tok-123456789' } }));
  await json(`${a.url}/api/setup`, { name: 'G', email: 'g@a.mx', password: 'clave12345', company: 'Proyecto A', setup_code: 'A' });
  const b = await listen(createApp({ db: openDb(':memory:'), config: { setupCode: 'B', opsToken: 'tok-123456789' } })); // sin terminar instalación
  const instances = parseInstances(`Proyecto A=${a.url}, Proyecto B=${b.url}\nProyecto C=http://127.0.0.1:1`);
  assert.equal(instances.length, 3);
  assert.throws(() => createPanel({ instances, opsToken: 'x', password: 'corta' }), /PANEL_PASSWORD/);
  const p = await listen(createPanel({ instances, opsToken: 'tok-123456789', password: 'panel-seguro-2026' }));
  assert.equal((await fetch(p.url)).status, 401);
  assert.equal(await (await fetch(`${p.url}/health`)).text(), 'ok', 'Railway revisa /health sin contraseña');
  const auth = { authorization: `Basic ${Buffer.from('maass:panel-seguro-2026').toString('base64')}` };
  const rows = await (await fetch(`${p.url}/estado.json`, { headers: auth })).json();
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by['Proyecto C'].level, 'red'); assert.match(by['Proyecto C'].alerts[0].text, /Caído/);
  assert.ok(by['Proyecto B'].alerts.some((x) => /Instalación sin terminar/.test(x.text)));
  assert.ok(by['Proyecto A'].alerts.some((x) => /Sin respaldo fuera del servidor/.test(x.text)), 'en memoria no hay respaldos: lo marca');
  const html = await (await fetch(p.url, { headers: auth })).text();
  assert.ok(html.includes('Proyecto A') && html.includes('Atender ya') && html.includes('No muestra datos de los clientes'));
  [a, b, p].forEach((x) => x.s.close());
});

test('respaldo externo: firma de AWS correcta y el archivo llega comprimido', async () => {
  // Caso oficial de la suite de pruebas de AWS Signature V4 (get-vanilla).
  const v = signV4({ method: 'GET', url: 'https://example.amazonaws.com/', payloadHash: sha256hex(''), accessKey: 'AKIDEXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', amzDate: '20150830T123600Z' });
  assert.match(v.authorization, /Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31$/);

  const got = {};
  const fake = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { Object.assign(got, { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.end(''); });
  });
  await new Promise((r) => fake.listen(0, r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-off-')); const file = path.join(dir, 'crm-2026-10-02.db');
  fs.writeFileSync(file, 'contenido de la base');
  const key = await uploadBackup(file, { endpoint: `http://127.0.0.1:${fake.address().port}`, bucket: 'respaldos', accessKey: 'K', secretKey: 'S', region: 'auto', prefix: 'maass' });
  assert.equal(key, 'maass/crm-2026-10-02.db.gz');
  assert.equal(got.method, 'PUT'); assert.equal(got.url, '/respaldos/maass/crm-2026-10-02.db.gz');
  assert.equal(zlib.gunzipSync(got.body).toString(), 'contenido de la base');
  assert.equal(got.headers['x-amz-content-sha256'], sha256hex(got.body));
  assert.match(got.headers.authorization, /^AWS4-HMAC-SHA256 Credential=K\/\d{8}\/auto\/s3\/aws4_request/);
  fake.close(); fs.rmSync(dir, { recursive: true, force: true });
});
