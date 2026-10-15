const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { photoStore } = require('../src/photos');
const auth = require('../src/auth');

// Levanta la app con base en memoria. panelHost vacío: el panel vive en /panel/.
async function start(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-test-'));
  const db = openDb(':memory:');
  const sent = [];
  const config = { dataDir: dir, siteUrl: 'https://www.rentaypunto.com', setupCode: 'ABCD-1234', version: 't', ...extra };
  const mail = { enabled: true, send: async (to, subject, text) => { sent.push({ to, subject, text }); return true; } };
  const app = createApp({ db, config, mail, photos: photoStore(path.join(dir, 'fotos'), null) });
  const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://localhost:${server.address().port}`;
  return { db, sent, config, base, close: () => new Promise((ok) => server.close(ok)) };
}

// Cliente con cookie propia (cada uno es "un navegador").
function client(base, prefix = '/panel') {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(base + prefix + url, {
      method, redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, body: json, text, headers: r.headers };
  };
  return {
    get: (u, h) => call('GET', u, undefined, h), post: (u, b, h) => call('POST', u, b ?? {}, h), patch: (u, b) => call('PATCH', u, b),
    put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), cookie: () => cookie,
  };
}

// Crea al Dueño con el código de instalación y completa la verificación en dos pasos.
async function owner(t) {
  const c = client(t.base);
  let r = await c.post('/api/setup', { setup_code: 'abcd1234', name: 'Fer', email: 'fer@example.com', password: 'contrasena-larga' });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  r = await c.get('/api/2fa');
  r = await c.post('/api/2fa', { code: auth.totpCode(r.body.secret, Math.floor(Date.now() / 30000)) });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return c;
}

// El Dueño invita a alguien; esa persona abre el link y crea su contraseña.
async function invite(t, dueno, { name, email, role, publish_direct, phone }) {
  const r = await dueno.post('/api/users', { name, email, role, publish_direct, phone });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  const token = new URL(r.body.link).searchParams.get('acceso');
  const c = client(t.base);
  const a = await c.post(`/api/access/${token}`, { password: 'otra-contrasena' });
  if (a.body.mfa) {
    const s = await c.get('/api/2fa');
    await c.post('/api/2fa', { code: auth.totpCode(s.body.secret, Math.floor(Date.now() / 30000)) });
  }
  return { c, id: r.body.id };
}

// JPEG mínimo válido (1x1) en data URL.
const JPEG = `data:image/jpeg;base64,${Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64').toString('base64')}`;

module.exports = { start, client, owner, invite, JPEG };
