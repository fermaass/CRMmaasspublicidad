const state = { me: null, meta: null, users: [], leads: [], view: 'board' };
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = (k) => state.meta.labels[k] || k;
const fmtDate = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
const can = (...roles) => state.me && roles.includes(state.me.role);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined || ['POST', 'PATCH'].includes(opts.method) ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : (['POST', 'PATCH'].includes(opts.method) ? '{}' : undefined),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Sesión expirada'); }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
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
  state.users = await api('/api/users');
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
  opts('#f-source', state.meta.sources.map((s) => [s, s[0].toUpperCase() + s.slice(1)]));
  opts('#f-status', state.meta.statuses.map((s) => [s, label(s)]));
  opts('#f-assigned', state.users.filter((u) => u.active).map((u) => [u.id, u.name]));
}

function filterQuery() {
  const p = new URLSearchParams();
  const add = (k, sel) => { const v = $(sel).value.trim(); if (v) p.set(k, v); };
  add('q', '#f-q'); add('profile', '#f-profile'); add('source', '#f-source'); add('assigned', '#f-assigned');
  if (state.view !== 'board') add('status', '#f-status');
  return p.toString();
}

// ---------- Vistas ----------
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
['#f-profile', '#f-source', '#f-assigned', '#f-status'].forEach((s) => $(s).addEventListener('change', refresh));
let searchTimer;
$('#f-q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 300); });
$('#export').addEventListener('click', () => { window.location = `/api/leads.csv?${filterQuery()}`; });
$('#new-lead').addEventListener('click', openNewLead);

function setView(view) {
  state.view = view;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  $('.toolbar').classList.toggle('hidden', view === 'users');
  $('#f-status').classList.toggle('hidden', view === 'board');
  refresh();
}

async function refresh() {
  if (!state.me) return;
  if (state.view === 'users') return renderUsers();
  if (state.view === 'stats') return renderStats();
  state.leads = await api(`/api/leads?${filterQuery()}`);
  state.view === 'board' ? renderBoard() : renderList();
}

function cardHtml(l) {
  return `<div class="lead-card" draggable="${canEditLead(l)}" data-id="${l.id}">
    <div class="name">${esc(l.name || l.phone || l.email)}</div>
    <div class="meta">${esc([l.phone, l.email].filter(Boolean).join(' · '))}</div>
    <div class="meta">
      <span class="tag ${l.source}">${esc(l.source)}</span>
      <span class="tag ${l.profile}">${esc(label(l.profile))}</span>
    </div>
    <div class="meta">${l.assigned_name ? esc(l.assigned_name) : '<em>Sin asignar</em>'} · ${fmtDate(l.updated_at)}</div>
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
      <h3 style="border-color: var(--${s})"><span>${esc(label(s))}</span><span class="muted">${items.length}</span></h3>
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
    const reason = prompt('Motivo por el que se declina (opcional):');
    if (reason === null) return;
    body.decline_reason = reason;
  }
  try {
    await api(`/api/leads/${lead.id}`, { method: 'PATCH', body });
  } catch (err) { alert(err.message); }
  refresh();
}

function renderList() {
  const rows = state.leads.map((l) => `<tr data-id="${l.id}">
    <td><strong>${esc(l.name || '—')}</strong><br><span class="muted">${esc(l.phone || '')} ${esc(l.email || '')}</span></td>
    <td><span class="tag status" style="background: var(--${l.status})">${esc(label(l.status))}</span></td>
    <td><span class="tag ${l.profile}">${esc(label(l.profile))}</span></td>
    <td><span class="tag ${l.source}">${esc(l.source)}</span><br><span class="muted">${esc(l.campaign || '')}</span></td>
    <td>${esc(l.assigned_name || 'Sin asignar')}</td>
    <td class="muted">${fmtDate(l.created_at)}</td>
  </tr>`).join('');
  $('#view-list').innerHTML = `<p class="muted">${state.leads.length} leads</p>
    <table><thead><tr><th>Contacto</th><th>Estado</th><th>Perfil</th><th>Origen / campaña</th><th>Vendedor</th><th>Recibido</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">Sin resultados</td></tr>'}</tbody></table>`;
  $('#view-list').querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openLead(tr.dataset.id)));
}

async function renderStats() {
  const s = await api(`/api/stats?${filterQuery()}`);
  const bars = (rows, lbl = (k) => k) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return rows.map((r) => `<div class="bar"><span title="${esc(lbl(r.key))}">${esc(lbl(r.key))}</span>
      <span class="track"><span class="fill" style="display:block;width:${(r.n / max) * 100}%"></span></span><span>${r.n}</span></div>`).join('')
      || '<p class="muted">Sin datos</p>';
  };
  const n = (rows, key) => rows.find((r) => r.key === key)?.n || 0;
  const sold = n(s.byStatus, 'vendido');
  const fit = n(s.byProfile, 'cumple');
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const ordered = state.meta.statuses.map((k) => ({ key: k, n: n(s.byStatus, k) }));

  $('#view-stats').innerHTML = `<div class="stats">
    <div class="card"><h3>Leads</h3><div class="kpi">${s.total}</div></div>
    <div class="card"><h3>Cumplen perfil</h3><div class="kpi">${fit}</div><span class="muted">${pct(fit, s.total)} del total</span></div>
    <div class="card"><h3>Vendidos</h3><div class="kpi">${sold}</div><span class="muted">${pct(sold, s.total)} del total · ${pct(sold, fit)} de los que cumplen perfil</span></div>
    <div class="card"><h3>Por estado</h3>${bars(ordered, label)}</div>
    <div class="card"><h3>Por perfil</h3>${bars(s.byProfile, label)}</div>
    <div class="card"><h3>Por origen</h3>${bars(s.bySource)}</div>
    <div class="card wide"><h3>Por vendedor</h3>
      <table><thead><tr><th>Vendedor</th><th>Leads</th><th>Cotizando</th><th>Vendidos</th></tr></thead><tbody>
      ${s.bySeller.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.n}</td><td>${r.cotizando}</td><td>${r.vendidos}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="card wide"><h3>Por campaña</h3>
      <table><thead><tr><th>Campaña</th><th>Leads</th><th>Cumplen</th><th>Vendidos</th></tr></thead><tbody>
      ${s.byCampaign.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.n}</td><td>${r.cumple}</td><td>${r.vendidos}</td></tr>`).join('')}
      </tbody></table></div>
  </div>`;
}

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
    <p class="muted">Recibido ${fmtDate(l.created_at)} por <span class="tag ${l.source}">${esc(l.source)}</span>
      ${waLink ? `· <a href="${waLink}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : ''}</p>
    ${l.message ? `<p class="card">${esc(l.message)}</p>` : ''}

    <form id="lead-form">
      <div class="row">
        <label>Estado <select name="status" ${ro}>${state.meta.statuses.map((s) => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></label>
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
  form.status.addEventListener('change', () => $('#decline-wrap').classList.toggle('hidden', form.status.value !== 'declinado'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(['status', 'profile', 'decline_reason', 'name', 'phone', 'email', 'campaign'].map((k) => [k, form[k].value]));
    if (can('gerente', 'marketing')) body.assigned_to = form.assigned_to.value || null;
    try {
      await api(`/api/leads/${l.id}`, { method: 'PATCH', body });
      openLead(l.id);
      refresh();
    } catch (err) { $('#lead-error').textContent = err.message; }
  });
  $('#take')?.addEventListener('click', async () => {
    try { await api(`/api/leads/${l.id}/take`, { method: 'POST' }); openLead(l.id); refresh(); } catch (err) { alert(err.message); }
  });
  $('#delete')?.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este lead y su historial? No se puede deshacer.')) return;
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
      <label>Nombre <input name="name"></label>
      <label>Teléfono <input name="phone"></label>
      <label>Email <input name="email" type="email"></label>
      <label>Campaña <input name="campaign"></label>
      <label>Mensaje / comentario <textarea name="message"></textarea></label>
      <p class="error" id="new-error"></p>
      <button type="submit">Crear</button>
    </form>`);
  $('#new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const { id } = await api('/api/leads', { method: 'POST', body });
      refresh();
      openLead(id);
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
      try { await api(`/api/users/${tr.dataset.id}`, { method: 'PATCH', body }); } catch (err) { alert(err.message); }
      renderUsers();
    };
    $('[data-f=role]', tr).addEventListener('change', (e) => patch({ role: e.target.value }));
    $('[data-f=active]', tr).addEventListener('change', (e) => patch({ active: e.target.checked }));
    $('[data-f=password]', tr).addEventListener('click', () => {
      const password = prompt('Nueva contraseña (mínimo 8 caracteres):');
      if (password) patch({ password });
    });
  });
}

// ---------- Arranque ----------
(async () => {
  state.meta = await api('/api/meta');
  try {
    state.me = await api('/api/me');
    start();
  } catch {
    showLogin();
  }
  // Los leads nuevos aparecen solos: se recarga cada 30 s si no hay un detalle abierto.
  setInterval(() => { if ($('#drawer').classList.contains('hidden') && state.view !== 'users') refresh(); }, 30000);
})();
