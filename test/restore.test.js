const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { openDb } = require('../src/db');
const { snapshot } = require('../src/backup');
const { restoreIfAsked } = require('../src/restore');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crm-rest-'));
const leadNames = (file) => { const db = openDb(file); const r = db.prepare('SELECT name FROM leads ORDER BY id').all().map((x) => x.name); db.close(); return r; };
const addLead = (db, name) => db.prepare("INSERT INTO leads (name, phone, source) VALUES (?, '1', 'otro')").run(name);

test('restaurar desde el volumen: guarda la base actual antes y no lo repite', async () => {
  const dir = tmpDir(); const dbPath = path.join(dir, 'crm.db');
  const db = openDb(dbPath);
  addLead(db, 'Antes');
  fs.mkdirSync(path.join(dir, 'respaldos'));
  snapshot(db, path.join(dir, 'respaldos', 'crm-2026-10-01.db'));
  addLead(db, 'Después'); db.close();
  assert.deepEqual(leadNames(dbPath), ['Antes', 'Después']);

  const logs = [];
  const r = await restoreIfAsked({ dbPath, source: 'respaldos/crm-2026-10-01.db', log: (m) => logs.push(m) });
  assert.deepEqual(leadNames(dbPath), ['Antes']);
  assert.ok(fs.existsSync(r.saved), 'la base anterior se guardó');
  assert.deepEqual(leadNames(r.saved), ['Antes', 'Después']);

  // Segunda vez con la variable puesta: no vuelve a restaurar.
  const db2 = openDb(dbPath); addLead(db2, 'Nuevo'); db2.close();
  assert.equal(await restoreIfAsked({ dbPath, source: 'respaldos/crm-2026-10-01.db', log: (m) => logs.push(m) }), null);
  assert.deepEqual(leadNames(dbPath), ['Antes', 'Nuevo']);
  assert.match(logs.at(-1), /no se repite/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restaurar: rechaza archivos fuera del volumen, inexistentes o que no son una base', async () => {
  const dir = tmpDir(); const dbPath = path.join(dir, 'crm.db');
  const db = openDb(dbPath); addLead(db, 'Intacto'); db.close();
  const log = () => {};
  await assert.rejects(restoreIfAsked({ dbPath, source: '../../etc/passwd', log }), /dentro del volumen/);
  await assert.rejects(restoreIfAsked({ dbPath, source: 'no-existe.db', log }), /No existe/);
  fs.writeFileSync(path.join(dir, 'basura.db'), 'esto no es sqlite');
  await assert.rejects(restoreIfAsked({ dbPath, source: 'basura.db', log }), /no es un respaldo válido/);
  const other = path.join(dir, 'otra.db'); const { DatabaseSync } = require('node:sqlite');
  const o = new DatabaseSync(other); o.exec('CREATE TABLE x (a)'); o.close();
  await assert.rejects(restoreIfAsked({ dbPath, source: 'otra.db', log }), /no es una base de Maass Leads/);
  assert.deepEqual(leadNames(dbPath), ['Intacto'], 'la base actual no se tocó');
  assert.ok(!fs.existsSync(`${dbPath}.restaurando`));
  assert.equal(await restoreIfAsked({ dbPath, source: '', log }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restaurar desde R2: baja el .gz firmado y lo descomprime', async () => {
  const dir = tmpDir(); const src = path.join(dir, 'origen.db');
  const s = openDb(src); addLead(s, 'Desde la nube'); s.close();
  const gz = zlib.gzipSync(fs.readFileSync(src));
  const got = {};
  const fake = http.createServer((req, res) => { Object.assign(got, { method: req.method, url: req.url, auth: req.headers.authorization }); res.end(gz); });
  await new Promise((r) => fake.listen(0, r));
  const dbPath = path.join(dir, 'nuevo', 'crm.db'); fs.mkdirSync(path.dirname(dbPath));
  const offsite = { endpoint: `http://127.0.0.1:${fake.address().port}`, bucket: 'respaldos', accessKey: 'K', secretKey: 'S', region: 'auto', prefix: 'maass' };
  await assert.rejects(restoreIfAsked({ dbPath, source: 'r2:maass/crm-2026-10-01.db.gz', log: () => {} }), /BACKUP_S3/);
  const r = await restoreIfAsked({ dbPath, source: 'r2:maass/crm-2026-10-01.db.gz', offsite, log: () => {} });
  assert.equal(r.saved, null, 'no había base antes');
  assert.equal(got.method, 'GET'); assert.equal(got.url, '/respaldos/maass/crm-2026-10-01.db.gz');
  assert.match(got.auth, /^AWS4-HMAC-SHA256 Credential=K\//);
  assert.deepEqual(leadNames(dbPath), ['Desde la nube']);
  fake.close(); fs.rmSync(dir, { recursive: true, force: true });
});
