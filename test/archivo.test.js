const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };
const json = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ago = (days) => new Date(Date.now() - days * 86400e3).toISOString();
const ymd = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);

test('tablero: los cerrados antiguos se archivan, salvo lo agendado; reportes y búsqueda los siguen viendo', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'ARCH-1234' } }));
  const cookie = (await json(`${url}/api/setup`, { name: 'G', email: 'g@x.mx', password: 'clave12345', company: 'X', setup_code: 'ARCH-1234' }))
    .headers.get('set-cookie').split(';')[0];
  const add = (name, cols) => {
    const id = db.prepare("INSERT INTO leads (name, phone, source) VALUES (?, '5500000000', 'formulario')").run(name).lastInsertRowid;
    for (const [k, v] of Object.entries(cols)) db.prepare(`UPDATE leads SET ${k} = ? WHERE id = ?`).run(v, id);
  };
  add('Abierto viejo', { status: 'cotizando', updated_at: ago(200) });
  add('Vendido reciente', { status: 'vendido', won_at: ago(5) });
  add('Vendido viejo', { status: 'vendido', won_at: ago(90) });
  add('Vendido viejo por renovar', { status: 'vendido', won_at: ago(300), campaign_end: ymd(20) });
  add('Declinado reciente', { status: 'declinado', declined_at: ago(10) });
  add('Declinado viejo', { status: 'declinado', declined_at: ago(60) });
  add('Declinado viejo con recontacto', { status: 'declinado', declined_at: ago(60), recontact_at: ymd(3) });
  const get = async (q) => (await fetch(`${url}/api/leads?${q}`, { headers: { cookie } })).json();

  const board = await get('board=1');
  const names = board.leads.map((l) => l.name).sort();
  assert.deepEqual(names, ['Abierto viejo', 'Declinado reciente', 'Declinado viejo con recontacto', 'Vendido reciente', 'Vendido viejo por renovar']);
  assert.equal(board.archived, 2); assert.equal(board.archive_days, 30);

  assert.equal((await get('')).length, 7, 'sin board=1 vienen todos (Mi día, ver todos)');
  assert.equal((await get('board=1&q=viejo')).length, 5, 'al buscar se muestran también los archivados');
  assert.ok(Array.isArray(await get(`board=1&from=${encodeURIComponent(ago(400))}`)), 'con periodo elegido no se archiva');
  const st = await (await fetch(`${url}/api/stats`, { headers: { cookie } })).json();
  assert.equal(st.funnel.recibidos, 7, 'el Resumen cuenta todos, también los archivados');
  s.close();
});

test('recordatorio mensual de descargar la cartera', async () => {
  const db = openDb(':memory:');
  const { s, url } = await listen(createApp({ db, config: { setupCode: 'CART-1234' } }));
  const cookie = (await json(`${url}/api/setup`, { name: 'G', email: 'g@x.mx', password: 'clave12345', company: 'X', setup_code: 'CART-1234' }))
    .headers.get('set-cookie').split(';')[0];
  const sys = async () => (await (await fetch(`${url}/api/system`, { headers: { cookie } })).json()).cartera;
  assert.equal((await sys()).due, false, 'recién instalado y sin leads: no molesta');
  db.prepare("INSERT INTO leads (name, phone, source) VALUES ('A', '5511111111', 'formulario')").run();
  db.prepare('UPDATE users SET created_at = ?').run(ago(31));
  assert.equal((await sys()).due, true, 'a los 30 días de instalado se recuerda');
  assert.equal((await fetch(`${url}/api/export/cartera.xlsx`, { headers: { cookie } })).status, 200);
  const after = await sys();
  assert.equal(after.due, false); assert.ok(after.last, 'se guarda la fecha de la descarga');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'cartera_downloaded_at'").run(ago(31));
  assert.equal((await sys()).due, true, 'un mes después de la última descarga, otra vez');
  s.close();
});
