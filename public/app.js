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
  add('product', '#f-product'); add('channel', '#f-channel');
  if (state.view !== 'board') add('status', '#f-status');
  return p.toString();
}

// ---------- Vistas ----------
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
['#f-profile', '#f-source', '#f-product', '#f-channel', '#f-assigned', '#f-status'].forEach((s) => $(s).addEventListener('change', refresh));
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
  const sold = n(s.byStatus, 'vendido');
  const fit = n(s.byProfile, 'cumple');
  const quoting = n(s.byStatus, 'cotizando');
  const stages = state.meta.statuses.map((k) => ({ key: k, n: n(s.byStatus, k), label: label(k), color: `var(--${k})`, dark: DARK_TEXT.has(k) }));
  const profiles = state.meta.profiles.map((k) => ({ key: k, n: n(s.byProfile, k), label: label(k), color: `var(--${k})` }));
  const sources = state.meta.sources.map((k) => ({ key: k, n: n(s.bySource, k), label: label(k), color: `var(--${k})` }));

  const kpi = (title, value, sub, color) => `<div class="kpi-tile" style="--c:${color}">
    <div class="label"><span class="dot"></span>${esc(title)}</div>
    <div class="value" data-count="${value}">0</div><div class="sub">${esc(sub)}</div></div>`;

  $('#view-stats').innerHTML = `<div class="dash">
    <div class="kpis">
      ${kpi('Leads', s.total, 'con los filtros actuales', 'var(--accent)')}
      ${kpi('Cumplen perfil', fit, `${pct(fit, s.total)}% del total`, 'var(--nuevo_perfil)')}
      ${kpi('Cotizando', quoting, `${pct(quoting, s.total)}% del total`, 'var(--cotizando)')}
      ${kpi('Vendidos', sold, `${pct(sold, fit)}% de los que cumplen perfil`, 'var(--vendido)')}
    </div>
    <div class="card chart-card"><h3>Embudo <small>cómo se reparten los leads por etapa</small></h3>
      ${battery(stages, s.total, true)}${legend(stages, s.total)}</div>
    <div class="card chart-card span-8"><h3>Leads recibidos <small>últimos 30 días</small></h3>${areaChart(s.byDay)}</div>
    <div class="card chart-card span-4"><h3>Por origen</h3>${donut(sources, s.total)}</div>
    <div class="card chart-card span-6"><h3>Por producto <small>etapa de cada lead</small></h3>${stageRows(s.productStages)}</div>
    <div class="card chart-card span-6"><h3>Por vendedor <small>etapa de cada lead</small></h3>${stageRows(s.sellerStages)}</div>
    <div class="card chart-card span-6"><h3>¿Cómo se enteraron? <small>canal de percepción</small></h3>${categoryBars(s.byChannel)}</div>
    <div class="card chart-card span-6"><h3>Perfil</h3>${battery(profiles, s.total, true)}${legend(profiles, s.total)}</div>
    <div class="card chart-card"><h3>Por campaña</h3><div class="table-wrap">
      <table><thead><tr><th>Campaña</th><th>Leads</th><th>Cumplen perfil</th><th>Vendidos</th></tr></thead><tbody>
      ${s.byCampaign.map((r) => `<tr><td>${esc(r.key)}</td><td class="num">${r.n}</td><td class="num">${r.cumple}</td><td class="num">${r.vendidos}</td></tr>`).join('')}
      </tbody></table></div></div>
  </div>`;
  animateIn($('#view-stats'));
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
    ${l.message ? `<p class="card">${esc(l.message)}</p>` : ''}

    <form id="lead-form">
      <div class="row">
        <label>Estado <select name="status" class="status-select ${textClass(l.status)}" style="${colorVar(l.status)}" ${ro}>${state.meta.statuses.map((s) => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></label>
        <label>Perfil <select name="profile" ${ro}>${state.meta.profiles.map((p) => `<option value="${p}" ${p === l.profile ? 'selected' : ''}>${esc(label(p))}</option>`).join('')}</select></label>
      </div>
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
        <label>Campaña <input name="campaign" value="${esc(l.campaign)}" ${ro}></label>
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

  const form = $('#lead-form');
  form.status.addEventListener('change', () => {
    $('#decline-wrap').classList.toggle('hidden', form.status.value !== 'declinado');
    form.status.setAttribute('style', colorVar(form.status.value));
    form.status.classList.toggle('dark-text', DARK_TEXT.has(form.status.value));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(['status', 'profile', 'decline_reason', 'name', 'phone', 'email', 'campaign', 'product_id', 'channel_id'].map((k) => [k, form[k].value]));
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
      <label>Campaña <input name="campaign"></label>
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
  $('#regen').addEventListener('click', async () => {
    if (!await ask('El formulario de tu página dejará de funcionar hasta que se actualice con la nueva clave. ¿Continuar?', { okLabel: 'Cambiar clave', danger: true })) return;
    await api('/api/settings', { method: 'PATCH', body: { regenerate_form_key: true } });
    renderSettings();
  });
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
