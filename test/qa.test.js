// Pruebas de QA: que ningún dato se guarde a medias, se pise o se pierda.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k' };
let server; let base; let db; let gerente; let ana; let anaId;
async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
}
const mk = async (phone) => (await req('/api/leads', { method: 'POST', cookie: gerente,
  body: { source: 'whatsapp', channel_id: 1, phone, assigned_to: anaId } })).json.id;
const touch = (id, outcome, extra = {}) => req(`/api/leads/${id}/touches`, { method: 'POST', cookie: ana, body: { channel: 'llamada', outcome, ...extra } });
const lead = async (id) => (await req(`/api/leads/${id}`, { cookie: gerente })).json;

before(async () => {
  db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = async (email, password) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return r.headers.get('set-cookie').split(';')[0];
  };
  gerente = await login('g@t.com', 'clave-gerente');
  anaId = (await req('/api/users', { method: 'POST', cookie: gerente, body: { name: 'Ana', email: 'a@t.com', password: 'password123', role: 'vendedor' } })).json.id;
  ana = await login('a@t.com', 'password123');
});
after(() => server.close());

test('un toque con un dato inválido no se guarda a medias', async () => {
  const id = await mk('5590000001');
  await touch(id, 'cumple');
  const before1 = await lead(id);
  const r = await touch(id, 'cotizado', { quote_amount: 'muchos pesos' });
  assert.equal(r.status, 400);
  const after1 = await lead(id);
  assert.equal(after1.touch_count, before1.touch_count, 'no cuenta el toque');
  assert.equal(after1.status, before1.status);
  assert.equal((await req(`/api/leads/${id}/touches`, { cookie: ana })).json.length, 1, 'no deja el toque registrado');
  assert.equal(after1.events.length, before1.events.length, 'no deja eventos sueltos');
});

test('guardar la ficha con datos viejos no deshace lo que otro cambió', async () => {
  const id = await mk('5590000002');
  const stale = await lead(id); // el gerente abre la ficha
  await touch(id, 'cumple'); // mientras, la vendedora registra un toque
  // el gerente corrige el nombre y guarda el formulario completo con la etapa vieja
  const r = await req(`/api/leads/${id}`, { method: 'PATCH', cookie: gerente,
    body: { name: 'Nombre corregido', status: stale.status, profile: stale.profile, base_updated_at: stale.updated_at } });
  assert.equal(r.status, 409, 'avisa que alguien más lo cambió');
  const l = await lead(id);
  assert.equal(l.status, 'nuevo_perfil', 'la etapa nueva sigue');
  // Con la ficha recargada sí guarda
  const ok = await req(`/api/leads/${id}`, { method: 'PATCH', cookie: gerente, body: { name: 'Nombre corregido', base_updated_at: l.updated_at } });
  assert.equal(ok.status, 200);
  assert.equal((await lead(id)).name, 'Nombre corregido');
});

test('mandar el mismo toque dos veces seguidas (doble clic) solo cuenta uno', async () => {
  const id = await mk('5590000003');
  const [a, b] = await Promise.all([
    touch(id, 'sin_respuesta', { request_id: 'clic-1' }), touch(id, 'sin_respuesta', { request_id: 'clic-1' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal((await lead(id)).touch_count, 1);
});

test('los pendientes no desaparecen aunque haya miles de leads cerrados', async () => {
  const id = await mk('5590000004');
  const ins = db.prepare(`INSERT INTO leads (name, phone, phone_key, source, status, profile, created_at, updated_at)
    VALUES (?, ?, ?, 'formulario', 'declinado', 'no_cumple', ?, ?)`);
  const ts = new Date(Date.now() + 86400e3).toISOString(); // más recientes que el lead activo
  db.exec('BEGIN');
  for (let i = 0; i < 2100; i++) ins.run(`Viejo ${i}`, `5591${String(i).padStart(6, '0')}`, `5591${String(i).padStart(6, '0')}`, ts, ts);
  db.exec('COMMIT');
  const list = (await req('/api/leads', { cookie: gerente })).json;
  assert.ok(list.some((l) => l.id === id), 'el lead en curso sigue en la lista');
});

test('la revisión de salud confirma que la base responde y avisa si no hay disco persistente', async () => {
  const r = await req('/health');
  assert.equal(r.status, 200);
});

test('respaldo diario y descarga: copias completas que se pueden abrir', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { dailyBackup, listBackups, KEEP } = require('../src/backup');
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-'));
  const file = path.join(dir, 'crm.db');
  const fdb = openDb(file);
  seedAdmin(fdb, config);
  const srv = createApp({ db: fdb, config: { ...config, dbPath: file } }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const cookie = (await fetch(`${b}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'g@t.com', password: 'clave-gerente' }) }))
    .headers.get('set-cookie').split(';')[0];
  await fetch(`${b}/api/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ source: 'whatsapp', channel_id: 1, phone: '5599000001' }) });

  // 20 días de respaldos: se quedan los últimos 14 y el de hoy tiene el lead
  for (let d = 1; d <= 20; d++) dailyBackup(fdb, file, `2026-01-${String(d).padStart(2, '0')}`);
  assert.equal(listBackups(file).length, KEEP);
  const copy = new DatabaseSync(path.join(dir, 'respaldos', 'crm-2026-01-20.db'));
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM leads').get().n, 1);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  copy.close();

  const dl = await fetch(`${b}/api/backup`, { headers: { cookie } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /crm-respaldo-/);
  const bytes = Buffer.from(await dl.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3');
  const sys = await (await fetch(`${b}/api/system`, { headers: { cookie } })).json();
  assert.equal(sys.backups, KEEP); assert.equal(sys.leads, 1); assert.equal(sys.storage_warning, false);
  assert.equal(fs.readdirSync(path.join(dir, 'respaldos')).filter((f) => f.startsWith('descarga-')).length, 0, 'no deja archivos temporales');
  srv.close(); fdb.close();
});

test('en Railway sin volumen se avisa que los datos se borrarían', () => {
  const { loadConfig } = require('../src/server');
  assert.equal(loadConfig({ RAILWAY_ENVIRONMENT: 'production' }).storageWarning, true);
  assert.equal(loadConfig({ RAILWAY_ENVIRONMENT: 'production', RAILWAY_VOLUME_MOUNT_PATH: '/data' }).storageWarning, false);
  assert.equal(loadConfig({}).storageWarning, false);
});

test('el CSV no deja correr fórmulas que lleguen en el formulario público', async () => {
  const { openDb } = require('../src/db');
  const { createApp, seedAdmin } = require('../src/server');
  const db = openDb(':memory:'); seedAdmin(db, { adminEmail: 'g2@t.com', adminPassword: 'clave-gerente' });
  const srv = createApp({ db, config: { formApiKey: 'k2' } }).listen(0); await new Promise((r) => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  await fetch(`${b}/webhooks/form?key=k2`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: '=HYPERLINK("http://x","clic")', telefono: '+52 55 1234 5678' }) });
  const c = (await fetch(`${b}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'g2@t.com', password: 'clave-gerente' }) })).headers.get('set-cookie').split(';')[0];
  const csv = await (await fetch(`${b}/api/leads.csv`, { headers: { cookie: c } })).text();
  srv.close();
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"",""clic"")"`), csv);
  assert.ok(csv.includes(',+52 55 1234 5678,'), 'el teléfono queda igual');
});
