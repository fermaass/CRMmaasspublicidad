// Panel de Maass Leads: una pantalla para ver el estado técnico de todos los proyectos (uno por cliente).
// Lee /api/ops/status de cada uno con OPS_TOKEN. No entra a ningún proyecto ni ve datos de sus clientes.
// Se corre como un servicio aparte con PANEL_INSTANCES, PANEL_PASSWORD y OPS_TOKEN.
const express = require('express');
const crypto = require('node:crypto');

// "Maass Publicidad=https://maass.maassleads.com, Gimnasio=https://gym.maassleads.com" (o uno por renglón).
function parseInstances(text) {
  return String(text || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=');
    const name = i > 0 ? s.slice(0, i).trim() : s;
    const url = (i > 0 ? s.slice(i + 1) : s).trim().replace(/\/+$/, '');
    return { name, url };
  }).filter((x) => /^https?:\/\//.test(x.url));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const daysAgo = (iso) => (iso ? (Date.now() - new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).getTime()) / 86400e3 : Infinity);
const ago = (iso) => {
  if (!iso) return 'nunca';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).getTime()) / 60e3));
  if (m < 60) return `hace ${m} min`;
  if (m < 48 * 60) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} días`;
};

// Revisa un proyecto y arma sus avisos. level: red (caído o datos en riesgo), yellow (revisar), info (dato).
function assess(s, majorityVersion) {
  const alerts = [];
  const add = (level, text) => alerts.push({ level, text });
  if (!s.db_ok) add('red', 'La base de datos reporta problemas: restaura el último respaldo');
  if (s.storage_warning) add('red', 'Sin volumen: los datos se borrarán en la próxima actualización');
  if (s.setup_pending) add('yellow', 'Instalación sin terminar: falta crear al gerente');
  if (!s.captcha) add('yellow', 'Sin captcha (faltan las claves de Turnstile)');
  if (daysAgo(s.backups?.local_last) > 2) add('red', `Respaldo diario atrasado (último: ${s.backups?.local_last || 'ninguno'})`);
  const off = s.backups?.offsite || {};
  if (!off.configured) add('yellow', 'Sin respaldo fuera del servidor');
  else if (off.error && daysAgo(off.last) > 1) add('red', `Falló el respaldo externo: ${off.error}`);
  else if (daysAgo(off.last) > 2) add('yellow', `Respaldo externo atrasado (último: ${off.last ? ago(off.last) : 'ninguno'})`);
  if (s.errors?.last_24h) add('yellow', `${s.errors.last_24h} ${s.errors.last_24h === 1 ? 'falla' : 'fallas'} en las últimas 24 h`);
  if (majorityVersion && s.version !== majorityVersion) add('yellow', `Versión distinta a los demás (${s.version}): revisa si su actualización falló`);
  if (!s.setup_pending && daysAgo(s.activity?.last_login_at) > 7) add('info', 'Nadie ha entrado en más de 7 días');
  const level = alerts.some((a) => a.level === 'red') ? 'red' : alerts.some((a) => a.level === 'yellow') ? 'yellow' : 'green';
  return { level, alerts };
}

async function checkAll(instances, opsToken, fetchImpl = fetch) {
  const rows = await Promise.all(instances.map(async (inst) => {
    try {
      const r = await fetchImpl(`${inst.url}/api/ops/status`, { headers: { authorization: `Bearer ${opsToken}` }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { ...inst, down: `respondió ${r.status}${r.status === 404 ? ' (¿falta OPS_TOKEN en ese proyecto?)' : ''}` };
      return { ...inst, status: await r.json() };
    } catch (err) {
      return { ...inst, down: err.name === 'TimeoutError' ? 'no respondió en 8 segundos' : 'no se pudo conectar' };
    }
  }));
  const versions = rows.filter((r) => r.status).map((r) => r.status.version);
  const majority = versions.sort((a, b) => versions.filter((v) => v === b).length - versions.filter((v) => v === a).length)[0];
  return rows.map((r) => (r.down ? { ...r, level: 'red', alerts: [{ level: 'red', text: `Caído: ${r.down}` }] } : { ...r, ...assess(r.status, versions.length > 1 ? majority : null) }));
}

function page(rows) {
  const LABEL = { green: 'Bien', yellow: 'Revisar', red: 'Atender ya' };
  const count = (l) => rows.filter((r) => r.level === l).length;
  const card = (r) => {
    const s = r.status || {}; const a = s.activity || {}; const b = s.backups || {};
    const fact = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    return `<article class="card ${r.level}">
      <header><span class="dot"></span><h2>${esc(r.name)}</h2><em class="pill ${r.level}">${LABEL[r.level]}</em>
        <a href="${esc(r.url)}" target="_blank" rel="noopener">Abrir</a></header>
      ${r.alerts.length ? `<ul class="alerts">${r.alerts.map((x) => `<li class="${x.level}">${esc(x.text)}</li>`).join('')}</ul>` : '<p class="ok">Todo en orden.</p>'}
      ${r.status ? `<div class="facts">
        ${fact('Leads (7 días)', a.leads_7d)}${fact('Toques (7 días)', a.touches_7d)}${fact('Último lead', ago(a.last_lead_at))}
        ${fact('Último acceso', ago(a.last_login_at))}${fact('Usuarios', `${a.users_active}${a.users_pending ? ` + ${a.users_pending} invitados` : ''}`)}
        ${fact('Leads en total', a.leads_total)}${fact('Respaldo diario', b.local_last || '—')}${fact('Respaldo externo', b.offsite?.configured ? ago(b.offsite.last) : 'no configurado')}
        ${fact('Versión', esc(s.version))}${fact('Arriba desde', ago(s.started_at))}
      </div>
      ${s.errors?.recent?.length ? `<details><summary>Fallas recientes (${s.errors.recent.length})</summary><table>
        <tr><th>Cuándo</th><th>Dónde</th><th>Mensaje</th></tr>
        ${s.errors.recent.map((e) => `<tr><td>${ago(e.at)}</td><td>${esc(e.source)} · ${esc(e.place)}</td><td>${esc(e.message)}</td></tr>`).join('')}</table></details>` : ''}` : ''}
    </article>`;
  };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60"><title>Panel · Maass Leads</title><style>
  :root{--bg:#f4f6fb;--card:#fff;--text:#1f2433;--muted:#6b7189;--line:#e4e8f1;--red:#e2445c;--yellow:#f59e0b;--green:#037f4c}
  *{box-sizing:border-box}body{margin:0;font:14px/1.45 Inter,system-ui,sans-serif;background:var(--bg);color:var(--text)}
  .top{background:linear-gradient(140deg,#0f4fc2,#1a73e8 40%,#8a78e2);color:#fff;padding:22px 16px}
  .top div{max-width:1100px;margin:0 auto}.top h1{margin:0;font-size:22px}.top p{margin:4px 0 0;opacity:.9}
  .sum{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}.sum span{background:rgba(255,255,255,.18);padding:4px 12px;border-radius:999px;font-weight:600}
  main{max-width:1100px;margin:16px auto;padding:0 16px;display:grid;gap:14px}
  .card{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--green);border-radius:14px;padding:16px}
  .card.yellow{border-left-color:var(--yellow)}.card.red{border-left-color:var(--red)}
  header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}h2{margin:0;font-size:17px}
  .dot{width:10px;height:10px;border-radius:50%;background:var(--green)}.yellow .dot{background:var(--yellow)}.red .dot{background:var(--red)}
  .pill{font-style:normal;font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px;background:#dcf3e7;color:var(--green)}
  .pill.yellow{background:#fff1d6;color:#9a5b00}.pill.red{background:#ffe3ec;color:#c21e56}
  header a{margin-left:auto;color:#1570ef;font-weight:600;text-decoration:none}
  .alerts{margin:10px 0 0;padding-left:18px}.alerts li.red{color:#c21e56;font-weight:600}.alerts li.info{color:var(--muted)}.ok{color:var(--green);margin:10px 0 0}
  .facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:12px}
  .facts div{background:var(--bg);border-radius:10px;padding:8px 10px}.facts span{display:block;font-size:11px;color:var(--muted)}.facts b{font-size:14px}
  details{margin-top:10px}summary{cursor:pointer;color:#1570ef;font-weight:600}table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
  th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:11px;color:var(--muted)}
  .foot{color:var(--muted);font-size:12px;text-align:center;margin:8px 0 24px}</style></head><body>
  <section class="top"><div><h1>Panel · Maass Leads</h1><p>Estado técnico de cada proyecto. No muestra datos de los clientes. Se actualiza cada minuto.</p>
    <div class="sum"><span>${rows.length} proyectos</span><span>${count('green')} bien</span><span>${count('yellow')} por revisar</span><span>${count('red')} por atender ya</span></div></div></section>
  <main>${rows.length ? rows.sort((x, y) => ['red', 'yellow', 'green'].indexOf(x.level) - ['red', 'yellow', 'green'].indexOf(y.level)).map(card).join('')
    : '<p>No hay proyectos. Agrégalos en la variable PANEL_INSTANCES.</p>'}</main>
  <p class="foot">Revisado ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })}</p></body></html>`;
}

function createPanel({ instances, opsToken, user = 'maass', password, fetchImpl }) {
  if (!password || password.length < 12) throw new Error('PANEL_PASSWORD es obligatoria (mínimo 12 caracteres)');
  const app = express();
  app.disable('x-powered-by');
  const fails = new Map();
  app.get('/health', (req, res) => res.send('ok')); // Railway revisa que el servicio arrancó
  app.use((req, res, next) => {
    res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
    // Usuario y contraseña del navegador (Basic). Con HTTPS de por medio, 20 intentos fallidos por conexión bloquean 15 min.
    const ip = String(req.get('cf-connecting-ip') || req.ip || '');
    const f = fails.get(ip);
    if (f && f.n >= 20 && f.until > Date.now()) return res.status(429).send('Demasiados intentos. Espera 15 minutos.');
    const [u, p] = Buffer.from(String(req.get('authorization') || '').replace(/^Basic\s+/i, ''), 'base64').toString().split(':');
    const same = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(); const y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
    if (!(same(u || '', user) & same(p || '', password))) {
      const n = (f && f.until > Date.now() ? f.n : 0) + (req.get('authorization') ? 1 : 0);
      fails.set(ip, { n, until: Date.now() + 15 * 60e3 });
      return res.set('WWW-Authenticate', 'Basic realm="Panel Maass Leads", charset="UTF-8"').status(401).send('Inicia sesión para ver el panel.');
    }
    fails.delete(ip);
    return next();
  });
  app.get('/', async (req, res) => res.send(page(await checkAll(instances, opsToken, fetchImpl))));
  app.get('/estado.json', async (req, res) => res.json(await checkAll(instances, opsToken, fetchImpl)));
  return app;
}

function startPanel(env = process.env) {
  const instances = parseInstances(env.PANEL_INSTANCES);
  const app = createPanel({ instances, opsToken: env.OPS_TOKEN, user: env.PANEL_USER || 'maass', password: env.PANEL_PASSWORD });
  const port = Number(env.PORT) || 3000;
  app.listen(port, () => console.log(`Panel de Maass Leads en el puerto ${port} con ${instances.length} proyectos`));
}

module.exports = { parseInstances, assess, checkAll, createPanel, startPanel };
