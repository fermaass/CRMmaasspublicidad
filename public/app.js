const state = { me: null, meta: null, users: [], catalog: { canal: [], producto: [], campana: [] }, leads: [], view: null, statsTab: null };
const F = window.CRMFollowup;
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
// Íconos de línea (estilo Lucide), en el color del texto que los rodea.
const ICONS = {
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  money: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  funnel: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5"/>',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
};
const icon = (name, size = 20) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
// Título de tarjeta con su cuadrito de color, como en el panel de referencia.
const cardTitle = (ico, color, title, sub = '') => `<div class="card-title"><span class="ico-badge" style="--c:${color}">${icon(ico, 18)}</span>
  <h3>${esc(title)}${sub ? ` <small>${esc(sub)}</small>` : ''}</h3></div>`;
const ROLE_NAMES = { gerente: 'Gerente', marketing: 'Marketing', vendedor: 'Vendedor', analista: 'Analista' };
const VIEW_TITLES = { today: 'Mi día', board: 'Tablero', list: 'Lista de leads', stats: 'Resumen', users: 'Usuarios', settings: 'Configuración' };
const shortDate = (d) => new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
// Guardar preferencias del navegador (pestaña del Resumen, filtros abiertos) sin fallar si no hay almacenamiento.
const pref = {
  get(k) { try { return localStorage.getItem(`crm:${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`crm:${k}`, v); } catch { /* sin almacenamiento */ } },
};
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
// Con `options` muestra una lista para elegir y devuelve la opción elegida.
function ask(message, { input = false, inputType = 'text', placeholder = '', okLabel = 'Aceptar', danger = false, options = null } = {}) {
  return new Promise((resolve) => {
    const modal = $('#modal');
    $('#modal-text').textContent = message;
    const select = $('#modal-select');
    select.classList.toggle('hidden', !options);
    select.innerHTML = (options || []).map((o) => `<option>${esc(o)}</option>`).join('');
    const field = $('#modal-input');
    field.classList.toggle('hidden', !input);
    field.value = '';
    field.type = inputType;
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
    ok.onclick = () => close(options ? select.value : input ? field.value.trim() : true);
    $('#modal-cancel').onclick = () => close(input || options ? null : false);
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
  $('#me').innerHTML = `<span class="avatar big" aria-hidden="true">${esc(initials(state.me.name))}</span>${esc(state.me.name)}`;
  document.querySelectorAll('[data-role]').forEach((el) => {
    el.classList.toggle('hidden', !el.dataset.role.split(',').includes(state.me.role));
  });
  $('#f-assigned').classList.toggle('hidden', state.me.role === 'vendedor');
  [state.users, state.catalog] = await Promise.all([api('/api/users'), api('/api/catalog')]);
  fillFilters();
  // El vendedor arranca en su lista de pendientes; el analista, en el Resumen.
  setView(state.view || (state.me.role === 'analista' ? 'stats' : 'today'));
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
  opts('#f-reason', state.meta.declineReasons.map((r) => [r, r]));
}

// "¿De dónde viene?": una sola lista con las campañas activas y los canales orgánicos.
function originOptions(campaign, channelId) {
  const camps = state.catalog.campana.filter((c) => c.active || c.name === campaign);
  const chans = state.catalog.canal.filter((c) => c.active || c.id === channelId);
  return `<option value="">Sin dato</option>
    ${camps.length ? `<optgroup label="Campañas">${camps.map((c) => `<option value="camp:${esc(c.name)}" ${c.name === campaign ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : ''}
    <optgroup label="Sin campaña (orgánico)">${chans.map((c) => `<option value="chan:${c.id}" ${!campaign && c.id === channelId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
}
// Convierte la opción elegida en campaña o canal para guardar.
function originToFields(value) {
  if (value?.startsWith('camp:')) return { campaign: value.slice(5), channel_id: null };
  if (value?.startsWith('chan:')) return { campaign: null, channel_id: value.slice(5) };
  return { campaign: null, channel_id: null };
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
  add('product', '#f-product'); add('channel', '#f-channel'); add('campaign', '#f-campaign'); add('reason', '#f-reason');
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

const EXTRA_FILTERS = ['#f-status', '#f-profile', '#f-source', '#f-product', '#f-channel', '#f-reason'];
function updateMoreFiltersLabel() {
  const n = EXTRA_FILTERS.filter((sel) => $(sel).value && !$(sel).classList.contains('hidden')).length;
  $('#more-filters').textContent = n ? `Más filtros (${n})` : 'Más filtros';
  $('#more-filters').classList.toggle('active-filters', n > 0);
}
$('#more-filters').addEventListener('click', () => {
  const box = $('#extra-filters');
  box.classList.toggle('hidden');
  $('#more-filters').setAttribute('aria-expanded', String(!box.classList.contains('hidden')));
});
$('#clear-filters').addEventListener('click', () => {
  ['#f-q', '#f-period', '#f-assigned', '#f-campaign', ...EXTRA_FILTERS].forEach((sel) => { $(sel).value = ''; });
  updateMoreFiltersLabel(); refresh();
});
// Aplica un conjunto de filtros (audiencias listas) y abre la lista.
function applyFilters(values) {
  ['#f-q', '#f-period', '#f-assigned', '#f-campaign', ...EXTRA_FILTERS].forEach((sel) => { $(sel).value = ''; });
  Object.entries(values).forEach(([sel, v]) => { $(sel).value = v; });
  $('#extra-filters').classList.remove('hidden');
  updateMoreFiltersLabel();
  setView('list');
}

// ---------- Vistas ----------
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
['#f-profile', '#f-source', '#f-product', '#f-channel', '#f-campaign', '#f-period', '#f-assigned', '#f-status', '#f-reason']
  .forEach((s) => $(s).addEventListener('change', () => { updateMoreFiltersLabel(); refresh(); }));
let searchTimer;
$('#f-q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 300); });
$('#export').addEventListener('click', () => {
  if (window.crmExport) return window.crmExport(filterQuery());
  window.location = `/api/leads.csv?${filterQuery()}`;
});
$('#new-lead').addEventListener('click', openNewLead);

function setView(view) {
  state.view = view;
  $('#page-title').textContent = VIEW_TITLES[view] || '';
  const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#page-sub').innerHTML = `${esc(today)} · viendo como <strong>${esc(state.me.name)}</strong> (${esc(ROLE_NAMES[state.me.role] || state.me.role)})`;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  $('.toolbar').classList.toggle('hidden', ['users', 'settings', 'today'].includes(view));
  $('#f-status').classList.toggle('hidden', view === 'board');
  updateMoreFiltersLabel();
  if (!['board', 'list'].includes(view)) $('#board-alert').classList.add('hidden');
  refresh();
}

async function refresh() {
  if (!state.me) return;
  if (state.view === 'users') return renderUsers();
  if (state.view === 'settings') return renderSettings();
  if (state.view === 'stats') return renderStats();
  // Mi día no usa los filtros: un pendiente viejo no debe esconderse por el periodo elegido.
  if (state.view === 'today') { state.leads = await api('/api/leads'); return renderToday(); }
  state.leads = await api(`/api/leads?${filterQuery()}`);
  state.view === 'board' ? renderBoard() : renderList();
  renderBoardAlert();
}

// Tarjeta mínima: quién es, qué toca hacer y de quién es. El resto está en la ficha.
function cardHtml(l) {
  const owner = l.assigned_name
    ? `<span class="avatar" title="${esc(l.assigned_name)}">${esc(initials(l.assigned_name))}</span>`
    : '<span class="avatar none" title="Sin asignar">?</span>';
  return `<div class="lead-card compact" draggable="${canEditLead(l)}" data-id="${l.id}">
    <div class="card-top"><span class="name">${esc(l.name || l.phone || l.email)}</span>${owner}</div>
    <div class="card-bottom">${cardAction(l)}<span class="ago">${timeAgo(l.updated_at)}</span></div>
  </div>`;
}

// Lo único que el vendedor necesita saber de un vistazo, según la etapa.
function cardAction(l) {
  if (l.status === 'nuevo') return touchBadge(l) || '<span class="touch-badge">Sin toques</span>';
  if (l.status === 'nuevo_perfil') return touchBadge(l);
  if (l.status === 'cotizando') return touchBadge(l) || `<span class="touch-badge">${icon('file', 13)} Cotizado</span>`;
  if (l.status === 'declinado') {
    return l.recontact_at ? `<span class="touch-badge today">${icon('calendar', 13)} Volver a contactar ${shortDate(`${l.recontact_at}T12:00:00`)}</span>`
      : `<span class="touch-badge late">${esc(l.decline_reason || 'Sin motivo')}</span>`;
  }
  return `<span class="touch-badge ok">${icon('check', 13)} ${l.sale_amount ? money(l.sale_amount) : 'Vendido'}</span>`;
}

function timeAgo(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

function canEditLead(l) {
  return can('gerente', 'marketing') || (state.me.role === 'vendedor' && l.assigned_to === state.me.id);
}

// ---------- Toques, cadencia y pendientes ----------
const DAY = F.DAY;
// Siguiente acción del lead según public/followup.js, con los días que faltan (negativo = atrasado).
function nextAction(l) {
  const a = F.nextAction(l);
  return a ? { ...a, days: F.dayDiff(a.due) } : null;
}
const whenText = (days) => (days < 0 ? `${-days} ${days === -1 ? 'día' : 'días'} tarde` : days === 0 ? 'toca hoy' : days === 1 ? 'mañana' : `en ${days} días`);
const whenClass = (days) => (days < 0 ? 'late' : days === 0 ? 'today' : '');

// Línea de acción de la tarjeta: lo siguiente que toca y cuándo.
function touchBadge(l) {
  const a = nextAction(l);
  if (!a || a.kind === 'recontacto') {
    if (l.response_touch) return `<span class="touch-badge ok">${icon('chat', 13)} Respondió en el toque ${l.response_touch}</span>`;
    return l.touch_count ? `<span class="touch-badge">${l.touch_count} ${l.touch_count === 1 ? 'toque' : 'toques'}</span>` : '';
  }
  return `<span class="touch-badge ${whenClass(a.days)}">${icon(a.kind === 'cotizacion' ? 'file' : 'phone', 13)} ${esc(a.label)} · ${whenText(a.days)}</span>`;
}

// Aviso arriba del tablero con lo vencido y lo de hoy (toques, seguimientos y cotizaciones).
function renderBoardAlert() {
  const el = $('#board-alert');
  const dues = state.leads.map(nextAction).filter((a) => a && a.kind !== 'recontacto');
  const late = dues.filter((d) => d.days < 0).length;
  const today = dues.filter((d) => d.days === 0).length;
  el.classList.toggle('hidden', !(late || today) || !['board', 'list'].includes(state.view));
  el.innerHTML = `${late ? `<span class="alert-pill late">${icon('phone', 15)} ${late} ${late === 1 ? 'pendiente vencido' : 'pendientes vencidos'}</span>` : ''}
    ${today ? `<span class="alert-pill today">${icon('calendar', 15)} ${today} para hoy</span>` : ''}
    ${can('gerente', 'marketing', 'vendedor') ? '<button type="button" class="ghost small" id="go-today">Ver Mi día</button>' : ''}`;
  $('#go-today')?.addEventListener('click', () => setView('today'));
}

// ---------- Mi día: pendientes ordenados por urgencia, con el toque a un clic ----------
function renderToday() {
  const mine = (l) => (state.me.role === 'vendedor' ? l.assigned_to === state.me.id : true);
  const items = state.leads.filter(mine).map((l) => ({ l, a: nextAction(l) }))
    .filter((x) => x.a && x.a.days <= 0)
    .sort((x, y) => x.a.due - y.a.due);
  const upcoming = state.leads.filter(mine).map((l) => ({ l, a: nextAction(l) }))
    .filter((x) => x.a && x.a.days > 0 && x.a.days <= 2 && x.a.kind !== 'recontacto').length;
  const free = state.leads.filter((l) => !l.assigned_to && ['nuevo', 'nuevo_perfil', 'cotizando'].includes(l.status));
  const late = items.filter((x) => x.a.days < 0 && x.a.kind !== 'recontacto').length;
  const groups = [
    ['recontacto', 'Volver a contactar', 'Leads que pospusieron y ya llegó su fecha'],
    ['cotizacion', 'Seguimiento de cotizaciones', 'Cotizaciones enviadas que esperan respuesta'],
    ['seguimiento', 'Respondieron: siguiente paso', 'Ya contestaron; toca perfilar o enviar cotización'],
    ['cadencia', 'Toques de la cadencia', 'Aún no contestan: 5 toques en 12 días'],
  ];
  const canTouch = (l) => canEditLead(l);
  const row = ({ l, a }) => {
    const outcomes = state.meta.touches.byStatus[l.status] || [];
    return `<div class="today-row" data-id="${l.id}">
      <div class="today-main">
        <button type="button" class="link name" data-open="${l.id}">${esc(l.name || l.phone || l.email)}</button>
        <span class="touch-badge ${whenClass(a.days)}">${esc(a.label)} · ${a.kind === 'recontacto' && a.days < 0 ? `desde el ${shortDate(a.due)}` : whenText(a.days)}</span>
        ${l.quote_amount && l.status === 'cotizando' ? `<span class="muted num">${money(l.quote_amount)}</span>` : ''}
        ${state.me.role !== 'vendedor' ? `<span class="muted">${esc(l.assigned_name || 'Sin asignar')}</span>` : ''}
        ${l.phone ? `<a class="muted" href="https://wa.me/${esc(l.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(l.phone)}</a>` : ''}
      </div>
      ${!canTouch(l) ? '' : a.kind === 'recontacto'
        ? '<div class="today-actions"><button type="button" class="small" data-reactivate>Reactivar lead</button></div>'
        : `<div class="today-actions">
          <select class="small-select" data-channel aria-label="Medio">${state.meta.touches.channels.map((c) => `<option value="${c}">${esc(label(c))}</option>`).join('')}</select>
          ${outcomes.map((o) => `<button type="button" class="outcome small ${o}" data-outcome="${o}">${esc(state.meta.touches.outcomes[o])}</button>`).join('')}
        </div>`}
    </div>`;
  };
  const sections = groups.map(([kind, title, help]) => {
    const list = items.filter((x) => x.a.kind === kind);
    if (!list.length) return '';
    return `<section class="card today-group">${cardTitle(kind === 'cotizacion' ? 'file' : kind === 'recontacto' ? 'calendar' : 'phone',
      kind === 'cotizacion' ? 'var(--f-cotizados)' : kind === 'recontacto' ? 'var(--nuevo_perfil)' : kind === 'seguimiento' ? 'var(--f-contactados)' : 'var(--f-recibidos)',
      `${title} (${list.length})`, help)}${list.map(row).join('')}</section>`;
  }).join('');
  $('#view-today').innerHTML = `
    <div class="today-summary">
      <span class="alert-pill ${late ? 'late' : 'ok'}">${late ? `${late} ${late === 1 ? 'vencido' : 'vencidos'}` : 'Nada vencido'}</span>
      <span class="alert-pill today">${items.length - late} para hoy</span>
      ${upcoming ? `<span class="muted">${upcoming} más en los próximos 2 días</span>` : ''}
      <span class="spacer"></span>
      ${can('gerente', 'marketing', 'vendedor') ? '<button type="button" id="today-new">+ Lead</button>' : ''}
    </div>
    ${free.length && state.me.role === 'vendedor' ? `<section class="card today-group">${cardTitle('inbox', 'var(--accent)', `Leads sin dueño (${free.length})`, 'Tómalos para empezar su cadencia')}
      ${free.map((l) => `<div class="today-row"><div class="today-main"><button type="button" class="link name" data-open="${l.id}">${esc(l.name || l.phone || l.email)}</button>
        <span class="muted">${timeAgo(l.created_at)}</span></div><div class="today-actions"><button type="button" class="small" data-take="${l.id}">Tomar</button></div></div>`).join('')}</section>` : ''}
    ${sections || `<div class="card empty-today">${icon('check', 28)}<h3>Estás al día</h3><p class="muted">No hay toques ni seguimientos pendientes para hoy.</p></div>`}`;

  const view = $('#view-today');
  $('#today-new')?.addEventListener('click', openNewLead);
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  view.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/leads/${b.dataset.take}/take`, { method: 'POST' }); toast('Lead tomado', 'ok'); refresh(); } catch (err) { toast(err.message, 'error'); }
  }));
  view.querySelectorAll('.today-row[data-id]').forEach((r) => {
    const l = state.leads.find((x) => String(x.id) === r.dataset.id);
    r.querySelectorAll('[data-outcome]').forEach((b) => b.addEventListener('click', () => registerTouch(l, $('[data-channel]', r).value, b.dataset.outcome)));
    $('[data-reactivate]', r)?.addEventListener('click', () => reactivate(l));
  });
}

// Registra un toque (desde Mi día o la ficha) pidiendo lo que haga falta según el resultado.
async function registerTouch(l, channel, outcome) {
  const body = { channel, outcome };
  if (outcome === 'cotizado') {
    const amount = await ask('¿De cuánto es la cotización? (opcional, sirve para ver cuánto dinero hay en juego)', { input: true, placeholder: 'Ej. 60000', okLabel: 'Registrar cotización' });
    if (amount === null) return false;
    if (amount) body.quote_amount = amount;
  }
  if (outcome === 'rechazo') {
    const reason = await ask('¿Por qué no le interesó?', { options: state.meta.declineReasons.filter((r) => r !== state.meta.noAnswer), okLabel: 'Declinar' });
    if (reason === null) return false;
    body.decline_reason = reason;
    if (reason === state.meta.postponed) {
      const date = await ask('¿Cuándo lo volvemos a contactar? (opcional)', { input: true, inputType: 'date', okLabel: 'Guardar' });
      if (date) body.recontact_at = date;
    }
  }
  if (outcome === 'vendido') {
    const amount = await ask('¡Venta cerrada! ¿De cuánto fue? (opcional)', { input: true, placeholder: 'Ej. 45000', okLabel: 'Registrar venta' });
    if (amount === null) return false;
    if (amount) body.sale_amount = amount;
  }
  try {
    const r = await api(`/api/leads/${l.id}/touches`, { method: 'POST', body });
    toast(r.auto_declined ? 'Quinto toque sin respuesta: el lead pasó a Declinado' : `Toque ${r.n} registrado`, r.auto_declined ? '' : 'ok');
    refresh();
    return true;
  } catch (err) { toast(err.message, 'error'); return false; }
}

async function reactivate(l) {
  try {
    await api(`/api/leads/${l.id}`, { method: 'PATCH', body: { status: l.profile === 'cumple' ? 'nuevo_perfil' : 'nuevo', recontact_at: null } });
    toast('Lead reactivado: ya está en tus seguimientos', 'ok');
    refresh();
  } catch (err) { toast(err.message, 'error'); }
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
    const reason = await ask('¿Por qué se declina?', { options: state.meta.declineReasons, okLabel: 'Declinar' });
    if (reason === null) return;
    body.decline_reason = reason;
    if (reason === state.meta.postponed) {
      const date = await ask('¿Cuándo lo volvemos a contactar? (opcional)', { input: true, inputType: 'date', okLabel: 'Guardar' });
      if (date) body.recontact_at = date;
    }
  }
  if (status === 'cotizando') {
    const amount = await ask('¿De cuánto es la cotización? (opcional)', { input: true, placeholder: 'Ej. 60000', okLabel: 'Mover a Cotizando' });
    if (amount === null) return;
    if (amount) body.quote_amount = amount;
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
  const audiences = can('gerente', 'marketing', 'analista') ? `<div class="audiences"><span class="muted">Audiencias listas:</span>
      <button type="button" class="chip" data-aud="fit">Cumplen perfil y no compraron</button>
      <button type="button" class="chip" data-aud="later">Lo pospusieron</button>
      <button type="button" class="chip" data-aud="noanswer">Nunca contestaron</button>
      <button type="button" class="chip" data-aud="clients">Clientes</button></div>` : '';
  $('#view-list').innerHTML = `${audiences}<p class="muted">${state.leads.length} leads${can('gerente', 'marketing', 'analista') ? ' · "Exportar CSV" descarga exactamente esta lista' : ''}</p>
    <div class="table-wrap"><table><thead><tr><th>Contacto</th><th>Estado</th><th>Perfil</th><th>Origen / canal / campaña</th><th>Producto</th><th>Vendedor</th><th>Recibido</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="muted">Sin resultados</td></tr>'}</tbody></table></div>`;
  $('#view-list').querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openLead(tr.dataset.id)));
  const AUD = {
    fit: { '#f-status': 'declinado', '#f-profile': 'cumple' },
    later: { '#f-status': 'declinado', '#f-reason': state.meta.postponed },
    noanswer: { '#f-status': 'declinado', '#f-reason': state.meta.noAnswer },
    clients: { '#f-status': 'vendido' },
  };
  $('#view-list').querySelectorAll('[data-aud]').forEach((b) => b.addEventListener('click', () => applyFilters(AUD[b.dataset.aud])));
}

async function renderStats() {
  const s = await api(`/api/stats?${filterQuery()}`);
  const n = (rows, key) => rows.find((r) => r.key === key)?.n || 0;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const stages = state.meta.statuses.map((k) => ({ key: k, n: n(s.byStatus, k), label: label(k), color: `var(--${k})`, dark: DARK_TEXT.has(k) }));
  const profiles = state.meta.profiles.map((k) => ({ key: k, n: n(s.byProfile, k), label: label(k), color: `var(--${k})` }));
  const sources = state.meta.sources.map((k) => ({ key: k, n: n(s.bySource, k), label: label(k), color: `var(--${k})` }));

  const kpi = (ico, title, value, sub, color, unit = '') => `<div class="kpi-tile" style="--c:${color}">
    <span class="kpi-ico">${icon(ico, 24)}</span>
    <div><div class="value"><span data-count="${value}">0</span>${unit}</div>
    <div class="label">${esc(title)}</div><div class="sub">${esc(sub)}</div></div></div>`;

  const f = s.funnel;
  const tab = state.statsTab || pref.get('statsTab') || (state.me.role === 'marketing' ? 'marketing' : 'ventas');
  state.statsTab = tab;
  const tabs = `<div class="tabs" role="tablist">
    <button type="button" role="tab" data-tab="ventas" class="${tab === 'ventas' ? 'active' : ''}">Ventas</button>
    <button type="button" role="tab" data-tab="marketing" class="${tab === 'marketing' ? 'active' : ''}">Marketing</button></div>`;

  let body;
  if (tab === 'ventas') {
    const speed = s.touches.speed;
    body = `<div class="kpis" style="--cols:4">
      ${kpi('inbox', 'Recibidos', f.recibidos, 'leads con los filtros actuales', 'var(--f-recibidos)')}
      ${kpi('chat', 'Contestaron', f.contactados, `${pct(f.contactados, f.recibidos)}% de los recibidos`, 'var(--f-contactados)')}
      ${kpi('file', 'Cotizados', f.cotizados, `${pct(f.cotizados, f.recibidos)}% de los recibidos`, 'var(--f-cotizados)')}
      ${kpi('check', 'Cerrados', f.cerrados, `${pct(f.cerrados, f.cotizados)}% de lo cotizado`, 'var(--f-cerrados)')}
      ${kpi('trend', 'Conversión', pct(f.cerrados, f.recibidos), 'de los recibidos se cierra', 'var(--accent)', '%')}
      ${textKpi('clock', 'Primer toque', speed == null ? '—' : hours(speed), 'promedio desde que llega el lead', speed != null && speed > 24 ? 'var(--declinado)' : 'var(--f-contactados)')}
      ${textKpi('file', 'En cotización', money(f.en_cotizacion), `${f.cotizando_ahora} ${f.cotizando_ahora === 1 ? 'cotización abierta' : 'cotizaciones abiertas'}`, 'var(--f-cotizados)')}
      ${f.ingresos ? textKpi('money', 'Ventas', money(f.ingresos), `de ${f.cerrados} cierres`, 'var(--f-cerrados)') : ''}
    </div>
    <div class="card chart-card span-8">${cardTitle('funnel', 'var(--accent)', 'Embudo de conversión', 'cuántos llegan a cada paso')}${funnelChart(f)}</div>
    <div class="card chart-card span-4">${cardTitle('layers', 'var(--nuevo_perfil)', 'Dónde están hoy', 'etapa actual')}
      ${battery(stages, s.total, true)}${legend(stages, s.total)}
      <p class="muted" style="margin-bottom:0">${f.declinados} declinados; ${n(s.byStatus, 'nuevo') + n(s.byStatus, 'nuevo_perfil')} todavía sin cotizar.</p></div>
    <div class="card chart-card">${cardTitle('users', 'var(--f-contactados)', 'Eficiencia por vendedor', 'de lo que recibe cada uno, cuánto avanza')}${sellerTable(s.sellerFunnel)}</div>
    <div class="card chart-card span-6">${cardTitle('phone', 'var(--f-contactados)', '¿En qué toque responden?', 'primer toque en que el cliente contestó')}
      ${touchBars(s.touches.response, s.touches.noAnswer, 'f-contactados', 'respondieron')}</div>
    <div class="card chart-card span-6">${cardTitle('file', 'var(--f-cotizados)', '¿En qué toque se cotiza?', 'toque en que se envió la cotización')}
      ${touchBars(s.touches.quote, null, 'f-cotizados', 'se cotizaron')}</div>
    <div class="card chart-card span-6">${cardTitle('target', 'var(--declinado)', '¿Por qué se pierden?', 'motivo de los declinados')}${reasonBars(s.touches.declineReasons)}</div>
    <div class="card chart-card span-6">${cardTitle('users', 'var(--f-recibidos)', 'Por vendedor', 'etapa de cada lead')}${stageRows(s.sellerStages)}</div>`;
  } else {
    const paid = s.campaignFunnel.filter((r) => r.inversion > 0);
    const inv = paid.reduce((t, r) => t + r.inversion, 0);
    const sum = (k) => paid.reduce((t, r) => t + (r[k] || 0), 0);
    const perOrDash = (k) => (inv && sum(k) ? money(inv / sum(k)) : '—');
    body = `<div class="kpis" style="--cols:3">
      ${kpi('inbox', 'Leads', f.recibidos, 'con los filtros actuales', 'var(--f-recibidos)')}
      ${kpi('userCheck', 'Cumplen perfil', pct(f.perfilados, f.recibidos), `${f.perfilados} de ${f.recibidos} leads`, 'var(--cumple)', '%')}
      ${textKpi('money', 'Inversión', inv ? money(inv) : '—', inv ? `${paid.length} ${paid.length === 1 ? 'campaña' : 'campañas'} con inversión` : 'captúrala en Configuración', 'var(--llamada)')}
      ${textKpi('inbox', 'Costo por lead', perOrDash('recibidos'), 'de las campañas con inversión', 'var(--f-recibidos)')}
      ${textKpi('check', 'Costo por cierre', perOrDash('cerrados'), 'de las campañas con inversión', 'var(--f-cerrados)')}
      ${textKpi('trend', 'Retorno', inv && sum('ingresos') ? `${(sum('ingresos') / inv).toFixed(1)}x` : '—', 'ventas ÷ inversión', 'var(--accent)')}
    </div>
    <div class="card chart-card">${cardTitle('megaphone', 'var(--llamada)', 'Conversión por campaña', 'de dónde salen los cierres')}${campaignTable(s.campaignFunnel)}</div>
    <div class="card chart-card">${cardTitle('money', 'var(--f-cerrados)', 'Eficiencia de campañas', 'cuánto cuesta y cuánto regresa cada una')}${campaignEfficiency(s.campaignFunnel)}</div>
    <div class="card chart-card">${cardTitle('sparkles', 'var(--nuevo_perfil)', 'Por anuncio', 'qué anuncio trae leads que cierran (utm_content)')}${adTable(s.adFunnel)}</div>
    <div class="card chart-card span-8">${cardTitle('calendar', 'var(--f-recibidos)', 'Leads recibidos', 'últimos 30 días')}${areaChart(s.byDay)}</div>
    <div class="card chart-card span-4">${cardTitle('pie', 'var(--formulario)', 'Por dónde escribieron')}${donut(sources, s.total)}</div>
    <div class="card chart-card span-6">${cardTitle('radio', 'var(--whatsapp)', '¿De dónde vienen?', 'canal, incluido el de cada campaña')}${categoryBars(s.byChannel)}</div>
    <div class="card chart-card span-6">${cardTitle('tag', 'var(--nuevo_perfil)', 'Por producto', 'etapa de cada lead')}${stageRows(s.productStages)}</div>
    <div class="card chart-card span-6">${cardTitle('userCheck', 'var(--cumple)', 'Perfil', 'se conserva aunque el lead se decline')}${battery(profiles, s.total, true)}${legend(profiles, s.total)}</div>
    <div class="card chart-card span-6">${cardTitle('layers', 'var(--whatsapp)', 'Por canal', 'etapa de cada lead')}${stageRows(s.channelStages)}</div>`;
  }
  $('#view-stats').innerHTML = `<div class="dash">${tabs}${insightBanner(s)}${body}</div>`;
  $('#view-stats').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.statsTab = b.dataset.tab; pref.set('statsTab', b.dataset.tab); renderStats();
  }));
  animateIn($('#view-stats'));
}

// KPI con texto ya formateado (dinero, tiempo), sin animación de conteo.
function textKpi(ico, title, value, sub, color) {
  return `<div class="kpi-tile" style="--c:${color}"><span class="kpi-ico">${icon(ico, 24)}</span>
    <div><div class="value money">${esc(value)}</div><div class="label">${esc(title)}</div><div class="sub">${esc(sub)}</div></div></div>`;
}

function adTable(rows) {
  if (!rows.length) {
    return `<p class="muted">Todavía no llegan leads con anuncio identificado. En cada anuncio pon el link de tu página con
      <code>?utm_campaign=…&amp;utm_content=nombre-del-anuncio</code>; el formulario de Configuración ya lo lee solo.</p>`;
  }
  return `<div class="table-wrap"><table class="funnel-table"><thead><tr>
    <th>Anuncio</th><th>Campaña</th><th>Recibidos</th><th>Perfilados</th><th>Cotizados</th><th>Cerrados</th><th>Ventas</th>
  </tr></thead><tbody>${rows.map((r) => `<tr>
      <td><strong>${esc(r.key)}</strong></td><td class="muted">${esc((r.campaign || '—').split(',').join(', '))}</td><td class="num"><b>${r.recibidos}</b></td>
      ${rateCell(r.perfilados, r.recibidos, 'perfilados')}${rateCell(r.cotizados, r.recibidos, 'cotizados')}${rateCell(r.cerrados, r.recibidos, 'cerrados')}
      <td class="num">${r.ingresos ? money(r.ingresos) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}

// Aviso con degradado: la lectura rápida del periodo (dónde se pierden los leads, qué campaña y quién cierran más).
function insightBanner(s) {
  const f = s.funnel;
  if (!f.recibidos) {
    return `<div class="hero">${icon('sparkles', 22)}<div><h2>Lectura rápida</h2><p>Todavía no hay leads con estos filtros.</p></div></div>`;
  }
  const steps = FUNNEL.slice(1).map(([k, name], i) => ({ from: FUNNEL[i][1], to: name, rate: pctOf(f[k], f[FUNNEL[i][0]]), base: f[FUNNEL[i][0]] }))
    .filter((x) => x.base > 0);
  const leak = steps.sort((a, b) => a.rate - b.rate)[0];
  const campaigns = s.campaignFunnel.filter((c) => c.key !== 'Sin campaña' && c.cerrados > 0)
    .sort((a, b) => pctOf(b.cerrados, b.recibidos) - pctOf(a.cerrados, a.recibidos) || b.cerrados - a.cerrados);
  const seller = s.sellerFunnel.filter((r) => r.id && r.cerrados > 0).sort((a, b) => b.cerrados - a.cerrados)[0];
  const parts = [`De <b>${f.recibidos}</b> leads se cerraron <b>${f.cerrados}</b> (${pctOf(f.cerrados, f.recibidos)}%).`];
  if (leak) parts.push(`La mayor fuga está de <b>${esc(leak.from)}</b> a <b>${esc(leak.to)}</b>: solo avanza el ${leak.rate}%.`);
  if (campaigns[0]) parts.push(`Campaña que mejor convierte: <b>${esc(campaigns[0].key)}</b> (${pctOf(campaigns[0].cerrados, campaigns[0].recibidos)}%).`);
  if (seller) parts.push(`Más cierres: <b>${esc(seller.key)}</b> con ${seller.cerrados}.`);
  const resp = s.touches.response;
  const respTotal = resp.reduce((t, r) => t + r.c, 0);
  if (respTotal) {
    const topTouch = [...resp].sort((a, b) => b.c - a.c)[0];
    parts.push(`La mayoría responde en el <b>toque ${topTouch.n}</b> (${pctOf(topTouch.c, respTotal)}%).`);
  }
  if (s.touches.overdue) parts.push(`Hay <b>${s.touches.overdue} ${s.touches.overdue === 1 ? 'toque vencido' : 'toques vencidos'}</b>.`);
  return `<div class="hero">${icon('sparkles', 22)}<div><h2>Lectura rápida</h2><p>${parts.join(' ')}</p></div></div>`;
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
    <th>Vendedor</th><th>Recibe</th><th>Contestaron</th><th>Perfilados</th><th>Cotiza</th><th>Cierra</th><th>Conversión</th><th>Toques a respuesta</th><th>Toques a cotizar</th><th>Toques vencidos</th><th>Primer toque</th><th>Hasta que contestan</th>
  </tr></thead><tbody>${rows.map((r) => {
    const conv = pctOf(r.cerrados, r.recibidos);
    return `<tr class="${r.id ? '' : 'unassigned'}">
      <td>${r.id ? `<span class="avatar" aria-hidden="true">${esc(initials(r.key))}</span>` : ''}<strong>${esc(r.key)}</strong></td>
      <td class="num"><b>${r.recibidos}</b></td>
      ${rateCell(r.contactados, r.recibidos, 'contactados')}${rateCell(r.perfilados, r.recibidos, 'perfilados')}
      ${rateCell(r.cotizados, r.recibidos, 'cotizados')}${rateCell(r.cerrados, r.recibidos, 'cerrados')}
      <td><span class="conv ${r.id && conv === best && best > 0 ? 'top' : ''}">${conv}%</span></td>
      <td class="num">${r.toques_respuesta ? r.toques_respuesta.toFixed(1) : '—'}</td>
      <td class="num">${r.toques_cotizacion ? r.toques_cotizacion.toFixed(1) : '—'}</td>
      <td>${r.toques_vencidos ? `<span class="conv bad">${r.toques_vencidos}</span>` : '<span class="muted">0</span>'}</td>
      <td class="num">${r.horas_primer_toque != null && r.horas_primer_toque > 24 ? `<span class="conv bad">${hours(r.horas_primer_toque)}</span>` : hours(r.horas_primer_toque)}</td>
      <td class="num">${hours(r.horas_contacto)}</td></tr>`;
  }).join('')}</tbody></table></div>
  <p class="muted small-note">Los porcentajes son sobre lo que recibe cada vendedor. Los tiempos se miden desde que llega el lead: "Primer toque" es cuánto tardó el vendedor en intentar el contacto (más de un día se marca en rojo) y "Hasta que contestan", cuánto tardó el cliente en responder.</p>`;
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
    if (rows.some((r) => r.falta_inversion_mes)) {
      return `<p class="muted">Las campañas solo tienen inversión total y el filtro es por periodo. Captura la inversión de cada mes en
        <strong>Configuración → Campañas</strong>, o elige "Todo el tiempo".</p>`;
    }
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
  const missing = rows.filter((r) => r.falta_inversion_mes).map((r) => r.key);
  const periodNote = missing.length ? `<p class="muted small-note">Sin inversión por mes en ${missing.map(esc).join(', ')}: solo tienen el total, que no se puede repartir por periodo.
    Captura la inversión de cada mes en Configuración → Campañas, o usa "Todo el tiempo".</p>` : '';
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

// Barras por número de toque (T1…T5, 6+), con el acumulado: "con 3 toques ya respondió el 80%".
function touchBars(rows, never, colorKey, verb) {
  const max = state.meta.touches.max;
  const buckets = Array.from({ length: max }, (_, i) => ({ key: `Toque ${i + 1}`, n: rows.find((r) => r.n === i + 1)?.c || 0 }));
  const extra = rows.filter((r) => r.n > max).reduce((t, r) => t + r.c, 0);
  if (extra) buckets.push({ key: `Toque ${max + 1} o más`, n: extra });
  const total = buckets.reduce((t, b) => t + b.n, 0);
  if (!total && !never) return '<p class="muted">Todavía no hay toques registrados. Se llena solo cuando los vendedores registran sus toques.</p>';
  const top = Math.max(...buckets.map((b) => b.n), never || 0, 1);
  let acc = 0;
  const rowsHtml = buckets.map((b) => {
    acc += b.n;
    return `<div class="brow"><span class="k">${b.key}</span>
      <div class="battery thin" style="background:transparent"><div class="seg" style="--w:${(b.n / top) * 100}%; --c:var(--${colorKey}); border-radius:4px"
        data-tip="${esc(`${b.key}: ${b.n} ${verb}\nAcumulado: ${pctOf(acc, total)}% hasta este toque`)}"></div></div>
      <span class="n">${b.n}</span></div>`;
  }).join('');
  const neverHtml = never != null ? `<div class="brow"><span class="k">Nunca (5 toques)</span>
      <div class="battery thin" style="background:transparent"><div class="seg" style="--w:${(never / top) * 100}%; --c:var(--empty); border-radius:4px"></div></div>
      <span class="n">${never}</span></div>` : '';
  const within = buckets.slice(0, 3).reduce((t, b) => t + b.n, 0);
  return `<div class="brows">${rowsHtml}${neverHtml}</div>
    ${total ? `<p class="muted small-note">El ${pctOf(within, total)}% de los que ${verb} lo hizo en los primeros 3 toques.</p>` : ''}`;
}

function reasonBars(rows) {
  if (!rows.length) return '<p class="muted">Sin leads declinados con estos filtros.</p>';
  const top = Math.max(...rows.map((r) => r.n));
  const total = rows.reduce((t, r) => t + r.n, 0);
  return `<div class="brows">${rows.map((r) => `<div class="brow"><span class="k" title="${esc(r.key)}">${esc(r.key)}</span>
    <div class="battery thin" style="background:transparent"><div class="seg" style="--w:${(r.n / top) * 100}%; --c:var(--declinado); border-radius:4px"
      data-tip="${esc(`${r.key}: ${r.n} (${pctOf(r.n, total)}%)`)}"></div></div><span class="n">${r.n}</span></div>`).join('')}</div>`;
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
  return `<div class="tracker">${steps.map(([k, name, at]) => `<div class="t-step ${at ? 'done' : ''}" style="--c:var(--f-${k})">
      <span class="t-dot">${at ? '✓' : ''}</span><span class="t-name">${name}</span>
      <span class="t-date">${at && typeof at === 'string' ? new Date(at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : ''}</span></div>`).join('')}
    </div>`;
}

// Panel de toques: los 5 de la cadencia (y los que sigan) y el registro del siguiente.
function touchesPanel(l, touches) {
  const t = state.meta.touches;
  const slots = Math.max(t.max, touches.length + (t.byStatus[l.status] ? 1 : 0));
  const dots = Array.from({ length: slots }, (_, i) => {
    const tt = touches[i];
    const planned = new Date(new Date(l.created_at).getTime() + (t.cadence[i] ?? t.cadence.at(-1)) * DAY);
    if (tt) {
      const ok = tt.outcome !== 'sin_respuesta';
      return `<div class="tp ${ok ? 'ok' : 'miss'}" data-tip="${esc(`Toque ${tt.n} · ${label(tt.channel)} · ${fmtDate(tt.created_at)}
${t.outcomes[tt.outcome]}${tt.user_name ? `
${tt.user_name}` : ''}`)}">
        <span class="tp-dot">${ok ? '✓' : '✕'}</span><span class="tp-n">T${tt.n}</span>
        <span class="tp-date">${new Date(tt.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span></div>`;
    }
    const inCadence = i < t.max && !l.contacted_at;
    return `<div class="tp todo"><span class="tp-dot">${i + 1}</span><span class="tp-n">T${i + 1}</span>
      <span class="tp-date">${inCadence ? planned.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : ''}</span></div>`;
  }).join('');
  const outcomes = t.byStatus[l.status];
  const n = touches.length + 1;
  const d = nextAction(l);
  const form = l.can_edit && outcomes ? `<div class="touch-form">
      <div class="touch-head"><strong>Registrar toque ${n}</strong>${d ? `<span class="touch-badge ${whenClass(d.days)}">
        ${esc(d.label)} · ${d.days < 0 ? whenText(d.days) : d.days === 0 ? 'toca hoy' : `el ${shortDate(d.due)}`}</span>` : ''}</div>
      <div class="seg-group" role="radiogroup" aria-label="Medio">${t.channels.map((c, i) => `<label class="seg"><input type="radio" name="touch-channel" value="${c}" ${i === 0 ? 'checked' : ''}><span>${esc(label(c))}</span></label>`).join('')}</div>
      <div class="outcome-grid">${outcomes.map((o) => `<button type="button" class="outcome ${o}" data-outcome="${o}">${esc(t.outcomes[o])}</button>`).join('')}</div>
      ${!l.contacted_at && n === t.max ? '<p class="muted small-note">Es el último toque de la cadencia: si no contesta, el lead pasa a Declinado.</p>' : ''}
    </div>` : '';
  return `<div class="touches"><div class="touch-row">${dots}</div>${form}</div>`;
}

async function openLead(id) {
  const [l, touches] = await Promise.all([api(`/api/leads/${id}`), api(`/api/leads/${id}/touches`)]);
  const ro = l.can_edit ? '' : 'disabled';
  const sellers = state.users.filter((u) => u.active && ['vendedor', 'gerente', 'marketing'].includes(u.role));
  const waLink = l.phone ? `https://wa.me/${l.phone.replace(/\D/g, '')}` : null;

  const adLine = [l.utm_content && `Anuncio: ${l.utm_content}`, l.utm_source && [l.utm_source, l.utm_medium].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
  openDrawer(`
    <button class="ghost" data-close style="float:right">Cerrar</button>
    <h2>${esc(l.name || l.phone || l.email)}</h2>
    <p class="contact-line">${[l.phone && esc(l.phone), l.email && esc(l.email)].filter(Boolean).join(' · ')}
      ${waLink ? ` · <a href="${waLink}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : ''}</p>
    <div class="tags">
      <span class="tag status-tag" style="${colorVar(l.status)}">${esc(label(l.status))}</span>
      <span class="tag ${l.profile}">${esc(label(l.profile))}</span>
      ${l.product_name ? `<span class="tag product">${esc(l.product_name)}</span>` : ''}
      ${l.campaign ? `<span class="tag">${esc(l.campaign)}</span>` : l.channel_name ? `<span class="tag">${esc(l.channel_name)}</span>` : ''}
      ${l.quote_amount ? `<span class="tag">Cotizado ${money(l.quote_amount)}</span>` : ''}
      ${l.sale_amount ? `<span class="tag cumple">Vendido ${money(l.sale_amount)}</span>` : ''}
    </div>
    <p class="muted small-note">Recibido ${fmtDate(l.created_at)} por ${esc(label(l.source))}${l.assigned_name ? ` · atiende ${esc(l.assigned_name)}` : ' · sin asignar'}${adLine ? ` · ${esc(adLine)}` : ''}</p>
    ${l.status === 'declinado' ? `<p class="decline-note">${esc(l.decline_reason || 'Declinado')}${l.recontact_at ? ` · volver a contactar el ${shortDate(`${l.recontact_at}T12:00:00`)}` : ''}
      ${l.can_edit ? '<button type="button" class="ghost small" id="reactivate">Reactivar</button>' : ''}</p>` : ''}
    ${state.me.role === 'vendedor' && !l.assigned_to ? '<button type="button" id="take" class="take-btn">Tomar este lead</button>' : ''}
    ${milestones(l)}
    ${touchesPanel(l, touches)}
    ${l.message ? `<p class="card message">${esc(l.message)}</p>` : ''}

    ${l.can_edit ? `<form id="note-form" class="note-form"><textarea name="content" placeholder="Agregar nota (qué platicaron, acuerdos, siguiente paso)"></textarea>
      <div class="actions"><button type="submit" class="small">Agregar nota</button></div></form>` : ''}

    <details class="lead-data">
      <summary>Datos del lead</summary>
      <form id="lead-form">
        <div class="row">
          <label>Nombre <input name="name" value="${esc(l.name)}" ${ro}></label>
          <label>Teléfono <input name="phone" value="${esc(l.phone)}" ${ro}></label>
        </div>
        <label>Email <input name="email" value="${esc(l.email)}" ${ro}></label>
        <div class="row">
          <label>¿De dónde viene? <select name="origin" ${ro}>${originOptions(l.campaign, l.channel_id)}</select></label>
          <label>Producto <select name="product_id" ${ro}>${catalogOptions('producto', l.product_id, 'Sin producto')}</select></label>
        </div>
        <label>Vendedor
          <select name="assigned_to" ${can('gerente', 'marketing') ? '' : 'disabled'}>
            <option value="">Sin asignar</option>
            ${sellers.map((u) => `<option value="${u.id}" ${u.id === l.assigned_to ? 'selected' : ''}>${esc(u.name)} (${u.role})</option>`).join('')}
          </select>
        </label>
        <div class="row">
          <label>Etapa <select name="status" class="status-select ${textClass(l.status)}" style="${colorVar(l.status)}" ${ro}>${state.meta.statuses.map((st) => `<option value="${st}" ${st === l.status ? 'selected' : ''}>${esc(label(st))}</option>`).join('')}</select></label>
          <label>Perfil <select name="profile" ${ro}>${state.meta.profiles.map((pr) => `<option value="${pr}" ${pr === l.profile ? 'selected' : ''}>${esc(label(pr))}</option>`).join('')}</select></label>
        </div>
        <div class="row">
          <label id="quote-wrap" class="${['cotizando', 'vendido', 'declinado'].includes(l.status) ? '' : 'hidden'}">Monto cotizado (MXN)
            <input name="quote_amount" inputmode="decimal" value="${l.quote_amount ?? ''}" placeholder="Ej. 60000" ${ro}></label>
          <label class="${l.status === 'vendido' ? '' : 'hidden'}" id="sale-wrap">Monto de venta (MXN)
            <input name="sale_amount" inputmode="decimal" value="${l.sale_amount ?? ''}" placeholder="Ej. 45000" ${ro}></label>
        </div>
        <div class="row ${l.status === 'declinado' ? '' : 'hidden'}" id="decline-wrap">
          <label>Motivo <select name="decline_reason" ${ro}>${[...new Set([...(l.decline_reason ? [l.decline_reason] : []), ...state.meta.declineReasons])]
            .map((r) => `<option ${r === l.decline_reason ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
          <label>Volver a contactar el <input type="date" name="recontact_at" value="${esc(l.recontact_at || '')}" ${ro}></label>
        </div>
        <p class="muted small-note">La etapa normalmente se mueve sola con los toques; cámbiala aquí solo para corregir.</p>
        <p class="error" id="lead-error"></p>
        <div class="actions">
          ${l.can_edit ? '<button type="submit">Guardar cambios</button>' : ''}
          ${can('gerente') ? '<button type="button" class="danger" id="delete">Eliminar lead</button>' : ''}
        </div>
      </form>
    </details>

    <h3>Historial</h3>
    <ul class="events">${l.events.map((e) => `<li class="${e.type}">${esc(e.content)}
      <small>${e.user_name ? esc(e.user_name) + ' · ' : ''}${fmtDate(e.created_at)}</small></li>`).join('')}</ul>
  `);

  document.querySelectorAll('#drawer-body .outcome').forEach((b) => b.addEventListener('click', async () => {
    const ok = await registerTouch(l, $('#drawer-body input[name=touch-channel]:checked').value, b.dataset.outcome);
    if (ok) openLead(l.id);
  }));
  $('#reactivate')?.addEventListener('click', async () => { await reactivate(l); openLead(l.id); });
  const form = $('#lead-form');
  form.status.addEventListener('change', () => {
    $('#decline-wrap').classList.toggle('hidden', form.status.value !== 'declinado');
    $('#sale-wrap').classList.toggle('hidden', form.status.value !== 'vendido');
    $('#quote-wrap').classList.toggle('hidden', !['cotizando', 'vendido', 'declinado'].includes(form.status.value));
    form.status.setAttribute('style', colorVar(form.status.value));
    form.status.classList.toggle('dark-text', DARK_TEXT.has(form.status.value));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(['status', 'profile', 'decline_reason', 'recontact_at', 'sale_amount', 'quote_amount', 'name', 'phone', 'email', 'product_id']
      .map((k) => [k, form[k].value]));
    Object.assign(body, originToFields(form.origin.value));
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
      <label>Teléfono <input name="phone" inputmode="tel" autofocus></label>
      <label>Nombre <input name="name"></label>
      <fieldset class="plain"><legend>¿Por dónde escribió?</legend>
        <div class="seg-group">${state.meta.manualSources.map((src, i) => `<label class="seg"><input type="radio" name="source" value="${src}" ${i === 0 ? 'checked' : ''}><span>${esc(label(src))}</span></label>`).join('')}</div>
      </fieldset>
      <label>¿De dónde viene? <select name="origin">${originOptions(null, null)}</select></label>
      <label>Producto de interés <select name="product_id">${catalogOptions('producto', null, 'Sin definir')}</select></label>
      <label>Mensaje / comentario <textarea name="message"></textarea></label>
      <details class="lead-data"><summary>Más datos</summary><label>Email <input name="email" type="email"></label></details>
      <p class="error" id="new-error"></p>
      <button type="submit">Crear lead</button>
    </form>`);
  $('#new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { origin, ...rest } = Object.fromEntries(new FormData(e.target));
    const body = { ...rest, ...originToFields(origin) };
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
  <input type="hidden" name="utm_campaign">
  <input type="hidden" name="utm_source">
  <input type="hidden" name="utm_medium">
  <input type="hidden" name="utm_content">
  <input type="hidden" name="redirect" value="https://TU-SITIO/gracias">
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <input name="nombre" placeholder="Nombre" required>
  <input name="telefono" placeholder="Teléfono" required>
  <input name="email" type="email" placeholder="Email">${selectFor('producto', 'producto', '¿Qué te interesa?')}${selectFor('canal', 'canal', '¿Cómo te enteraste de nosotros?')}
  <textarea name="mensaje" placeholder="¿En qué te podemos ayudar?"></textarea>
  <button>Enviar</button>
</form>
<script>
  // Toma la campaña y el anuncio del link (utm_...) y los recuerda aunque la persona navegue a otra página.
  (function () {
    var p = new URLSearchParams(location.search);
    ['utm_campaign', 'utm_source', 'utm_medium', 'utm_content'].forEach(function (n) {
      var v = p.get(n);
      try { if (v) localStorage.setItem(n, v); else v = localStorage.getItem(n); } catch (e) {}
      document.querySelectorAll('input[name=' + n + ']').forEach(function (i) { if (v) i.value = v; });
    });
  })();
</script>`;

  $('#view-settings').innerHTML = `<div class="settings">
    <div class="card">
      ${cardTitle('users', 'var(--f-contactados)', 'Reparto de leads')}
      <label class="switch-row"><input type="checkbox" id="auto-assign" ${s.auto_assign ? 'checked' : ''}>
        <span><strong>Repartir leads automáticamente por turnos</strong><br>
        <span class="muted">Cada lead que llega por formulario o que captura marketing se asigna al siguiente vendedor activo, para que ninguno espere sin dueño.
        Apágalo si prefieres asignarlos a mano.</span></span></label>
    </div>
    ${campaignEditor()}
    <div class="lists">
      ${listEditor('producto', 'Productos', 'Lo que vendes. Se elige en cada lead como producto de interés.', 'Ej. Espectacular, Pantalla LED')}
      ${listEditor('canal', 'Canales de percepción', 'Cómo se enteró el cliente de ustedes.', 'Ej. Radio, Evento, TikTok')}
    </div>
    <div class="card">
      ${cardTitle('file', 'var(--accent)', 'Formulario de tu página web')}
      <p>Pásale esto a quien administra tu página web. Cada vez que alguien llene el formulario, el lead aparece aquí solo.</p>
      <p class="muted">En cada anuncio usa el link de tu página con la campaña y el nombre del anuncio, por ejemplo
        <code>https://TU-SITIO/?utm_campaign=FB-Espectaculares-Oct&amp;utm_source=facebook&amp;utm_content=video-carretera</code>.
        El formulario los guarda solos y el Resumen te dice qué campaña y qué anuncio cierran.</p>
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
      const { id } = await api('/api/catalog', { method: 'POST', body: { kind: 'campana', name, channel_id: f.elements.channel_id.value || null } });
      if (f.elements.budget.value) await api(`/api/catalog/${id}/budgets`, { method: 'PUT', body: { month: monthKey(0), amount: f.elements.budget.value } });
      await reloadCatalog();
      toast(`Campaña "${name}" agregada`, 'ok');
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#auto-assign').addEventListener('change', async (e) => {
    try {
      await api('/api/settings', { method: 'PATCH', body: { auto_assign: e.target.checked } });
      toast(e.target.checked ? 'Reparto automático encendido' : 'Reparto automático apagado', 'ok');
    } catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
  });
  $('#view-settings').querySelectorAll('[data-camp-channel]').forEach((sel) => sel.addEventListener('change', async () => {
    try { await api(`/api/catalog/${sel.dataset.campChannel}`, { method: 'PATCH', body: { channel_id: sel.value || null } }); toast('Canal guardado', 'ok'); } catch (err) { toast(err.message, 'error'); }
  }));
  $('#view-settings').querySelectorAll('[data-month]').forEach((inp) => inp.addEventListener('change', async () => {
    const id = inp.closest('[data-item]').dataset.item;
    try {
      await api(`/api/catalog/${id}/budgets`, { method: 'PUT', body: { month: inp.dataset.month, amount: inp.value } });
      await reloadCatalog();
      toast('Inversión guardada', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  }));
  $('#regen').addEventListener('click', async () => {
    if (!await ask('El formulario de tu página dejará de funcionar hasta que se actualice con la nueva clave. ¿Continuar?', { okLabel: 'Cambiar clave', danger: true })) return;
    await api('/api/settings', { method: 'PATCH', body: { regenerate_form_key: true } });
    renderSettings();
  });
}

// 'YYYY-MM' de hace `back` meses, en hora local.
function monthKey(back) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const monthName = (key) => new Date(`${key}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });

function campaignEditor() {
  const items = state.catalog.campana;
  const months = [0, 1, 2, 3, 4, 5].map(monthKey);
  const channelSelect = (i) => `<select data-camp-channel="${i.id}" aria-label="Canal de ${esc(i.name)}" class="small-select">
    <option value="">Canal…</option>${state.catalog.canal.filter((c) => c.active || c.id === i.channel_id)
      .map((c) => `<option value="${c.id}" ${c.id === i.channel_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
  const budgetOf = (i, m) => (i.budgets || []).find((b) => b.month === m)?.amount;
  return `<div class="card">
    ${cardTitle('megaphone', 'var(--llamada)', 'Campañas')}
    <p class="muted">Las que el vendedor puede elegir en cada lead. A cada campaña ponle su canal (Facebook, Google…) y lo que se invirtió cada mes:
      con eso el Resumen calcula cuánto cuesta cada lead y cada cierre en el periodo que elijas. Si llega una campaña nueva desde un anuncio, se agrega sola aquí.</p>
    <form id="campaign-form" class="list-form">
      <input name="name" placeholder="Ej. FB Espectaculares Octubre" aria-label="Nombre de la campaña" maxlength="120">
      <select name="channel_id" aria-label="Canal" class="small-select"><option value="">Canal…</option>
        ${state.catalog.canal.filter((c) => c.active).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <input name="budget" inputmode="decimal" placeholder="Inversión de ${monthName(months[0])}" aria-label="Inversión de este mes" style="max-width:170px">
      <button type="submit">Agregar</button>
    </form>
    <ul class="items campaigns">
      ${items.map((i) => {
        const cur = budgetOf(i, months[0]);
        const noMonthly = !(i.budgets || []).length;
        return `<li data-item="${i.id}" data-active="${i.active}" class="${i.active ? '' : 'inactive'}">
        <span>${esc(i.name)}${i.active ? '' : ' <small>(quitada)</small>'}</span>
        ${channelSelect(i)}
        <span class="budget ${cur == null ? 'missing' : ''}">${cur == null ? `Sin inversión en ${monthName(months[0])}` : `${money(cur)} en ${monthName(months[0])}`}</span>
        <button type="button" class="ghost small" data-rename>Renombrar</button>
        <button type="button" class="ghost small" data-toggle>${i.active ? 'Quitar' : 'Volver a usar'}</button>
        <details class="months"><summary>Inversión por mes</summary>
          <div class="month-grid">${months.map((m) => `<label>${monthName(m)}<input data-month="${m}" inputmode="decimal" value="${budgetOf(i, m) ?? ''}" placeholder="$0"></label>`).join('')}</div>
          ${noMonthly && i.budget ? `<p class="muted small-note">Tiene una inversión total de ${money(i.budget)} de antes; al capturar meses, se usan los meses.</p>` : ''}
        </details>
      </li>`;
      }).join('') || '<li class="muted">Todavía no hay campañas. Agrega la primera arriba.</li>'}
    </ul>
  </div>`;
}

function listEditor(kind, title, help, placeholder) {
  const items = state.catalog[kind];
  return `<div class="card">
    ${kind === 'producto' ? cardTitle('tag', 'var(--nuevo_perfil)', title) : cardTitle('radio', 'var(--whatsapp)', title)}
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
