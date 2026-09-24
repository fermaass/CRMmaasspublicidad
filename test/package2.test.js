const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp, seedAdmin } = require('../src/server');
const F = require('../public/followup.js');

const config = { adminEmail: 'g@t.com', adminPassword: 'clave-gerente', formApiKey: 'k', autoAssign: true };
let server; let base; let db; let gerente; const sellers = {};

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* texto */ }
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const form = (body) => req('/webhooks/form?key=k', { method: 'POST', body });
const lead = async (id) => (await req(`/api/leads/${id}`, { cookie: gerente })).json;

before(async () => {
  db = openDb(':memory:');
  seedAdmin(db, config);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  gerente = (await req('/api/login', { method: 'POST', body: { email: 'g@t.com', password: 'clave-gerente' } })).cookie;
  for (const name of ['Ana', 'Beto']) {
    const email = `${name.toLowerCase()}@t.com`;
    const { id } = (await req('/api/users', { method: 'POST', cookie: gerente, body: { name, email, password: 'password123', role: 'vendedor' } })).json;
    sellers[name] = { id, cookie: (await req('/api/login', { method: 'POST', body: { email, password: 'password123' } })).cookie };
  }
});
after(() => server.close());

test('reparto automático al de menor carga y se puede apagar', async () => {
  const a = (await form({ nombre: 'A', telefono: '5530000001' })).json.id;
  const b = (await form({ nombre: 'B', telefono: '5530000002' })).json.id;
  const c = (await form({ nombre: 'C', telefono: '5530000003' })).json.id;
  assert.deepEqual([(await lead(a)).assigned_name, (await lead(b)).assigned_name, (await lead(c)).assigned_name], ['Ana', 'Beto', 'Ana']);
  assert.ok((await lead(a)).events.some((e) => e.content === 'Asignado automáticamente a Ana'));

  // El gerente captura a mano: también se reparte. El vendedor que captura se queda con el lead.
  const m = (await req('/api/leads', { method: 'POST', cookie: gerente, body: { source: 'llamada', channel_id: 5, phone: '5530000004' } })).json.id;
  assert.equal((await lead(m)).assigned_name, 'Beto');
  const own = (await req('/api/leads', { method: 'POST', cookie: sellers.Ana.cookie, body: { source: 'whatsapp', channel_id: 5, phone: '5530000005' } })).json.id;
  assert.equal((await lead(own)).assigned_name, 'Ana');

  assert.equal((await req('/api/assign-settings', { method: 'PATCH', cookie: gerente, body: { auto_assign: false } })).json.auto_assign, false);
  const d = (await form({ nombre: 'D', telefono: '5530000006' })).json.id;
  assert.equal((await lead(d)).assigned_to, null);
  await req('/api/assign-settings', { method: 'PATCH', cookie: gerente, body: { auto_assign: true } });
});

test('formulario guarda los datos del anuncio y el utm_campaign manda', async () => {
  const r = await form({ nombre: 'U', telefono: '5530000010', campana: 'sitio-web', utm_campaign: 'FB-Octubre', utm_source: 'facebook', utm_medium: 'cpc', utm_content: 'video-espectacular' });
  const l = await lead(r.json.id);
  assert.equal(l.campaign, 'FB-Octubre');
  assert.deepEqual([l.utm_source, l.utm_medium, l.utm_content], ['facebook', 'cpc', 'video-espectacular']);
  const s = (await req('/api/stats', { cookie: gerente })).json;
  assert.equal(s.adFunnel[0].key, 'video-espectacular');
});

test('campaña con canal e inversión por mes', async () => {
  const cat = (await req('/api/catalog', { cookie: gerente })).json;
  const fb = cat.canal.find((c) => c.name === 'Facebook');
  const camp = cat.campana.find((c) => c.name === 'FB-Octubre');
  await req(`/api/catalog/${camp.id}`, { method: 'PATCH', cookie: gerente, body: { channel_id: fb.id } });
  const month = new Date().toISOString().slice(0, 7);
  assert.equal((await req(`/api/catalog/${camp.id}/budgets`, { method: 'PUT', cookie: gerente, body: { month: 'mal', amount: 1 } })).status, 400);
  await req(`/api/catalog/${camp.id}/budgets`, { method: 'PUT', cookie: gerente, body: { month, amount: '8,000' } });
  await req(`/api/catalog/${camp.id}/budgets`, { method: 'PUT', cookie: gerente, body: { month: '2020-01', amount: 999 } });

  const withBudgets = (await req('/api/catalog', { cookie: gerente })).json.campana.find((c) => c.id === camp.id);
  assert.equal(withBudgets.budgets.length, 2);

  // El lead de la campaña hereda el canal de la campaña
  const leads = (await req(`/api/leads?channel=${fb.id}`, { cookie: gerente })).json;
  assert.deepEqual(leads.map((l) => l.name), ['U']);
  assert.equal(leads[0].channel_name, 'Facebook');

  // Este mes: solo cuenta la inversión del mes; todo el tiempo: la suma de los meses
  const from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const thisMonth = (await req(`/api/stats?from=${encodeURIComponent(from)}`, { cookie: gerente })).json.campaignFunnel.find((c) => c.key === 'FB-Octubre');
  assert.equal(thisMonth.inversion, 8000);
  const all = (await req('/api/stats', { cookie: gerente })).json.campaignFunnel.find((c) => c.key === 'FB-Octubre');
  assert.equal(all.inversion, 8999);
  await req(`/api/catalog/${camp.id}/budgets`, { method: 'PUT', cookie: gerente, body: { month: '2020-01', amount: '' } });
  assert.equal((await req('/api/stats', { cookie: gerente })).json.campaignFunnel.find((c) => c.key === 'FB-Octubre').inversion, 8000);
});

test('monto cotizado, seguimiento de cotización, primer toque y recontacto', async () => {
  const id = (await form({ nombre: 'Q', telefono: '5530000020' })).json.id;
  const ownerId = (await lead(id)).assigned_to;
  const owner = Object.values(sellers).find((x) => x.id === ownerId) || null;
  const ck = owner ? owner.cookie : gerente;
  const touch = (outcome, extra = {}) => req(`/api/leads/${id}/touches`, { method: 'POST', cookie: ck, body: { channel: 'llamada', outcome, ...extra } });
  await touch('cumple');
  await touch('cotizado', { quote_amount: '60,000' });
  let l = await lead(id);
  assert.equal(l.quote_amount, 60000);
  assert.ok(l.first_touch_at);
  const a = F.nextAction(l);
  assert.equal(a.kind, 'cotizacion');
  assert.equal(F.dayDiff(a.due), 2, 'primer seguimiento de la cotización a los 2 días');

  const s = (await req('/api/stats', { cookie: gerente })).json;
  assert.equal(s.funnel.en_cotizacion, 60000);
  assert.ok(s.touches.speed >= 0);
  assert.ok(s.sellerFunnel.some((r) => r.horas_primer_toque != null));

  // Lo pospuso con fecha para volver a contactarlo
  const date = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  await touch('rechazo', { decline_reason: 'Lo pospuso / sin presupuesto ahora', recontact_at: date });
  l = await lead(id);
  assert.equal(l.status, 'declinado'); assert.equal(l.recontact_at, date);
  assert.equal(F.nextAction(l).kind, 'recontacto');
  const aud = (await req(`/api/leads?reason=${encodeURIComponent('Lo pospuso / sin presupuesto ahora')}`, { cookie: gerente })).json;
  assert.deepEqual(aud.map((x) => x.id), [id]);

  // Reactivarlo borra la fecha
  await req(`/api/leads/${id}`, { method: 'PATCH', cookie: ck, body: { status: 'nuevo_perfil' } });
  l = await lead(id);
  assert.equal(l.status, 'nuevo_perfil'); assert.equal(l.recontact_at, null);
});

test('la cadencia sin respuesta se cuenta desde que llega el lead', () => {
  const created = new Date(Date.now() - 2 * 86400e3).toISOString();
  const a = F.nextAction({ status: 'nuevo', created_at: created, touch_count: 1, contacted_at: null });
  assert.equal(a.kind, 'cadencia'); assert.equal(a.n, 2);
  assert.equal(F.dayDiff(a.due), -1, 'el toque 2 tocaba al día siguiente de llegar');
  assert.equal(F.nextAction({ status: 'vendido' }), null);
  const f = F.nextAction({ status: 'nuevo_perfil', contacted_at: created, last_touch_at: created, touch_count: 1 });
  assert.equal(f.kind, 'seguimiento'); assert.equal(f.label, 'Enviar cotización');
});
