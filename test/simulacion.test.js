// Simulación de punta a punta: con un reloj falso, 8 leads viven desde hace 80 días hasta hoy pasando por todos los roles:
// formulario, asignación, cadencia de toques, perfil, cotización, venta, postventa, renovación, recompra, declinados,
// inversión por mes, costos, Equipo hoy, Resumen, permisos, CSV y respaldo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.join(__dirname, '..');
const RealDate = Date;
let fakeNow = RealDate.now();
global.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(fakeNow); else super(...a); }
  static now() { return fakeNow; }
};
const TODAY = new RealDate(); TODAY.setHours(0, 0, 0, 0);
const at = (day, hour = 10, min = 0) => { fakeNow = TODAY.getTime() + day * 86400e3 + hour * 3600e3 + min * 60e3; return new Date().toISOString(); };
const ymd = (day) => new RealDate(TODAY.getTime() + day * 86400e3 + 12 * 3600e3).toISOString().slice(0, 10);

const { openDb } = require(path.join(REPO, 'src/db'));
const { createApp } = require(path.join(REPO, 'src/server'));
const F = require(path.join(REPO, 'public/followup.js'));

const results = []; const log = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); if (!ok) console.log(`  ✗ ${name} ${detail}`); };
const note = (s) => { log.push(s); };

let base;
async function call(cookie, p, method = 'GET', body) {
  const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie: cookie || '' }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { json = t; }
  return { status: r.status, json, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const PW = 'maass2026!';
const login = async (email) => (await call('', '/api/login', 'POST', { email, password: PW })).cookie;
const as = async (email) => {
  let c = await login(email);
  // La sesión vence con el tiempo (igual que en la vida real): si vence, se vuelve a entrar.
  return async (p, m, b) => { let r = await call(c, p, m, b); if (r.status === 401) { c = await login(email); r = await call(c, p, m, b); } return r; };
};

test('simulación: un lead de punta a punta y el resto del equipo, de hace 80 días a hoy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sim-'));
  const dbPath = path.join(dir, 'crm.db');
  const db = openDb(dbPath);
  const server = createApp({ db, config: { dbPath, setupCode: 'SIM-0001' } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const ACT = (l) => { const a = F.nextAction(l); return a ? { ...a, days: F.dayDiff(a.due) } : null; };

  // ===== Día -80: arranque =====
  at(-80, 8);
  const setup = await call('', '/api/setup', 'POST', { name: 'Fer Maass', email: 'fer@maass.mx', password: PW, can_assign: '', company: 'Maass Publicidad', setup_code: 'SIM-0001' });
  check('primer uso crea al gerente', setup.status === 201);
  const G = await as('fer@maass.mx');
  const ids = {};
  for (const [name, email, role] of [['Coco Ruiz', 'coco@maass.mx', 'operador'], ['Ana López', 'ana@maass.mx', 'vendedor'], ['Beto Ramírez', 'beto@maass.mx', 'vendedor'],
    ['Mara Ortiz', 'mara@maass.mx', 'marketing'], ['Lalo Díaz', 'lalo@maass.mx', 'analista']]) {
    const r = await G('/api/users', 'POST', { name, email, password: PW, role });
    ids[name.split(' ')[0]] = r.json.id;
  }
  check('alta de 5 usuarios (coordinador, 2 vendedores, marketing, analista)', Object.values(ids).every(Boolean));
  const M = await as('mara@maass.mx');
  const cat = (await M('/api/catalog')).json;
  const ch = Object.fromEntries(cat.canal.map((c) => [c.name, c.id]));
  const prodEsp = (await M('/api/catalog', 'POST', { kind: 'producto', name: 'Espectacular' })).json.id;
  const prodLed = (await M('/api/catalog', 'POST', { kind: 'producto', name: 'Pantalla LED' })).json.id;
  const fb = (await M('/api/catalog', 'POST', { kind: 'campana', name: 'FB-Espectaculares', channel_id: ch.Facebook })).json.id;
  const gg = (await M('/api/catalog', 'POST', { kind: 'campana', name: 'Google-LED', channel_id: ch.Google })).json.id;
  // Inversión por mes calendario (meses distintos sin importar qué día se corra la prueba).
  const monthAgo = (k) => { const d = new RealDate(TODAY.getFullYear(), TODAY.getMonth() - k, 15); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const budgets = [[fb, 3, 10000], [fb, 2, 10000], [fb, 1, 10000], [fb, 0, 5000], [gg, 3, 8000], [gg, 2, 8000]];
  for (const [id, k, amount] of budgets) check(`inversión ${amount} en ${monthAgo(k)}`, (await M(`/api/catalog/${id}/budgets`, 'PUT', { month: monthAgo(k), amount })).status === 200);
  check('marketing no da de alta usuarios', (await M('/api/users', 'POST', { name: 'x', email: 'x@x.mx', password: PW, role: 'vendedor' })).status === 403);
  const formKey = (await G('/api/settings')).json.form_api_key;
  check('hay clave del formulario', Boolean(formKey));
  const form = (body) => call('', `/webhooks/form?key=${encodeURIComponent(formKey)}`, 'POST', body);
  check('formulario con clave mala se rechaza', (await call('', '/webhooks/form?key=mala', 'POST', { nombre: 'x', telefono: '5500000000' })).status === 401);

  // ===== Lead 1: el ciclo completo =====
  at(-80, 9);
  const r1 = await form({ nombre: 'Laura Gómez', telefono: '55 1122 3344', email: 'laura@cliente.mx', producto: 'Espectacular', canal: 'Facebook',
    utm_campaign: 'FB-Espectaculares', utm_source: 'facebook', utm_medium: 'paid', utm_content: 'video-a', mensaje: 'Quiero un espectacular en Periférico' });
  check('L1 entra por formulario (201)', r1.status === 201, JSON.stringify(r1.json));
  const L1 = r1.json.id;
  const O = await as('coco@maass.mx');
  let w = (await O('/api/workload')).json;
  check('L1 llega sin asignar (asignación automática apagada)', w.unassigned === 1 && w.auto_assign === false);
  check('el coordinador ve la sugerencia de a quién le toca', Boolean(w.suggested));
  at(-80, 9, 20);
  check('coordinador asigna L1 a Ana', (await O(`/api/leads/${L1}/assign`, 'POST', { assigned_to: ids.Ana })).status === 200);
  const A = await as('ana@maass.mx');
  let l = (await A(`/api/leads/${L1}`)).json;
  check('L1 en Nuevo, con campaña, anuncio y producto', l.status === 'nuevo' && l.campaign === 'FB-Espectaculares' && l.utm_content === 'video-a' && l.product_id === prodEsp, `${l.status} ${l.campaign} ${l.product_id}`);
  check('Mi día: L1 Toque 1/5 hoy', ACT(l)?.label === 'Toque 1/5' && ACT(l).days === 0, JSON.stringify(ACT(l)));
  const B = await as('beto@maass.mx');
  check('Beto no ve el lead de Ana', (await B(`/api/leads/${L1}`)).status === 404);
  check('el gerente no registra toques', (await G(`/api/leads/${L1}/touches`, 'POST', { channel: 'llamada', outcome: 'sin_respuesta' })).status === 403);

  at(-80, 9, 50);
  let t = await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'llamada', outcome: 'sin_respuesta', request_id: 'r-1' });
  check('T1 no contestó', t.status === 201 && t.json.n === 1);
  check('doble clic no duplica el toque', (await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'llamada', outcome: 'sin_respuesta', request_id: 'r-1' })).json.duplicate === true);
  l = (await A(`/api/leads/${L1}`)).json;
  check('L1 pasa a Contactando', F.stageOf(l) === 'contactando' && l.touch_count === 1, `${F.stageOf(l)} ${l.touch_count}`);
  check('siguiente: Toque 2/5 mañana', ACT(l)?.label === 'Toque 2/5' && ACT(l).days === 1, JSON.stringify(ACT(l)));
  at(-79, 11);
  await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'whatsapp', outcome: 'sin_respuesta' });
  at(-77, 12);
  l = (await A(`/api/leads/${L1}`)).json;
  check('día 3: toca Toque 3/5', ACT(l)?.label === 'Toque 3/5' && ACT(l).days === 0, JSON.stringify(ACT(l)));
  const agreed = new Date(TODAY.getTime() - 75 * 86400e3 + 10 * 3600e3).toISOString();
  t = await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'llamada', outcome: 'conversacion', note: 'Le mando ubicaciones el jueves', next_step: 'Le mando ubicaciones el jueves', next_step_at: agreed });
  l = (await A(`/api/leads/${L1}`)).json;
  check('T3 contestó: etapa Contestó y respondió en el toque 3', F.stageOf(l) === 'contesto' && l.response_touch === 3 && l.contacted_at, `${F.stageOf(l)} rt=${l.response_touch}`);
  check('el acuerdo con el cliente manda sobre la cadencia', ACT(l)?.agreed && ACT(l).days === 2, JSON.stringify(ACT(l)));
  at(-76, 9);
  check('el gerente pide seguimiento', (await G(`/api/leads/${L1}/request`, 'POST', { text: 'Ofrécele 2 caras en Periférico' })).status === 200);
  check('el pedido le aparece a Ana', (await A('/api/leads')).json.find((x) => x.id === L1).manager_request === 'Ofrécele 2 caras en Periférico');
  at(-75, 10, 15);
  await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'llamada', outcome: 'cumple', decision_maker: 'si', budget_status: 'si', start_window: 'mes' });
  l = (await A(`/api/leads/${L1}`)).json;
  check('T4 cumple perfil: etapa Cumple perfil y perfil rápido guardado', F.stageOf(l) === 'nuevo_perfil' && l.profile === 'cumple' && l.decision_maker === 'si' && l.start_window === 'mes');
  check('el pedido del gerente se quitó solo', l.manager_request === null && l.events.some((e) => /Atendió el seguimiento/.test(e.content)));
  check('siguiente: Enviar cotización', ACT(l)?.label === 'Enviar cotización', JSON.stringify(ACT(l)));
  at(-74, 16);
  t = await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'correo', outcome: 'cotizado' });
  check('cotizar sin monto se rechaza', t.status === 400, JSON.stringify(t.json));
  check('...y no deja un toque a medias', (await A(`/api/leads/${L1}`)).json.touch_count === 4);
  await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'correo', outcome: 'cotizado', quote_amount: '$150,000', note: 'Propuesta 2 caras Periférico' });
  l = (await A(`/api/leads/${L1}`)).json;
  check('T5 cotizado $150,000: etapa Cotizando', l.status === 'cotizando' && l.quote_amount === 150000 && l.quote_touch === 5 && l.quoted_at, `${l.status} ${l.quote_amount}`);
  check('seguimiento de la cotización a los 2 días', ACT(l)?.kind === 'seguimiento_cotizacion' || /cotizaci/i.test(ACT(l)?.label || ''), JSON.stringify(ACT(l)));
  at(-72, 10);
  l = (await A(`/api/leads/${L1}`)).json;
  check('a los 2 días toca el seguimiento 1 de la cotización', ACT(l)?.days === 0, JSON.stringify(ACT(l)));
  await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'whatsapp', outcome: 'seguimiento', note: 'Lo revisa con su socio' });
  at(-69, 13);
  t = await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'visita', outcome: 'vendido' });
  check('cerrar venta sin monto se rechaza', t.status === 400);
  const end1 = ymd(21);
  t = await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'visita', outcome: 'vendido', sale_amount: '135000', campaign_end: end1 });
  l = (await A(`/api/leads/${L1}`)).json;
  check('T7 vendido $135,000 con fin de campaña', l.status === 'vendido' && l.sale_amount === 135000 && l.campaign_end === end1 && l.won_at, `${l.status} ${l.sale_amount} ${l.campaign_end}`);
  check('después de vender no hay pendiente inmediato', !ACT(l) || ACT(l).days > 0, JSON.stringify(ACT(l)));
  at(-48, 10);
  l = (await A(`/api/leads/${L1}`)).json;
  check('a las 3 semanas: ¿Cómo va la campaña? Pedir referidos', ACT(l)?.kind === 'postventa' && ACT(l).days <= 0, JSON.stringify(ACT(l)));
  t = await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'llamada', outcome: 'renovo', renewal_amount: '1' });
  check('no deja registrar renovación cuando toca referidos', t.status === 400);
  await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'llamada', outcome: 'referidos', note: 'Me recomendó a Hotel Mirador 322 111 2233' });
  l = (await A(`/api/leads/${L1}`)).json;
  check('referidos registrados', Boolean(l.postsale_at));
  at(-9, 10);
  l = (await A(`/api/leads/${L1}`)).json;
  check('30 días antes del fin: Renovación', ACT(l)?.kind === 'renovacion' && ACT(l).days <= 0, JSON.stringify(ACT(l)));
  const end2 = ymd(113);
  await A(`/api/leads/${L1}/touches`, 'POST', { channel: 'visita', outcome: 'renovo', renewal_amount: '120000', campaign_end: end2 });
  l = (await A(`/api/leads/${L1}`)).json;
  check('renovó $120,000 y la campaña se extiende', l.renewal_amount === 120000 && l.campaign_end === end2, `${l.renewal_amount} ${l.campaign_end}`);
  check('la siguiente renovación queda para 30 días antes del nuevo fin', ACT(l)?.kind === 'renovacion' && ACT(l).days > 60, JSON.stringify(ACT(l)));
  note(`L1 historial: ${l.events.length} eventos; toques: ${(await A(`/api/leads/${L1}/touches`)).json.map((x) => `T${x.n} ${x.channel} ${x.outcome}`).join(' → ')}`);

  // ===== Lead 2: nunca contesta, se declina solo al 5º toque =====
  at(-60, 9);
  const L2 = (await O('/api/leads', 'POST', { source: 'whatsapp', campaign: 'Google-LED', name: 'Ricardo Martínez', phone: '5544063014', product_id: prodLed, assigned_to: ids.Beto })).json.id;
  check('L2 capturado por el coordinador y asignado al capturar', (await G(`/api/leads/${L2}`)).json.assigned_to === ids.Beto);
  for (const [d, h] of [[-60, 10], [-59, 10], [-57, 10], [-53, 10], [-48, 10]]) { at(d, h); t = await B(`/api/leads/${L2}/touches`, 'POST', { channel: 'llamada', outcome: 'sin_respuesta' }); }
  l = (await G(`/api/leads/${L2}`)).json;
  check('L2: 5 toques sin respuesta → Declinado solo', t.json.auto_declined && l.status === 'declinado' && l.decline_reason === 'No contestó (5 toques)', `${l.status} ${l.decline_reason}`);
  check('L2 queda en "Declinado · sin perfil"', F.stageOf(l) === 'declinado_sin');

  // ===== Lead 3: asignación automática; contesta pero no cumple perfil =====
  at(-41, 9);
  check('el coordinador enciende la asignación automática', (await O('/api/assign-settings', 'PATCH', { auto_assign: true })).json.auto_assign === true);
  at(-40, 9);
  const L3 = (await form({ nombre: 'Tienda Lupita', telefono: '5533221100', utm_campaign: 'Google-LED', producto: 'Pantalla LED' })).json.id;
  l = (await G(`/api/leads/${L3}`)).json;
  check('L3 se asignó solo al de menor carga', Boolean(l.assigned_to) && l.events.some((e) => /automáticamente/.test(e.content)), `asignado a ${l.assigned_name}`);
  const S3 = l.assigned_to === ids.Ana ? A : B;
  at(-40, 11); await S3(`/api/leads/${L3}/touches`, 'POST', { channel: 'llamada', outcome: 'conversacion' });
  at(-37, 11); await S3(`/api/leads/${L3}/touches`, 'POST', { channel: 'llamada', outcome: 'no_cumple' });
  l = (await G(`/api/leads/${L3}`)).json;
  check('L3 no cumple: Declinado · sin perfil, motivo No cumple perfil', l.status === 'declinado' && l.profile === 'no_cumple' && l.decline_reason === 'No cumple perfil' && F.stageOf(l) === 'declinado_sin');
  at(-36, 9); await O('/api/assign-settings', 'PATCH', { auto_assign: false });

  // ===== Lead 4: el mismo cliente vuelve a escribir (duplicado) =====
  at(-20, 18);
  const r4 = await form({ nombre: 'Laura G.', telefono: '5511223344', utm_campaign: 'FB-Espectaculares', mensaje: 'Quiero otra cara' });
  check('cliente que ya compró vuelve a escribir: oportunidad nueva', r4.status === 201 && r4.json.repeat_of === L1 && r4.json.id !== L1, JSON.stringify(r4.json));
  const L4 = r4.json.id;
  l = (await G(`/api/leads/${L4}`)).json;
  check('la oportunidad nueva queda con Ana (ya era su cliente)', l.assigned_to === ids.Ana && l.events.some((e) => /Ya es cliente/.test(e.content)), l.assigned_name);
  l = (await G(`/api/leads/${L1}`)).json;
  check('L1 sigue Vendido con su venta y su renovación intactas', l.status === 'vendido' && l.sale_amount === 135000 && l.renewal_amount === 120000 && l.events.some((e) => /Volvió a escribir/.test(e.content)));
  at(-20, 19);
  const r4b = await form({ nombre: 'Laura G.', telefono: '5511223344', mensaje: 'Es para Insurgentes' });
  check('si escribe otra vez, se suma a la oportunidad nueva (no crea otra)', r4b.status === 200 && r4b.json.id === L4, JSON.stringify(r4b.json));
  at(-19, 10); await A(`/api/leads/${L4}/touches`, 'POST', { channel: 'llamada', outcome: 'cumple' });
  at(-18, 10); await A(`/api/leads/${L4}/touches`, 'POST', { channel: 'correo', outcome: 'cotizado', quote_amount: 70000 });
  at(-16, 10); await A(`/api/leads/${L4}/touches`, 'POST', { channel: 'llamada', outcome: 'vendido', sale_amount: 65000, campaign_end: ymd(75) });
  check('segunda venta a Laura: $65,000 en su propio lead; la primera sigue en $135,000',
    (await G(`/api/leads/${L4}`)).json.sale_amount === 65000 && (await G(`/api/leads/${L1}`)).json.sale_amount === 135000);

  // ===== Lead 5: cotiza y lo pierde por precio =====
  at(-15, 10);
  const L5 = (await form({ nombre: 'Hotel Mirador', telefono: '3221112233', utm_campaign: 'FB-Espectaculares', utm_content: 'video-b', producto: 'Espectacular' })).json.id;
  await O(`/api/leads/${L5}`, 'PATCH', { assigned_to: ids.Beto });
  check('asignar desde Asignación (PATCH) funciona para el coordinador', (await G(`/api/leads/${L5}`)).json.assigned_to === ids.Beto);
  at(-15, 12); await B(`/api/leads/${L5}/touches`, 'POST', { channel: 'whatsapp', outcome: 'cumple' });
  at(-14, 12); await B(`/api/leads/${L5}/touches`, 'POST', { channel: 'correo', outcome: 'cotizado', quote_amount: '80000' });
  at(-10, 12);
  t = await B(`/api/leads/${L5}/touches`, 'POST', { channel: 'llamada', outcome: 'rechazo', decline_reason: 'Precio' });
  l = (await G(`/api/leads/${L5}`)).json;
  check('L5 perdido por Precio: Declinado · con perfil (remarketing)', t.status === 201 && l.decline_reason === 'Precio' && F.stageOf(l) === 'declinado_perfil', `${t.status} ${JSON.stringify(t.json)} ${F.stageOf(l)}`);

  // ===== Lead 6: cotización abierta =====
  at(-12, 10);
  const L6 = (await form({ nombre: 'Agencia Norte', telefono: '8155667788', utm_campaign: 'FB-Espectaculares', utm_content: 'video-a' })).json.id;
  await O(`/api/leads/${L6}/assign`, 'POST', { assigned_to: ids.Beto });
  at(-12, 12); await B(`/api/leads/${L6}/touches`, 'POST', { channel: 'llamada', outcome: 'cumple' });
  at(-11, 12); await B(`/api/leads/${L6}/touches`, 'POST', { channel: 'correo', outcome: 'cotizado', quote_amount: '90000' });

  // ===== Lead 7: asignado y sin tocar =====
  at(-3, 9);
  const L7 = (await form({ nombre: 'Despacho Sol', telefono: '5577889900', utm_campaign: 'FB-Espectaculares' })).json.id;
  await O(`/api/leads/${L7}/assign`, 'POST', { assigned_to: ids.Ana });

  // ===== Lead 8: llega hoy, sin asignar =====
  at(0, 8);
  const L8 = (await form({ nombre: 'Pedro Sol', telefono: '5512341234', utm_campaign: 'Google-LED' })).json.id;

  // ===== Verificación al día de hoy =====
  at(0, 11);
  const G2 = await as('fer@maass.mx'); const A2 = await as('ana@maass.mx'); const B2 = await as('beto@maass.mx');
  const M2 = await as('mara@maass.mx'); const O2 = await as('coco@maass.mx'); const L = await as('lalo@maass.mx');
  const s = (await G2('/api/stats')).json;
  const f = s.funnel;
  note(`Embudo total: recibidos ${f.recibidos}, contestaron ${f.contactados}, perfilados ${f.perfilados}, cotizados ${f.cotizados}, cerrados ${f.cerrados}, ventas ${f.ingresos}, en cotización ${f.en_cotizacion}`);
  check('embudo: 8 leads (la recompra cuenta como oportunidad nueva)', f.recibidos === 8, f.recibidos);
  check('embudo: contestaron 5 (L1, L3, L4, L5, L6)', f.contactados === 5, f.contactados);
  check('embudo: perfilados 4 (L1, L4, L5, L6)', f.perfilados === 4, f.perfilados);
  check('embudo: cotizados 4', f.cotizados === 4, f.cotizados);
  check('embudo: 2 cierres por $200,000', f.cerrados === 2 && f.ingresos === 200000, `${f.cerrados} ${f.ingresos}`);
  check('en cotización hoy: $90,000 (L6)', f.en_cotizacion === 90000 && f.cotizando_ahora === 1);
  check('días a cerrar promedio: (11 + 4) / 2', Math.abs(f.dias_cierre - 7.5) < 0.1, f.dias_cierre);
  const cf = Object.fromEntries(s.campaignFunnel.map((r) => [r.key, r]));
  const FB = cf['FB-Espectaculares']; const GG = cf['Google-LED'];
  note(`FB: ${FB.recibidos} leads, ${FB.perfilados} perfil, ${FB.cerrados} cierre, inversión ${FB.inversion}, ventas ${FB.ingresos}`);
  note(`Google: ${GG.recibidos} leads, ${GG.perfilados} perfil, ${GG.cerrados} cierres, inversión ${GG.inversion}`);
  check('FB: 5 leads, 4 con perfil, 2 cierres, $200,000', FB.recibidos === 5 && FB.perfilados === 4 && FB.cerrados === 2 && FB.ingresos === 200000);
  check('FB: inversión total $35,000 (cuatro meses)', FB.inversion === 35000, FB.inversion);
  check('Google: 3 leads, inversión $16,000', GG.recibidos === 3 && GG.inversion === 16000, `${GG.recibidos} ${GG.inversion}`);
  note(`Costos FB: por lead ${(FB.inversion / FB.recibidos).toFixed(0)}, por lead con perfil ${(FB.inversion / FB.perfilados).toFixed(0)}, por cierre ${(FB.inversion / FB.cerrados).toFixed(0)}, retorno ${(FB.ingresos / FB.inversion).toFixed(2)}x`);
  check('por qué se descartan FB: Precio', FB.descartes.some((d) => d.key === 'Precio'));
  check('anuncios: video-a con 2 leads y 1 cierre', s.adFunnel.find((a) => a.key === 'video-a')?.recibidos === 2 && s.adFunnel.find((a) => a.key === 'video-a').cerrados === 1);
  check('audiencias: 1 con perfil sin comprar (L5), 2 clientes (L1 y L4)', s.audiences.perfil === 1 && s.audiences.clientes === 2, JSON.stringify(s.audiences));
  check('respuesta: uno en el toque 3', s.touches.response.some((r) => r.n === 3));
  const beto = s.sellerFunnel.find((r) => r.id === ids.Beto); const ana = s.sellerFunnel.find((r) => r.id === ids.Ana);
  check('Ana: ticket $100,000 y descuento promedio 9% (10% y 7.1%)', ana.ticket === 100000 && Math.round(ana.descuento * 100) === 9, `${ana.ticket} ${ana.descuento}`);
  const pipeBeto = s.pipeline.find((p) => p.id === ids.Beto);
  check('pipeline de Beto: 1 viva por $90,000', pipeBeto?.vivas === 1 && pipeBeto.vivas_monto === 90000, JSON.stringify(pipeBeto));
  // Mes en curso
  const first = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1).toISOString();
  const sm = (await G2(`/api/stats?from=${encodeURIComponent(first)}`)).json;
  const fbm = sm.campaignFunnel.find((r) => r.key === 'FB-Espectaculares');
  note(`Mes en curso: ${sm.funnel.recibidos} leads; FB este mes ${fbm ? `${fbm.recibidos} leads, inversión ${fbm.inversion}` : 'sin leads'}`);
  const health = (await M2('/api/campaign-health')).json;
  note(`Campañas a revisar: ${health.campaigns.map((c) => `${c.key}=${c.status} (${c.motivos.join('; ') || 'ok'})`).join(' | ')}`);
  const det = (await M2('/api/campaign-detail?name=FB-Espectaculares')).json;
  note(`Ficha FB por mes: ${det.months.map((m) => `${m.month}: ${m.leads} leads, ${m.perfil} perfil, $${m.inversion ?? '—'}`).join(' · ')}`);
  check('ficha FB: inversión por mes cuadra ($35,000)', det.months.reduce((t2, m) => t2 + (m.inversion || 0), 0) === 35000);
  // Equipo hoy
  const team = (await G2('/api/team')).json;
  const tAna = team.sellers.find((r) => r.id === ids.Ana); const tBeto = team.sellers.find((r) => r.id === ids.Beto);
  note(`Equipo hoy: Ana ${tAna.en_curso} en curso, ${tAna.sin_primer_toque} sin primer toque, ${tAna.vencidos} vencidos | Beto ${tBeto.en_curso} en curso, ${tBeto.vencidos} vencidos; alertas Beto: ${tBeto.alertas.map((a) => a.why).join(', ')}`);
  check('Equipo hoy: L7 de Ana sin primer toque', tAna.sin_primer_toque === 1);
  check('Equipo hoy: la cotización de Beto está vencida', tBeto.vencidos >= 1);
  check('Equipo hoy: 1 sin asignar (L8)', team.unassigned === 1);
  check('cotizaciones más grandes: L6 $90,000', team.top_quotes[0]?.id === L6 && team.top_quotes[0].amount === 90000);
  // Vendedores
  const aLeads = (await A2('/api/leads')).json;
  check('Ana solo ve sus leads', aLeads.every((x) => x.assigned_to === ids.Ana) && aLeads.length >= 2);
  const aDue = aLeads.map((x) => ({ x, a: ACT(x) })).filter((y) => y.a && y.a.days <= 0);
  note(`Mi día de Ana: ${aDue.map((y) => `${y.x.name}: ${y.a.label} (${y.a.days} días)`).join(' | ')}`);
  check('Mi día de Ana: L7 Toque 1 vencido', aDue.some((y) => y.x.id === L7 && y.a.days < 0));
  const sa = (await A2('/api/stats')).json;
  check('Resumen de Ana trae el promedio del equipo', sa.team && sa.team.vendedores === 2);
  check('al vendedor no se le muestra la inversión', sa.campaignFunnel.every((r) => r.inversion == null));
  // Permisos
  check('marketing no mueve etapas', (await M2(`/api/leads/${L6}`, 'PATCH', { status: 'vendido', sale_amount: 1 })).status === 200 && (await G2(`/api/leads/${L6}`)).json.status === 'cotizando');
  check('marketing corrige el origen', (await M2(`/api/leads/${L8}`, 'PATCH', { product_id: prodLed })).status === 200 && (await G2(`/api/leads/${L8}`)).json.product_id === prodLed);
  check('analista: solo lectura', (await L(`/api/leads/${L6}`, 'PATCH', { name: 'x' })).status === 403 && (await L('/api/stats')).status === 200);
  check('coordinador no ve reportes', (await O2('/api/stats')).status === 403 && (await O2('/api/team')).status === 403);
  check('vendedor no ve Equipo hoy', (await A2('/api/team')).status === 403);
  // Exportar
  const csv = await fetch(`${base}/api/leads.csv`, { headers: { cookie: await login('fer@maass.mx') } }).then((r) => r.text());
  check('CSV: trae a Laura con su venta', /Laura Gómez/.test(csv) && /135000/.test(csv), csv.split('\n')[0]);
  const audCsv = await fetch(`${base}/api/leads.csv?audience=perfil`, { headers: { cookie: await login('mara@maass.mx') } }).then((r) => r.text());
  check('CSV de audiencia "con perfil sin comprar": solo Hotel Mirador', /Hotel Mirador/.test(audCsv) && !/Laura/.test(audCsv));
  // Respaldo
  const bk = await fetch(`${base}/api/backup`, { headers: { cookie: await login('fer@maass.mx') } });
  check('el gerente descarga el respaldo', bk.status === 200 && Number(bk.headers.get('content-length') || (await bk.arrayBuffer()).byteLength) > 1000);

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const fails = results.filter((r) => !r.ok);
  assert.deepEqual(fails.map((x) => `${x.name} ${x.detail}`), [], `${fails.length} de ${results.length} verificaciones fallaron`);
  assert.ok(results.length >= 90, `solo corrieron ${results.length} verificaciones`);
});
