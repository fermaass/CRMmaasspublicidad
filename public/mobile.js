// Versión de celular: cada rol ve solo lo que tiene que hacer en ese momento; lo detallado se queda en la computadora.
// Se activa con pantalla angosta. "Ver versión completa" la apaga en ese celular. La versión de escritorio no cambia.
const MOBILE_QUERY = '(max-width: 760px)';
const isSmallScreen = () => window.matchMedia(MOBILE_QUERY).matches;
const mobileOn = () => isSmallScreen() && pref.get('fullsite') !== '1';

// Pestañas de la barra de abajo según lo que hace cada quien.
function mobileTabs() {
  const tabs = [];
  if (sells()) tabs.push({ view: 'today', label: 'Mi día', ico: 'phone' });
  if (canAssign()) tabs.push({ view: 'm-assign', label: 'Asignar', ico: 'inbox' });
  if (can('gerente', 'analista')) tabs.push({ view: 'm-team', label: 'Equipo', ico: 'users' });
  if (sells() || canAssign() || can('gerente')) tabs.push({ action: 'new', label: 'Lead', ico: 'plus' });
  if (!can('operador') || sells()) tabs.push({ view: 'm-numbers', label: sells() && !can('gerente', 'marketing') ? 'Mi mes' : 'Números', ico: 'trend' });
  return tabs;
}
const mobileHome = () => mobileTabs().find((t) => t.view)?.view || 'm-numbers';

function setupMobile() {
  const on = mobileOn();
  document.body.classList.toggle('m', on);
  $('#mbar')?.remove(); $('#m-full')?.remove();
  // En un celular con la versión completa puesta, un aviso discreto para volver.
  if (!on && isSmallScreen()) {
    $('.topbar').insertAdjacentHTML('afterend', '<button type="button" id="m-full" class="ghost small m-back">Volver a la versión de celular</button>');
    $('#m-full').addEventListener('click', () => { pref.set('fullsite', '0'); state.view = null; start(); });
    return false;
  }
  if (!on) return false;
  const tabs = mobileTabs();
  document.body.insertAdjacentHTML('beforeend', `<nav id="mbar" class="mbar" aria-label="Secciones">${tabs.map((t) => `<button type="button" ${t.view ? `data-mview="${t.view}"` : `data-maction="${t.action}"`}>
    ${icon(t.ico, 22)}<span>${esc(t.label)}</span></button>`).join('')}</nav>`);
  $('#mbar').querySelectorAll('[data-mview]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.mview)));
  $('#mbar [data-maction=new]')?.addEventListener('click', openNewLead);
  return true;
}
function markMobileTab(view) {
  document.querySelectorAll('#mbar [data-mview]').forEach((b) => b.classList.toggle('active', b.dataset.mview === view));
}
// Pie de cada pantalla de celular: lo demás está en la computadora.
const fullSiteLink = (what) => `<p class="m-foot muted">${what ? `${esc(what)} está en la computadora. ` : ''}<button type="button" class="link" data-fullsite>Ver versión completa</button></p>`;
function wireFullSite(root) {
  root.querySelectorAll('[data-fullsite]').forEach((b) => b.addEventListener('click', () => { pref.set('fullsite', '1'); state.view = null; start(); }));
}

// ---------- Asignar (coordinador o quien asigna): un toque por lead, con el sugerido ya puesto ----------
async function renderMAssign() {
  const view = $('#view-m-assign');
  const [w, all] = await Promise.all([api('/api/workload'), api('/api/leads?assigned=none')]);
  const open = all.filter((l) => ['nuevo', 'nuevo_perfil', 'cotizando'].includes(l.status)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const sellers = w.sellers.map((u) => ({ ...u }));
  // A quién le toca: el de menos leads en curso y, si empatan, el que recibió menos esta semana.
  const next = () => [...sellers].sort((a, b) => a.activos - b.activos || a.asignados_semana - b.asignados_semana || a.id - b.id)[0];
  const card = (l, sug) => `<div class="m-card m-assign-card" data-id="${l.id}">
      <div class="m-row"><button type="button" class="link name" data-open="${l.id}">${esc(l.name || l.phone || l.email)}</button>
        <span class="${waitingTooLong(l.created_at) ? 'touch-badge late' : 'muted small'}">${timeAgo(l.created_at) === 'ahora' ? 'recién llegó' : `espera ${timeAgo(l.created_at).replace(/^hace /, '')}`}</span></div>
      <div class="muted small">${esc(label(l.source))}${l.campaign ? ` · ${esc(l.campaign)}` : ''}${l.product_name ? ` · ${esc(l.product_name)}` : ''}</div>
      <div class="m-assign-actions">
        <button type="button" class="m-big" data-assign>Asignar a <b data-name>${esc(sug?.name || '')}</b></button>
        <select data-pick aria-label="Elegir otro vendedor">${sellers.map((u) => `<option value="${u.id}" ${u.id === sug?.id ? 'selected' : ''}>${esc(u.name)} · ${u.activos}</option>`).join('')}</select>
      </div>
    </div>`;
  // Cada tarjeta muestra a quién le tocaría si se asignan en orden (el primero al de menos carga, el segundo al siguiente…).
  const projection = (n) => {
    const load = sellers.map((u) => ({ ...u })); const outList = [];
    for (let i = 0; i < n; i++) {
      const s = [...load].sort((a, b) => a.activos - b.activos || a.asignados_semana - b.asignados_semana || a.id - b.id)[0];
      if (!s) break; outList.push(sellers.find((u) => u.id === s.id)); s.activos += 1; s.asignados_semana += 1;
    }
    return outList;
  };
  const plan = projection(open.length);
  const sug = next();
  view.innerHTML = `<div class="m-head"><span class="alert-pill ${open.length ? 'late' : 'ok'}">${open.length ? `${open.length} sin asignar` : 'Todo asignado'}</span>
      ${open.length > 1 && sellers.length ? `<button type="button" class="ghost m-big" data-balance>Repartir los ${open.length} parejo</button>` : ''}</div>
    ${!sellers.length ? '<p class="muted">Da de alta vendedores en la computadora (Usuarios).</p>'
      : open.map((l, i) => card(l, plan[i] || sug)).join('') || `<div class="card empty-today">${icon('check', 28)}<h3>Todo asignado</h3><p class="muted">Cada lead en curso ya tiene quién lo atienda.</p></div>`}
    ${fullSiteLink('La carga del equipo y el reparto automático')}`;
  wireFullSite(view);
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  const refreshSuggestions = () => {
    const cards = [...view.querySelectorAll('.m-assign-card')].filter((c) => !c.dataset.touched); // si eligió a otro a mano, se respeta
    const p = projection(cards.length);
    cards.forEach((c, i) => { if (!p[i]) return; $('[data-pick]', c).value = String(p[i].id); $('[data-name]', c).textContent = p[i].name; });
  };
  $('[data-balance]', view)?.addEventListener('click', async () => {
    const n = view.querySelectorAll('.m-assign-card').length;
    if (!await ask(`Se van a repartir ${n} leads, cada uno al vendedor con menos carga. ¿Continuar?`, { okLabel: 'Repartir' })) return;
    try { const r = await api('/api/leads/balance', { method: 'POST' }); toast(`${r.assigned} leads repartidos`, 'ok'); renderMAssign(); updateAssignBadge(); } catch (err) { toast(err.message, 'error'); }
  });
  view.querySelectorAll('.m-assign-card').forEach((c) => {
    const pick = $('[data-pick]', c);
    pick?.addEventListener('change', () => { c.dataset.touched = '1'; $('[data-name]', c).textContent = sellers.find((u) => String(u.id) === pick.value).name; });
    $('[data-assign]', c)?.addEventListener('click', async () => {
      const seller = sellers.find((u) => String(u.id) === pick.value);
      c.classList.add('going'); // se quita al momento; si falla, regresa
      try {
        await api(`/api/leads/${c.dataset.id}/assign`, { method: 'POST', body: { assigned_to: seller.id } });
        toast(`Asignado a ${seller.name}`, 'ok');
        seller.activos += 1; seller.asignados_semana += 1;
        c.remove();
        const left = view.querySelectorAll('.m-assign-card').length;
        const pill = $('.m-head .alert-pill', view);
        pill.textContent = left ? `${left} sin asignar` : 'Todo asignado'; pill.className = `alert-pill ${left ? 'late' : 'ok'}`;
        const bal = $('[data-balance]', view);
        if (bal) { if (left < 2) bal.remove(); else bal.textContent = `Repartir los ${left} parejo`; }
        refreshSuggestions(); updateAssignBadge();
      } catch (err) { c.classList.remove('going'); toast(err.message, 'error'); }
    });
  });
}

// ---------- Equipo (gerente): el semáforo en tarjetas; tocar abre lo que necesita atención ----------
async function renderMTeam() {
  const view = $('#view-m-team');
  const t = await api('/api/team');
  const light = (r) => (r.vencidos || r.sin_primer_toque || r.acuerdos_vencidos || r.pedidos_tarde ? 'red' : r.frias || r.incompletos.length || r.hoy > 8 ? 'yellow' : 'green');
  const order = { red: 0, yellow: 1, green: 2 };
  const rows = [...t.sellers].sort((a, b) => order[light(a)] - order[light(b)]);
  const badge = (n, text, bad) => (n ? `<span class="conv ${bad ? 'bad' : ''}">${n} ${text}</span>` : '');
  const items = (r) => [
    ...r.pedidos_abiertos.filter((p) => p.horas > 24).map((p) => ({ id: p.id, name: p.name, why: `tu pedido lleva ${p.horas} h` })),
    ...r.alertas, ...r.incompletos.slice(0, 4),
  ];
  view.innerHTML = `<div class="m-head">${t.unassigned ? (canAssign() ? `<button type="button" class="alert-pill late" data-go-assign>${t.unassigned} sin asignar · Asignar</button>` : `<span class="alert-pill late">${t.unassigned} sin asignar</span>`) : '<span class="alert-pill ok">Todo asignado</span>'}</div>
    ${rows.map((r) => `<details class="m-card m-seller ${light(r)}">
      <summary><span class="light ${light(r)}"></span><b>${esc(r.name)}</b><span class="muted small">${r.en_curso} en curso · ${r.hoy} hoy</span>
        ${r.vencidos || r.sin_primer_toque || r.frias ? `<span class="m-badges">${badge(r.vencidos, 'vencidos', true)}${badge(r.sin_primer_toque, 'sin primer toque', true)}${badge(r.frias, 'frías', false)}</span>` : ''}</summary>
      ${items(r).length ? `<div class="m-list">${items(r).map((a) => `<button type="button" class="m-item" data-open="${a.id}"><b>${esc(a.name)}</b><span class="muted small">${esc(a.why)}</span></button>`).join('')}</div>
        <p class="muted small">Abre el lead para <b>pedir seguimiento</b>.</p>` : '<p class="muted small">Al día.</p>'}
    </details>`).join('') || '<p class="muted">No hay vendedores activos.</p>'}
    ${t.top_quotes.length ? `<h3 class="m-sub">Cotizaciones más grandes</h3>${t.top_quotes.slice(0, 6).map((q) => `<button type="button" class="m-card m-item" data-open="${q.id}">
        <span class="m-row"><b>${esc(q.name)}</b><b>${money(q.amount)}</b></span>
        <span class="muted small">${esc(q.seller)} · ${q.dias_sin_contacto === 0 ? 'contacto hoy' : `${q.dias_sin_contacto} ${q.dias_sin_contacto === 1 ? 'día' : 'días'} sin contacto`}</span></button>`).join('')}` : ''}
    ${fullSiteLink('El detalle por vendedor, usuarios y configuración')}`;
  wireFullSite(view);
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  $('[data-go-assign]', view)?.addEventListener('click', () => setView('m-assign'));
}

// ---------- Números del mes: ventas para quien vende o dirige; campañas para marketing ----------
async function renderMNumbers() {
  const view = $('#view-m-numbers');
  const range = periodRange('mes');
  const salesSide = can('gerente', 'vendedor', 'analista') || sells();
  const mktSide = can('gerente', 'marketing', 'analista');
  const [act, st, health] = await Promise.all([
    salesSide ? api(`/api/activity?${rangeQuery(range)}`).catch(() => null) : null,
    mktSide ? api(`/api/stats?${rangeQuery(range)}`).catch(() => null) : null,
    mktSide ? api('/api/campaign-health').catch(() => null) : null,
  ]);
  const sum = (list) => (list || []).reduce((t, x) => t + (x.amount || 0), 0);
  const tile = (value, text, sub = '') => `<div class="m-tile"><b>${value}</b><span>${esc(text)}</span>${sub ? `<small class="muted">${esc(sub)}</small>` : ''}</div>`;
  const month = new Date().toLocaleDateString('es-MX', { month: 'long' });
  let html = `<p class="muted small m-period">Del 1 de ${esc(month)} a hoy</p>`;
  if (act && act.ventas) {
    html += `<div class="m-tiles">
      ${tile(act.recibidos.n, sells() && !can('gerente') ? 'leads asignados' : 'leads recibidos')}
      ${tile(act.cotizaciones.length, 'cotizaciones', money(sum(act.cotizaciones)))}
      ${tile(act.ventas.length, 'ventas', money(sum(act.ventas)))}
      ${act.renovaciones.length ? tile(act.renovaciones.length, 'renovaciones', money(sum(act.renovaciones))) : ''}
    </div>`;
  }
  if (st) {
    const m = marketingMetrics(st);
    html += `<h3 class="m-sub">Campañas</h3><div class="m-tiles">
      ${tile(money(m.inv), 'invertido', `${m.paid} con inversión`)}
      ${tile(m.cpl ? money(m.cpl) : '—', 'por lead')}
      ${tile(m.cplq ? money(m.cplq) : '—', 'por lead con perfil')}
      ${tile(m.cpc ? money(m.cpc) : '—', 'por venta', m.roas ? `retorno ${m.roas.toFixed(1)}x` : '')}
    </div>`;
  }
  if (health) {
    const bad = health.campaigns.filter((c) => c.status !== 'green');
    html += bad.length ? `<h3 class="m-sub">Campañas a revisar</h3>${bad.map((c) => `<div class="m-card"><div class="m-row"><span><span class="light ${c.status}"></span> <b>${esc(c.key)}</b></span>
        <span class="muted small">${c.leads_mes} leads</span></div><ul class="m-why">${c.motivos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}`
      : health.campaigns.length ? '<p class="muted">Todas las campañas van bien este mes.</p>' : '';
  }
  view.innerHTML = `${html}${fullSiteLink('El detalle, las comparaciones y los reportes')}`;
  wireFullSite(view);
}
