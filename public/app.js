const state = { waTemplates: {}, me: null, meta: null, users: [], catalog: { canal: [], producto: [], campana: [] }, leads: [], view: null, statsTab: null };
const F = window.CRMFollowup;
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = (k) => state.meta.labels[k] || k;
const fmtDate = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
const can = (...roles) => state.me && roles.includes(state.me.role);
// Asignar es trabajo del Operador (o de un gerente que también opera, en equipos chicos).
const canAssign = () => Boolean(state.me && (state.me.role === 'operador' || state.me.can_assign));
// Colores con poco contraste para texto blanco: llevan texto oscuro.
const DARK_TEXT = new Set(['cotizando', 'declinado_sin']);
const stageOf = (l) => F.stageOf(l);
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
const ROLE_NAMES = { gerente: 'Gerente', marketing: 'Marketing', vendedor: 'Vendedor', analista: 'Analista', operador: 'Operador' };
const VIEW_TITLES = { today: 'Mi día', board: 'Tablero', assign: 'Asignación de leads', team: 'Equipo hoy', stats: 'Resumen', users: 'Usuarios', settings: 'Configuración' };
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

// Pregunta con varios campos opcionales en el mismo recuadro. Devuelve los valores o null si se cancela.
function askForm(message, fieldsHtml, okLabel = 'Registrar') {
  return new Promise((resolve) => {
    const modal = $('#modal'); const extra = $('#modal-extra'); const ok = $('#modal-ok');
    $('#modal-text').textContent = message;
    $('#modal-select').classList.add('hidden'); $('#modal-input').classList.add('hidden');
    extra.innerHTML = fieldsHtml; extra.classList.remove('hidden');
    ok.textContent = okLabel; ok.classList.remove('danger');
    modal.classList.remove('hidden');
    (extra.querySelector('input:not([type=radio]), textarea') || ok).focus();
    const close = (value) => {
      modal.classList.add('hidden'); extra.classList.add('hidden'); extra.innerHTML = '';
      ok.onclick = null; $('#modal-cancel').onclick = null;
      resolve(value);
    };
    ok.onclick = () => close(Object.fromEntries(new FormData(extra)));
    $('#modal-cancel').onclick = () => close(null);
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
  document.querySelectorAll('[data-assigner]').forEach((el) => el.classList.toggle('hidden', !canAssign()));
  $('#f-assigned').classList.toggle('hidden', state.me.role === 'vendedor');
  [state.users, state.catalog, state.waTemplates] = await Promise.all([api('/api/users'), api('/api/catalog'), api('/api/wa-templates')]);
  fillFilters();
  // Cada rol arranca en lo suyo: vendedor en Mi día, gerente en Equipo hoy, operador en Asignación, marketing y analista en el Resumen.
  const home = { vendedor: 'today', gerente: 'team', operador: 'assign', marketing: 'stats', analista: 'stats' };
  setView(state.view || home[state.me.role] || 'board');
}

function fillFilters() {
  const opts = (sel, values) => {
    const el = $(sel);
    el.querySelectorAll('option[data-dyn]').forEach((o) => o.remove());
    values.forEach(([v, t]) => el.insertAdjacentHTML('beforeend', `<option data-dyn value="${esc(v)}">${esc(t)}</option>`));
  };
  opts('#f-profile', state.meta.profiles.map((p) => [p, label(p)]));
  opts('#f-source', state.meta.sources.map((s) => [s, label(s)]));
  opts('#f-status', state.meta.stages.map((s) => [s, label(s)]));
  opts('#f-assigned', state.users.filter((u) => u.active).map((u) => [u.id, u.name]));
  opts('#f-product', state.catalog.producto.map((i) => [i.id, i.name]));
  opts('#f-channel', state.catalog.canal.map((i) => [i.id, i.name]));
  opts('#f-campaign', state.catalog.campana.map((c) => [c.name, c.name]));
  opts('#f-reason', state.meta.declineReasons.map((r) => [r, r]));
}

// "¿De dónde viene?": una sola lista con las campañas activas y los canales orgánicos.
function originOptions(campaign, channelId, emptyLabel = 'Sin dato') {
  const camps = state.catalog.campana.filter((c) => c.active || c.name === campaign);
  const chans = state.catalog.canal.filter((c) => c.active || c.id === channelId);
  return `<option value="">${esc(emptyLabel)}</option>
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
  if (state.view !== 'board') add('stage', '#f-status');
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
// ---------- Vistas ----------
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
['#f-profile', '#f-source', '#f-product', '#f-channel', '#f-campaign', '#f-period', '#f-assigned', '#f-status', '#f-reason']
  .forEach((s) => $(s).addEventListener('change', () => { updateMoreFiltersLabel(); refresh(); }));
let searchTimer;
$('#f-q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 300); });
function exportCsv(query) {
  if (window.crmExport) return window.crmExport(query);
  window.location = `/api/leads.csv?${query}`;
}
$('#export').addEventListener('click', () => exportCsv(filterQuery()));
$('#new-lead').addEventListener('click', openNewLead);

function setView(view) {
  state.view = view;
  $('#page-title').textContent = VIEW_TITLES[view] || '';
  const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#page-sub').innerHTML = `${esc(today)} · viendo como <strong>${esc(state.me.name)}</strong> (${esc(ROLE_NAMES[state.me.role] || state.me.role)})`;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  $('.toolbar').classList.toggle('hidden', ['users', 'settings', 'today', 'assign', 'team'].includes(view));
  $('#f-status').classList.toggle('hidden', view === 'board');
  updateMoreFiltersLabel();
  if (view !== 'board') $('#board-alert').classList.add('hidden');
  refresh();
}

// Aviso en la pestaña Asignación: cuántos leads esperan vendedor. En rojo si alguno lleva más de WAIT_HOURS.
const WAIT_HOURS = 2;
const waitingTooLong = (iso) => iso && Date.now() - new Date(iso).getTime() > WAIT_HOURS * 3600e3;
async function updateAssignBadge() {
  const btn = $('#nav [data-view=assign]');
  if (!canAssign()) return;
  try {
    const w = await api('/api/workload');
    btn.innerHTML = `Asignación${w.unassigned ? ` <span class="nav-badge ${waitingTooLong(w.oldest_unassigned_at) ? 'late' : ''}">${w.unassigned}</span>` : ''}`;
    btn.title = w.unassigned ? `${w.unassigned} sin asignar${waitingTooLong(w.oldest_unassigned_at) ? `; alguno lleva más de ${WAIT_HOURS} h esperando` : ''}` : '';
  } catch { /* el aviso no es crítico */ }
}

async function refresh() {
  if (!state.me) return;
  updateAssignBadge();
  if (state.view === 'users') return renderUsers();
  if (state.view === 'settings') return renderSettings();
  if (state.view === 'stats') return renderStats();
  if (state.view === 'assign') return renderAssign();
  if (state.view === 'team') return renderTeam();
  // Mi día no usa los filtros: un pendiente viejo no debe esconderse por el periodo elegido.
  if (state.view === 'today') { state.leads = await api('/api/leads'); return renderToday(); }
  state.leads = await api(`/api/leads?${filterQuery()}`);
  renderBoard();
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
  return (nextAction(l) && touchBadge(l)) || `<span class="touch-badge ok">${icon('check', 13)} ${l.sale_amount ? money(l.sale_amount) : 'Vendido'}</span>`;
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
  // Avance de ventas: gerente y el vendedor dueño. Marketing solo corrige el origen desde la ficha.
  return can('gerente') || (state.me.role === 'vendedor' && l.assigned_to === state.me.id);
}

// ---------- Toques, cadencia y pendientes ----------
const DAY = F.DAY;
// Siguiente acción del lead según public/followup.js, con los días que faltan (negativo = atrasado).
function nextAction(l) {
  const a = F.nextAction(l);
  return a ? { ...a, days: F.dayDiff(a.due) } : null;
}
// Resultados posibles del siguiente toque. En Vendido dependen de lo que toque: referidos o renovación.
function outcomesFor(l) {
  if (l.status !== 'vendido') return state.meta.touches.byStatus[l.status] || [];
  const k = F.nextAction(l)?.kind;
  return k === 'postventa' ? ['referidos'] : k === 'renovacion' ? ['renovo', 'no_renueva'] : [];
}
const hhmm = (d) => new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
// Cuándo toca, con hora si fue acordado con el cliente.
function whenLabel(a) {
  if (a.kind === 'recontacto' && a.days < 0) return `desde el ${shortDate(a.due)}`;
  if (!a.agreed) return whenText(a.days);
  const day = a.days === 0 ? 'hoy' : a.days === 1 ? 'mañana' : a.days < 0 ? whenText(a.days) : shortDate(a.due);
  return `${day} ${hhmm(a.due)}`;
}
const whenText = (days) => (days < 0 ? `${-days} ${days === -1 ? 'día' : 'días'} tarde` : days === 0 ? 'toca hoy' : days === 1 ? 'mañana' : `en ${days} días`);
// Liga de WhatsApp con el mensaje de lo que toca (primer contacto, seguimiento, cotización o recontacto).
// {vendedor} es quien da clic: el mensaje sale de su WhatsApp.
function waHref(l) {
  const a = nextAction(l);
  const kind = a ? a.kind : l.status === 'declinado' || l.status === 'vendido' ? null : l.contacted_at ? 'seguimiento' : 'cadencia';
  return F.waLink(l.phone, kind ? state.waTemplates[kind] : '', { nombre: l.name, vendedor: state.me.name, producto: l.product_name });
}
const WA_ICON = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z"/></svg>';
const waButton = (l, small = false) => {
  const href = waHref(l);
  return href ? `<a class="wa-btn ${small ? 'small' : ''}" href="${esc(href)}" target="_blank" rel="noopener" data-wa>${WA_ICON}<span>WhatsApp</span></a>` : '';
};
const whenClass = (days) => (days < 0 ? 'late' : days === 0 ? 'today' : '');

// Línea de acción de la tarjeta: lo siguiente que toca y cuándo.
function touchBadge(l) {
  const a = nextAction(l);
  if (!a || a.kind === 'recontacto') {
    if (l.response_touch) return `<span class="touch-badge ok">${icon('chat', 13)} Respondió en el toque ${l.response_touch}</span>`;
    return l.touch_count ? `<span class="touch-badge">${l.touch_count} ${l.touch_count === 1 ? 'toque' : 'toques'}</span>` : '';
  }
  return `<span class="touch-badge ${whenClass(a.days)} ${a.agreed ? 'agreed' : ''}">${icon(a.kind === 'cotizacion' ? 'file' : 'phone', 13)} ${esc(a.label)} · ${whenLabel(a)}</span>`;
}

// Aviso arriba del tablero con lo vencido y lo de hoy (toques, seguimientos y cotizaciones).
function renderBoardAlert() {
  const el = $('#board-alert');
  const dues = state.leads.map(nextAction).filter((a) => a && a.kind !== 'recontacto');
  const late = dues.filter((d) => d.days < 0).length;
  const today = dues.filter((d) => d.days === 0).length;
  el.classList.toggle('hidden', !(late || today) || state.view !== 'board');
  el.innerHTML = `${late ? `<span class="alert-pill late">${icon('phone', 15)} ${late} ${late === 1 ? 'pendiente vencido' : 'pendientes vencidos'}</span>` : ''}
    ${today ? `<span class="alert-pill today">${icon('calendar', 15)} ${today} para hoy</span>` : ''}
    ${can('gerente', 'marketing', 'vendedor') ? '<button type="button" class="ghost small" id="go-today">Ver Mi día</button>' : ''}`;
  $('#go-today')?.addEventListener('click', () => setView('today'));
}

// ---------- Mi día: pendientes ordenados por urgencia, con el toque a un clic ----------
function renderToday() {
  const mine = (l) => (state.me.role === 'vendedor' ? l.assigned_to === state.me.id : true);
  // Lo que pidió el gerente va primero y no se repite abajo.
  const requested = state.leads.filter(mine).filter((l) => l.manager_request)
    .map((l) => ({ l, a: nextAction(l) || { kind: 'seguimiento', label: 'Seguimiento', days: 0, due: new Date() }, req: true }));
  const items = state.leads.filter(mine).filter((l) => !l.manager_request).map((l) => ({ l, a: nextAction(l) }))
    .filter((x) => x.a && x.a.days <= 0)
    .sort((x, y) => x.a.due - y.a.due);
  const upcoming = state.leads.filter(mine).map((l) => ({ l, a: nextAction(l) }))
    .filter((x) => x.a && x.a.days > 0 && x.a.days <= 2 && x.a.kind !== 'recontacto').length;
  const free = state.leads.filter((l) => !l.assigned_to && ['nuevo', 'nuevo_perfil', 'cotizando'].includes(l.status));
  const late = items.filter((x) => x.a.days < 0 && x.a.kind !== 'recontacto').length;
  // Mismas etapas, orden y colores que el Tablero: un lead en Nuevo aparece aquí bajo Nuevo.
  const STAGE_HELP = {
    nuevo: 'Recién llegados: nadie los ha tocado. Entre más rápido el primer contacto, más cierres',
    contactando: 'Ya se intentó y aún no contestan: 5 toques en 12 días',
    contesto: 'Contestaron: toca perfilar',
    nuevo_perfil: 'Cumplen perfil: toca enviar la cotización',
    cotizando: 'Seguimiento de la cotización a los 2, 5 y 10 días',
    vendido: 'Clientes: preguntar cómo va la campaña, pedir referidos y ofrecer la renovación a tiempo',
    declinado_perfil: 'Lo pospusieron y ya llegó la fecha de volver a contactarlos',
    declinado_sin: 'Lo pospusieron y ya llegó la fecha de volver a contactarlos',
  };
  const canTouch = (l) => canEditLead(l);
  const row = ({ l, a, req }) => {
    const outcomes = outcomesFor(l);
    return `<div class="today-row" data-id="${l.id}">
      <div class="today-main">
        <button type="button" class="link name" data-open="${l.id}">${esc(l.name || l.phone || l.email)}</button>
        ${req ? `<span class="request-pill">${icon('sparkles', 13)} Pedido del gerente: ${esc(l.manager_request)}</span>`
          : `<span class="touch-badge ${whenClass(a.days)} ${a.agreed ? 'agreed' : ''}">${esc(a.label)} · ${whenLabel(a)}</span>`}
        ${l.quote_amount && l.status === 'cotizando' ? `<span class="muted num">${money(l.quote_amount)}</span>` : ''}
        ${state.me.role !== 'vendedor' ? `<span class="muted">${esc(l.assigned_name || 'Sin asignar')}</span>` : ''}
        ${l.phone ? `<span class="muted">${esc(l.phone)}</span>` : ''}
        ${l.last_note && l.last_note !== l.next_step ? `<span class="today-note" title="${esc(l.last_note)}">“${esc(l.last_note)}”</span>` : ''}
      </div>
      ${!canTouch(l) ? '' : a.kind === 'recontacto' && !req
        ? `<div class="today-actions">${waButton(l, true)}<button type="button" class="small" data-reactivate>Reactivar lead</button></div>`
        : `<div class="today-actions">
          ${waButton(l, true)}
          <select class="small-select" data-channel aria-label="Medio">${state.meta.touches.channels.map((c) => `<option value="${c}">${esc(label(c))}</option>`).join('')}</select>
          ${outcomes.map((o) => `<button type="button" class="outcome small ${o}" data-outcome="${o}">${esc(state.meta.touches.outcomes[o])}</button>`).join('')}
        </div>`}
    </div>`;
  };
  const CLOSED = ['vendido', 'declinado_perfil', 'declinado_sin'];
  const sections = state.meta.stages.filter((st) => STAGE_HELP[st]).map((st) => {
    const list = items.filter((x) => stageOf(x.l) === st);
    const onBoard = state.leads.filter(mine).filter((l) => stageOf(l) === st).length;
    if (CLOSED.includes(st) && !list.length) return '';
    return `<section class="card today-group">
      <h3 class="col-head today-head ${textClass(st)}" style="${colorVar(st)}"><span>${esc(label(st))}</span>
        <span class="count">${list.length} hoy${CLOSED.includes(st) ? '' : ` · ${onBoard} en el tablero`}</span></h3>
      <p class="muted small-note today-help">${STAGE_HELP[st]}</p>
      ${list.length ? list.map(row).join('') : '<p class="muted today-none">Nada pendiente hoy en esta etapa.</p>'}
    </section>`;
  }).join('');
  $('#view-today').innerHTML = `
    <div class="today-summary">
      <span class="alert-pill ${late ? 'late' : 'ok'}">${late ? `${late} ${late === 1 ? 'vencido' : 'vencidos'}` : 'Nada vencido'}</span>
      <span class="alert-pill today">${items.length - late} para hoy</span>
      ${upcoming ? `<span class="muted">${upcoming} más en los próximos 2 días</span>` : ''}
      ${free.length && canAssign() ? `<button type="button" class="ghost small" id="today-assign">${free.length} sin asignar · Asignar</button>` : ''}
      <span class="spacer"></span>
      ${can('vendedor') ? '<button type="button" id="today-new">+ Lead</button>' : ''}
    </div>
    ${requested.length ? `<section class="card today-group requests">${cardTitle('sparkles', 'var(--accent)', `Pedidos del gerente (${requested.length})`,
      'Se quitan solos al registrar el toque')}${requested.map(row).join('')}</section>` : ''}
    ${items.length ? sections : requested.length ? '' : `<div class="card empty-today">${icon('check', 28)}<h3>Estás al día</h3><p class="muted">No hay toques ni seguimientos pendientes para hoy.</p></div>`}`;

  const view = $('#view-today');
  $('#today-new')?.addEventListener('click', openNewLead);
  $('#today-assign')?.addEventListener('click', () => setView('assign'));
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  view.querySelectorAll('.today-row[data-id]').forEach((r) => {
    const l = state.leads.find((x) => String(x.id) === r.dataset.id);
    r.querySelectorAll('[data-outcome]').forEach((b) => b.addEventListener('click', () => registerTouch(l, $('[data-channel]', r).value, b.dataset.outcome)));
    $('[data-reactivate]', r)?.addEventListener('click', () => reactivate(l));
    // Al abrir WhatsApp, el toque que se registre después queda como WhatsApp.
    $('[data-wa]', r)?.addEventListener('click', () => { const sel = $('[data-channel]', r); if (sel) sel.value = 'whatsapp'; });
  });
}

// Registra un toque (desde Mi día o la ficha) pidiendo lo que haga falta según el resultado.
// Perfil rápido en la ficha: tres preguntas, un toque cada una (otro toque en la misma respuesta la borra).
function quickProfileStrip(l) {
  if (!['nuevo', 'nuevo_perfil', 'cotizando'].includes(l.status) && !Object.keys(state.meta.quickProfile).some((k) => l[k])) return '';
  return `<div class="quick-profile">${Object.entries(state.meta.quickProfile).map(([k, q]) => `<div class="qp-row"><span class="qp-q">${esc(q.label)}</span>
    ${Object.entries(q.options).map(([v, t]) => `<button type="button" class="qp ${l[k] === v ? 'on' : ''}" data-qp="${k}" data-v="${v}" ${l.can_edit ? '' : 'disabled'}>${esc(t)}</button>`).join('')}</div>`).join('')}</div>`;
}

// Campos de captura: todos opcionales y lo más cortos posible.
const agreementFields = () => `<label>¿Qué se habló o acordó?<input name="note" maxlength="300" placeholder="Ej. Le mando propuesta con 3 ubicaciones"></label>
  <label>¿Cuándo es el siguiente paso?<input type="datetime-local" name="next_step_at"></label>`;
const quickProfileFields = (l = {}) => Object.entries(state.meta.quickProfile).map(([k, q]) => `<fieldset class="plain"><legend>${esc(q.label)}</legend>
  <div class="seg-group">${Object.entries(q.options).map(([v, t]) => `<label class="seg"><input type="radio" name="${k}" value="${v}" ${l[k] === v ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div></fieldset>`).join('');
const moneyField = (name, text) => `<label>${text}<input name="${name}" inputmode="decimal" placeholder="Ej. 60000"></label>`;
const dateField = (name, text) => `<label>${text}<input type="date" name="${name}"></label>`;

// Registra un toque (desde Mi día o la ficha) pidiendo en un solo paso lo que haga falta según el resultado.
async function registerTouch(l, channel, outcome) {
  const body = { channel, outcome };
  const forms = {
    cumple: ['Cumple perfil. Si puedes, responde (un toque cada una):', `${quickProfileFields(l)}${agreementFields()}`],
    conversacion: ['Contestó. ¿Qué quedaron?', agreementFields()],
    seguimiento: ['Sigue en conversación. ¿Qué quedaron?', agreementFields()],
    cotizado: ['Cotización enviada', `${moneyField('quote_amount', '¿De cuánto es? (para saber cuánto hay en juego)')}${agreementFields()}`],
    vendido: ['¡Venta cerrada!', `${moneyField('sale_amount', '¿De cuánto fue?')}${dateField('campaign_end', '¿Cuándo termina la campaña? (para ofrecer la renovación a tiempo)')}`],
    referidos: ['¿Cómo va su campaña?', '<label>¿Te recomendó a alguien?<input name="note" maxlength="300" placeholder="Nombre y teléfono, si te lo dio"></label>'],
    renovo: ['¡Renovó!', `${moneyField('renewal_amount', '¿Por cuánto?')}${dateField('campaign_end', '¿Hasta cuándo va ahora la campaña?')}`],
  };
  if (forms[outcome]) {
    const v = await askForm(forms[outcome][0], forms[outcome][1]);
    if (v === null) return false;
    for (const [k, val] of Object.entries(v)) if (val) body[k] = val;
    // La hora la pone el navegador del vendedor: se manda en ISO para que no dependa de la zona del servidor.
    if (body.note && body.next_step_at) body.next_step = body.note;
    if (body.next_step_at) body.next_step_at = new Date(body.next_step_at).toISOString();
  }
  if (outcome === 'rechazo') {
    const reason = await ask('¿Por qué no le interesó?', { options: state.meta.declineReasons.filter((r) => r !== state.meta.noAnswer && r !== state.meta.ghosted), okLabel: 'Declinar' });
    if (reason === null) return false;
    body.decline_reason = reason;
    if (reason === state.meta.postponed) {
      const date = await ask('¿Cuándo lo volvemos a contactar? (opcional)', { input: true, inputType: 'date', okLabel: 'Guardar' });
      if (date) body.recontact_at = date;
    }
  }
  try {
    const r = await api(`/api/leads/${l.id}/touches`, { method: 'POST', body });
    const why = r.reason === state.meta.ghosted ? `${state.meta.silentMax} seguimientos seguidos sin respuesta` : 'Quinto toque sin respuesta';
    toast(r.auto_declined ? `${why}: el lead pasó a Declinado (${r.reason}). Su perfil se conserva para remarketing.` : `Toque ${r.n} registrado`, r.auto_declined ? '' : 'ok');
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
  board.innerHTML = state.meta.stages.map((s) => {
    let items = state.leads.filter((l) => stageOf(l) === s);
    // Los que nunca contestaron no se muestran: no vale la pena volver a buscarlos. Siguen contando en el Resumen.
    let hidden = 0;
    if (s === 'declinado_sin') {
      const keep = items.filter((l) => l.contacted_at);
      hidden = items.length - keep.length; items = keep;
    }
    return `<div class="column ${['vendido', 'declinado_perfil', 'declinado_sin'].includes(s) ? 'closed' : ''}" data-stage="${s}">
      <h3 class="col-head ${textClass(s)}" style="${colorVar(s)}"><span>${esc(label(s))}</span><span class="count">${items.length}</span></h3>
      ${items.map(cardHtml).join('')}
      ${hidden ? `<p class="muted small-note col-note">${hidden} ${hidden === 1 ? 'no contestó' : 'nunca contestaron'}; no se muestran aquí y siguen contando en el Resumen.</p>` : ''}
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
      // Nuevo, Contactando y Contestó las definen los toques; a mano solo se corrige hacia las etapas de adelante.
      const target = { nuevo_perfil: 'nuevo_perfil', cotizando: 'cotizando', vendido: 'vendido', declinado_perfil: 'declinado', declinado_sin: 'declinado' }[col.dataset.stage];
      if (!lead || stageOf(lead) === col.dataset.stage) return;
      if (!target) { toast('Esa columna se llena sola con los toques: registra el toque en la ficha del lead.'); return; }
      if (lead.status === target) return;
      await changeStatus(lead, target);
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

// Mismo periodo anterior para comparar (mismos filtros). null si no hay periodo elegido.
function prevPeriodQuery() {
  const period = $('#f-period').value;
  if (!period) return null;
  const p = new URLSearchParams(filterQuery());
  const d = new Date(); const now = Date.now();
  const first = (y, m) => new Date(y, m, 1);
  let from; let to; let text;
  if (period === 'mes') { from = first(d.getFullYear(), d.getMonth() - 1); to = new Date(from.getTime() + (now - first(d.getFullYear(), d.getMonth()).getTime())); text = 'vs mismo corte del mes anterior'; }
  if (period === 'mes_pasado') { from = first(d.getFullYear(), d.getMonth() - 2); to = first(d.getFullYear(), d.getMonth() - 1); text = 'vs el mes previo'; }
  if (period === '30' || period === '90') { to = new Date(now - Number(period) * 86400e3); from = new Date(to.getTime() - Number(period) * 86400e3); text = `vs ${period} días anteriores`; }
  if (period === 'anio') { from = first(d.getFullYear() - 1, 0); to = new Date(from.getTime() + (now - first(d.getFullYear(), 0).getTime())); text = 'vs mismo corte del año pasado'; }
  p.set('from', from.toISOString()); p.set('to', to.toISOString());
  return { query: p.toString(), text };
}

// Números de marketing de un periodo: costos sobre las campañas con inversión.
function marketingMetrics(st) {
  const f = st.funnel;
  const paid = st.campaignFunnel.filter((r) => r.inversion > 0);
  const inv = paid.reduce((t, r) => t + r.inversion, 0);
  const sum = (k) => paid.reduce((t, r) => t + (r[k] || 0), 0);
  const per = (k) => (inv && sum(k) ? inv / sum(k) : null);
  return { leads: f.recibidos, perfil: f.recibidos ? (f.perfilados / f.recibidos) * 100 : null, inv: inv || null, paid: paid.length,
    cpl: per('recibidos'), cplq: per('perfilados'), cpc: per('cerrados'), roas: inv && sum('ingresos') ? sum('ingresos') / inv : null, sinOrigen: f.sin_origen || 0 };
}
// Flecha contra el periodo anterior. lowerIsBetter para costos; points para porcentajes.
function delta(cur, old, text, { lowerIsBetter = false, points = false, neutral = false } = {}) {
  if (cur == null || old == null || (!points && !old)) return '';
  const diff = points ? cur - old : ((cur - old) / old) * 100;
  if (Math.abs(diff) < 0.5) return `<div class="delta">= ${text}</div>`;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return `<div class="delta ${neutral ? '' : good ? 'good' : 'bad'}">${diff > 0 ? '↑' : '↓'} ${Math.abs(Math.round(diff))}${points ? ' pts' : '%'} ${text}</div>`;
}

async function renderStats() {
  const prevQ = prevPeriodQuery();
  const [s, prev] = await Promise.all([api(`/api/stats?${filterQuery()}`), prevQ ? api(`/api/stats?${prevQ.query}`) : null]);
  const n = (rows, key) => rows.find((r) => r.key === key)?.n || 0;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const stages = state.meta.stages.map((k) => ({ key: k, n: n(s.byStage, k), label: label(k), color: `var(--${k})`, dark: DARK_TEXT.has(k) }));
  const profiles = state.meta.profiles.map((k) => ({ key: k, n: n(s.byProfile, k), label: label(k), color: `var(--${k})` }));
  const sources = state.meta.sources.map((k) => ({ key: k, n: n(s.bySource, k), label: label(k), color: `var(--${k})` }));

  const kpi = (ico, title, value, sub, color, unit = '', extra = '') => `<div class="kpi-tile" style="--c:${color}">
    <span class="kpi-ico">${icon(ico, 24)}</span>
    <div><div class="value"><span data-count="${value}">0</span>${unit}</div>
    <div class="label">${esc(title)}</div><div class="sub">${esc(sub)}</div>${extra}</div></div>`;

  const f = s.funnel;
  // El vendedor ve solo su Resumen de ventas; lo de marketing (inversión, costos) no le aplica.
  const seller = state.me.role === 'vendedor';
  const tab = seller ? 'ventas' : state.statsTab || pref.get('statsTab') || (state.me.role === 'marketing' ? 'marketing' : 'ventas');
  state.statsTab = tab;
  const tabs = seller ? '' : `<div class="tabs" role="tablist">
    <button type="button" role="tab" data-tab="ventas" class="${tab === 'ventas' ? 'active' : ''}">Ventas</button>
    <button type="button" role="tab" data-tab="marketing" class="${tab === 'marketing' ? 'active' : ''}">Marketing</button></div>`;

  let body;
  if (tab === 'ventas') {
    const speed = s.touches.speed;
    const pf = prev?.funnel; const vs = prevQ?.text || '';
    const dv = (cur, old, opts) => (prev ? delta(cur, old, vs, opts) : '');
    const conv = (x) => (x && x.recibidos ? (x.cerrados / x.recibidos) * 100 : null);
    body = `<div class="kpis" style="--cols:4">
      ${kpi('inbox', 'Recibidos', f.recibidos, 'leads con los filtros actuales', 'var(--f-recibidos)', '', dv(f.recibidos, pf?.recibidos))}
      ${kpi('chat', 'Contestaron', f.contactados, `${pct(f.contactados, f.recibidos)}% de los recibidos`, 'var(--f-contactados)', '', dv(f.contactados, pf?.contactados))}
      ${kpi('file', 'Cotizados', f.cotizados, `${pct(f.cotizados, f.recibidos)}% de los recibidos`, 'var(--f-cotizados)', '', dv(f.cotizados, pf?.cotizados))}
      ${kpi('check', 'Cerrados', f.cerrados, `${pct(f.cerrados, f.cotizados)}% de lo cotizado`, 'var(--f-cerrados)', '', dv(f.cerrados, pf?.cerrados))}
      ${kpi('trend', 'Conversión', pct(f.cerrados, f.recibidos), 'de los recibidos se cierra', 'var(--accent)', '%', dv(conv(f), conv(pf), { points: true }))}
      ${textKpi('clock', 'Primer toque', speed == null ? '—' : hours(speed), 'promedio desde que llega el lead', speed != null && speed > 24 ? 'var(--declinado)' : 'var(--f-contactados)', dv(speed, prev?.touches.speed, { lowerIsBetter: true }))}
      ${textKpi('file', 'En cotización', money(f.en_cotizacion), `${f.cotizando_ahora} ${f.cotizando_ahora === 1 ? 'cotización abierta' : 'cotizaciones abiertas'}`, 'var(--f-cotizados)')}
      ${textKpi('money', 'Ventas', f.ingresos ? money(f.ingresos) : '—', `de ${f.cerrados} ${f.cerrados === 1 ? 'cierre' : 'cierres'}`, 'var(--f-cerrados)', dv(f.ingresos, pf?.ingresos))}
    </div>
    ${!prevQ ? '<p class="muted small-note stats-hint">Elige un periodo arriba (por ejemplo "Este mes") para comparar contra el periodo anterior.</p>' : ''}
    <div class="card chart-card span-8">${cardTitle('funnel', 'var(--accent)', 'Embudo de conversión', 'cuántos llegan a cada paso')}${funnelChart(f)}</div>
    <div class="card chart-card span-4">${cardTitle('layers', 'var(--nuevo_perfil)', 'Dónde están hoy', 'etapa actual')}
      ${battery(stages, s.total, true)}${legend(stages, s.total)}
      <p class="muted" style="margin-bottom:0">${n(s.byStage, 'nuevo')} sin tocar; ${n(s.byStage, 'declinado_perfil')} ${n(s.byStage, 'declinado_perfil') === 1 ? 'declinado' : 'declinados'} con perfil para campañas futuras.</p></div>
    <div class="card chart-card">${seller ? cardTitle('users', 'var(--f-contactados)', 'Tu eficiencia', 'de lo que te asignan, cuánto avanza')
      : cardTitle('users', 'var(--f-contactados)', 'Eficiencia por vendedor', 'de lo que recibe cada uno, cuánto avanza')}${sellerTable(s.sellerFunnel)}</div>
    <div class="card chart-card">${cardTitle('money', 'var(--f-cotizados)', seller ? 'Tu pipeline' : 'Pipeline', 'cotizaciones abiertas hoy y venta esperada')}${pipelineTable(s.pipeline)}</div>
    <div class="card chart-card span-6">${cardTitle('phone', 'var(--f-contactados)', '¿En qué toque responden?', 'primer toque en que el cliente contestó')}
      ${touchBars(s.touches.response, s.touches.noAnswer, 'f-contactados', 'respondieron')}</div>
    <div class="card chart-card span-6">${cardTitle('target', 'var(--declinado)', '¿Por qué se pierden?', 'motivo de los declinados')}${reasonBars(s.touches.declineReasons)}</div>
    ${seller ? `<div class="card chart-card">${cardTitle('tag', 'var(--nuevo_perfil)', 'Por producto', 'etapa de cada uno de tus leads')}${stageRows(s.productStages)}</div>`
      : `<div class="card chart-card">${cardTitle('users', 'var(--f-recibidos)', 'Por vendedor', 'etapa de cada lead')}${stageRows(s.sellerStages)}</div>`}`;
  } else {
    const m = marketingMetrics(s); const o = prev ? marketingMetrics(prev) : null; const vs = prevQ?.text || '';
    const d = (k, opts) => (o ? delta(m[k], o[k], vs, opts) : '');
    const moneyOr = (v) => (v == null ? '—' : money(v));
    body = `<div class="kpis" style="--cols:4">
      ${textKpi('inbox', 'Leads', String(m.leads), 'con los filtros actuales', 'var(--f-recibidos)', d('leads'))}
      ${textKpi('userCheck', 'Cumplen perfil', m.perfil == null ? '—' : `${Math.round(m.perfil)}%`, `${f.perfilados} de ${f.recibidos} leads`, 'var(--cumple)', d('perfil', { points: true }))}
      ${textKpi('money', 'Inversión', moneyOr(m.inv), m.inv ? `${m.paid} ${m.paid === 1 ? 'campaña' : 'campañas'} con inversión` : 'captúrala en Configuración', 'var(--llamada)', d('inv', { neutral: true }))}
      ${textKpi('inbox', 'Costo por lead', moneyOr(m.cpl), 'de las campañas con inversión', 'var(--f-recibidos)', d('cpl', { lowerIsBetter: true }))}
      ${textKpi('userCheck', 'Costo por lead con perfil', moneyOr(m.cplq), 'la señal temprana de calidad', 'var(--nuevo_perfil)', d('cplq', { lowerIsBetter: true }))}
      ${textKpi('check', 'Costo por cierre', moneyOr(m.cpc), 'de las campañas con inversión', 'var(--f-cerrados)', d('cpc', { lowerIsBetter: true }))}
      ${textKpi('trend', 'Retorno', m.roas == null ? '—' : `${m.roas.toFixed(1)}x`, 'ventas ÷ inversión', 'var(--accent)', d('roas'))}
      ${textKpi('target', 'Leads sin origen', String(m.sinOrigen), m.sinOrigen ? `${pct(m.sinOrigen, m.leads)}%: inversión que no se puede medir` : 'todos tienen origen', m.sinOrigen ? 'var(--declinado)' : 'var(--cumple)')}
    </div>
    ${!prevQ ? '<p class="muted small-note stats-hint">Elige un periodo arriba (por ejemplo "Este mes") para comparar contra el periodo anterior.</p>' : ''}
    <div class="card chart-card">${cardTitle('megaphone', 'var(--llamada)', 'Campañas', 'calidad, costo y retorno de cada una')}${campaignTable(s.campaignFunnel)}</div>
    <div class="card chart-card">${cardTitle('sparkles', 'var(--nuevo_perfil)', 'Por anuncio', 'qué anuncio trae leads que cumplen perfil y cierran (utm_content)')}${adTable(s.adFunnel)}</div>
    <div class="card chart-card">${cardTitle('target', 'var(--nuevo_perfil)', 'Audiencias para remarketing', 'con los filtros de arriba')}${audienceCards(s.audiences)}</div>
    <div class="card chart-card span-8">${cardTitle('calendar', 'var(--f-recibidos)', 'Leads recibidos', 'últimos 30 días')}${areaChart(s.byDay)}</div>
    <div class="card chart-card span-4">${cardTitle('radio', 'var(--whatsapp)', '¿De dónde vienen?', 'canal, incluido el de cada campaña')}${categoryBars(s.byChannel)}</div>
    <div class="card chart-card span-6">${cardTitle('tag', 'var(--nuevo_perfil)', 'Por producto', 'etapa de cada lead')}${stageRows(s.productStages)}</div>
    <div class="card chart-card span-6">${cardTitle('layers', 'var(--whatsapp)', 'Por canal', 'etapa de cada lead')}${stageRows(s.channelStages)}</div>`;
  }
  $('#view-stats').innerHTML = `<div class="dash">${tabs}${insightBanner(s)}${body}</div>`;
  $('#view-stats').querySelectorAll('[data-audience]').forEach((b) => b.addEventListener('click', () => {
    exportCsv(`${filterQuery()}&audience=${b.dataset.audience}${b.dataset.format ? `&format=${b.dataset.format}` : ''}`);
  }));
  $('#view-stats').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.statsTab = b.dataset.tab; pref.set('statsTab', b.dataset.tab); renderStats();
  }));
  animateIn($('#view-stats'));
}

const AUDIENCES = [
  ['perfil', 'Cumplían perfil y no compraron', 'Los más valiosos para la siguiente campaña.'],
  ['pospuso', 'Lo pospusieron', 'Tenían interés pero no presupuesto o no era el momento.'],
  ['contestaron', 'Contestaron pero no cumplían perfil', 'Pueden servir para otro producto.'],
  ['clientes', 'Clientes', 'Para recompra y recomendaciones.'],
];
function audienceCards(a) {
  return `<div class="audience-grid">${AUDIENCES.map(([k, title, help]) => `<div class="audience">
      <div class="value num">${a[k]}</div><strong>${title}</strong><p class="muted">${help}</p>
      <div class="audience-actions">
        <button type="button" class="ghost small" data-audience="${k}" ${a[k] ? '' : 'disabled'}>Lista completa</button>
        <button type="button" class="ghost small" data-audience="${k}" data-format="ads" ${a[k] ? '' : 'disabled'} title="Teléfono con +52, correo y nombre separados, para subir como público">Para Meta / Google</button>
      </div></div>`).join('')}</div>
    <p class="muted small-note">Los que nunca contestaron no entran en ninguna audiencia. "Para Meta / Google" trae teléfono internacional (+52…), correo y nombre separados,
      para subirla como público personalizado o para excluir a quienes ya son clientes.</p>`;
}

// KPI con texto ya formateado (dinero, tiempo), sin animación de conteo.
function textKpi(ico, title, value, sub, color, extra = '') {
  return `<div class="kpi-tile" style="--c:${color}"><span class="kpi-ico">${icon(ico, 24)}</span>
    <div><div class="value money">${esc(value)}</div><div class="label">${esc(title)}</div><div class="sub">${esc(sub)}</div>${extra}</div></div>`;
}

// Motivo principal por el que se descartan los leads de una campaña o anuncio (el resto, al pasar el mouse).
function discardCell(r) {
  if (!r.descartes?.length) return '<td class="muted">—</td>';
  const total = r.descartes.reduce((t, x) => t + x.n, 0);
  const top = r.descartes[0];
  return `<td><span class="discard" data-tip="${esc(r.descartes.map((x) => `${x.key}: ${x.n}`).join('\n'))}">${esc(top.key)} <b>${pctOf(top.n, total)}%</b></span></td>`;
}
const daysCell = (v) => { const d = v == null ? null : Math.max(1, Math.round(v)); return `<td class="num">${d == null ? '—' : `${d} ${d === 1 ? 'día' : 'días'}`}</td>`; };

function adTable(rows) {
  if (!rows.length) {
    return `<p class="muted">Todavía no llegan leads con anuncio identificado. Arma los links de tus anuncios en
      <strong>Configuración → Links para anuncios</strong> y aquí verás qué anuncio trae leads que cumplen perfil.</p>`;
  }
  return `<div class="table-wrap"><table class="funnel-table"><thead><tr>
    <th>Anuncio</th><th>Campaña</th><th>Leads</th><th>Cumplen perfil</th><th>Cotizados</th><th>Cierres</th><th>Ventas</th><th>Días a cerrar</th><th>Por qué se descartan</th>
  </tr></thead><tbody>${rows.map((r) => `<tr>
      <td><strong>${esc(r.key)}</strong></td><td class="muted">${esc((r.campaign || '—').split(',').join(', '))}</td><td class="num"><b>${r.recibidos}</b></td>
      ${rateCell(r.perfilados, r.recibidos, 'perfilados')}${rateCell(r.cotizados, r.recibidos, 'cotizados')}${rateCell(r.cerrados, r.recibidos, 'cerrados')}
      <td class="num">${r.ingresos ? money(r.ingresos) : '—'}</td>${daysCell(r.dias_cierre)}${discardCell(r)}</tr>`).join('')}</tbody></table></div>`;
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
  if (seller && s.sellerFunnel.filter((r) => r.id).length > 1) parts.push(`Más cierres: <b>${esc(seller.key)}</b> con ${seller.cerrados}.`);
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
  const pct1 = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  return `<div class="table-wrap"><table class="funnel-table sellers-table"><thead><tr>
    <th>Vendedor</th><th>Recibe</th><th>Contestaron</th><th>Cotiza</th><th>Cierra</th><th>Conversión</th><th>Cierra de lo cotizado</th>
    <th>Ticket promedio</th><th>Descuento</th><th>Primer toque</th><th>Toques 7 días</th><th>Vencidos</th><th>Pierde por</th>
  </tr></thead><tbody>${rows.map((r) => {
    const conv = pctOf(r.cerrados, r.recibidos);
    return `<tr class="${r.id ? '' : 'unassigned'}">
      <td>${r.id ? `<span class="avatar" aria-hidden="true">${esc(initials(r.key))}</span>` : ''}<strong>${esc(r.key)}</strong></td>
      <td class="num"><b>${r.recibidos}</b></td>
      ${rateCell(r.contactados, r.recibidos, 'contactados')}${rateCell(r.cotizados, r.recibidos, 'cotizados')}${rateCell(r.cerrados, r.recibidos, 'cerrados')}
      <td><span class="conv ${r.id && conv === best && best > 0 ? 'top' : ''}">${conv}%</span></td>
      <td class="num">${r.cotizados ? `${pctOf(r.cerrados, r.cotizados)}%` : '—'}</td>
      <td class="num">${r.ticket ? money(r.ticket) : '—'}</td>
      <td class="num">${r.descuento == null ? '—' : r.descuento > 0.1 ? `<span class="conv bad" data-tip="Vende en promedio ${pct1(r.descuento)} abajo de lo que cotiza">${pct1(r.descuento)}</span>` : pct1(r.descuento)}</td>
      <td class="num">${r.horas_primer_toque != null && r.horas_primer_toque > 24 ? `<span class="conv bad">${hours(r.horas_primer_toque)}</span>` : hours(r.horas_primer_toque)}</td>
      <td class="num">${r.toques_7d ?? '—'}</td>
      <td>${r.toques_vencidos ? `<span class="conv bad">${r.toques_vencidos}</span>` : '<span class="muted">0</span>'}</td>
      ${discardCell({ descartes: r.pierde_por })}</tr>`;
  }).join('')}</tbody></table></div>
  <p class="muted small-note">"Cierra de lo cotizado" dice qué tan bien remata; "Descuento" es cuánto abajo de lo cotizado vende en promedio (más de 10% se marca en rojo);
    "Toques 7 días" es su actividad de la semana: separa al que no trabaja del que trabaja y no tiene suerte. "Pierde por" es su motivo principal de pérdida.
    Los tiempos se miden desde que llega el lead.</p>`;
}

// Pipeline: lo que hay en cotización hoy, vivo o frío, y la venta esperada con la tasa real de cierre de cada vendedor.
function pipelineTable(rows) {
  if (!rows?.length) return '<p class="muted">No hay cotizaciones abiertas.</p>';
  const tot = rows.reduce((t, r) => ({ vivas: t.vivas + r.vivas, vivas_monto: t.vivas_monto + r.vivas_monto, frias: t.frias + r.frias,
    frias_monto: t.frias_monto + r.frias_monto, esperado: t.esperado + (r.esperado || 0) }), { vivas: 0, vivas_monto: 0, frias: 0, frias_monto: 0, esperado: 0 });
  const line = (r, strong) => `<td class="num">${strong ? '<b>' : ''}${r.vivas} · ${money(r.vivas_monto)}${strong ? '</b>' : ''}</td>
    <td class="num">${r.frias ? `<span class="conv bad">${r.frias} · ${money(r.frias_monto)}</span>` : '<span class="muted">0</span>'}</td>`;
  return `<div class="table-wrap"><table class="funnel-table"><thead><tr>
    <th>Vendedor</th><th>Cotizaciones vivas</th><th>Frías (más de 15 días sin contacto)</th><th>Cierra de sus cotizaciones</th><th>Venta esperada</th>
  </tr></thead><tbody>${rows.map((r) => `<tr><td><strong>${esc(r.key)}</strong></td>${line(r)}
      <td class="num">${r.tasa == null ? `<span class="muted" data-tip="Necesita al menos 3 cotizaciones cerradas para calcularlo">sin historial</span>` : `${Math.round(r.tasa * 100)}% <span class="muted">de ${r.cerradas}</span>`}</td>
      <td class="num"><b>${r.esperado == null ? '—' : money(r.esperado)}</b></td></tr>`).join('')}
    ${rows.length > 1 ? `<tr class="total-row"><td><strong>Total</strong></td>${line(tot, true)}<td></td><td class="num"><b>${money(tot.esperado)}</b></td></tr>` : ''}
  </tbody></table></div>
  <p class="muted small-note">Venta esperada = monto de las cotizaciones vivas × el % real con que ese vendedor cierra sus cotizaciones. No es una meta: sale de su historial.
    Las frías no se cuentan en la venta esperada; conviene reactivarlas o cerrarlas.</p>`;
}

// Una sola tabla por campaña: calidad del lead, costo y retorno. Con ventas manda el retorno; sin ventas, el costo por lead con perfil.
function campaignTable(rows) {
  if (!rows.length) return '<p class="muted">Sin datos</p>';
  const per = (r, k) => (r.inversion > 0 && r[k] ? r.inversion / r[k] : null);
  const roasOf = (r) => (r.inversion > 0 && r.ingresos ? r.ingresos / r.inversion : null);
  const paid = rows.filter((r) => r.inversion > 0);
  const bySales = paid.some((r) => r.ingresos);
  const ranked = [...paid].sort((a, b) => (bySales ? (roasOf(b) ?? -1) - (roasOf(a) ?? -1) : (per(a, 'perfilados') ?? Infinity) - (per(b, 'perfilados') ?? Infinity)));
  const best = ranked.find((r) => (bySales ? r.ingresos : r.perfilados));
  const order = [...ranked, ...rows.filter((r) => !(r.inversion > 0))];
  const missing = rows.filter((r) => r.falta_inversion_mes).map((r) => r.key);
  const note = !paid.length
    ? (missing.length ? '<p class="muted small-note">Las campañas solo tienen inversión total y el filtro es por periodo: captura la inversión de cada mes en Configuración → Campañas, o elige "Todo el tiempo".</p>'
      : '<p class="muted small-note">Captura la inversión de cada campaña en Configuración → Campañas para ver costos y retorno.</p>')
    : missing.length ? `<p class="muted small-note">Sin inversión por mes en ${missing.map(esc).join(', ')}: solo tienen el total, que no se puede repartir por periodo.</p>` : '';
  return `<div class="table-wrap"><table class="funnel-table campaigns-table"><thead><tr>
    <th>Campaña</th><th>Leads</th><th>Cumplen perfil</th><th>Cotizados</th><th>Cierres</th><th>Inversión</th><th>Costo por lead</th>
    <th>Por lead con perfil</th><th>Por cierre</th><th>Ventas</th><th>Retorno</th><th>Días a cerrar</th><th>Por qué se descartan</th>
  </tr></thead><tbody>${order.map((r) => {
    const roas = roasOf(r);
    return `<tr>
      <td><strong>${esc(r.key)}</strong>${r === best ? ' <span class="conv top">más eficiente</span>' : ''}</td>
      <td class="num"><b>${r.recibidos}</b></td>
      ${rateCell(r.perfilados, r.recibidos, 'perfilados')}${rateCell(r.cotizados, r.recibidos, 'cotizados')}${rateCell(r.cerrados, r.recibidos, 'cerrados')}
      <td class="num">${r.inversion > 0 ? money(r.inversion) : '—'}</td>
      <td class="num">${money(per(r, 'recibidos'))}</td>
      <td class="num"><b>${money(per(r, 'perfilados'))}</b></td>
      <td class="num">${r.inversion > 0 ? (r.cerrados ? money(per(r, 'cerrados')) : 'sin cierres') : '—'}</td>
      <td class="num">${r.ingresos ? money(r.ingresos) : '—'}</td>
      <td>${roas == null ? '—' : `<span class="conv ${roas >= 1 ? 'good' : 'bad'}" data-tip="${esc(`Por cada $1 invertido regresaron $${roas.toFixed(2)}`)}">${roas.toFixed(1)}x</span>`}</td>
      ${daysCell(r.dias_cierre)}${discardCell(r)}
    </tr>`;
  }).join('')}</tbody></table></div>
  <p class="muted small-note">"Por lead con perfil" es la señal temprana: los cierres tardan semanas, pero en días ya se sabe si una campaña trae leads que sí cumplen.
    "Días a cerrar" ayuda a no juzgar una campaña antes de tiempo. Retorno = ventas ÷ inversión. Cada venta cuenta en la campaña y el periodo en que llegó el lead.</p>
  ${note}`;
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
    g.counts[r.stage] = r.n; g.total += r.n; groups.set(r.key, g);
  });
  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  if (!list.length) return '<p class="muted">Sin datos</p>';
  const stageParts = (g) => state.meta.stages.map((k) => ({ key: k, n: g.counts[k] || 0, label: `${g.key} · ${label(k)}`, color: `var(--${k})`, dark: DARK_TEXT.has(k) }));
  return `<div class="brows">${list.map((g) => `<div class="brow"><span class="k" title="${esc(g.key)}">${esc(g.key)}</span>
    ${battery(stageParts(g), g.total)}<span class="n">${g.total}</span></div>`).join('')}</div>
    <div class="legend">${state.meta.stages.map((k) => `<span style="--c:var(--${k})"><i></i>${esc(label(k))}</span>`).join('')}</div>`;
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
  const outcomes = outcomesFor(l).length ? outcomesFor(l) : null;
  const n = touches.length + 1;
  const d = nextAction(l);
  const form = l.can_touch && outcomes ? `<div class="touch-form">
      <div class="touch-head"><strong>Registrar toque ${n}</strong>${d ? `<span class="touch-badge ${whenClass(d.days)}">
        ${esc(d.label)} · ${d.agreed ? whenLabel(d) : d.days < 0 ? whenText(d.days) : d.days === 0 ? 'toca hoy' : `el ${shortDate(d.due)}`}</span>` : ''}</div>
      <div class="seg-group" role="radiogroup" aria-label="Medio">${t.channels.map((c, i) => `<label class="seg"><input type="radio" name="touch-channel" value="${c}" ${i === 0 ? 'checked' : ''}><span>${esc(label(c))}</span></label>`).join('')}</div>
      <div class="outcome-grid">${outcomes.map((o) => `<button type="button" class="outcome ${o}" data-outcome="${o}">${esc(t.outcomes[o])}</button>`).join('')}</div>
      ${!l.contacted_at && n === t.max ? '<p class="muted small-note">Es el último toque de la cadencia: si no contesta, el lead pasa a Declinado.</p>' : ''}
    </div>` : '';
  return `<div class="touches"><div class="touch-row">${dots}</div>${form}</div>`;
}

async function openLead(id) {
  const [l, touches] = await Promise.all([api(`/api/leads/${id}`), api(`/api/leads/${id}/touches`)]);
  const ro = l.can_edit ? '' : 'disabled';
  const roOrigin = l.can_edit_origin ? '' : 'disabled';
  const sellers = state.users.filter((u) => (u.active && u.role === 'vendedor') || u.id === l.assigned_to);

  const adLine = [l.utm_content && `Anuncio: ${l.utm_content}`, l.utm_source && [l.utm_source, l.utm_medium].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
  openDrawer(`
    <button class="ghost" data-close style="float:right">Cerrar</button>
    <h2>${esc(l.name || l.phone || l.email)}</h2>
    <div class="contact-line">${[l.phone && esc(l.phone), l.email && esc(l.email)].filter(Boolean).join(' · ')}
      ${waButton(l)}</div>
    <div class="tags">
      <span class="tag status-tag ${textClass(stageOf(l))}" style="${colorVar(stageOf(l))}">${esc(label(stageOf(l)))}</span>
      <span class="tag ${l.profile}">${esc(label(l.profile))}</span>
      ${l.product_name ? `<span class="tag product">${esc(l.product_name)}</span>` : ''}
      ${l.campaign ? `<span class="tag">${esc(l.campaign)}</span>` : l.channel_name ? `<span class="tag">${esc(l.channel_name)}</span>` : ''}
      ${l.quote_amount ? `<span class="tag">Cotizado ${money(l.quote_amount)}</span>` : ''}
      ${l.sale_amount ? `<span class="tag cumple">Vendido ${money(l.sale_amount)}</span>` : ''}
      ${l.campaign_end ? `<span class="tag">Campaña hasta el ${shortDate(`${l.campaign_end}T12:00:00`)}</span>` : ''}
      ${l.renewal_amount ? `<span class="tag cumple">Renovaciones ${money(l.renewal_amount)}</span>` : ''}
    </div>
    ${l.manager_request ? `<p class="request-note">${icon('sparkles', 15)} <span><b>Pedido del gerente:</b> ${esc(l.manager_request)}
      <span class="muted">· se quita cuando el vendedor registre el toque</span></span>${can('gerente') ? '<button type="button" class="ghost small" id="req-clear">Quitar</button>' : ''}</p>` : ''}
    ${can('gerente') && l.assigned_to && !l.manager_request && !['declinado'].includes(l.status)
      ? `<button type="button" class="ghost small ask-followup" id="req-ask">${icon('sparkles', 14)} Pedir seguimiento a ${esc(l.assigned_name)}</button>` : ''}
    ${quickProfileStrip(l)}
    ${l.next_step_at ? `<p class="agreed-note">${icon('calendar', 15)} <span><b>Próximo paso acordado:</b> ${esc(l.next_step || 'dar seguimiento')} ·
      ${new Date(l.next_step_at).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></p>` : ''}
    <p class="muted small-note">Recibido ${fmtDate(l.created_at)} por ${esc(label(l.source))}${l.assigned_name ? ` · atiende ${esc(l.assigned_name)}` : ' · sin asignar'}${adLine ? ` · ${esc(adLine)}` : ''}</p>
    ${l.status === 'declinado' ? `<p class="decline-note">${esc(l.decline_reason || 'Declinado')}${l.recontact_at ? ` · volver a contactar el ${shortDate(`${l.recontact_at}T12:00:00`)}` : ''}
      ${l.can_edit ? '<button type="button" class="ghost small" id="reactivate">Reactivar</button>' : ''}</p>` : ''}
    ${milestones(l)}
    ${touchesPanel(l, touches)}
    ${l.message ? `<p class="card message">${esc(l.message)}</p>` : ''}

    ${l.can_edit_origin ? `<form id="note-form" class="note-form"><textarea name="content" placeholder="Agregar nota (qué platicaron, acuerdos, siguiente paso)"></textarea>
      <div class="actions"><button type="submit" class="small">Agregar nota</button></div></form>` : ''}

    <details class="lead-data">
      <summary>Datos del lead</summary>
      <form id="lead-form">
        <div class="row">
          <label>Nombre <input name="name" value="${esc(l.name)}" ${roOrigin}></label>
          <label>Teléfono <input name="phone" value="${esc(l.phone)}" ${roOrigin}></label>
        </div>
        <label>Email <input name="email" value="${esc(l.email)}" ${roOrigin}></label>
        <div class="row">
          <label>¿De dónde viene? <select name="origin" ${roOrigin}>${originOptions(l.campaign, l.channel_id)}</select></label>
          <label>Producto <select name="product_id" ${roOrigin}>${catalogOptions('producto', l.product_id, 'Sin producto')}</select></label>
        </div>
        <label>Vendedor
          <select name="assigned_to" ${l.can_reassign ? '' : 'disabled'}>
            <option value="">Sin asignar</option>
            ${sellers.map((u) => `<option value="${u.id}" ${u.id === l.assigned_to ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
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
        <label class="${l.status === 'vendido' ? '' : 'hidden'}" id="end-wrap">¿Cuándo termina la campaña?
          <input type="date" name="campaign_end" value="${esc(l.campaign_end || '')}" ${ro}></label>
        <div class="row ${l.status === 'declinado' ? '' : 'hidden'}" id="decline-wrap">
          <label>Motivo <select name="decline_reason" ${ro}>${[...new Set([...(l.decline_reason ? [l.decline_reason] : []), ...state.meta.declineReasons])]
            .map((r) => `<option ${r === l.decline_reason ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
          <label>Volver a contactar el <input type="date" name="recontact_at" value="${esc(l.recontact_at || '')}" ${ro}></label>
        </div>
        <p class="muted small-note">${l.can_edit ? 'La etapa normalmente se mueve sola con los toques; cámbiala aquí solo para corregir.'
          : l.can_edit_origin ? 'Desde marketing se corrigen el origen, el producto y los datos de contacto; la etapa y los toques los lleva ventas.' : ''}</p>
        <p class="error" id="lead-error"></p>
        <div class="actions">
          ${l.can_edit_origin ? '<button type="submit">Guardar cambios</button>' : ''}
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
  const sendRequest = async (text) => {
    try { await api(`/api/leads/${l.id}/request`, { method: 'POST', body: { text } }); openLead(l.id); refresh(); } catch (err) { toast(err.message, 'error'); }
  };
  $('#req-ask')?.addEventListener('click', async () => {
    const text = await ask(`¿Qué le pides a ${l.assigned_name}? Le aparecerá hasta arriba en su Mi día.`, { input: true, placeholder: 'Ej. Llámale hoy y ofrécele 2 caras en Periférico', okLabel: 'Pedir' });
    if (text) { await sendRequest(text); toast('Pedido enviado al vendedor', 'ok'); }
  });
  $('#req-clear')?.addEventListener('click', () => sendRequest(''));
  document.querySelectorAll('#drawer-body [data-qp]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/leads/${l.id}`, { method: 'PATCH', body: { [b.dataset.qp]: l[b.dataset.qp] === b.dataset.v ? null : b.dataset.v } });
      openLead(l.id);
    } catch (err) { toast(err.message, 'error'); }
  }));
  $('#drawer-body [data-wa]')?.addEventListener('click', () => {
    const r = $('#drawer-body input[name=touch-channel][value=whatsapp]'); if (r) r.checked = true;
  });
  const form = $('#lead-form');
  // El vendedor se cambia al momento, aparte de "Guardar": quien asigna no siempre edita el lead.
  form.assigned_to.addEventListener('change', async () => {
    try {
      await api(`/api/leads/${l.id}/assign`, { method: 'POST', body: { assigned_to: form.assigned_to.value || null } });
      toast(form.assigned_to.value ? `Asignado a ${form.assigned_to.selectedOptions[0].textContent}` : 'Sin vendedor', 'ok');
      openLead(l.id); refresh();
    } catch (err) { toast(err.message, 'error'); }
  });
  form.status.addEventListener('change', () => {
    $('#decline-wrap').classList.toggle('hidden', form.status.value !== 'declinado');
    $('#sale-wrap').classList.toggle('hidden', form.status.value !== 'vendido');
    $('#end-wrap').classList.toggle('hidden', form.status.value !== 'vendido');
    $('#quote-wrap').classList.toggle('hidden', !['cotizando', 'vendido', 'declinado'].includes(form.status.value));
    form.status.setAttribute('style', colorVar(form.status.value));
    form.status.classList.toggle('dark-text', DARK_TEXT.has(form.status.value));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(['status', 'profile', 'decline_reason', 'recontact_at', 'sale_amount', 'quote_amount', 'campaign_end', 'name', 'phone', 'email', 'product_id']
      .map((k) => [k, form[k].value]));
    Object.assign(body, originToFields(form.origin.value));
    try {
      await api(`/api/leads/${l.id}`, { method: 'PATCH', body });
      openLead(l.id);
      refresh();
    } catch (err) { $('#lead-error').textContent = err.message; }
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

async function openNewLead() {
  let pick = '';
  if (canAssign()) {
    const w = await api('/api/workload');
    const sug = w.sellers.find((u) => u.id === w.suggested);
    pick = w.sellers.length ? `<label>¿Quién le da seguimiento? <select name="assigned_to">
        ${w.sellers.map((u) => `<option value="${u.id}" ${u.id === w.suggested ? 'selected' : ''}>${esc(u.name)} · ${u.activos} en curso</option>`).join('')}
        <option value="">Sin asignar por ahora</option></select></label>
      ${sug ? `<p class="muted small-note" style="margin-top:-6px">Sugerido: ${esc(sug.name)}, es quien tiene menos leads en curso.</p>` : ''}` : '';
  }
  openDrawer(`
    <button class="ghost" data-close style="float:right">Cerrar</button>
    <h2>Nuevo lead</h2>
    <form id="new-form">
      <label>Teléfono <input name="phone" inputmode="tel" autofocus></label>
      <label>Nombre <input name="name"></label>
      <fieldset class="plain"><legend>¿Por dónde escribió?</legend>
        <div class="seg-group">${state.meta.manualSources.map((src, i) => `<label class="seg"><input type="radio" name="source" value="${src}" ${i === 0 ? 'checked' : ''}><span>${esc(label(src))}</span></label>`).join('')}</div>
      </fieldset>
      <label>¿De dónde viene? <select name="origin" required>${originOptions(null, null, 'Elige campaña o canal…')}</select></label>
      <label>Producto de interés <select name="product_id">${catalogOptions('producto', null, 'Sin definir')}</select></label>
      ${pick}
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

// ---------- Equipo hoy: lo que el gerente tiene que atender de cada vendedor ----------
async function renderTeam() {
  const t = await api('/api/team');
  const light = (r) => (r.vencidos || r.sin_primer_toque || r.acuerdos_vencidos ? 'red' : r.frias || r.hoy > 8 ? 'yellow' : 'green');
  const LIGHT_TEXT = { red: 'Atender hoy', yellow: 'Vigilar', green: 'Al día' };
  const num = (n, bad) => `<td class="num">${n ? `<span class="conv ${bad ? 'bad' : ''}">${n}</span>` : '<span class="muted">0</span>'}</td>`;
  const rows = t.sellers.map((r) => `<tr data-seller="${r.id}">
      <td><span class="light ${light(r)}" title="${LIGHT_TEXT[light(r)]}"></span><span class="avatar" aria-hidden="true">${esc(initials(r.name))}</span><strong>${esc(r.name)}</strong>
        <span class="muted small">${LIGHT_TEXT[light(r)]}</span></td>
      <td class="num"><b>${r.en_curso}</b></td>
      ${num(r.vencidos, true)}${num(r.sin_primer_toque, true)}${num(r.acuerdos_vencidos, true)}${num(r.frias, false)}
      <td class="num">${r.hoy}</td>
      <td class="num">${r.en_cotizacion ? money(r.en_cotizacion) : '—'}</td>
      <td class="num">${r.toques_7d}</td>
      <td class="num">${r.pedidos ? `<span class="conv">${r.pedidos}</span>` : '<span class="muted">0</span>'}</td>
      <td><button type="button" class="ghost small" data-board="${r.id}">Ver sus leads</button></td>
    </tr>
    ${r.alertas.length ? `<tr class="alerts-row"><td colspan="11"><div class="team-alerts">${r.alertas.map((a) => `<button type="button" class="chip-alert" data-open="${a.id}">
      <b>${esc(a.name)}</b> · ${esc(a.why)}</button>`).join('')}</div></td></tr>` : ''}`).join('');
  $('#view-team').innerHTML = `<div class="team">
    <div class="today-summary">
      ${t.unassigned ? (canAssign() ? `<button type="button" class="ghost small" id="team-assign">${t.unassigned} sin asignar · Asignar</button>`
        : `<span class="alert-pill late">${t.unassigned} sin asignar (el operador los reparte)</span>`) : '<span class="alert-pill ok">Todo asignado</span>'}
      <span class="muted">Rojo: algo vencido o un lead sin primer toque después de ${t.first_touch_hours} h. Amarillo: cotizaciones frías (más de ${t.cold_days} días sin contacto).</span>
    </div>
    <section class="card">
      ${cardTitle('users', 'var(--f-contactados)', 'Tu equipo hoy', 'a quién hablarle y de qué lead')}
      ${t.sellers.length ? `<div class="table-wrap"><table class="funnel-table team-table"><thead><tr>
        <th>Vendedor</th><th>En curso</th><th>Vencidos</th><th>Sin primer toque</th><th>Acuerdos vencidos</th><th>Cotizaciones frías</th>
        <th>Para hoy</th><th>En cotización</th><th>Toques 7 días</th><th>Pedidos tuyos</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small-note">Da clic en un lead de la lista para abrir su ficha y, si hace falta, "Pedir seguimiento": le aparece hasta arriba al vendedor.</p>`
        : '<p class="muted">No hay vendedores activos.</p>'}
    </section>
  </div>`;
  const view = $('#view-team');
  $('#team-assign')?.addEventListener('click', () => setView('assign'));
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  view.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => {
    $('#f-assigned').value = b.dataset.board; updateMoreFiltersLabel(); setView('board');
  }));
  animateIn(view);
}

// ---------- Asignación: carga por vendedor y leads sin dueño ----------
async function renderAssign() {
  const ACTIVE = ['nuevo', 'nuevo_perfil', 'cotizando'];
  const [w, all] = await Promise.all([api('/api/workload'), api('/api/leads?assigned=none')]);
  const late = all.filter((l) => ACTIVE.includes(l.status) && waitingTooLong(l.created_at)).length;
  const open = all.filter((l) => ACTIVE.includes(l.status)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const max = Math.max(1, ...w.sellers.map((u) => u.activos));
  const sug = w.sellers.find((u) => u.id === w.suggested);
  const load = w.sellers.length ? `<div class="brows load-rows">${w.sellers.map((u) => `<div class="load-row">
      <span class="k"><span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><strong>${esc(u.name)}</strong>
        ${u.id === w.suggested ? '<span class="conv top">le toca</span>' : ''}</span>
      <div class="battery thin load-bar" role="img" aria-label="${esc(`${u.name}: ${u.por_cotizar} por cotizar, ${u.cotizando} cotizando`)}">
        ${u.por_cotizar ? `<div class="seg" style="--w:${(u.por_cotizar / max) * 100}%; --c:var(--nuevo)" data-tip="${esc(`${u.por_cotizar} por cotizar`)}"></div>` : ''}
        ${u.cotizando ? `<div class="seg dark-text" style="--w:${(u.cotizando / max) * 100}%; --c:var(--cotizando)" data-tip="${esc(`${u.cotizando} cotizando`)}"></div>` : ''}
      </div>
      <span class="n"><b>${u.activos}</b> <span class="muted">en curso</span></span>
      <span class="load-extra">${u.vencidos ? `<span class="conv bad">${u.vencidos} ${u.vencidos === 1 ? 'vencido' : 'vencidos'}</span>` : '<span class="muted">al día</span>'}
        <span class="muted">· ${u.asignados_semana} esta semana</span></span>
    </div>`).join('')}</div>
    <div class="legend"><span style="--c:var(--nuevo)"><i></i>Por cotizar</span><span style="--c:var(--cotizando)"><i></i>Cotizando</span></div>`
    : '<p class="muted">No hay vendedores activos. Dalos de alta en <strong>Usuarios</strong>.</p>';
  const options = (sel) => w.sellers.map((u) => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.name)} · ${u.activos} en curso</option>`).join('');
  const rows = open.map((l) => `<div class="today-row" data-id="${l.id}">
      <div class="today-main">
        <button type="button" class="link name" data-open="${l.id}">${esc(l.name || l.phone || l.email)}</button>
        <span class="muted">${esc(label(l.source))}${l.campaign ? ` · ${esc(l.campaign)}` : ''}${l.product_name ? ` · ${esc(l.product_name)}` : ''}</span>
        <span class="${waitingTooLong(l.created_at) ? 'touch-badge late' : 'muted'}">${timeAgo(l.created_at) === 'ahora' ? 'recién llegó' : `esperando ${timeAgo(l.created_at).replace(/^hace /, '')}`}</span>
      </div>
      ${w.sellers.length ? `<div class="today-actions"><select class="small-select" data-seller aria-label="Vendedor">${options(w.suggested)}</select>
        <button type="button" class="small" data-assign>Asignar</button></div>` : ''}
    </div>`).join('');

  $('#view-assign').innerHTML = `<div class="assign">
    <label class="switch-row card compact-card"><input type="checkbox" id="auto-assign" ${w.auto_assign ? 'checked' : ''}>
      <span><strong>Asignar automáticamente al vendedor con menos carga</strong><br>
      <span class="muted">Apagado, asignas tú cada lead aquí o al capturarlo, con la sugerencia de a quién le toca. Encendido, cada lead que llega sin vendedor se asigna solo.</span></span></label>
    <section class="card">${cardTitle('users', 'var(--f-contactados)', 'Carga por vendedor', 'leads en curso de cada uno: nuevos, perfilados y cotizando')}
      ${load}
      ${sug ? `<p class="muted small-note">Sugerencia: el siguiente lead a <strong>${esc(sug.name)}</strong>, que tiene menos leads en curso${w.sellers.filter((u) => u.activos === sug.activos).length > 1 ? ' (y recibió menos esta semana)' : ''}. Tú decides; la sugerencia solo viene preseleccionada.</p>` : ''}
    </section>
    <section class="card">
      <div class="assign-head">${cardTitle('inbox', 'var(--accent)', `Sin asignar (${open.length})`, late ? `${late} ${late === 1 ? 'lleva' : 'llevan'} más de ${WAIT_HOURS} h esperando: entre más rápido el primer contacto, más cierres` : 'del más viejo al más nuevo')}
        ${open.length > 1 && w.sellers.length ? '<button type="button" class="ghost" id="balance">Repartir todos parejo</button>' : ''}</div>
      ${rows || `<div class="empty-today">${icon('check', 28)}<h3>Todo asignado</h3><p class="muted">Cada lead en curso ya tiene quién le dé seguimiento.</p></div>`}
    </section>
  </div>`;

  const view = $('#view-assign');
  $('#auto-assign').addEventListener('change', async (e) => {
    try {
      await api('/api/assign-settings', { method: 'PATCH', body: { auto_assign: e.target.checked } });
      toast(e.target.checked ? 'Asignación automática encendida' : 'Asignación manual', 'ok');
    } catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
  });
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  view.querySelectorAll('.today-row[data-id]').forEach((r) => $('[data-assign]', r)?.addEventListener('click', async () => {
    const sel = $('[data-seller]', r);
    try {
      await api(`/api/leads/${r.dataset.id}`, { method: 'PATCH', body: { assigned_to: Number(sel.value) } });
      toast(`Asignado a ${sel.selectedOptions[0].textContent.split(' · ')[0]}`, 'ok');
      renderAssign();
    } catch (err) { toast(err.message, 'error'); }
  }));
  $('#balance')?.addEventListener('click', async () => {
    if (!await ask(`Se van a repartir ${open.length} leads, cada uno al vendedor con menos carga en ese momento. ¿Continuar?`, { okLabel: 'Repartir' })) return;
    try {
      const r = await api('/api/leads/balance', { method: 'POST' });
      toast(`${r.assigned} leads repartidos`, 'ok');
      renderAssign();
    } catch (err) { toast(err.message, 'error'); }
  });
  animateIn(view);
}

// ---------- Usuarios ----------
async function renderUsers() {
  state.users = await api('/api/users');
  const roleOpts = (sel) => state.meta.roles.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${ROLE_NAMES[r] || r}</option>`).join('');
  $('#view-users').innerHTML = `
    <div class="card" style="margin: 12px 0">
      <h3 style="margin-top:0">Agregar usuario</h3>
      <form id="user-form" class="row" style="flex-wrap:wrap; align-items:end">
        <label>Nombre <input name="name" required></label>
        <label>Email <input name="email" type="email" required></label>
        <label>Contraseña <input name="password" type="text" minlength="8" required></label>
        <label>Rol <select name="role">${roleOpts('vendedor')}</select></label>
        <fieldset class="plain operator-question hidden" id="op-question">
          <legend>¿Este gerente también hará las funciones de operador (capturar y asignar leads)?</legend>
          <div class="seg-group">
            <label class="seg"><input type="radio" name="can_assign" value="1" disabled><span>Sí, equipo chico</span></label>
            <label class="seg"><input type="radio" name="can_assign" value="" disabled><span>No, hay operador</span></label>
          </div>
        </fieldset>
        <button type="submit" style="flex:0 0 auto">Crear</button>
      </form>
      <p class="error" id="user-error"></p>
      <p class="muted"><b>Gerente:</b> dirige; ve Equipo hoy, el Resumen y todos los leads, pide seguimientos y corrige; reasigna solo en emergencias.
        En equipos chicos puede tener también las <b>funciones de operador</b> (pestaña Asignación).
        <b>Operador:</b> captura y asigna leads y corrige datos; no ve reportes. <b>Vendedor:</b> trabaja los leads que le asignan y ve su propio Resumen.
        <b>Marketing:</b> Resumen de marketing, campañas y audiencias. <b>Analista:</b> solo lectura.</p>
    </div>
    <table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Funciones de operador</th><th>Activo</th><th></th></tr></thead><tbody>
    ${state.users.map((u) => `<tr data-id="${u.id}">
      <td>${esc(u.name)}${u.role === 'vendedor' && u.active ? ` <span class="muted small">· ${u.en_curso} en curso</span>` : ''}</td><td>${esc(u.email)}</td>
      <td><select data-f="role">${roleOpts(u.role)}</select></td>
      <td>${u.role === 'gerente' ? `<label class="inline-check"><input type="checkbox" data-f="can_assign" ${u.can_assign ? 'checked' : ''}> También asigna leads</label>` : '<span class="muted">—</span>'}</td>
      <td><input type="checkbox" data-f="active" ${u.active ? 'checked' : ''}></td>
      <td><button class="ghost" data-f="password">Cambiar contraseña</button></td>
    </tr>`).join('')}
    </tbody></table>`;

  // Al elegir Gerente, la pregunta de funciones de operador se vuelve obligatoria.
  const roleSel = $('#user-form [name=role]');
  const syncQuestion = () => {
    const isManager = roleSel.value === 'gerente';
    $('#op-question').classList.toggle('hidden', !isManager);
    $('#op-question').querySelectorAll('input').forEach((i) => { i.disabled = !isManager; i.required = isManager; if (!isManager) i.checked = false; });
  };
  roleSel.addEventListener('change', syncQuestion); syncQuestion();
  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(e.target));
      await api('/api/users', { method: 'POST', body });
      state.users = await api('/api/users'); fillFilters(); renderUsers();
    } catch (err) { $('#user-error').textContent = err.message; }
  });
  $('#view-users').querySelectorAll('tbody tr').forEach((tr) => {
    const patch = async (body) => {
      let r = null;
      try { r = await api(`/api/users/${tr.dataset.id}`, { method: 'PATCH', body }); } catch (err) { toast(err.message, 'error'); }
      renderUsers();
      return r;
    };
    const u = state.users.find((x) => String(x.id) === tr.dataset.id);
    // Si deja de ser vendedor activo y tiene leads en curso, se avisa que quedarán sin asignar.
    const confirmRelease = async (el, restore) => {
      if (u.role !== 'vendedor' || !u.active || !u.en_curso) return true;
      const ok = await ask(`${u.name} tiene ${u.en_curso} ${u.en_curso === 1 ? 'lead en curso' : 'leads en curso'}. Quedarán sin asignar para repartirlos en Asignación. ¿Continuar?`, { okLabel: 'Continuar' });
      if (!ok) restore(el);
      return ok;
    };
    const released = (r) => { if (r?.released) toast(`${r.released} ${r.released === 1 ? 'lead quedó' : 'leads quedaron'} sin asignar; repártelos en Asignación`, 'ok'); };
    $('[data-f=role]', tr).addEventListener('change', async (e) => {
      if (e.target.value !== 'vendedor' && !await confirmRelease(e.target, (el) => { el.value = u.role; })) return;
      released(await patch({ role: e.target.value }));
    });
    $('[data-f=can_assign]', tr)?.addEventListener('change', async (e) => {
      await patch({ can_assign: e.target.checked });
      if (String(u.id) === String(state.me.id)) { state.me = await api('/api/me'); start(); }
    });
    $('[data-f=active]', tr).addEventListener('change', async (e) => {
      if (!e.target.checked && !await confirmRelease(e.target, (el) => { el.checked = true; })) return;
      released(await patch({ active: e.target.checked }));
    });
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
    ${campaignEditor()}
    ${linkBuilder()}
    <div class="card">
      ${cardTitle('chat', 'var(--whatsapp)', 'Mensajes de WhatsApp')}
      <p class="muted">El botón de WhatsApp abre el chat del cliente con este mensaje ya escrito, según lo que toque con el lead. El vendedor lo puede cambiar antes de enviarlo.
        Se reemplazan solos: <code>{nombre}</code> (primer nombre del cliente), <code>{vendedor}</code> y <code>{producto}</code>.</p>
      <form id="wa-form" class="wa-form">
        ${[['cadencia', 'Primer contacto (aún no contesta)'], ['seguimiento', 'Ya contestó: perfilar o cotizar'], ['cotizacion', 'Seguimiento de la cotización'], ['recontacto', 'Volver a contactar (lo pospuso)'], ['postventa', 'Cliente: cómo va la campaña y referidos'], ['renovacion', 'Cliente: ofrecer la renovación']]
          .map(([k, t]) => `<label>${t}<textarea name="${k}" rows="3" maxlength="1000">${esc(s.wa_templates[k])}</textarea></label>`).join('')}
        <p class="muted small-note">Si dejas uno vacío, vuelve al mensaje de fábrica.</p>
        <button type="submit">Guardar mensajes</button>
      </form>
    </div>
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
  $('#wa-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/settings', { method: 'PATCH', body: { wa_templates: Object.fromEntries(new FormData(e.target)) } });
      state.waTemplates = await api('/api/wa-templates');
      toast('Mensajes guardados', 'ok');
      renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
  wireLinkBuilder();
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

// Links para anuncios: arma la URL con los UTM exactos para que la campaña y el anuncio lleguen bien escritos.
const UTM_SOURCES = [['facebook', 'paid_social', 'Facebook'], ['instagram', 'paid_social', 'Instagram'], ['google', 'cpc', 'Google Ads'],
  ['tiktok', 'paid_social', 'TikTok'], ['email', 'email', 'Correo'], ['otro', 'referral', 'Otro']];
const slug = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function linkBuilder() {
  const camps = state.catalog.campana.filter((c) => c.active);
  return `<div class="card">
    ${cardTitle('megaphone', 'var(--llamada)', 'Links para anuncios')}
    <p class="muted">Arma aquí el link de cada anuncio. Así la campaña y el anuncio llegan bien escritos y el Resumen los mide sin partirse en nombres parecidos.</p>
    <form id="link-form" class="link-form" onsubmit="return false">
      <label>Página a donde lleva el anuncio<input name="url" type="url" placeholder="https://tu-sitio.com/espectaculares" value="${esc(pref.get('landingUrl') || '')}"></label>
      <div class="row">
        <label>Campaña<select name="campaign">${camps.length ? camps.map((c) => `<option>${esc(c.name)}</option>`).join('') : '<option value="">Primero da de alta una campaña</option>'}</select></label>
        <label>Dónde se publica<select name="source">${UTM_SOURCES.map(([v, , t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      </div>
      <label>Nombre del anuncio<input name="ad" maxlength="80" placeholder="Ej. video carretera, carrusel precios"></label>
      <label>Link listo para pegar en el anuncio</label>
      <div class="copy"><input readonly id="link-out" placeholder="Llena la página y la campaña"><button type="button" class="ghost" id="link-copy">Copiar</button></div>
    </form>
  </div>`;
}
function wireLinkBuilder() {
  const f = $('#link-form'); if (!f) return;
  const build = () => {
    const url = f.url.value.trim();
    pref.set('landingUrl', url);
    if (!url || !f.campaign.value) { $('#link-out').value = ''; return; }
    let u;
    try { u = new URL(url); } catch { $('#link-out').value = 'Revisa la dirección de la página (debe empezar con https://)'; return; }
    const src = UTM_SOURCES.find(([v]) => v === f.source.value);
    u.searchParams.set('utm_campaign', f.campaign.value);
    u.searchParams.set('utm_source', src[0]); u.searchParams.set('utm_medium', src[1]);
    if (slug(f.ad.value)) u.searchParams.set('utm_content', slug(f.ad.value)); else u.searchParams.delete('utm_content');
    $('#link-out').value = u.toString();
  };
  f.addEventListener('input', build); f.addEventListener('change', build); build();
  $('#link-copy').addEventListener('click', async () => {
    const v = $('#link-out').value; if (!v.startsWith('http')) return;
    try { await navigator.clipboard.writeText(v); } catch { $('#link-out').select(); document.execCommand('copy'); }
    toast('Link copiado', 'ok');
  });
}

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
    if ($('#drawer').classList.contains('hidden') && !['users', 'settings', 'assign', 'team'].includes(state.view)) refresh();
  }, 30000);
})();
