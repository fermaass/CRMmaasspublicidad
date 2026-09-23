const state = { me: null, meta: null, users: [], catalog: { canal: [], producto: [] }, leads: [], view: 'board' };
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = (k) => state.meta.labels[k] || k;
const fmtDate = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
const can = (...roles) => state.me && roles.includes(state.me.role);
// Colores con poco contraste para texto blanco: llevan texto oscuro.
const DARK_TEXT = new Set(['cotizando']);
const colorVar = (key) => `--c: var(--${key})`;
const textClass = (key) => (DARK_TEXT.has(key) ? 'dark-text' : '');
// Paleta fija para productos y canales (validada para daltonismo); más de 8 se agrupan en "Otros".
const CAT = ['#6161ff', '#ff7a00', '#00a39b', '#e2445c', '#caa000', '#9d50dd', '#037f4c', '#ff5ac4'];
const money = (v) => (v == null ? '—' : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }));
// Opciones de campaña (se guardan por nombre); incluye la actual aunque ya no esté activa.
function campaignOptions(current, emptyLabel) {
  const items = state.catalog.campana.filter((c) => c.active || c.name === current);
  return `<option value="">${esc(emptyLabel)}</option>`
    + items.map((c) => `<option value="${esc(c.name)}" ${c.name === current ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined || ['POST', 'PATCH'].includes(opts.method) ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : (['POST', 'PATCH'].includes(opts.method) ? '{}' : undefined),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Sesión expirada'); }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Error ${res.status}`), { data });
  return data;
}

// ---------- Avisos y confirmaciones dentro de la página ----------
function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = 'toast hidden'; }, 3500);
}

// Devuelve true/false, o el texto escrito si se pide un campo (null si se cancela).
function ask(message, { input = false, placeholder = '', okLabel = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    const modal = $('#modal');
    $('#modal-text').textContent = message;
    const field = $('#modal-input');
    field.classList.toggle('hidden', !input);
    field.value = '';
    field.placeholder = placeholder;
    const ok = $('#modal-ok');
    ok.textContent = okLabel;
    ok.classList.toggle('danger', danger);
    modal.classList.remove('hidden');
    (input ? field : ok).focus();
    const close = (value) => {
      modal.classList.add('hidden');
      ok.onclick = null; $('#modal-cancel').onclick = null; field.onkeydown = null;
      resolve(value);
    };
    ok.onclick = () => close(input ? field.value.trim() : true);
    $('#modal-cancel').onclick = () => close(input ? null : false);
    field.onkeydown = (e) => { if (e.key === 'Enter') ok.onclick(); };
  });
}

// ---------- Sesión ----------
function showLogin() {
  state.me = null;
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    state.me = await api('/api/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
    $('#login-error').textContent = '';
    start();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showLogin(); });

async function start() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#me').textContent = `${state.me.name} · ${state.me.role}`;
  document.querySelectorAll('[data-role]').forEach((el) => {
    el.classList.toggle('hidden', !el.dataset.role.split(',').includes(state.me.role));
  });
  $('#f-assigned').classList.toggle('hidden', state.me.role === 'vendedor');
  [state.users, state.catalog] = await Promise.all([api('/api/users'), api('/api/catalog')]);
  fillFilters();
  setView(state.view);
}

function fillFilters() {
  const opts = (sel, values) => {
    const el = $(sel);
    el.querySelectorAll('option[data-dyn]').forEach((o) => o.remove());
    values.forEach(([v, t]) => el.insertAdjacentHTML('beforeend', `<option data-dyn value="${esc(v)}">${esc(t)}</option>`));
  };
  opts('#f-profile', state.meta.profiles.map((p) => [p, label(p)]));
  opts('#f-source', state.meta.sources.map((s) => [s, label(s)]));
  opts('#f-status', state.meta.statuses.map((s) => [s, label(s)]));
  opts('#f-assigned', state.users.filter((u) => u.active).map((u) => [u.id, u.name]));
  opts('#f-product', state.catalog.producto.map((i) => [i.id, i.name]));
  opts('#f-channel', state.catalog.canal.map((i) => [i.id, i.name]));
  opts('#f-campaign', state.catalog.campana.map((c) => [c.name, c.name]));
}

// Opciones de un <select> de la lista; incluye el valor actual aunque ya no esté activo.
function catalogOptions(kind, current, emptyLabel) {
  const items = state.catalog[kind].filter((i) => i.active || i.id === current);
  return `<option value="">${esc(emptyLabel)}</option>`
    + items.map((i) => `<option value="${i.id}" ${i.id === current ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
}

function filterQuery() {
  const p = new URLSearchParams();
  const add = (k, sel) => { const v = $(sel).value.trim(); if (v) p.set(k, v); };
  add('q', '#f-q'); add('profile', '#f-profile'); add('source', '#f-source'); add('assigned', '#f-assigned');
  add('product', '#f-product'); add('channel', '#f-channel'); add('campaign', '#f-campaign');
  // Periodo: filtra por fecha en que se recibió el lead.
  const period = $('#f-period').value;
  if (period) {
    const d = new Date();
    const first = (y, m) => new Date(y, m, 1).toISOString();
    if (period === 'mes') p.set('from', first(d.getFullYear(), d.getMonth()));
    if (period === 'mes_pasado') { p.set('from', first(d.getFullYear(), d.getMonth() - 1)); p.set('to', first(d.getFullYear(), d.getMonth())); }
    if (period === '30' || period === '90') p.set('from', new Date(Date.now() - Number(period) * 86400e3).toISOString());
    if (period === 'anio') p.set('from', first(d.getFullYear(), 0));
  }
  if (state.view !== 'board') add('status', '#f-status');
  return p.toString();
}

// ---------- Vistas ----------
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
['#f-profile', '#f-source', '#f-product', '#f-channel', '#f-campaign', '#f-period', '#f-assigned', '#f-status'].forEach((s) => $(s).addEventListener('change', refresh));
let searchTimer;
$('#f-q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 300); });
$('#export').addEventListener('click', () => {
  if (window.crmExport) return window.crmExport(filterQuery());
  window.location = `/api/leads.csv?${filterQuery()}`;
});
$('#new-lead').addEventListener('click', openNewLead);

function setView(view) {
  state.view = view;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  $('.toolbar').classList.toggle('hidden', ['users', 'settings'].includes(view));
  $('#f-status').classList.toggle('hidden', view === 'board');
  refresh();
}

async function refresh() {
  if (!state.me) return;
  if (state.view === 'users') return renderUsers();
  if (state.view === 'settings') return renderSettings();
  if (state.view === 'stats') return renderStats();
  state.leads = await api(`/api/leads?${filterQuery()}`);
  state.view === 'board' ? renderBoard() : renderList();
}

function cardHtml(l) {
  return `<div class="lead-card" draggable="${canEditLead(l)}" data-id="${l.id}">
    <div class="name">${esc(l.name || l.phone || l.email)}</div>
    <div class="meta">${esc([l.phone, l.email].filter(Boolean).join(' · '))}</div>
    <div class="tags">
      <span class="tag ${l.source}">${esc(label(l.source))}</span>
      <span class="tag ${l.profile}">${esc(label(l.profile))}</span>
      ${l.product_name ? `<span class="tag product">${esc(l.product_name)}</span>` : ''}
    </div>
    <div class="meta">${l.assigned_name
      ? `<span class="avatar" aria-hidden="true">${esc(initials(l.assigned_name))}</span>${esc(l.assigned_name)}`
      : '<span class="avatar none" aria-hidden="true">?</span><em>Sin asignar</em>'} · ${fmtDate(l.updated_at)}</div>
  </div>`;
}

function canEditLead(l) {
  return can('gerente', 'marketing') || (state.me.role === 'vendedor' && l.assigned_to === state.me.id);
}

function renderBoard() {
  const board = $('#view-board');
  board.innerHTML = state.meta.statuses.map((s) => {
    const items = state.leads.filter((l) => l.status === s);
    return `<div class="column" data-status="${s}">
      <h3 class="col-head ${textClass(s)}" style="${colorVar(s)}"><span>${esc(label(s))}</span><span class="count">${items.length}</span></h3>
      ${items.map(cardHtml).join('')}
    </div>`;
  }).join('');

  board.querySelectorAll('.lead-card').forEach((c) => {
    c.addEventListener('click', () => openLead(c.dataset.id));
    c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', c.dataset.id));
  });
  board.querySelectorAll('.column').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      const lead = state.leads.find((l) => String(l.id) === id);
      if (!lead || lead.status === col.dataset.status) return;
      await changeStatus(lead, col.dataset.status);
    });
  });
}

async function changeStatus(lead, status) {
  const body = { status };
  if (status === 'declinado') {
    const reason = await ask('¿Por qué se declina? (opcional, ayuda a marketing)', { input: true, placeholder: 'Ej. presupuesto, eligió a otro proveedor', okLabel: 'Declinar' });
    if (reason === null) return;
    body.decline_reason = reason;
  }
  if (status === 'vendido') {
    const amount = await ask('¡Venta cerrada! ¿De cuánto fue? (opcional, sirve para medir el retorno de cada campaña)',
      { input: true, placeholder: 'Ej. 45000', okLabel: 'Marcar vendido' });
    if (amount === null) return;
    if (amount) body.sale_amount = amount;
  }
  try {
    await api(`/api/leads/${lead.id}`, { method: 'PATCH', body });
  } catch (err) { toast(err.message, 'error'); }
  refresh();
}

function renderList() {
  const rows = state.leads.map((l) => `<tr data-id="${l.id}">
    <td><strong>${esc(l.name || '—')}</strong><br><span class="muted">${esc(l.phone || '')} ${esc(l.email || '')}</span></td>
    <td class="status-cell"><span class="${textClass(l.status)}" style="${colorVar(l.status)}">${esc(label(l.status))}</span></td>
    <td><span class="tag ${l.profile}">${esc(label(l.profile))}</span></td>
    <td><span class="tag ${l.source}">${esc(label(l.source))}</span><br><span class="muted">${esc([l.channel_name, l.campaign].filter(Boolean).join(' · '))}</span></td>
    <td>${esc(l.product_name || '—')}</td>
    <td>${esc(l.assigned_name || 'Sin asignar')}</td>
    <td class="muted">${fmtDate(l.created_at)}</td>
  </tr>`).join('');
  $('#view-list').innerHTML = `<p class="muted">${state.leads.length} leads</p>
    <div class="table-wrap"><table><thead><tr><th>Contacto</th><th>Estado</th><th>Perfil</th><th>Origen / canal / campaña</th><th>Producto</th><th>Vendedor</th><th>Recibido</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="muted">Sin resultados</td></tr>'}</tbody></table></div>`;
  $('#view-list').querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openLead(tr.dataset.id)));
}

async function renderStats() {
  const s = await api(`/api/stats?${filterQuery()}`);
  const n = (rows, key) => rows.find((r) => r.key === key)?.n || 0;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const stages = state.meta.statuses.map((k) => ({ key: k, n: n(s.byStatus, k), label: label(k), color: `var(--${k})`, dark: DARK_TEXT.has(k) }));
  const profiles = state.meta.profiles.map((k) => ({ key: k, n: n(s.byProfile, k), label: label(k), color: `var(--${k})` }));
  const sources = state.meta.sources.map((k) => ({ key: k, n: n(s.bySource, k), label: label(k), color: `var(--${k})` }));

  const kpi = (title, value, sub, color, unit = '') => `<div class="kpi-tile" style="--c:${color}">
    <div class="label"><span class="dot"></span>${esc(title)}</div>
    <div class="value"><span data-count="${value}">0</span>${unit}</div><div class="sub">${esc(sub)}</div></div>`;

  const f = s.funnel;
  $('#view-stats').innerHTML = `<div class="dash">
    <div class="kpis">
      ${kpi('Recibidos', f.recibidos, 'leads con los filtros actuales', 'var(--f-recibidos)')}
      ${kpi('Contestaron', f.contactados, `${pct(f.contactados, f.recibidos)}% de los recibidos`, 'var(--f-contactados)')}
      ${kpi('Cotizados', f.cotizados, `${pct(f.cotizados, f.recibidos)}% de los recibidos`, 'var(--f-cotizados)')}
      ${kpi('Cerrados', f.cerrados, `${pct(f.cerrados, f.cotizados)}% de lo cotizado`, 'var(--f-cerrados)')}
      ${kpi('Conversión', pct(f.cerrados, f.recibidos), 'de cada 100 recibidos se cierran', 'var(--accent)', '%')}
      ${f.ingresos ? `<div class="kpi-tile" style="--c:var(--f-cerrados)"><div class="label"><span class="dot"></span>Ventas</div>
        <div class="value">${money(f.ingresos)}</div><div class="sub">de ${f.cerrados} cierres</div></div>` : ''}
    </div>
    <div class="card chart-card span-8"><h3>Embudo de conversión <small>cuántos llegan a cada paso</small></h3>${funnelChart(f)}</div>
    <div class="card chart-card span-4"><h3>Dónde están hoy <small>etapa actual</small></h3>
      ${battery(stages, s.total, true)}${legend(stages, s.total)}
      <p class="muted" style="margin-bottom:0">${f.declinados} declinados; ${n(s.byStatus, 'nuevo') + n(s.byStatus, 'nuevo_perfil')} todavía sin cotizar.</p></div>
    <div class="card chart-card"><h3>Eficiencia por vendedor <small>de lo que recibe cada uno, cuánto avanza</small></h3>${sellerTable(s.sellerFunnel)}</div>
    <div class="card chart-card"><h3>Conversión por campaña <small>de dónde salen los cierres</small></h3>${campaignTable(s.campaignFunnel)}</div>
    <div class="card chart-card"><h3>Eficiencia de campañas <small>cuánto cuesta y cuánto regresa cada una</small></h3>${campaignEfficiency(s.campaignFunnel)}</div>
    <div class="card chart-card span-8"><h3>Leads recibidos <small>últimos 30 días</small></h3>${areaChart(s.byDay)}</div>
    <div class="card chart-card span-4"><h3>Por origen</h3>${donut(sources, s.total)}</div>
    <div class="card chart-card span-6"><h3>Por producto <small>etapa de cada lead</small></h3>${stageRows(s.productStages)}</div>
    <div class="card chart-card span-6"><h3>Por vendedor <small>etapa de cada lead</small></h3>${stageRows(s.sellerStages)}</div>
    <div class="card chart-card span-6"><h3>¿Cómo se enteraron? <small>canal de percepción</small></h3>${categoryBars(s.byChannel)}</div>
    <div class="card chart-card span-6"><h3>Perfil</h3>${battery(profiles, s.total, true)}${legend(profiles, s.total)}</div>
  </div>`;
  animateIn($('#view-stats'));
}

const FUNNEL = [
  ['recibidos', 'Recibidos'], ['contactados', 'Contestaron'], ['perfilados', 'Perfilados'], ['cotizados', 'Cotizados'], ['cerrados', 'Cerrados'],
];
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Embudo: barras centradas que se angostan; a la derecha el total y entre pasos cuántos avanzan.
function funnelChart(f) {
  const top = f.recibidos || 1;
  return `<div class="funnel">${FUNNEL.map(([k, name], i) => {
    const prev = i ? f[FUNNEL[i - 1][0]] : null;
    const step = i ? `<div class="f-step"><span>↓ ${pctOf(f[k], prev)}% avanza</span></div>` : '';
    const w = Math.max((f[k] / top) * 100, f[k] ? 3 : 0);
    return `${step}<div class="f-row">
      <span class="f-name">${name}</span>
      <div class="f-track"><div class="f-bar ${k === 'cotizados' ? 'dark-text' : ''}" style="--w:${w}%; --c:var(--f-${k})"
        data-tip="${esc(`${name}: ${f[k]}
${pctOf(f[k], f.recibidos)}% de los recibidos${i ? `
${pctOf(f[k], prev)}% del paso anterior` : ''}`)}">
        <b data-count="${f[k]}">0</b></div></div>
      <span class="f-pct">${pctOf(f[k], f.recibidos)}%</span>
    </div>`;
  }).join('')}</div>`;
}

// Celda con número, porcentaje sobre la base y una barrita.
function rateCell(value, base, key) {
  const p = pctOf(value, base);
  return `<td class="rate"><div><b class="num">${value}</b> <span class="muted num">${base ? `${p}%` : ''}</span></div>
    <div class="mini"><i style="--w:${p}%; --c:var(--f-${key})"></i></div></td>`;
}

function hours(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} días`;
}

function sellerTable(rows) {
  if (!rows.length) return '<p class="muted">Sin datos</p>';
  const best = Math.max(...rows.filter((r) => r.id).map((r) => pctOf(r.cerrados, r.recibidos)), 0);
  return `<div class="table-wrap"><table class="funnel-table"><thead><tr>
    <th>Vendedor</th><th>Recibe</th><th>Contestaron</th><th>Perfilados</th><th>Cotiza</th><th>Cierra</th><th>Conversión</th><th>Tiempo hasta que contestan</th>
  </tr></thead><tbody>${rows.map((r) => {
    const conv = pctOf(r.cerrados, r.recibidos);
    return `<tr class="${r.id ? '' : 'unassigned'}">
      <td>${r.id ? `<span class="avatar" aria-hidden="true">${esc(initials(r.key))}</span>` : ''}<strong>${esc(r.key)}</strong></td>
      <td class="num"><b>${r.recibidos}</b></td>
      ${rateCell(r.contactados, r.recibidos, 'contactados')}${rateCell(r.perfilados, r.recibidos, 'perfilados')}
      ${rateCell(r.cotizados, r.recibidos, 'cotizados')}${rateCell(r.cerrados, r.recibidos, 'cerrados')}
      <td><span class="conv ${r.id && conv === best && best > 0 ? 'top' : ''}">${conv}%</span></td>
      <td class="num">${hours(r.horas_contacto)}</td></tr>`;
  }).join('')}</tbody></table></div>
  <p class="muted small-note">Los porcentajes son sobre lo que recibe cada vendedor. "Tiempo hasta que contestan" va de la asignación a que el cliente respondió.</p>`;
}

function campaignTable(rows) {
  if (!rows.length) return '<p class="muted">Sin datos</p>';
  return `<div class="table-wrap"><table class="funnel-table"><thead><tr>
    <th>Campaña</th><th>Recibidos</th><th>Contestaron</th><th>Perfilados</th><th>Cotizados</th><th>Cerrados</th><th>Conversión</th>
  </tr></thead><tbody>${rows.map((r) => `<tr>
      <td><strong>${esc(r.key)}</strong></td><td class="num"><b>${r.recibidos}</b></td>
      ${rateCell(r.contactados, r.recibidos, 'contactados')}${rateCell(r.perfilados, r.recibidos, 'perfilados')}
      ${rateCell(r.cotizados, r.recibidos, 'cotizados')}${rateCell(r.cerrados, r.recibidos, 'cerrados')}
      <td><span class="conv">${pctOf(r.cerrados, r.recibidos)}%</span></td></tr>`).join('')}</tbody></table></div>`;
}

// Costo por lead, por cotización y por cierre, y retorno (ventas ÷ inversión). Menor costo = más eficiente.
function campaignEfficiency(rows) {
  const withBudget = rows.filter((r) => r.inversion > 0);
  if (!withBudget.length) {
    return `<p class="muted">Todavía no hay inversión capturada. En <strong>Configuración → Campañas</strong> marketing pone cuánto se invirtió en cada una
      y aquí aparece el costo por lead, por cotización y por cierre.</p>`;
  }
  const per = (r, k) => (r[k] ? r.inversion / r[k] : null);
  // Si hay ventas capturadas manda el retorno (ventas ÷ inversión); si no, el costo por cierre más bajo.
  const roasOf = (r) => (r.ingresos ? r.ingresos / r.inversion : null);
  const bySales = withBudget.some((r) => r.ingresos);
  const ranked = [...withBudget].sort((a, b) => (bySales
    ? (roasOf(b) ?? -1) - (roasOf(a) ?? -1)
    : (per(a, 'cerrados') ?? Infinity) - (per(b, 'cerrados') ?? Infinity)));
  const best = ranked.find((r) => (bySales ? r.ingresos : r.cerrados));
  const maxCpl = Math.max(...withBudget.map((r) => per(r, 'recibidos') || 0));
  const periodNote = $('#f-period').value ? '<p class="muted small-note">Ojo: la inversión es el total de cada campaña y los leads son solo los del periodo elegido; para costos exactos usa "Todo el tiempo".</p>' : '';
  return `<div class="table-wrap"><table class="funnel-table"><thead><tr>
    <th>Campaña</th><th>Inversión</th><th>Costo por lead</th><th>Costo por cotización</th><th>Costo por cierre</th><th>Ventas</th><th>Retorno</th>
  </tr></thead><tbody>${ranked.map((r) => {
    const roas = roasOf(r);
    const cpl = per(r, 'recibidos');
    return `<tr>
      <td><strong>${esc(r.key)}</strong>${r === best ? ' <span class="conv top">más eficiente</span>' : ''}</td>
      <td class="num">${money(r.inversion)}</td>
      <td class="rate"><div class="num">${money(cpl)}</div><div class="mini"><i style="--w:${maxCpl ? (cpl / maxCpl) * 100 : 0}%; --c:var(--f-recibidos)"></i></div></td>
      <td class="num">${money(per(r, 'cotizados'))}</td>
      <td class="num"><b>${r.cerrados ? money(per(r, 'cerrados')) : 'sin cierres'}</b></td>
      <td class="num">${r.ingresos ? money(r.ingresos) : '—'}</td>
      <td>${roas == null ? '—' : `<span class="conv ${roas >= 1 ? 'good' : 'bad'}" data-tip="${esc(`Por cada $1 invertido regresaron $${roas.toFixed(2)}`)}">${roas.toFixed(1)}x</span>`}</td>
    </tr>`;
  }).join('')}</tbody></table></div>
  <p class="muted small-note">Retorno = ventas ÷ inversión: 3x significa que por cada peso invertido se vendieron tres. Las ventas se toman del monto capturado al marcar un lead como vendido.</p>
  ${periodNote}`;
}

// Barra tipo "batería": segmentos proporcionales con 2px de separación.
function battery(parts, total, big = false) {
  const segs = parts.filter((p) => p.n > 0).map((p) => {
    const w = total ? (p.n / total) * 100 : 0;
    const txt = big && w >= 7 ? `${Math.round(w)}%` : '';
    return `<div class="seg ${p.dark ? 'dark-text' : ''}" style="--w:${w}%; --c:${p.color}"
      data-tip="${esc(`${p.label}\n${p.n} leads · ${Math.round(w)}%`)}">${txt}</div>`;
  }).join('');
  return `<div class="battery ${big ? '' : 'thin'}" role="img" aria-label="${esc(parts.map((p) => `${p.label}: ${p.n}`).join(', '))}">${segs}</div>`;
}

function legend(parts, total) {
  return `<div class="legend">${parts.map((p) => `<span style="--c:${p.color}"><i></i>${esc(p.label)} <b>${p.n}</b>
    <span class="muted">${total ? Math.round((p.n / total) * 100) : 0}%</span></span>`).join('')}</div>`;
}

// Filas de batería por producto / vendedor, cada una repartida por etapa.
function stageRows(rows) {
  const groups = new Map();
  rows.forEach((r) => {
    const g = groups.get(r.key) || { key: r.key, total: 0, counts: {} };
    g.counts[r.status] = r.n; g.total += r.n; groups.set(r.key, g);
  });
  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  if (!list.length) return '<p class="muted">Sin datos</p>';
  const stageParts = (g) => state.meta.statuses.map((k) => ({ key: k, n: g.counts[k] || 0, label: `${g.key} · ${label(k)}`, color: `var(--${k})`, dark: DARK_TEXT.has(k) }));
  return `<div class="brows">${list.map((g) => `<div class="brow"><span class="k" title="${esc(g.key)}">${esc(g.key)}</span>
    ${battery(stageParts(g), g.total)}<span class="n">${g.total}</span></div>`).join('')}</div>
    <div class="legend">${state.meta.statuses.map((k) => `<span style="--c:var(--${k})"><i></i>${esc(label(k))}</span>`).join('')}</div>`;
}

// Barras horizontales por categoría; el color sigue al elemento de la lista, no a su posición.
function categoryBars(rows) {
  if (!rows.length) return '<p class="muted">Sin datos</p>';
  const colorOf = (key) => {
    const idx = state.catalog.canal.findIndex((c) => c.name === key);
    return idx >= 0 && idx < CAT.length ? CAT[idx] : 'var(--empty)';
  };
  const max = Math.max(...rows.map((r) => r.n));
  return `<div class="brows">${rows.map((r) => `<div class="brow"><span class="k" title="${esc(r.key)}">${esc(r.key)}</span>
    <div class="battery thin" style="background:transparent"><div class="seg" style="--w:${(r.n / max) * 100}%; --c:${colorOf(r.key)}; border-radius:4px"
      data-tip="${esc(`${r.key}\n${r.n} leads · ${r.cumple} cumplen perfil · ${r.vendidos} vendidos`)}"></div></div>
    <span class="n">${r.n}</span></div>`).join('')}</div>`;
}

function donut(parts, total) {
  const r = 58; const C = 2 * Math.PI * r; const gap = total > 0 && parts.filter((p) => p.n).length > 1 ? 3 : 0;
  let offset = 0;
  const segs = parts.filter((p) => p.n > 0).map((p) => {
    const len = (p.n / total) * C;
    const seg = `<circle class="seg" r="${r}" cx="75" cy="75" style="stroke:${p.color}" stroke-dasharray="0 ${C}"
      data-dash="${Math.max(len - gap, 0.5)} ${C}" stroke-dashoffset="${-offset}" transform="rotate(-90 75 75)"
      data-tip="${esc(`${p.label}\n${p.n} leads · ${Math.round((p.n / total) * 100)}%`)}"></circle>`;
    offset += len;
    return seg;
  }).join('');
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 150 150" role="img" aria-label="${esc(parts.map((p) => `${p.label}: ${p.n}`).join(', '))}">
    <circle r="${r}" cx="75" cy="75" fill="none" stroke="#eef0f5" stroke-width="18"></circle>${segs}
    <text x="75" y="72" text-anchor="middle" font-size="26" font-weight="600">${total}</text>
    <text x="75" y="92" text-anchor="middle" font-size="11" style="fill:var(--muted)">leads</text></svg>
    ${legend(parts, total)}</div>`;
}

function areaChart(byDay) {
  const days = [];
  const counts = Object.fromEntries(byDay.map((d) => [d.day, d.n]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10);
    days.push({ day: d, n: counts[d] || 0 });
  }
  const W = 600; const H = 170; const L = 28; const B = 22; const T = 8;
  const max = Math.max(4, ...days.map((d) => d.n));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const x = (i) => L + (i / (days.length - 1)) * (W - L - 6);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d.n).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;
  const fill = `${line} L${x(days.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const grid = [0, 1, 2, 3, 4].map((k) => `<line x1="${L}" x2="${W}" y1="${y(k * step)}" y2="${y(k * step)}"></line>
    <text x="${L - 6}" y="${y(k * step) + 4}" text-anchor="end">${k * step}</text>`).join('');
  const xl = [0, 10, 20, 29].map((i) => `<text class="xlab" x="${x(i)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === 29 ? 'end' : 'middle'}">${fmt(days[i].day)}</text>`).join('');
  const len = days.reduce((t, d, i) => (i ? t + Math.hypot(x(i) - x(i - 1), y(d.n) - y(days[i - 1].n)) : 0), 0);
  setTimeout(() => wireArea(days, x, y, fmt), 0);
  return `<div class="area"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Leads por día en los últimos 30 días">
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6161ff" stop-opacity=".28"></stop>
      <stop offset="1" stop-color="#6161ff" stop-opacity="0"></stop></linearGradient></defs>
    <g class="grid">${grid}</g>${xl}
    <path class="fill" d="${fill}"></path><path class="line" d="${line}" style="--len:${Math.ceil(len)}"></path>
    <line class="cross hidden" y1="${T}" y2="${H - B}"></line><circle class="pt hidden" r="5"></circle>
    <rect class="hit" x="${L}" y="0" width="${W - L}" height="${H}" fill="transparent"></rect></svg></div>`;
}

function wireArea(days, x, y, fmt) {
  const svg = $('#view-stats .area svg');
  if (!svg) return;
  const hit = $('.hit', svg); const cross = $('.cross', svg); const pt = $('.pt', svg);
  hit.addEventListener('mousemove', (e) => {
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * 600;
    let i = 0; let best = Infinity;
    days.forEach((d, k) => { const dist = Math.abs(x(k) - vx); if (dist < best) { best = dist; i = k; } });
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.classList.remove('hidden');
    pt.setAttribute('cx', x(i)); pt.setAttribute('cy', y(days[i].n)); pt.classList.remove('hidden');
    hit.dataset.tip = `${fmt(days[i].day)}\n${days[i].n} ${days[i].n === 1 ? 'lead' : 'leads'}`;
  });
  hit.addEventListener('mouseleave', () => { cross.classList.add('hidden'); pt.classList.add('hidden'); });
}

// Arranca animaciones: barras que crecen, dona que se dibuja, números que cuentan.
function animateIn(root) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.classList.add('ready');
    root.querySelectorAll('circle.seg[data-dash]').forEach((c) => c.setAttribute('stroke-dasharray', c.dataset.dash));
  }));
  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    if (reduce || !target) { el.textContent = target; return; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      el.textContent = Math.round(target * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Tooltip único para todo lo que tenga data-tip.
document.addEventListener('mousemove', (e) => {
  const tip = $('#tip');
  const el = e.target.closest?.('[data-tip]');
  if (!el) { tip.classList.add('hidden'); return; }
  tip.textContent = el.dataset.tip;
  tip.classList.remove('hidden');
  const pad = 14;
  const left = Math.min(e.clientX + pad, window.innerWidth - tip.offsetWidth - 8);
  const topPos = e.clientY - tip.offsetHeight - pad < 0 ? e.clientY + pad : e.clientY - tip.offsetHeight - pad;
  tip.style.left = `${left}px`; tip.style.top = `${topPos}px`;
});

// ---------- Detalle de lead ----------
function openDrawer(html) {
  $('#drawer-body').innerHTML = html;
  $('#drawer').classList.remove('hidden');
}
function closeDrawer() { $('#drawer').classList.add('hidden'); }
$('#drawer').addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeDrawer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

// Pasos del embudo en la ficha del lead, con la fecha en que se alcanzó cada uno.
function milestones(l) {
  // Igual que el embudo: llegar a un paso cuenta los anteriores; la fecha es la propia de cada paso si se registró.
  const reached = [true, !!(l.contacted_at || l.profiled_at || l.quoted_at || l.won_at),
    !!(l.profiled_at || l.quoted_at || l.won_at), !!(l.quoted_at || l.won_at), !!l.won_at];
  const dates = [l.created_at, l.contacted_at, l.profiled_at, l.quoted_at, l.won_at];
  const steps = [['recibidos', 'Recibido'], ['contactados', 'Contestó'], ['perfilados', 'Perfilado'], ['cotizados', 'Cotizado'], ['cerrados', 'Cerrado']]
    .map(([k, name], i) => [k, name, reached[i] && (dates[i] || true)]);
  const canMark = l.can_edit && !l.quoted_at && !l.won_at;
  return `<div class="tracker">${steps.map(([k, name, at]) => `<div class="t-step ${at ? 'done' : ''}" style="--c:var(--f-${k})">
      <span class="t-dot">${at ? '✓' : ''}</span><span class="t-name">${name}</span>
      <span class="t-date">${at && typeof at === 'string' ? new Date(at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : ''}</span></div>`).join('')}
    </div>
    ${canMark ? `<button type="button" class="${l.contacted_at ? 'ghost small' : 'contact-btn'}" id="contacted">
      ${l.contacted_at ? 'Desmarcar "contestó"' : '✓ El cliente ya contestó'}</button>` : ''}`;
}

async function openLead(id) {
  const l = await api(`/api/leads/${id}`);
  const ro = l.can_edit ? '' : 'disabled';
  const sellers = state.users.filter((u) => u.active && ['vendedor', 'gerente', 'marketing'].includes(u.role));
  const waLink = l.phone ? `https://wa.me/${l.phone.replace(/\D/g, '')}` : null;

  openDrawer(`
    <button class="ghost" data-close style="float:right">Cerrar</button>
    <h2>${esc(l.name || l.phone || l.email)}</h2>
    <p class="muted">Recibido ${fmtDate(l.created_at)} por <span class="tag ${l.source}">${esc(label(l.source))}</span>
      ${waLink ? `· <a href="${waLink}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : ''}</p>
    ${milestones(l)}
    ${l.message ? `<p class="card">${esc(l.message)}</p>` : ''}

    <form id="lead-form">
      <div class="row">
        <label>Estado <select name="status" class="status-select ${textClass(l.status)}" style="${colorVar(l.status)}" ${ro}>${state.meta.statuses.map((s) => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></label>
        <label>Perfil <select name="profile" ${ro}>${state.meta.profiles.map((p) => `<option value="${p}" ${p === l.profile ? 'selected' : ''}>${esc(label(p))}</option>`).join('')}</select></label>
      </div>
      <label class="${l.status === 'vendido' ? '' : 'hidden'}" id="sale-wrap">Monto de venta (MXN)
        <input name="sale_amount" inputmode="decimal" value="${l.sale_amount ?? ''}" placeholder="Ej. 45000" ${ro}></label>
      <label class="${l.status === 'declinado' ? '' : 'hidden'}" id="decline-wrap">Motivo declinado <input name="decline_reason" value="${esc(l.decline_reason)}" ${ro}></label>
      <label>Vendedor
        <select name="assigned_to" ${can('gerente', 'marketing') ? '' : 'disabled'}>
          <option value="">Sin asignar</option>
          ${sellers.map((u) => `<option value="${u.id}" ${u.id === l.assigned_to ? 'selected' : ''}>${esc(u.name)} (${u.role})</option>`).join('')}
        </select>
      </label>
      <div class="row">
        <label>Nombre <input name="name" value="${esc(l.name)}" ${ro}></label>
        <label>Teléfono <input name="phone" value="${esc(l.phone)}" ${ro}></label>
      </div>
      <div class="row">
        <label>Email <input name="email" value="${esc(l.email)}" ${ro}></label>
        <label>Campaña <select name="campaign" ${ro}>${campaignOptions(l.campaign, 'Sin campaña')}</select></label>
      </div>
      <div class="row">
        <label>Producto <select name="product_id" ${ro}>${catalogOptions('producto', l.product_id, 'Sin producto')}</select></label>
        <label>¿Cómo se enteró? <select name="channel_id" ${ro}>${catalogOptions('canal', l.channel_id, 'Sin dato')}</select></label>
      </div>
      <p class="error" id="lead-error"></p>
      <div class="actions">
        ${l.can_edit ? '<button type="submit">Guardar</button>' : ''}
        ${state.me.role === 'vendedor' && !l.assigned_to ? '<button type="button" id="take">Tomar este lead</button>' : ''}
        ${can('gerente') ? '<button type="button" class="danger" id="delete">Eliminar</button>' : ''}
      </div>
    </form>

    <h3>Historial</h3>
    ${l.can_edit ? `<form id="note-form"><textarea name="content" placeholder="Agregar nota (llamada, cotización enviada, etc.)"></textarea>
      <div class="actions"><button type="submit">Agregar nota</button></div></form>` : ''}
    <ul class="events">${l.events.map((e) => `<li class="${e.type}">${esc(e.content)}
      <small>${e.user_name ? esc(e.user_name) + ' · ' : ''}${fmtDate(e.created_at)}</small></li>`).join('')}</ul>
  `);

  $('#contacted')?.addEventListener('click', async () => {
    try {
      await api(`/api/leads/${l.id}`, { method: 'PATCH', body: { contacted: !l.contacted_at } });
      if (!l.contacted_at) toast('Marcado: el cliente contestó', 'ok');
      openLead(l.id); refresh();
    } catch (err) { toast(err.message, 'error'); }
  });
  const form = $('#lead-form');
  form.status.addEventListener('change', () => {
    $('#decline-wrap').classList.toggle('hidden', form.status.value !== 'declinado');
    $('#sale-wrap').classList.toggle('hidden', form.status.value !== 'vendido');
    form.status.setAttribute('style', colorVar(form.status.value));
    form.status.classList.toggle('dark-text', DARK_TEXT.has(form.status.value));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(['status', 'profile', 'decline_reason', 'sale_amount', 'name', 'phone', 'email', 'campaign', 'product_id', 'channel_id'].map((k) => [k, form[k].value]));
    if (can('gerente', 'marketing')) body.assigned_to = form.assigned_to.value || null;
    try {
      await api(`/api/leads/${l.id}`, { method: 'PATCH', body });
      openLead(l.id);
      refresh();
    } catch (err) { $('#lead-error').textContent = err.message; }
  });
  $('#take')?.addEventListener('click', async () => {
    try { await api(`/api/leads/${l.id}/take`, { method: 'POST' }); openLead(l.id); refresh(); } catch (err) { toast(err.message, 'error'); }
  });
  $('#delete')?.addEventListener('click', async () => {
    if (!await ask('¿Eliminar este lead y su historial? No se puede deshacer.', { okLabel: 'Eliminar', danger: true })) return;
    await api(`/api/leads/${l.id}`, { method: 'DELETE' });
    closeDrawer(); refresh();
  });
  $('#note-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = e.target.content.value.trim();
    if (!content) return;
    await api(`/api/leads/${l.id}/notes`, { method: 'POST', body: { content } });
    openLead(l.id);
  });
}

function openNewLead() {
  openDrawer(`
    <button class="ghost" data-close style="float:right">Cerrar</button>
    <h2>Nuevo lead</h2>
    <form id="new-form">
      <label>¿Por dónde llegó?
        <select name="source">${state.meta.manualSources.map((s) => `<option value="${s}">${esc(label(s))}</option>`).join('')}</select>
      </label>
      <label>Teléfono <input name="phone" inputmode="tel" autofocus></label>
      <label>Nombre <input name="name"></label>
      <label>Email <input name="email" type="email"></label>
      <label>Producto de interés <select name="product_id">${catalogOptions('producto', null, 'Sin definir')}</select></label>
      <label>¿Cómo se enteró de nosotros? <select name="channel_id">${catalogOptions('canal', null, 'Sin dato')}</select></label>
      <label>Campaña <select name="campaign">${campaignOptions(null, 'Sin campaña')}</select></label>
      <label>Mensaje / comentario <textarea name="message"></textarea></label>
      <p class="error" id="new-error"></p>
      <button type="submit">Crear</button>
    </form>`);
  $('#new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const { id, existing } = await api('/api/leads', { method: 'POST', body });
      refresh();
      await openLead(id);
      if (existing) {
        $('#drawer-body h2').insertAdjacentHTML('afterend',
          '<p class="warn">Este contacto ya estaba registrado. Se agregó el nuevo contacto a su historial.</p>');
      }
    } catch (err) { $('#new-error').textContent = err.message; }
  });
}

// ---------- Usuarios ----------
async function renderUsers() {
  state.users = await api('/api/users');
  const roleOpts = (sel) => state.meta.roles.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${r}</option>`).join('');
  $('#view-users').innerHTML = `
    <div class="card" style="margin: 12px 0">
      <h3 style="margin-top:0">Agregar usuario</h3>
      <form id="user-form" class="row" style="flex-wrap:wrap; align-items:end">
        <label>Nombre <input name="name" required></label>
        <label>Email <input name="email" type="email" required></label>
        <label>Contraseña <input name="password" type="text" minlength="8" required></label>
        <label>Rol <select name="role">${roleOpts('vendedor')}</select></label>
        <button type="submit" style="flex:0">Crear</button>
      </form>
      <p class="error" id="user-error"></p>
      <p class="muted">Gerente: todo, incluidos usuarios. Marketing: ve y edita todos los leads y asigna. Vendedor: ve sus leads y los sin asignar, puede tomarlos. Analista: solo lectura y reportes.</p>
    </div>
    <table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Activo</th><th></th></tr></thead><tbody>
    ${state.users.map((u) => `<tr data-id="${u.id}">
      <td>${esc(u.name)}</td><td>${esc(u.email)}</td>
      <td><select data-f="role">${roleOpts(u.role)}</select></td>
      <td><input type="checkbox" data-f="active" ${u.active ? 'checked' : ''}></td>
      <td><button class="ghost" data-f="password">Cambiar contraseña</button></td>
    </tr>`).join('')}
    </tbody></table>`;

  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      state.users = await api('/api/users'); fillFilters(); renderUsers();
    } catch (err) { $('#user-error').textContent = err.message; }
  });
  $('#view-users').querySelectorAll('tbody tr').forEach((tr) => {
    const patch = async (body) => {
      try { await api(`/api/users/${tr.dataset.id}`, { method: 'PATCH', body }); } catch (err) { toast(err.message, 'error'); }
      renderUsers();
    };
    $('[data-f=role]', tr).addEventListener('change', (e) => patch({ role: e.target.value }));
    $('[data-f=active]', tr).addEventListener('change', (e) => patch({ active: e.target.checked }));
    $('[data-f=password]', tr).addEventListener('click', async () => {
      const password = await ask('Nueva contraseña (mínimo 8 caracteres):', { input: true, okLabel: 'Cambiar' });
      if (password) patch({ password });
    });
  });
}

// ---------- Primer uso ----------
$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    state.me = await api('/api/setup', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    $('#setup').classList.add('hidden');
    state.view = 'settings';
    start();
  } catch (err) { $('#setup-error').textContent = err.message; }
});

// ---------- Configuración ----------
function copyField(value, multiline = false) {
  const field = multiline
    ? `<textarea readonly rows="9">${esc(value)}</textarea>`
    : `<input readonly value="${esc(value)}">`;
  return `<div class="copy">${field}<button type="button" class="ghost" data-copy>Copiar</button></div>`;
}

async function renderSettings() {
  const s = await api('/api/settings');
  const htmlAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const selectFor = (kind, name, first) => {
    const items = state.catalog[kind].filter((i) => i.active);
    if (!items.length) return '';
    return `\n  <select name="${name}">\n    <option value="">${first}</option>\n`
      + items.map((i) => `    <option value="${htmlAttr(i.name)}">${htmlAttr(i.name)}</option>`).join('\n')
      + '\n  </select>';
  };
  const snippet = `<form action="${s.form_url}" method="post">
  <input type="hidden" name="key" value="${s.form_api_key}">
  <input type="hidden" name="campana" value="sitio-web">
  <input type="hidden" name="redirect" value="https://TU-SITIO/gracias">
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <input name="nombre" placeholder="Nombre" required>
  <input name="telefono" placeholder="Teléfono" required>
  <input name="email" type="email" placeholder="Email">${selectFor('producto', 'producto', '¿Qué te interesa?')}${selectFor('canal', 'canal', '¿Cómo te enteraste de nosotros?')}
  <textarea name="mensaje" placeholder="¿En qué te podemos ayudar?"></textarea>
  <button>Enviar</button>
</form>`;

  $('#view-settings').innerHTML = `<div class="settings">
    ${campaignEditor()}
    <div class="lists">
      ${listEditor('producto', 'Productos', 'Lo que vendes. Se elige en cada lead como producto de interés.', 'Ej. Espectacular, Pantalla LED')}
      ${listEditor('canal', 'Canales de percepción', 'Cómo se enteró el cliente de ustedes.', 'Ej. Radio, Evento, TikTok')}
    </div>
    <div class="card">
      <h3>Formulario de tu página web</h3>
      <p>Pásale esto a quien administra tu página web. Cada vez que alguien llene el formulario, el lead aparece aquí solo.</p>
      <label>Dirección a donde se envía el formulario</label>${copyField(s.form_url)}
      <label>Clave del formulario</label>${copyField(s.form_api_key)}
      <label>Ejemplo de formulario listo para pegar en la página</label>${copyField(snippet, true)}
      <p class="muted">Para anuncios de Facebook/Instagram (formularios de Meta) o Google Ads se conecta con Zapier o Make usando la misma dirección y clave.</p>
      <button type="button" class="ghost" id="regen">Cambiar la clave (si llega spam)</button>
    </div>

  </div>`;

  $('#view-settings').querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const field = b.previousElementSibling;
    field.select();
    try { await navigator.clipboard.writeText(field.value); } catch { document.execCommand('copy'); }
    b.textContent = 'Copiado';
    setTimeout(() => { b.textContent = 'Copiar'; }, 1500);
  }));
  $('#view-settings').querySelectorAll('.list-form').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = f.elements.name.value.trim();
    if (!name) return;
    try {
      await api('/api/catalog', { method: 'POST', body: { kind: f.dataset.kind, name } });
      await reloadCatalog();
      toast(`"${name}" agregado`, 'ok');
    } catch (err) { toast(err.message, 'error'); }
  }));
  $('#view-settings').querySelectorAll('[data-item]').forEach((row) => {
    const id = row.dataset.item;
    $('[data-rename]', row).addEventListener('click', async () => {
      const name = await ask('Nuevo nombre:', { input: true, okLabel: 'Guardar' });
      if (!name) return;
      try { await api(`/api/catalog/${id}`, { method: 'PATCH', body: { name } }); await reloadCatalog(); } catch (err) { toast(err.message, 'error'); }
    });
    $('[data-toggle]', row).addEventListener('click', async () => {
      const active = row.dataset.active !== '1';
      await api(`/api/catalog/${id}`, { method: 'PATCH', body: { active } });
      await reloadCatalog();
    });
  });
  $('#campaign-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.elements.name.value.trim();
    if (!name) return;
    try {
      await api('/api/catalog', { method: 'POST', body: { kind: 'campana', name, budget: f.elements.budget.value } });
      await reloadCatalog();
      toast(`Campaña "${name}" agregada`, 'ok');
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#view-settings').querySelectorAll('[data-budget]').forEach((b) => b.addEventListener('click', async () => {
    const value = await ask('Inversión total de la campaña (MXN). Déjalo vacío para quitarla.', { input: true, placeholder: 'Ej. 15000', okLabel: 'Guardar' });
    if (value === null) return;
    try { await api(`/api/catalog/${b.dataset.budget}`, { method: 'PATCH', body: { budget: value } }); await reloadCatalog(); } catch (err) { toast(err.message, 'error'); }
  }));
  $('#regen').addEventListener('click', async () => {
    if (!await ask('El formulario de tu página dejará de funcionar hasta que se actualice con la nueva clave. ¿Continuar?', { okLabel: 'Cambiar clave', danger: true })) return;
    await api('/api/settings', { method: 'PATCH', body: { regenerate_form_key: true } });
    renderSettings();
  });
}

function campaignEditor() {
  const items = state.catalog.campana;
  return `<div class="card">
    <h3>Campañas</h3>
    <p class="muted">Las que el vendedor puede elegir en cada lead. Con la inversión, el Resumen calcula cuánto cuesta cada lead, cada cotización y cada cierre.
      Si llega una campaña nueva desde un formulario o anuncio, se agrega sola aquí.</p>
    <form id="campaign-form" class="list-form">
      <input name="name" placeholder="Ej. FB Espectaculares Octubre" aria-label="Nombre de la campaña" maxlength="120">
      <input name="budget" inputmode="decimal" placeholder="Inversión (MXN)" aria-label="Inversión" style="max-width:170px">
      <button type="submit">Agregar</button>
    </form>
    <ul class="items">
      ${items.map((i) => `<li data-item="${i.id}" data-active="${i.active}" class="${i.active ? '' : 'inactive'}">
        <span>${esc(i.name)}${i.active ? '' : ' <small>(quitada)</small>'}</span>
        <span class="budget ${i.budget == null ? 'missing' : ''}">${i.budget == null ? 'Sin inversión' : money(i.budget)}</span>
        <button type="button" class="ghost small" data-budget="${i.id}">Inversión</button>
        <button type="button" class="ghost small" data-rename>Renombrar</button>
        <button type="button" class="ghost small" data-toggle>${i.active ? 'Quitar' : 'Volver a usar'}</button>
      </li>`).join('') || '<li class="muted">Todavía no hay campañas. Agrega la primera arriba.</li>'}
    </ul>
  </div>`;
}

function listEditor(kind, title, help, placeholder) {
  const items = state.catalog[kind];
  return `<div class="card">
    <h3>${esc(title)}</h3>
    <p class="muted">${esc(help)}</p>
    <form class="list-form" data-kind="${kind}">
      <input name="name" placeholder="${esc(placeholder)}" aria-label="Agregar a ${esc(title)}" maxlength="120">
      <button type="submit">Agregar</button>
    </form>
    <ul class="items">
      ${items.map((i) => `<li data-item="${i.id}" data-active="${i.active}" class="${i.active ? '' : 'inactive'}">
        <span>${esc(i.name)}${i.active ? '' : ' <small>(quitado)</small>'}</span>
        <button type="button" class="ghost small" data-rename>Renombrar</button>
        <button type="button" class="ghost small" data-toggle>${i.active ? 'Quitar' : 'Volver a usar'}</button>
      </li>`).join('') || '<li class="muted">Todavía no hay nada. Agrega el primero arriba.</li>'}
    </ul>
    ${items.some((i) => !i.active) ? '<p class="muted">Lo quitado ya no aparece para elegir, pero los leads que lo tenían lo conservan.</p>' : ''}
  </div>`;
}

async function reloadCatalog() {
  state.catalog = await api('/api/catalog');
  fillFilters();
  renderSettings();
}

// ---------- Arranque ----------
(async () => {
  state.meta = await api('/api/meta');
  if ((await api('/api/setup')).needed) {
    $('#setup').classList.remove('hidden');
    return;
  }
  try {
    state.me = await api('/api/me');
    start();
  } catch {
    showLogin();
  }
  // Los leads nuevos aparecen solos: se recarga cada 30 s si no hay un detalle abierto.
  setInterval(() => {
    if ($('#drawer').classList.contains('hidden') && !['users', 'settings'].includes(state.view)) refresh();
  }, 30000);
})();
