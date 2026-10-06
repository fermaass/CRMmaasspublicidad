const state = { company: { name: '', logo: '', term: 'campana', renewals: true }, waTemplates: {}, me: null, meta: null, users: [], catalog: { canal: [], producto: [], campana: [] }, leads: [], view: null, statsTab: null };
const F = window.CRMFollowup;
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = (k) => state.meta.labels[k] || k;
const fmtDate = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
const can = (...roles) => state.me && roles.includes(state.me.role);
// Asignar es el trabajo del Coordinador de leads; a cualquier otro usuario se le puede dar con "También asigna leads".
const canAssign = () => Boolean(state.me && (state.me.role === 'operador' || state.me.can_assign));
// Atiende leads: el vendedor, o cualquier otro con "También atiende leads" (por ejemplo, el gerente de un equipo chico).
const sells = () => Boolean(state.me && (state.me.role === 'vendedor' || state.me.sells));
// Colores con poco contraste para texto blanco: llevan texto oscuro.
const DARK_TEXT = new Set(['cotizando', 'declinado_sin']);
const stageOf = (l) => F.stageOf(l);
const colorVar = (key) => `--c: var(--${key})`;
const textClass = (key) => (DARK_TEXT.has(key) ? 'dark-text' : '');
// Paleta fija para productos y canales (validada para daltonismo); más de 8 se agrupan en "Otros".
const CAT = ['#6161ff', '#ff7a00', '#00a39b', '#e2445c', '#caa000', '#9d50dd', '#037f4c', '#ff5ac4'];
const money = (v) => (v == null ? '—' : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }));
// La plataforma se llama Maass Leads; cada instalación es de una empresa con su nombre, logo y cómo le llama a lo que vende.
const PLATFORM = 'Maass Leads';
function applyCompany(c) {
  state.company = c;
  F.configure({ term: c.term, renewals: c.renewals });
  document.querySelectorAll('.brand-logo').forEach((img) => { img.classList.toggle('hidden', !c.logo); if (c.logo) img.src = c.logo; else img.removeAttribute('src'); });
  // Con logo, arriba se ve el logo; sin logo, el nombre. En la entrada se ven los dos.
  document.querySelectorAll('.company-name').forEach((el) => {
    el.textContent = c.name || '';
    el.classList.toggle('hidden', !c.name || (Boolean(c.logo) && Boolean(el.closest('.topbar'))));
  });
  $('.topbar-company')?.classList.toggle('hidden', !c.name && !c.logo);
  document.title = c.name ? `${PLATFORM} · ${c.name}` : PLATFORM;
}
// Portada de acceso (entrar, crear contraseña, primer uso): se ve mientras no haya sesión.
const showAuth = (on) => { $('#auth').classList.toggle('hidden', !on); if (on) setTimeout(setupCaptcha, 0); };

// Captcha (Cloudflare Turnstile): solo si la instalación tiene clave. Se dibuja en el formulario visible.
const captchaWidgets = {};
function setupCaptcha() {
  const key = state.company.captcha_site_key;
  if (!key) return;
  const render = () => document.querySelectorAll('.captcha-box').forEach((el) => {
    if (el.dataset.ready || !el.offsetParent) return;
    el.dataset.ready = '1';
    captchaWidgets[el.id] = window.turnstile.render(el, {
      sitekey: key, language: 'es', theme: 'light', retry: 'auto', 'refresh-expired': 'auto',
      callback: () => captchaNote(el, ''),
      // Si la verificación no puede correr en este navegador, se dice por qué en vez de dejar solo "Troubleshoot".
      'error-callback': (code) => { captchaNote(el, captchaHelp(code)); return true; },
    });
  });
  if (window.turnstile) { render(); return; }
  if (document.getElementById('turnstile-js')) return;
  window.onTurnstileLoad = render;
  const sc = document.createElement('script');
  sc.id = 'turnstile-js'; sc.async = true; sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
  sc.onerror = () => document.querySelectorAll('.captcha-box').forEach((el) => captchaNote(el, captchaHelp('carga')));
  document.head.append(sc);
}
// Mensaje debajo de la casilla de verificación (vacío = se quita).
function captchaNote(el, text) {
  let n = el.nextElementSibling?.classList.contains('captcha-note') ? el.nextElementSibling : null;
  if (!text) { n?.remove(); return; }
  if (!n) { n = document.createElement('p'); n.className = 'captcha-note'; el.after(n); }
  n.textContent = text;
}
function captchaHelp(code) {
  const c = String(code || '');
  const base = 'No se pudo completar la verificación de seguridad en este navegador.';
  if (c === 'carga') return `${base} Revisa tu internet o desactiva el bloqueador de contenido para este sitio y recarga la página.`;
  if (c.startsWith('110')) return `${base} El sitio no está dado de alta en la verificación (código ${c}): avisa a quien administra la plataforma.`;
  return `${base} Recarga la página. Si sigue: en iPhone desactiva los bloqueadores de contenido y "Ocultar dirección IP" para este sitio (botón aA de Safari), o prueba en Chrome. Código ${c}.`;
}
const captchaToken = (id) => (window.turnstile && captchaWidgets[id] !== undefined ? window.turnstile.getResponse(captchaWidgets[id]) || undefined : undefined);
const captchaReset = (id) => { if (window.turnstile && captchaWidgets[id] !== undefined) window.turnstile.reset(captchaWidgets[id]); };
// ¿Sus clientes renuevan? (campañas, contratos, membresías). Si no, no se pregunta cuándo termina ni se avisa la renovación.
const renewals = () => state.company.renewals !== false;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
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
const ROLE_NAMES = { gerente: 'Gerente', marketing: 'Gerente de marketing', vendedor: 'Vendedor', analista: 'Analista', operador: 'Coordinador de leads' };
const VIEW_TITLES = { today: 'Mi día', board: 'Tablero', assign: 'Asignación de leads', team: 'Equipo hoy', seller: 'Ficha del vendedor', campaign: 'Ficha de campaña', stats: 'Resumen', users: 'Usuarios', settings: 'Configuración' };
const shortDate = (d) => new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
// Guardar preferencias del navegador (pestaña del Resumen, filtros abiertos) sin fallar si no hay almacenamiento.
const pref = {
  get(k) { try { return localStorage.getItem(`crm:${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`crm:${k}`, v); } catch { /* sin almacenamiento */ } },
};
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body !== undefined || ['POST', 'PATCH'].includes(opts.method) ? { 'Content-Type': 'application/json' } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : (['POST', 'PATCH'].includes(opts.method) ? '{}' : undefined),
    });
  } catch {
    // Sin internet o el servidor no respondió: se dice claro que NO se guardó, para que no se pierda el dato sin saberlo.
    throw Object.assign(new Error(opts.method && opts.method !== 'GET'
      ? 'Sin conexión: no se guardó. Revisa tu internet e intenta de nuevo.' : 'Sin conexión con el servidor. Revisa tu internet.'), { api: true });
  }
  let data = null;
  try { data = res.headers.get('content-type')?.includes('json') ? await res.json() : null; } catch { /* respuesta incompleta */ }
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw Object.assign(new Error('Sesión expirada'), { api: true }); }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Error ${res.status}`), { data, api: true });
  return data;
}

// Fallas de programación (no avisos normales como "contraseña incorrecta"): se reportan solas al registro técnico
// para el panel de Maass Leads. Máximo 5 por visita; solo el mensaje y la pantalla, sin datos de clientes.
let reportedErrors = 0;
function reportError(message) {
  if (!state.me || reportedErrors >= 5 || !message) return;
  reportedErrors += 1;
  fetch('/api/ops/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: String(message).slice(0, 300), view: state.view || '' }) }).catch(() => {});
}
window.addEventListener('error', (e) => reportError(e.message));
// Cualquier error que no se haya atrapado se muestra (antes se perdía en silencio).
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message) toast(e.reason.message, 'error');
  if (!e.reason?.api) reportError(e.reason?.message || String(e.reason));
});
window.addEventListener('offline', () => toast('Sin internet: lo que registres no se guardará hasta que vuelva la conexión.', 'error'));
window.addEventListener('online', () => { toast('Conexión de nuevo', 'ok'); if (state.me) refresh(); });
const newRequestId = () => (window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

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
    ok.onclick = () => { if (!extra.reportValidity()) return; close(Object.fromEntries(new FormData(extra))); };
    $('#modal-cancel').onclick = () => close(null);
  });
}

// ---------- Sesión ----------
function showLogin() {
  state.me = null;
  state.view = null; // quien entre después empieza en su propia pantalla, no en la del usuario anterior
  state.showArchived = false;
  $('#app').classList.add('hidden');
  showAuth(true);
  $('#login').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    state.me = await api('/api/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password'), captcha: captchaToken('cap-login') } });
    $('#login-error').textContent = '';
    start();
  } catch (err) {
    $('#login-error').textContent = err.message;
    captchaReset('cap-login'); // cada verificación sirve una sola vez
  }
});

$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showLogin(); });

// Link de invitación o de contraseña nueva: quien lo abre elige su contraseña y entra.
async function showAccess(token) {
  showAuth(true);
  $('#access').classList.remove('hidden');
  const goLogin = () => { history.replaceState(null, '', location.pathname); $('#access').classList.add('hidden'); showLogin(); };
  try {
    const t = await api(`/api/access/${encodeURIComponent(token)}`);
    $('#access-title').textContent = t.kind === 'invite' ? `Hola ${t.name.split(' ')[0]}, crea tu contraseña` : 'Crea tu contraseña nueva';
    $('#access-sub').textContent = `Entrarás con ${t.email}. Solo tú la conoces; ni tu gerente la ve.`;
  } catch (err) {
    $('#access-title').textContent = 'Este link ya no sirve';
    $('#access-sub').textContent = err.message;
    $('#access-form').querySelectorAll('label, button').forEach((el) => el.classList.add('hidden'));
    $('#access-form').insertAdjacentHTML('beforeend', '<button type="button" id="access-login">Ir a la pantalla de entrada</button>');
    $('#access-login').addEventListener('click', goLogin);
    return;
  }
  $('#access-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('password') !== f.get('password2')) { $('#access-error').textContent = 'Las contraseñas no coinciden'; return; }
    try {
      state.me = await api(`/api/access/${encodeURIComponent(token)}`, { method: 'POST', body: { password: f.get('password'), captcha: captchaToken('cap-access') } });
      history.replaceState(null, '', location.pathname);
      $('#access').classList.add('hidden');
      toast('Listo: ya tienes acceso', 'ok');
      start();
    } catch (err) { $('#access-error').textContent = err.message; captchaReset('cap-access'); }
  };
}

// Cambiar mi contraseña (clic en mi nombre arriba a la derecha).
$('#me').addEventListener('click', async () => {
  const v = await askForm('Cambiar mi contraseña', `<label>Contraseña actual<input type="password" name="current" required autocomplete="current-password"></label>
    <label>Contraseña nueva (mínimo 8 caracteres)<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
    <label>Repítela<input type="password" name="password2" minlength="8" required autocomplete="new-password"></label>`, 'Cambiar');
  if (!v) return;
  if (v.password !== v.password2) { toast('Las contraseñas nuevas no coinciden', 'error'); return; }
  try {
    await api('/api/me/password', { method: 'POST', body: { current: v.current, password: v.password } });
    toast('Contraseña cambiada. Se cerró tu sesión en los demás dispositivos.', 'ok');
  } catch (err) { toast(err.message, 'error'); }
});

async function start() {
  $('#login').classList.add('hidden');
  showAuth(false);
  $('#app').classList.remove('hidden');
  $('#me').innerHTML = `<span class="avatar big" aria-hidden="true">${esc(initials(state.me.name))}</span>${esc(state.me.name)}`;
  document.querySelectorAll('[data-role]').forEach((el) => {
    el.classList.toggle('hidden', !el.dataset.role.split(',').includes(state.me.role));
  });
  document.querySelectorAll('[data-assigner]').forEach((el) => el.classList.toggle('hidden', !canAssign()));
  document.querySelectorAll('[data-sells-nav]').forEach((el) => el.classList.toggle('hidden', !sells()));
  if (canAssign()) $('#new-lead').classList.remove('hidden'); // quien asigna también captura leads
  $('#f-assigned').classList.toggle('hidden', state.me.role === 'vendedor');
  [state.users, state.catalog, state.waTemplates] = await Promise.all([api('/api/users'), api('/api/catalog'), api('/api/wa-templates')]);
  fillFilters();
  if (can('gerente')) {
    api('/api/system').then((sys) => {
      $('#storage-warning')?.remove();
      if (sys.storage_warning) {
        $('.topbar').insertAdjacentHTML('afterend', '<div id="storage-warning" class="decline-note storage-warning">Atención: la base de datos no está en un disco persistente y se borrará en la próxima actualización. Conecta un volumen en Railway (ver Configuración).</div>');
      }
      showCarteraReminder(sys.cartera);
    }).catch(() => {});
  }
  // Cada rol arranca en lo suyo: vendedor en Mi día, gerente en Equipo hoy, coordinador en Asignación, marketing y analista en el Resumen.
  const home = { vendedor: 'today', gerente: 'team', operador: 'assign', marketing: 'stats', analista: 'stats' };
  setView(state.view || home[state.me.role] || 'board');
}

// Recordatorio mensual: descargar la cartera en Excel. "Más tarde" lo pospone una semana en este navegador.
function showCarteraReminder(c) {
  $('#cartera-reminder')?.remove();
  let snoozed = 0;
  try { snoozed = Number(localStorage.getItem('cartera-snooze')) || 0; } catch { /* sin almacenamiento: se muestra */ }
  if (!c?.due || snoozed > Date.now()) return;
  $('.topbar').insertAdjacentHTML('afterend', `<div id="cartera-reminder" class="cartera-reminder" role="status">
    <span>${c.last ? `Ya pasó un mes desde que descargaste tu cartera (${shortDate(c.last)}).` : 'Es buen momento para descargar tu cartera por primera vez.'}
      Guárdala en tu computadora o en Drive: es tu copia en Excel de todos tus contactos.</span>
    <a class="button-link small" href="/api/export/cartera.xlsx" download id="cartera-now">Descargar</a>
    <button type="button" class="ghost small" id="cartera-later">Más tarde</button></div>`);
  $('#cartera-now').addEventListener('click', (e) => {
    if (window.crmCartera) { e.preventDefault(); window.crmCartera(); }
    $('#cartera-reminder').remove();
  });
  $('#cartera-later').addEventListener('click', () => {
    try { localStorage.setItem('cartera-snooze', String(Date.now() + 7 * 86400e3)); } catch { /* sin almacenamiento */ }
    $('#cartera-reminder').remove();
  });
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
    if (period === 'custom') {
      const r = periodRange('custom', $('#f-from').value, $('#f-to').value);
      if (r) { p.set('from', r.from.toISOString()); p.set('to', r.to.toISOString()); }
    }
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
  $('#f-custom').classList.add('hidden');
  updateMoreFiltersLabel(); refresh();
});
// ---------- Vistas ----------
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
['#f-profile', '#f-source', '#f-product', '#f-channel', '#f-campaign', '#f-period', '#f-assigned', '#f-status', '#f-reason']
  .forEach((s) => $(s).addEventListener('change', () => { updateMoreFiltersLabel(); refresh(); }));
// "Elegir fechas…": desde y hasta (incluye los dos días). Arranca con el mes en curso.
$('#f-period').addEventListener('change', () => {
  const custom = $('#f-period').value === 'custom';
  $('#f-custom').classList.toggle('hidden', !custom);
  if (custom && !$('#f-from').value) { const r = periodRange('mes'); $('#f-from').value = ymdLocal(r.from); $('#f-to').value = ymdLocal(new Date(r.to - 1)); }
});
['#f-from', '#f-to'].forEach((sel) => $(sel).addEventListener('change', () => { if (periodRange('custom', $('#f-from').value, $('#f-to').value)) refresh(); }));
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
  $('.toolbar').classList.toggle('hidden', ['users', 'settings', 'today', 'assign', 'team', 'seller', 'campaign'].includes(view));
  $('#f-status').classList.toggle('hidden', view === 'board');
  updateMoreFiltersLabel();
  if (view !== 'board') { $('#board-alert').classList.add('hidden'); $('#board-archived')?.classList.add('hidden'); }
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

// Contador en la pestaña Mi día (vendedor): lo vencido y lo de hoy, para verlo desde cualquier vista. En rojo si hay vencidos.
async function updateTodayBadge(leads) {
  const btn = $('#nav [data-view=today]');
  if (!sells()) return;
  try {
    const list = (leads || await api('/api/leads')).filter((l) => l.assigned_to === state.me.id);
    const dues = list.map((l) => ({ l, a: nextAction(l) })).filter(({ l, a }) => l.manager_request || (a && a.days <= 0));
    const late = dues.filter(({ a }) => a && a.days < 0 && a.kind !== 'recontacto').length;
    btn.innerHTML = `Mi día${dues.length ? ` <span class="nav-badge ${late ? 'late' : ''}">${dues.length}</span>` : ''}`;
    btn.title = dues.length ? `${dues.length} por atender${late ? `, ${late} ${late === 1 ? 'vencido' : 'vencidos'}` : ''}` : '';
  } catch { /* el aviso no es crítico */ }
}

async function refresh() {
  if (!state.me) return;
  updateAssignBadge();
  if (state.view !== 'today') updateTodayBadge();
  if (state.view === 'users') return renderUsers();
  if (state.view === 'settings') return renderSettings();
  if (state.view === 'stats') return renderStats();
  if (state.view === 'assign') return renderAssign();
  if (state.view === 'team') return renderTeam();
  if (state.view === 'seller') return renderSeller();
  if (state.view === 'campaign') return renderCampaign();
  // Mi día no usa los filtros: un pendiente viejo no debe esconderse por el periodo elegido.
  if (state.view === 'today') { state.leads = await api('/api/leads'); updateTodayBadge(state.leads); return renderToday(); }
  const r = await api(`/api/leads?${filterQuery()}${state.showArchived ? '' : '&board=1'}`);
  state.leads = Array.isArray(r) ? r : r.leads;
  state.archived = Array.isArray(r) ? null : r;
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
  return can('gerente') || (sells() && l.assigned_to === state.me.id);
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
  return F.waLink(l.phone, kind ? state.waTemplates[kind] : '', { nombre: l.name, vendedor: state.me.name, producto: l.product_name, empresa: state.company.name });
}
const WA_ICON = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z"/></svg>';
const waButton = (l, small = false) => {
  const href = waHref(l);
  return href ? `<a class="wa-btn ${small ? 'small' : ''}" href="${esc(href)}" target="_blank" rel="noopener" data-wa>${WA_ICON}<span>WhatsApp</span></a>` : '';
};
// Llamar con un toque desde el celular; el toque que se registre después queda como Llamada.
const callButton = (l, small = false) => {
  const n = F.waNumber(l.phone);
  return n ? `<a class="call-btn ${small ? 'small' : ''}" href="tel:+${n}" data-call>${icon('phone', small ? 14 : 16)}<span>Llamar</span></a>` : '';
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
  // Mi día es de quien atiende leads: solo los suyos (el panorama del equipo está en Equipo hoy).
  const mine = (l) => (sells() ? l.assigned_to === state.me.id : true);
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
    vendido: `Clientes: preguntar cómo va ${F.theTerm()} y pedir referidos${renewals() ? '; ofrecer la renovación a tiempo' : ''}`,
    declinado_perfil: 'Lo pospusieron y ya llegó la fecha de volver a contactarlos',
    declinado_sin: 'Lo pospusieron y ya llegó la fecha de volver a contactarlos',
  };
  const canTouch = (l) => sells() && l.assigned_to === state.me.id; // igual que el servidor
  const row = ({ l, a, req }) => {
    // "Volver a contactar": los botones son los del lead ya reactivado; al registrar el toque se reactiva solo.
    const outcomes = l.status === 'declinado' ? state.meta.touches.byStatus[l.profile === 'cumple' ? 'nuevo_perfil' : 'nuevo'] : outcomesFor(l);
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
      ${!canTouch(l) ? '' : `<div class="today-actions">
          ${callButton(l, true)}${waButton(l, true)}
          <select class="small-select" data-channel aria-label="Medio">${state.meta.touches.channels.map((c) => `<option value="${c}">${esc(label(c))}</option>`).join('')}</select>
          ${outcomes.slice(0, 4).map((o) => `<button type="button" class="outcome small ${o}" data-outcome="${o}">${esc(state.meta.touches.outcomes[o])}</button>`).join('')}
          ${outcomes.length > 4 ? `<button type="button" class="ghost small" data-open="${l.id}">Otro…</button>` : ''}
        </div>`}
    </div>`;
  };
  const CLOSED = ['vendido', 'declinado_perfil', 'declinado_sin'];
  const sections = state.meta.stages.filter((st) => STAGE_HELP[st]).map((st) => {
    const list = items.filter((x) => stageOf(x.l) === st);
    const onBoard = state.leads.filter(mine).filter((l) => stageOf(l) === st).length;
    if (!list.length) return ''; // solo las etapas con algo que hacer hoy
    return `<section class="card today-group">
      <h3 class="col-head today-head ${textClass(st)}" style="${colorVar(st)}"><span>${esc(label(st))}</span>
        <span class="count">${list.length} hoy${CLOSED.includes(st) ? '' : ` · ${onBoard} en el tablero`}</span></h3>
      <p class="muted small-note today-help">${STAGE_HELP[st]}</p>
      ${list.map(row).join('')}
    </section>`;
  }).join('');
  $('#view-today').innerHTML = `
    <div class="today-summary">
      <span class="alert-pill ${late ? 'late' : 'ok'}">${late ? `${late} ${late === 1 ? 'vencido' : 'vencidos'}` : 'Nada vencido'}</span>
      <span class="alert-pill today">${items.length - late} para hoy</span>
      ${upcoming ? `<span class="muted">${upcoming} más en los próximos 2 días</span>` : ''}
      ${free.length && canAssign() ? `<button type="button" class="ghost small" id="today-assign">${free.length} sin asignar · Asignar</button>` : ''}
      <span class="spacer"></span>
      <input type="search" id="today-q" class="today-search" placeholder="Buscar cliente por nombre o teléfono" aria-label="Buscar cliente" autocomplete="off">
      ${sells() ? '<button type="button" id="today-new">+ Lead</button>' : ''}
    </div>
    <div id="today-results" class="today-results hidden" role="region" aria-live="polite" aria-label="Resultados de la búsqueda"></div>
    ${requested.length ? `<section class="card today-group requests">${cardTitle('sparkles', 'var(--accent)', `Pedidos del gerente (${requested.length})`,
      'Se quitan solos al registrar el toque')}${requested.map(row).join('')}</section>` : ''}
    ${items.length ? sections : requested.length ? '' : `<div class="card empty-today">${icon('check', 28)}<h3>Estás al día</h3><p class="muted">No hay toques ni seguimientos pendientes para hoy.</p></div>`}`;

  const view = $('#view-today');
  // Buscador: cuando el cliente regresa la llamada, encontrarlo sin salir de Mi día. Busca entre los leads del vendedor.
  const search = () => {
    const q = $('#today-q').value.trim(); state.todayQ = q;
    const box = $('#today-results');
    box.classList.toggle('hidden', !q);
    if (!q) { box.innerHTML = ''; return; }
    const low = q.toLowerCase(); const digits = q.replace(/\D/g, '');
    const hits = state.leads.filter(mine).filter((l) => [l.name, l.email, l.campaign].some((v) => v && v.toLowerCase().includes(low))
      || (digits.length >= 3 && String(l.phone || '').replace(/\D/g, '').includes(digits))).slice(0, 8);
    box.innerHTML = hits.length ? hits.map((l) => `<button type="button" class="search-hit" data-open="${l.id}"><b>${esc(l.name || l.phone || l.email)}</b>
        <span class="tag status-tag ${textClass(stageOf(l))}" style="${colorVar(stageOf(l))}">${esc(label(stageOf(l)))}</span>
        ${l.phone ? `<span class="muted">${esc(l.phone)}</span>` : ''}</button>`).join('')
      : '<p class="muted">No encontré a nadie con eso entre tus leads.</p>';
    box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  };
  $('#today-q').value = state.todayQ || '';
  $('#today-q').addEventListener('input', search);
  if (state.todayQ) search();
  $('#today-new')?.addEventListener('click', openNewLead);
  $('#today-assign')?.addEventListener('click', () => setView('assign'));
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  view.querySelectorAll('.today-row[data-id]').forEach((r) => {
    const l = state.leads.find((x) => String(x.id) === r.dataset.id);
    r.querySelectorAll('[data-outcome]').forEach((b) => b.addEventListener('click', async () => {
      if (l.status !== 'declinado') return registerTouch(l, $('[data-channel]', r).value, b.dataset.outcome);
      const status = l.profile === 'cumple' ? 'nuevo_perfil' : 'nuevo';
      try { await api(`/api/leads/${l.id}`, { method: 'PATCH', body: { status, recontact_at: null } }); } catch (err) { toast(err.message, 'error'); return; }
      if (!await registerTouch({ ...l, status }, $('[data-channel]', r).value, b.dataset.outcome)) refresh();
    }));
    // Al abrir WhatsApp, el toque que se registre después queda como WhatsApp.
    $('[data-wa]', r)?.addEventListener('click', () => { const sel = $('[data-channel]', r); if (sel) sel.value = 'whatsapp'; });
    $('[data-call]', r)?.addEventListener('click', () => { const sel = $('[data-channel]', r); if (sel) sel.value = 'llamada'; });
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
const agreementFields = () => `<label>¿Qué se habló o acordó?<input name="note" maxlength="300" placeholder="Ej. Le mando la propuesta por correo hoy"></label>
  <label>¿Cuándo es el siguiente paso?<input type="datetime-local" name="next_step_at"></label>
  <div class="quick-dates">${[['1', 'Mañana'], ['3', 'En 3 días'], ['7', 'En una semana']].map(([d, t]) => `<button type="button" class="ghost small" data-in-days="${d}">${t}</button>`).join('')}</div>`;
// Los botones rápidos ponen la fecha a las 10:00 de ese día (se puede cambiar).
function wireQuickDates(root) {
  root.querySelectorAll('[data-in-days]').forEach((b) => b.addEventListener('click', () => {
    const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.inDays)); d.setHours(10, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    $('[name=next_step_at]', root).value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
    root.querySelectorAll('[data-in-days]').forEach((x) => x.classList.toggle('on', x === b));
  }));
}
const quickProfileFields = (l = {}) => Object.entries(state.meta.quickProfile).map(([k, q]) => `<fieldset class="plain"><legend>${esc(q.label)}</legend>
  <div class="seg-group">${Object.entries(q.options).map(([v, t]) => `<label class="seg"><input type="radio" name="${k}" value="${v}" ${l[k] === v ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div></fieldset>`).join('');
const moneyField = (name, text, required = false) => `<label>${text}<input name="${name}" inputmode="decimal" placeholder="Ej. 60000" ${required ? 'required pattern="[$0-9., ]*[1-9][$0-9., ]*"' : ''}></label>`;
const dateField = (name, text) => `<label>${text}<input type="date" name="${name}"></label>`;
// Producto, cantidad y monto al cotizar o vender. Con precio fijo el monto sale de precio × cantidad y el vendedor no lo cambia.
function priceFields(l, amountName, text) {
  const prods = state.catalog.producto.filter((p) => p.active || p.id === l.product_id);
  if (!prods.length) return moneyField(amountName, text, true);
  return `<div class="row"><label>Producto <select name="product_id" data-prod>
      <option value="" data-price="" data-fixed="0">Sin definir</option>
      ${prods.map((p) => `<option value="${p.id}" data-price="${p.price ?? ''}" data-fixed="${p.fixed_price ? 1 : 0}" ${p.id === l.product_id ? 'selected' : ''}>${esc(p.name)}${p.price ? ` · ${money(p.price)}${p.fixed_price ? ' (fijo)' : ''}` : ''}</option>`).join('')}
    </select></label>
    <label>Cantidad <input name="quantity" inputmode="decimal" value="${l.quantity ?? 1}" data-qty required pattern="[0-9]+([.,][0-9]+)?"></label></div>
    ${moneyField(amountName, text, true)}<p class="muted small-note" data-price-note></p>`;
}
// Al vender, si el producto dura X meses, la fecha de término se pone sola (se puede cambiar).
function wireEndFromProduct(root) {
  const sel = $('[data-prod]', root); const end = $('[name=campaign_end]', root);
  if (!sel || !end) return;
  const sync = () => {
    const p = state.catalog.producto.find((x) => String(x.id) === sel.value);
    if (!p?.duration_months || (end.value && end.dataset.auto !== '1')) return;
    const d = new Date(); d.setMonth(d.getMonth() + p.duration_months);
    end.value = d.toISOString().slice(0, 10); end.dataset.auto = '1';
  };
  end.addEventListener('input', () => { end.dataset.auto = '0'; });
  sel.addEventListener('change', sync); sync();
}
function wirePriceFields(root, amountName) {
  const sel = $('[data-prod]', root); const qty = $('[data-qty]', root); const amt = $(`[name=${amountName}]`, root); const note = $('[data-price-note]', root);
  if (!sel || !amt) return;
  const sync = () => {
    const o = sel.selectedOptions[0]; const price = Number(o?.dataset.price) || 0; const fixed = o?.dataset.fixed === '1';
    const q = Number(String(qty.value).replace(',', '.')) || 1; const total = Math.round(price * q * 100) / 100;
    if (fixed && !can('gerente')) {
      amt.value = String(total); amt.readOnly = true;
      note.textContent = `Precio fijo: ${money(price)} × ${q} = ${money(total)}`;
    } else {
      amt.readOnly = false;
      if (price && (!amt.value || amt.dataset.auto === '1')) { amt.value = String(total); amt.dataset.auto = '1'; }
      note.textContent = price ? `Precio de lista: ${money(price)} × ${q} = ${money(total)}. Si el real es otro, escríbelo.` : '';
    }
  };
  amt.addEventListener('input', () => { amt.dataset.auto = '0'; });
  sel.addEventListener('change', sync); qty.addEventListener('input', sync); sync();
}

// Registra un toque (desde Mi día o la ficha) pidiendo en un solo paso lo que haga falta según el resultado.
// Freno al doble clic: mientras un toque de un lead se está guardando, no se manda otro.
const touchBusy = new Set();
// extra: lo que ya se capturó antes de elegir el resultado (una respuesta del perfil, una nota): va en el mismo toque.
async function registerTouch(l, channel, outcome, extra = {}) {
  if (touchBusy.has(l.id)) return false;
  touchBusy.add(l.id);
  try { return await registerTouchOnce(l, channel, outcome, extra); } finally { touchBusy.delete(l.id); }
}
async function registerTouchOnce(l, channel, outcome, extra = {}) {
  // Mismo identificador si se reintenta: el servidor no lo registra dos veces.
  const body = { channel, outcome, request_id: newRequestId(), ...extra };
  const forms = {
    cumple: ['Cumple perfil. Si puedes, responde (un toque cada una):', `${quickProfileFields(l)}${agreementFields()}`],
    conversacion: ['Contestó. ¿Qué quedaron?', agreementFields()],
    seguimiento: ['Sigue en conversación. ¿Qué quedaron?', agreementFields()],
    cotizado: ['Cotización enviada', `${priceFields(l, 'quote_amount', '¿De cuánto es la cotización?')}${agreementFields()}`],
    vendido: ['¡Venta cerrada!', `${priceFields(l, 'sale_amount', '¿De cuánto fue la venta?')}${renewals() ? dateField('campaign_end', `¿Cuándo termina ${F.theTerm()}? (para ofrecer la renovación a tiempo)`) : ''}`],
    referidos: ['¿Cómo va su campaña?', '<label>¿Te recomendó a alguien?<input name="note" maxlength="300" placeholder="Nombre y teléfono, si te lo dio"></label>'],
    renovo: ['¡Renovó!', `${moneyField('renewal_amount', '¿Por cuánto?')}${dateField('campaign_end', `¿Hasta cuándo va ahora ${F.theTerm()}?`)}`],
  };
  if (forms[outcome]) {
    const pending = askForm(forms[outcome][0], forms[outcome][1]);
    // Lo ya capturado aparece en el recuadro para no escribirlo dos veces.
    for (const [k, val] of Object.entries(extra)) {
      const input = $(`#modal-extra [name="${k}"]:not([type=radio])`); if (input) input.value = val;
      const radio = $(`#modal-extra input[type=radio][name="${k}"][value="${val}"]`); if (radio) radio.checked = true;
    }
    wireQuickDates($('#modal-extra'));
    if (outcome === 'cotizado') wirePriceFields($('#modal-extra'), 'quote_amount');
    if (outcome === 'vendido') {
      // Lo normal es cerrar por lo que se cotizó: el monto viene puesto (se puede cambiar).
      if (l.quote_amount && !$('#modal-extra [name=sale_amount]').value) $('#modal-extra [name=sale_amount]').value = String(l.quote_amount);
      wirePriceFields($('#modal-extra'), 'sale_amount');
      wireEndFromProduct($('#modal-extra'));
    }
    const v = await pending;
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

// Aviso arriba del tablero: cuántos cerrados antiguos están archivados, y el botón para verlos u ocultarlos.
function renderArchivedNote() {
  const el = $('#board-archived');
  const a = state.archived;
  if (!el) return;
  const show = state.view === 'board' && (state.showArchived || a?.archived > 0);
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.innerHTML = state.showArchived
    ? `<span>Estás viendo también los vendidos y declinados antiguos.</span> <button type="button" class="ghost small" id="archived-toggle">Ocultarlos</button>`
    : `<span>${a.archived} ${a.archived === 1 ? 'lead vendido o declinado hace más de' : 'leads vendidos o declinados hace más de'} ${a.archive_days} días no se muestran aquí. Siguen en el Resumen, los reportes, la cartera y la búsqueda.</span>
      <button type="button" class="ghost small" id="archived-toggle">Ver todos</button>`;
  $('#archived-toggle').addEventListener('click', () => { state.showArchived = !state.showArchived; refresh(); });
}

function renderBoard() {
  renderArchivedNote();
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
  if (status === 'cotizando' || status === 'vendido') {
    const key = status === 'cotizando' ? 'quote_amount' : 'sale_amount';
    const pending = askForm(status === 'cotizando' ? 'Mover a Cotizando' : '¡Venta cerrada!',
      priceFields(lead, key, status === 'cotizando' ? '¿De cuánto es la cotización?' : '¿De cuánto fue la venta?'), status === 'cotizando' ? 'Mover a Cotizando' : 'Marcar vendido');
    if (status === 'vendido' && lead.quote_amount) $('#modal-extra [name=sale_amount]').value = String(lead.quote_amount);
    wirePriceFields($('#modal-extra'), key);
    const v = await pending;
    if (!v) return;
    for (const [k, val] of Object.entries(v)) if (val) body[k] = val;
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
  if (period === 'custom') {
    const r = periodRange('custom', $('#f-from').value, $('#f-to').value);
    if (!r) return null;
    to = r.from; from = new Date(r.from.getTime() - (r.to - r.from)); text = 'vs el periodo anterior del mismo largo';
  }
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
  const prevQ = state.me.role === 'vendedor' ? null : prevPeriodQuery();
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
  // Vendedor: solo ventas. Gerente de marketing: solo marketing (evaluar vendedores no es su trabajo). Gerente y analista: ambas.
  const tab = seller ? 'ventas' : state.me.role === 'marketing' ? 'marketing' : state.statsTab || pref.get('statsTab') || 'ventas';
  state.statsTab = tab;
  const health = tab === 'marketing' ? await api('/api/campaign-health').catch(() => null) : null;
  const tabs = !can('gerente', 'analista') ? '' : `<div class="tabs" role="tablist">
    <button type="button" role="tab" data-tab="ventas" class="${tab === 'ventas' ? 'active' : ''}">Ventas</button>
    <button type="button" role="tab" data-tab="marketing" class="${tab === 'marketing' ? 'active' : ''}">Marketing</button></div>`;

  let body;
  if (seller) {
    // El vendedor: él contra el promedio del equipo, su embudo, su pipeline y por qué pierde. Lo demás es trabajo del gerente.
    const mine = s.sellerFunnel.find((r) => r.id === state.me.id) || {};
    const t = s.team;
    const teamV = t && { conv: t.recibidos ? t.cerrados / t.recibidos : null, quoteWin: t.cotizados ? t.cerrados / t.cotizados : null,
      ticket: t.ticket, desc: t.descuento, first: t.primer_toque };
    body = `${compareKpis(mine, teamV)}
    ${teamV ? '<p class="muted small-note stats-hint">"Equipo" es el promedio de todos los vendedores con los mismos filtros: en verde donde vas mejor, en rojo donde vas abajo.</p>' : ''}
    <div class="card chart-card span-6">${cardTitle('funnel', 'var(--accent)', 'Tu embudo', 'cuántos llegan a cada paso')}${funnelChart(f)}</div>
    <div class="card chart-card span-6">${cardTitle('money', 'var(--f-cotizados)', 'Tu pipeline', 'cotizaciones abiertas hoy')}${pipeSummary((s.pipeline || []).find((r) => r.id === state.me.id))}
      ${cardTitle('target', 'var(--declinado)', '¿Por qué se pierden?', 'motivo de tus declinados')}${reasonBars(s.touches.declineReasons)}</div>`;
  } else if (tab === 'ventas') {
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
    <div class="card chart-card">${cardTitle('users', 'var(--f-contactados)', 'Eficiencia por vendedor', 'de lo que recibe cada uno, cuánto avanza')}${sellerTable(s.sellerFunnel)}</div>
    <div class="card chart-card">${cardTitle('money', 'var(--f-cotizados)', 'Pipeline', 'cotizaciones abiertas hoy y venta esperada')}${pipelineTable(s.pipeline)}</div>
    <div class="card chart-card span-6">${cardTitle('target', 'var(--declinado)', '¿Por qué se pierden?', 'motivo de los declinados')}${reasonBars(s.touches.declineReasons)}</div>
    <details class="card chart-card fold-card span-6"><summary>${cardTitle('phone', 'var(--f-contactados)', '¿En qué toque responden?', 'para afinar la cadencia; ábrelo cuando lo necesites')}</summary>
      ${touchBars(s.touches.response, s.touches.noAnswer, 'f-contactados', 'respondieron')}</details>`;
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
    ${healthCard(health)}
    <div class="card chart-card">${cardTitle('megaphone', 'var(--llamada)', 'Campañas', 'clic en una campaña para ver su ficha')}${campaignTable(s.campaignFunnel)}</div>
    <div class="card chart-card">${cardTitle('sparkles', 'var(--nuevo_perfil)', 'Por anuncio', 'qué anuncio trae leads que cumplen perfil y cierran (utm_content)')}${adTable(s.adFunnel)}</div>
    <div class="card chart-card">${cardTitle('target', 'var(--nuevo_perfil)', 'Audiencias para remarketing', 'con los filtros de arriba')}${audienceCards(s.audiences)}</div>
    <div class="card chart-card span-8">${cardTitle('calendar', 'var(--f-recibidos)', 'Leads recibidos', 'últimos 30 días')}${areaChart(s.byDay)}</div>
    <div class="card chart-card span-4">${cardTitle('radio', 'var(--whatsapp)', '¿De dónde vienen?', 'canal, incluido el de cada campaña')}${categoryBars(s.byChannel)}</div>
    <div class="card chart-card">${cardTitle('tag', 'var(--nuevo_perfil)', 'Por producto', 'etapa de cada lead')}${stageRows(s.productStages)}</div>`;
  }
  const banner = seller ? sellerMonth(await api('/api/leads'), s) : tab === 'marketing' ? marketingInsight(s, health) : salesInsight(s, prev, prevQ);
  const reportBtn = `<div class="stats-actions"><button type="button" class="ghost" id="stats-report">${icon('file', 16)} Descargar reporte</button></div>`;
  $('#view-stats').innerHTML = `<div class="dash">${tabs}${reportBtn}${banner}${body}</div>`;
  $('#view-stats').querySelectorAll('[data-campaign-open]').forEach((b) => b.addEventListener('click', () => openCampaign(b.dataset.campaignOpen)));
  $('#monthly-report')?.addEventListener('click', () => openReport('marketing', 'mes_pasado'));
  $('#stats-report').addEventListener('click', () => openReport(seller ? 'vendedor' : tab === 'marketing' ? 'marketing' : 'ventas'));
  $('#view-stats').querySelectorAll('[data-seller-open]').forEach((b) => b.addEventListener('click', () => openSeller(Number(b.dataset.sellerOpen))));
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

// "Tu mes" del vendedor: cuánto lleva vendido contra el mes pasado a estas alturas, y qué tiene por cobrar o atrasado.
// No depende de los filtros: siempre es el mes en curso.
function sellerMonth(leads, s) {
  const now = new Date(); const m0 = new Date(now.getFullYear(), now.getMonth(), 1); const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const sameDay = new Date(m1.getTime() + (now - m0));
  const won = (from, to) => leads.filter((l) => l.assigned_to === state.me.id && l.won_at && new Date(l.won_at) >= from && new Date(l.won_at) < to);
  const total = (xs) => xs.reduce((t, l) => t + (l.sale_amount || 0), 0);
  const cur = won(m0, now); const prev = won(m1, sameDay < m0 ? sameDay : m0);
  const parts = [cur.length ? `Este mes llevas <b>${money(total(cur))}</b> en ${cur.length} ${cur.length === 1 ? 'venta' : 'ventas'}.` : 'Este mes todavía no cierras ventas.'];
  if (prev.length) {
    const d = total(prev) ? Math.round(((total(cur) - total(prev)) / total(prev)) * 100) : null;
    parts.push(`El mes pasado a estas alturas llevabas ${money(total(prev))}${d == null || !cur.length ? '' : ` (${d >= 0 ? '↑' : '↓'} ${Math.abs(d)}%)`}.`);
  }
  const pipe = (s.pipeline || []).find((r) => r.id === state.me.id);
  if (pipe?.vivas) parts.push(`Tienes <b>${pipe.vivas} ${pipe.vivas === 1 ? 'cotización abierta' : 'cotizaciones abiertas'}</b> por ${money(pipe.vivas_monto)}${pipe.esperado ? `; por tu historial, esperas cerrar unos ${money(pipe.esperado)}` : ''}.`);
  if (pipe?.frias) parts.push(`<b>${pipe.frias} ${pipe.frias === 1 ? 'está fría' : 'están frías'}</b> (${money(pipe.frias_monto)}, más de 15 días sin contacto): reactívalas o ciérralas.`);
  const late = leads.filter((l) => l.assigned_to === state.me.id).map(nextAction).filter((a) => a && a.kind !== 'recontacto' && a.days < 0).length;
  parts.push(late ? `Tienes <b>${late} ${late === 1 ? 'pendiente vencido' : 'pendientes vencidos'}</b> en Mi día.` : 'No tienes pendientes vencidos.');
  return `<div class="hero">${icon('sparkles', 22)}<div><h2>Tu mes</h2><p>${parts.join(' ')}</p></div></div>`;
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

// Tabla de vendedores: solo lo que sirve para decidir. El detalle de cada uno está en su ficha (clic en el nombre).
function sellerTable(rows) {
  if (!rows.length) return '<p class="muted">Sin datos</p>';
  const best = Math.max(...rows.filter((r) => r.id).map((r) => pctOf(r.cerrados, r.recibidos)), 0);
  const canOpen = can('gerente', 'analista');
  return `<div class="table-wrap"><table class="funnel-table sellers-table"><thead><tr>
    <th>Vendedor</th><th>Recibe</th><th>Conversión</th><th>Cierra de lo cotizado</th><th>Ticket promedio</th><th>Descuento</th><th>Primer toque</th><th>Vencidos</th>
  </tr></thead><tbody>${rows.map((r) => {
    const conv = pctOf(r.cerrados, r.recibidos);
    return `<tr class="${r.id ? '' : 'unassigned'}">
      <td>${r.id ? `<span class="avatar" aria-hidden="true">${esc(initials(r.key))}</span>` : ''}${r.id && canOpen
        ? `<button type="button" class="link" data-seller-open="${r.id}">${esc(r.key)}</button>` : `<strong>${esc(r.key)}</strong>`}</td>
      <td class="num"><b>${r.recibidos}</b></td>
      <td><span class="conv ${r.id && conv === best && best > 0 ? 'top' : ''}">${conv}%</span> <span class="muted small">${r.cerrados} de ${r.recibidos}</span></td>
      <td class="num">${r.cotizados ? `${pctOf(r.cerrados, r.cotizados)}%` : '—'}</td>
      <td class="num">${r.ticket ? money(r.ticket) : '—'}</td>
      <td class="num">${r.descuento == null ? '—' : r.descuento > 0.1 ? `<span class="conv bad" data-tip="Vende en promedio ${Math.round(r.descuento * 100)}% abajo de lo que cotiza">${Math.round(r.descuento * 100)}%</span>` : `${Math.round(r.descuento * 100)}%`}</td>
      <td class="num">${r.horas_primer_toque != null && r.horas_primer_toque > 24 ? `<span class="conv bad">${hours(r.horas_primer_toque)}</span>` : hours(r.horas_primer_toque)}</td>
      <td>${r.toques_vencidos ? `<span class="conv bad">${r.toques_vencidos}</span>` : '<span class="muted">0</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>
  <p class="muted small-note">${canOpen ? 'Da clic en un vendedor para ver su ficha completa (embudo contra el equipo, pipeline, por qué pierde y pedidos). ' : ''}"Descuento" es cuánto abajo de lo cotizado vende en promedio (más de 10% en rojo). Los tiempos se miden desde que llega el lead.</p>`;
}

// Lectura rápida del gerente: lo que pide acción hoy en su equipo, no el resumen general.
function salesInsight(s, prev, prevQ) {
  const f = s.funnel; const parts = [];
  const late = s.sellerFunnel.filter((r) => r.id && r.toques_vencidos).sort((a, b) => b.toques_vencidos - a.toques_vencidos);
  if (late[0]) parts.push(`<b>${esc(late[0].key)}</b> tiene <b>${late[0].toques_vencidos} ${late[0].toques_vencidos === 1 ? 'pendiente vencido' : 'pendientes vencidos'}</b>${late[1] ? `; ${esc(late[1].key)}, ${late[1].toques_vencidos}` : ''}.`);
  else parts.push('Nadie tiene pendientes vencidos.');
  const exp = (s.pipeline || []).reduce((t, r) => t + (r.esperado || 0), 0);
  const cold = (s.pipeline || []).reduce((t, r) => t + r.frias_monto, 0);
  if (exp) parts.push(`Venta esperada del pipeline: <b>${money(exp)}</b>.`);
  if (cold) parts.push(`Hay <b>${money(cold)}</b> en cotizaciones frías por reactivar o cerrar.`);
  if (prev && f.ingresos != null) {
    const d = prev.funnel.ingresos ? Math.round(((f.ingresos - prev.funnel.ingresos) / prev.funnel.ingresos) * 100) : null;
    parts.push(`Ventas: <b>${money(f.ingresos)}</b>${d == null ? '' : ` (${d >= 0 ? '↑' : '↓'} ${Math.abs(d)}% ${esc(prevQ.text)})`}.`);
  } else parts.push(`Ventas: <b>${money(f.ingresos)}</b> de ${f.cerrados} ${f.cerrados === 1 ? 'cierre' : 'cierres'}.`);
  return `<div class="hero">${icon('sparkles', 22)}<div><h2>Lectura rápida</h2><p>${parts.join(' ')}</p></div></div>`;
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
    <th>Campaña</th><th>Leads</th><th>Cumplen perfil</th><th>Inversión</th><th>Por lead con perfil</th><th>Cierres</th><th>Retorno</th><th>Por qué se descartan</th>
  </tr></thead><tbody>${order.map((r) => {
    const roas = roasOf(r);
    return `<tr>
      <td>${r.key === 'Sin campaña' ? `<strong>${esc(r.key)}</strong>` : `<button type="button" class="link" data-campaign-open="${esc(r.key)}">${esc(r.key)}</button>`}${r === best ? ' <span class="conv top">más eficiente</span>' : ''}</td>
      <td class="num"><b>${r.recibidos}</b></td>
      ${rateCell(r.perfilados, r.recibidos, 'perfilados')}
      <td class="num">${r.inversion > 0 ? money(r.inversion) : '—'}</td>
      <td class="num"><b>${money(per(r, 'perfilados'))}</b></td>
      ${rateCell(r.cerrados, r.recibidos, 'cerrados')}
      <td>${roas == null ? '—' : `<span class="conv ${roas >= 1 ? 'good' : 'bad'}" data-tip="${esc(`Por cada $1 invertido regresaron $${roas.toFixed(2)}`)}">${roas.toFixed(1)}x</span>`}</td>
      ${discardCell(r)}
    </tr>`;
  }).join('')}</tbody></table></div>
  <p class="muted small-note">"Por lead con perfil" es la señal temprana: los cierres tardan semanas, pero en días ya se sabe si una campaña trae leads que sí cumplen.
    Retorno = ventas ÷ inversión. Costo por lead, por cierre, cotizados y días a cerrar están en la ficha de cada campaña.</p>
  ${note}`;
}

// Campañas a revisar: el semáforo del mes en curso (rojas y amarillas; las verdes solo se cuentan).
const LIGHT_LABEL = { red: 'Revisar ya', yellow: 'Vigilar', green: 'Bien' };
function healthCard(h) {
  if (!h) return '';
  const bad = h.campaigns.filter((c) => c.status !== 'green');
  const good = h.campaigns.length - bad.length;
  const rows = bad.map((c) => `<div class="health-row">
      <span class="light ${c.status}" title="${LIGHT_LABEL[c.status]}"></span>
      <div class="health-main"><button type="button" class="link name" data-campaign-open="${esc(c.key)}">${esc(c.key)}</button>
        <span class="muted small">${LIGHT_LABEL[c.status]}</span>
        <ul>${c.motivos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>
      <div class="health-nums"><span><b>${c.inversion_mes ? money(c.inversion_mes) : '—'}</b> invertido</span><span><b>${c.leads_mes}</b> leads</span>
        <span><b>${c.perfil_mes}</b> con perfil</span><span><b>${c.cplq_mes ? money(c.cplq_mes) : '—'}</b> por lead con perfil</span></div>
    </div>`).join('');
  return `<div class="card chart-card">${cardTitle('target', 'var(--declinado)', 'Campañas a revisar', `este mes${h.cplq_promedio ? ` · lead con perfil promedio ${money(h.cplq_promedio)}` : ''}`)}
    ${rows || '<p class="muted">Ninguna campaña requiere atención este mes.</p>'}
    ${good ? `<p class="muted small-note">${good} ${good === 1 ? 'campaña va' : 'campañas van'} bien.</p>` : ''}
    <p class="muted small-note">Rojo: tiene inversión y no trae leads en 7 días, ninguno cumple perfil, o cada lead con perfil cuesta más del doble del promedio.
      Amarillo: trajo leads sin inversión capturada (sus costos salen en cero) o la mitad de sus descartes son por un mismo motivo.</p></div>`;
}

// Lectura rápida de marketing: dónde mover el dinero.
function marketingInsight(s, h) {
  const parts = [];
  const red = h ? h.campaigns.filter((c) => c.status === 'red') : [];
  const yellow = h ? h.campaigns.filter((c) => c.status === 'yellow') : [];
  if (red.length) parts.push(`<b>${red.length} ${red.length === 1 ? 'campaña' : 'campañas'} para revisar ya</b>: ${red.slice(0, 3).map((c) => esc(c.key)).join(', ')}.`);
  else if (h) parts.push('Ninguna campaña en rojo este mes.');
  if (yellow.length) parts.push(`${yellow.length} en vigilancia.`);
  const best = h ? h.campaigns.filter((c) => c.cplq_mes).sort((a, b) => a.cplq_mes - b.cplq_mes)[0] : null;
  if (best) parts.push(`El lead con perfil más barato del mes viene de <b>${esc(best.key)}</b> (${money(best.cplq_mes)}).`);
  if (s.funnel.sin_origen) parts.push(`${s.funnel.sin_origen} ${s.funnel.sin_origen === 1 ? 'lead sin origen' : 'leads sin origen'}: inversión que no se puede medir.`);
  return `<div class="hero">${icon('sparkles', 22)}<div><h2>Lectura rápida</h2><p>${parts.join(' ')}</p></div>
    <button type="button" class="ghost hero-btn" id="monthly-report">Reporte de marketing</button></div>`;
}

// ---------- Ficha de campaña ----------
function openCampaign(name) { state.campaignName = name; setView('campaign'); }
async function renderCampaign() {
  const name = state.campaignName;
  const period = $('#f-period').value;
  const base = new URLSearchParams(filterQuery()); ['assigned', 'campaign', 'q', 'stage', 'profile', 'source', 'product', 'channel', 'reason'].forEach((k) => base.delete(k));
  const mineQ = new URLSearchParams(base); mineQ.set('campaign', name);
  const [me, all, d] = await Promise.all([api(`/api/stats?${mineQ}`), api(`/api/stats?${base}`), api(`/api/campaign-detail?name=${encodeURIComponent(name)}`)]);
  // Una campaña sin leads en el periodo no aparece en el embudo; su inversión se toma de los meses capturados.
  const fromM = base.get('from') ? base.get('from').slice(0, 7) : '0000-00';
  const toM = base.get('to') ? new Date(new Date(base.get('to')).getTime() - 1).toISOString().slice(0, 7) : '9999-99';
  const invPeriod = d.months.filter((x) => x.inversion && x.month >= fromM && x.month <= toM).reduce((t, x) => t + x.inversion, 0) || null;
  const row = me.campaignFunnel.find((r) => r.key === name) || { recibidos: 0, perfilados: 0, cotizados: 0, cerrados: 0, inversion: invPeriod, ingresos: 0 };
  const m = marketingMetrics(all);
  const per = (k) => (row.inversion > 0 && row[k] ? row.inversion / row[k] : null);
  const roas = row.inversion > 0 && row.ingresos ? row.ingresos / row.inversion : null;
  const vs = (txt, good) => `<div class="delta ${good == null ? '' : good ? 'good' : 'bad'}">${txt}</div>`;
  const pctR = row.recibidos ? (row.perfilados / row.recibidos) * 100 : null;
  const maxW = Math.max(1, ...d.weeks.map((w) => w.leads));
  const weeks = `<div class="week-bars" style="--n:${d.weeks.length}" role="img" aria-label="Leads y leads con perfil por semana">${d.weeks.map((w) => `<div class="wk" data-tip="${esc(`Semana del ${shortDate(`${w.week}T12:00:00`)}\n${w.leads} leads · ${w.perfil} con perfil`)}">
      <div class="wk-bars"><i class="all" style="height:${(w.leads / maxW) * 100}%"></i><i class="fit" style="height:${(w.perfil / maxW) * 100}%"></i></div>
      <span>${shortDate(`${w.week}T12:00:00`)}</span></div>`).join('')}</div>
    <div class="legend"><span style="--c:var(--f-recibidos)"><i></i>Leads</span><span style="--c:var(--f-perfilados)"><i></i>Con perfil</span></div>`;
  const months = d.months.length ? `<div class="table-wrap"><table class="funnel-table"><thead><tr><th>Mes</th><th>Inversión</th><th>Leads</th><th>Con perfil</th><th>Por lead con perfil</th></tr></thead><tbody>
      ${d.months.map((x) => `<tr><td>${monthName(x.month)}</td><td class="num">${x.inversion ? money(x.inversion) : '<span class="conv bad">sin capturar</span>'}</td>
        <td class="num">${x.leads}</td><td class="num">${x.perfil}</td><td class="num"><b>${x.inversion && x.perfil ? money(x.inversion / x.perfil) : '—'}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin datos.</p>';
  const COLORS = ['var(--f-cerrados)', 'var(--f-cotizados)', 'var(--declinado)'];
  const qp = Object.values(d.perfil_rapido).map((q) => {
    const parts = q.options.map((o, i) => ({ key: o.value, n: o.n, label: o.label, color: COLORS[i] || 'var(--empty)' }));
    return `<div class="qp-stat"><span class="qp-q">${esc(q.label)} <span class="muted small">(${q.total} respondieron)</span></span>${q.total ? battery(parts, q.total, true) + legend(parts, q.total) : '<p class="muted small">Sin respuestas todavía.</p>'}</div>`;
  }).join('');
  const periods = [['', 'Todo el tiempo'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado'], ['30', 'Últimos 30 días'], ['90', 'Últimos 90 días'], ['anio', 'Este año']];
  $('#view-campaign').innerHTML = `<div class="dash">
    <div class="seller-head">
      <button type="button" class="ghost small" id="camp-back">← Resumen</button>
      <h2>${icon('megaphone', 22)} ${esc(name)}</h2>
      <select id="camp-period" aria-label="Periodo">${periods.map(([v, tx]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${tx}</option>`).join('')}</select>
    </div>
    <div class="kpis" style="--cols:6">
      ${textKpi('inbox', 'Leads', String(row.recibidos), `${row.cotizados} cotizados`, 'var(--f-recibidos)')}
      ${textKpi('userCheck', 'Cumplen perfil', pctR == null ? '—' : `${Math.round(pctR)}%`, `${row.perfilados} leads`, 'var(--cumple)', m.perfil == null ? '' : vs(`promedio: ${Math.round(m.perfil)}%`, pctR == null ? null : pctR >= m.perfil))}
      ${textKpi('money', 'Inversión', row.inversion > 0 ? money(row.inversion) : '—', 'en el periodo', 'var(--llamada)')}
      ${textKpi('userCheck', 'Por lead con perfil', per('perfilados') ? money(per('perfilados')) : '—', `por lead: ${money(per('recibidos'))}`, 'var(--nuevo_perfil)', m.cplq == null ? '' : vs(`promedio: ${money(m.cplq)}`, per('perfilados') == null ? null : per('perfilados') <= m.cplq))}
      ${textKpi('check', 'Cierres', String(row.cerrados), row.cerrados ? `por cierre: ${money(per('cerrados'))}` : 'sin cierres', 'var(--f-cerrados)')}
      ${textKpi('trend', 'Retorno', roas == null ? '—' : `${roas.toFixed(1)}x`, row.dias_cierre ? `cierra en ~${Math.max(1, Math.round(row.dias_cierre))} días` : 'ventas ÷ inversión', 'var(--accent)', m.roas == null ? '' : vs(`promedio: ${m.roas.toFixed(1)}x`, roas == null ? null : roas >= m.roas))}
    </div>
    <div class="card chart-card span-8">${cardTitle('calendar', 'var(--f-recibidos)', 'Tendencia semanal', 'últimas 12 semanas: si los leads con perfil bajan, el anuncio se está cansando')}${weeks}</div>
    <div class="card chart-card span-4">${cardTitle('funnel', 'var(--accent)', 'Su embudo')}${funnelChart(me.funnel)}</div>
    <div class="card chart-card">${cardTitle('money', 'var(--llamada)', 'Inversión contra leads por mes')}${months}</div>
    <div class="card chart-card">${cardTitle('sparkles', 'var(--nuevo_perfil)', 'Sus anuncios')}${adTable(me.adFunnel)}</div>
    <div class="card chart-card span-6">${cardTitle('userCheck', 'var(--cumple)', 'Lo que dicen sus leads', 'perfil rápido que capturan los vendedores')}${qp}</div>
    <div class="card chart-card span-6">${cardTitle('target', 'var(--declinado)', 'Por qué se descartan')}${reasonBars(me.touches.declineReasons)}</div>
  </div>`;
  $('#camp-back').addEventListener('click', () => setView('stats'));
  $('#camp-period').addEventListener('change', (e) => { $('#f-period').value = e.target.value; renderCampaign(); });
  animateIn($('#view-campaign'));
}

// ---------- Reporte mensual de marketing (mes pasado completo contra el anterior) ----------
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
  // Medio sugerido: el del último toque con este cliente, o por donde llegó (WhatsApp o llamada).
  const defChannel = touches.at(-1)?.channel || (t.channels.includes(l.source) ? l.source : t.channels[0]);
  const d = nextAction(l);
  const form = l.can_touch && outcomes ? `<div class="touch-form">
      <div class="touch-head"><strong>Registrar toque ${n}</strong>${d ? `<span class="touch-badge ${whenClass(d.days)}">
        ${esc(d.label)} · ${d.agreed ? whenLabel(d) : d.days < 0 ? whenText(d.days) : d.days === 0 ? 'toca hoy' : `el ${shortDate(d.due)}`}</span>` : ''}</div>
      <div class="seg-group" role="radiogroup" aria-label="Medio">${t.channels.map((c) => `<label class="seg"><input type="radio" name="touch-channel" value="${c}" ${c === defChannel ? 'checked' : ''}><span>${esc(label(c))}</span></label>`).join('')}</div>
      <div class="outcome-grid">${outcomes.map((o) => `<button type="button" class="outcome ${o}" data-outcome="${o}">${esc(t.outcomes[o])}</button>`).join('')}</div>
      ${!l.contacted_at && n === t.max ? '<p class="muted small-note">Es el último toque de la cadencia: si no contesta, el lead pasa a Declinado.</p>' : ''}
    </div>` : '';
  const take = l.can_take ? `<div class="touch-form take-lead"><strong>¿Tú atiendes este lead?</strong>
      <p class="muted small-note">Para anotar llamadas y mensajes ("no contestó", "contestó"…), alguien tiene que atenderlo. Si eres tú, da clic: queda asignado a ti y activa "También atiende leads" en tu usuario.</p>
      <button type="button" id="take-lead">Sí, yo lo atiendo</button></div>` : '';
  return `<div class="touches"><div class="touch-row">${dots}</div>${form}${take}</div>`;
}

async function openLead(id) {
  const [l, touches] = await Promise.all([api(`/api/leads/${id}`), api(`/api/leads/${id}/touches`)]);
  const ro = l.can_edit ? '' : 'disabled';
  const roOrigin = l.can_edit_origin ? '' : 'disabled';
  const sellers = state.users.filter((u) => (u.active && (u.role === 'vendedor' || u.can_sell)) || u.id === l.assigned_to);

  const adLine = [l.utm_content && `Anuncio: ${l.utm_content}`, l.utm_source && [l.utm_source, l.utm_medium].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
  openDrawer(`
    <button class="ghost" data-close style="float:right">Cerrar</button>
    <h2>${esc(l.name || l.phone || l.email)}</h2>
    <div class="contact-line">${[l.phone && esc(l.phone), l.email && esc(l.email)].filter(Boolean).join(' · ')}
      ${callButton(l)}${waButton(l)}</div>
    <div class="tags">
      <span class="tag status-tag ${textClass(stageOf(l))}" style="${colorVar(stageOf(l))}">${esc(label(stageOf(l)))}</span>
      ${label(l.profile) !== label(stageOf(l)) ? `<span class="tag ${l.profile}">${esc(label(l.profile))}</span>` : ''}
      ${l.product_name ? `<span class="tag product">${esc(l.product_name)}</span>` : ''}
      ${l.campaign ? `<span class="tag">${esc(l.campaign)}</span>` : l.channel_name ? `<span class="tag">${esc(l.channel_name)}</span>` : ''}
      ${l.quote_amount ? `<span class="tag">Cotizado ${money(l.quote_amount)}${l.quantity && l.quantity !== 1 ? ` (× ${l.quantity})` : ''}</span>` : ''}
      ${l.sale_amount ? `<span class="tag cumple">Vendido ${money(l.sale_amount)}</span>` : ''}
      ${l.campaign_end ? `<span class="tag">${esc(cap(F.term()))} hasta el ${shortDate(`${l.campaign_end}T12:00:00`)}</span>` : ''}
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
          <label class="${['cotizando', 'vendido', 'declinado'].includes(l.status) ? '' : 'hidden'}" id="qty-wrap">Cantidad
            <input name="quantity" inputmode="decimal" value="${l.quantity ?? ''}" placeholder="1" ${ro}></label>
          <label id="quote-wrap" class="${['cotizando', 'vendido', 'declinado'].includes(l.status) ? '' : 'hidden'}">Monto cotizado (MXN)
            <input name="quote_amount" inputmode="decimal" value="${l.quote_amount ?? ''}" placeholder="Ej. 60000" ${ro}></label>
          <label class="${l.status === 'vendido' ? '' : 'hidden'}" id="sale-wrap">Monto de venta (MXN)
            <input name="sale_amount" inputmode="decimal" value="${l.sale_amount ?? ''}" placeholder="Ej. 45000" ${ro}></label>
        </div>
        <label class="${l.status === 'vendido' && renewals() ? '' : 'hidden'}" id="end-wrap">¿Cuándo termina ${esc(F.theTerm())}?
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
  $('#take-lead')?.addEventListener('click', async () => {
    try {
      await api(`/api/users/${state.me.id}`, { method: 'PATCH', body: { can_sell: true } });
      await api(`/api/leads/${l.id}/assign`, { method: 'POST', body: { assigned_to: state.me.id } });
      state.me = await api('/api/me'); state.users = await api('/api/users');
      document.querySelectorAll('[data-sells-nav]').forEach((el) => el.classList.toggle('hidden', !sells()));
      toast('Listo: el lead es tuyo. Ya puedes registrar el toque.', 'ok');
      refresh(); openLead(l.id);
    } catch (err) { toast(err.message, 'error'); }
  });
  const sendRequest = async (text) => {
    try { await api(`/api/leads/${l.id}/request`, { method: 'POST', body: { text } }); openLead(l.id); refresh(); } catch (err) { toast(err.message, 'error'); }
  };
  $('#req-ask')?.addEventListener('click', async () => {
    const text = await ask(`¿Qué le pides a ${l.assigned_name}? Le aparecerá hasta arriba en su Mi día.`, { input: true, placeholder: 'Ej. Llámale hoy y ofrécele el paquete trimestral', okLabel: 'Pedir' });
    if (text) { await sendRequest(text); toast('Pedido enviado al vendedor', 'ok'); }
  });
  $('#req-clear')?.addEventListener('click', () => sendRequest(''));
  const touchChannel = () => $('#drawer-body input[name=touch-channel]:checked')?.value || state.meta.touches.channels[0];
  document.querySelectorAll('#drawer-body [data-qp]').forEach((b) => b.addEventListener('click', async () => {
    // Responder el perfil de un lead que aún no contestaba = se habló con él: se registra como toque en ese momento.
    if (l.can_touch && !l.contacted_at && l.status === 'nuevo' && l[b.dataset.qp] !== b.dataset.v) {
      if (await registerTouch(l, touchChannel(), 'conversacion', { [b.dataset.qp]: b.dataset.v })) openLead(l.id);
      return;
    }
    try {
      await api(`/api/leads/${l.id}`, { method: 'PATCH', body: { [b.dataset.qp]: l[b.dataset.qp] === b.dataset.v ? null : b.dataset.v } });
      openLead(l.id); refresh();
    } catch (err) { toast(err.message, 'error'); }
  }));
  // Al llamar o escribir, el medio queda elegido y la ficha lleva al recuadro del toque para anotar cómo te fue.
  const toTouch = (ch) => {
    const r = $(`#drawer-body input[name=touch-channel][value=${ch}]`); if (r) r.checked = true;
    const tf = $('#drawer-body .touch-form');
    if (tf) { tf.scrollIntoView({ behavior: 'smooth', block: 'center' }); tf.classList.add('flash'); setTimeout(() => tf.classList.remove('flash'), 1600); }
  };
  $('#drawer-body [data-wa]')?.addEventListener('click', () => toTouch('whatsapp'));
  $('#drawer-body [data-call]')?.addEventListener('click', () => toTouch('llamada'));
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
    $('#end-wrap').classList.toggle('hidden', form.status.value !== 'vendido' || !renewals());
    $('#quote-wrap').classList.toggle('hidden', !['cotizando', 'vendido', 'declinado'].includes(form.status.value));
    $('#qty-wrap').classList.toggle('hidden', !['cotizando', 'vendido', 'declinado'].includes(form.status.value));
    form.status.setAttribute('style', colorVar(form.status.value));
    form.status.classList.toggle('dark-text', DARK_TEXT.has(form.status.value));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(['status', 'profile', 'decline_reason', 'recontact_at', 'sale_amount', 'quote_amount', 'quantity', 'campaign_end', 'name', 'phone', 'email', 'product_id']
      .map((k) => [k, form[k].value]));
    Object.assign(body, originToFields(form.origin.value));
    try {
      body.base_updated_at = l.updated_at;
      await api(`/api/leads/${l.id}`, { method: 'PATCH', body });
      openLead(l.id);
      refresh();
    } catch (err) {
      if (err.data?.stale) { toast(err.message, 'error'); openLead(l.id); refresh(); return; }
      $('#lead-error').textContent = err.message;
    }
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
    const btn = e.target.querySelector('button[type=submit]');
    // Si la nota es de una llamada o mensaje con el cliente, se registra como toque (y mueve la etapa).
    if (l.can_touch && ['nuevo', 'nuevo_perfil', 'cotizando'].includes(l.status)) {
      const n = (l.touch_count || 0) + 1;
      const opts = [`Sí, contestó (registrar toque ${n})`, `No contestó (registrar toque ${n})`, 'Solo guardar la nota'];
      const pick = await ask('¿Esta nota es de un contacto con el cliente?', { options: opts, okLabel: 'Continuar' });
      if (pick === null) return;
      if (pick !== opts[2]) {
        const outcome = pick === opts[1] ? 'sin_respuesta' : l.status === 'nuevo' ? 'conversacion' : 'seguimiento';
        if (await registerTouch(l, touchChannel(), outcome, { note: content })) openLead(l.id);
        return;
      }
    }
    btn.disabled = true;
    try {
      await api(`/api/leads/${l.id}/notes`, { method: 'POST', body: { content } });
      openLead(l.id);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; } // la nota se queda escrita para reintentar
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
  // Lo que casi siempre es igual se pone solo: el último origen y medio que usaste, o la única opción si solo hay una.
  const nf = $('#new-form');
  const remember = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const pickIf = (sel, v) => { if (v && [...sel.options].some((o) => o.value === v)) sel.value = v; };
  const real = (sel) => [...sel.options].filter((o) => o.value && o.value !== 'none');
  if (real(nf.origin).length === 1) nf.origin.value = real(nf.origin)[0].value; else pickIf(nf.origin, remember('nl-origin'));
  if (real(nf.product_id).length === 1) nf.product_id.value = real(nf.product_id)[0].value;
  const lastSource = remember('nl-source');
  if (lastSource) { const r = $(`#new-form input[name=source][value="${lastSource}"]`); if (r) r.checked = true; }
  nf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { origin, ...rest } = Object.fromEntries(new FormData(e.target));
    const body = { ...rest, ...originToFields(origin) };
    try { localStorage.setItem('nl-origin', origin); localStorage.setItem('nl-source', rest.source); } catch { /* sin almacenamiento */ }
    try {
      const { id, existing, repeat_of: repeatOf } = await api('/api/leads', { method: 'POST', body });
      refresh();
      await openLead(id);
      if (existing) {
        $('#drawer-body h2').insertAdjacentHTML('afterend',
          '<p class="warn">Este contacto ya estaba registrado. Se agregó el nuevo contacto a su historial.</p>');
      }
      if (repeatOf) {
        $('#drawer-body h2').insertAdjacentHTML('afterend',
          '<p class="warn">Ya es cliente: compró antes. Se abrió como oportunidad nueva y su venta anterior no se toca.</p>');
      }
    } catch (err) { $('#new-error').textContent = err.message; }
  });
}

// ---------- Equipo hoy: lo que el gerente tiene que atender de cada vendedor ----------
async function renderTeam() {
  const t = await api('/api/team');
  const light = (r) => (r.vencidos || r.sin_primer_toque || r.acuerdos_vencidos || r.pedidos_tarde ? 'red' : r.frias || r.incompletos.length || r.hoy > 8 ? 'yellow' : 'green');
  const LIGHT_TEXT = { red: 'Atender hoy', yellow: 'Vigilar', green: 'Al día' };
  const num = (n, bad) => `<td class="num">${n ? `<span class="conv ${bad ? 'bad' : ''}">${n}</span>` : '<span class="muted">0</span>'}</td>`;
  const reqCell = (r) => `<td class="num">${r.pedidos_abiertos.length ? `<span class="conv ${r.pedidos_tarde ? 'bad' : ''}" data-tip="${esc(r.pedidos_tarde ? `${r.pedidos_tarde} con más de 24 h sin atender` : 'abiertos')}">${r.pedidos_abiertos.length}</span>` : '<span class="muted">0</span>'}
    ${r.pedidos_a_tiempo == null ? '' : `<span class="muted small"> · ${Math.round(r.pedidos_a_tiempo * 100)}% a tiempo</span>`}</td>`;
  const chips = (r) => [
    ...r.pedidos_abiertos.filter((p) => p.horas > 24).map((p) => `<button type="button" class="chip-alert" data-open="${p.id}"><b>${esc(p.name)}</b> · tu pedido lleva ${p.horas} h sin atender</button>`),
    ...r.alertas.map((a) => `<button type="button" class="chip-alert" data-open="${a.id}"><b>${esc(a.name)}</b> · ${esc(a.why)}</button>`),
    ...r.incompletos.slice(0, 6).map((a) => `<button type="button" class="chip-alert data" data-open="${a.id}"><b>${esc(a.name)}</b> · ${esc(a.why)}</button>`),
  ].join('');
  // Vendedor que también asigna: cuántos de los leads que repartió esta semana se quedó él. En rojo si se quedó más que su parte pareja.
  const selfAssign = (r) => {
    if (!r.asigna) return '';
    const fair = r.asigno_7d / Math.max(1, t.sellers.length);
    const much = r.autoasignados_7d >= 2 && r.autoasignados_7d > fair;
    return `<div class="small ${much ? '' : 'muted'}">${much ? '<span class="conv bad">' : ''}Asigna leads: se quedó ${r.autoasignados_7d} de ${r.asigno_7d} esta semana${much ? '</span>' : ''}</div>`;
  };
  const rows = t.sellers.map((r) => `<tr data-seller="${r.id}">
      <td><span class="light ${light(r)}" title="${LIGHT_TEXT[light(r)]}"></span><span class="avatar" aria-hidden="true">${esc(initials(r.name))}</span>
        <button type="button" class="link" data-seller-open="${r.id}">${esc(r.name)}</button> <span class="muted small">${LIGHT_TEXT[light(r)]}</span>${selfAssign(r)}</td>
      <td class="num"><b>${r.en_curso}</b></td>
      ${num(r.vencidos, true)}${num(r.sin_primer_toque, true)}${num(r.acuerdos_vencidos, true)}${num(r.frias, false)}
      <td class="num">${r.hoy}</td>
      <td class="num">${r.en_cotizacion ? money(r.en_cotizacion) : '—'}</td>
      <td class="num">${r.toques_7d}</td>
      ${reqCell(r)}
      ${num(r.incompletos.length, false)}
    </tr>
    ${chips(r) ? `<tr class="alerts-row"><td colspan="11"><div class="team-alerts">${chips(r)}</div></td></tr>` : ''}`).join('');
  const top = t.top_quotes.length ? `<div class="table-wrap"><table class="funnel-table"><thead><tr>
      <th>Cliente</th><th>Vendedor</th><th>Monto</th><th>Último contacto</th><th>Siguiente paso</th><th></th></tr></thead><tbody>
      ${t.top_quotes.map((q) => `<tr><td><button type="button" class="link" data-open="${q.id}">${esc(q.name)}</button></td><td>${esc(q.seller)}</td>
        <td class="num"><b>${money(q.amount)}</b></td>
        <td class="num">${q.dias_sin_contacto >= t.cold_days ? `<span class="conv bad">hace ${q.dias_sin_contacto} días</span>` : q.dias_sin_contacto === 0 ? 'hoy' : `hace ${q.dias_sin_contacto} ${q.dias_sin_contacto === 1 ? 'día' : 'días'}`}</td>
        <td>${q.siguiente ? `${esc(q.siguiente)}${q.vence != null && q.vence < 0 ? ` <span class="conv bad">${-q.vence} ${q.vence === -1 ? 'día' : 'días'} tarde</span>` : ''}` : '—'}</td>
        <td>${q.pedido ? '<span class="request-pill">pedido enviado</span>' : `<button type="button" class="ghost small" data-open="${q.id}">Abrir</button>`}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No hay cotizaciones abiertas con monto.</p>';
  // Primeros pasos: se marcan solos y la tarjeta desaparece al terminar (o si se oculta).
  let hidden = false; try { hidden = localStorage.getItem('onboarding-hidden') === '1'; } catch { /* sin almacenamiento */ }
  const ob = hidden ? null : await api('/api/onboarding').catch(() => null);
  const obCard = ob && !ob.done ? `<section class="card onboarding">${cardTitle('check', 'var(--accent)', `Primeros pasos · ${ob.steps.filter((st) => st.done).length} de ${ob.steps.length}`, 'se marcan solos conforme los haces')}
    <ul class="ob-list">${ob.steps.map((st) => `<li class="${st.done ? 'done' : ''}"><span class="ob-dot">${st.done ? '✓' : ''}</span>
      ${st.done ? `<span>${esc(st.label)}</span>` : `<button type="button" class="link" data-ob-view="${st.view}" data-ob-tab="${st.tab || ''}">${esc(st.label)}</button>`}</li>`).join('')}</ul>
    <button type="button" class="ghost small" id="ob-hide">Ocultar</button></section>` : '';
  $('#view-team').innerHTML = `${obCard}<div class="team">
    <div class="today-summary">
      ${t.unassigned ? (canAssign() ? `<button type="button" class="ghost small" id="team-assign">${t.unassigned} sin asignar · Asignar</button>`
        : `<span class="alert-pill late">${t.unassigned} sin asignar (los reparte quien asigna leads)</span>`) : '<span class="alert-pill ok">Todo asignado</span>'}
      <span class="muted">Rojo: algo vencido, un lead sin primer toque después de ${t.first_touch_hours} h o un pedido tuyo con más de 24 h. Amarillo: cotizaciones frías o datos incompletos.</span>
      <span class="spacer"></span>
      <button type="button" class="ghost" id="weekly-report">Reporte de ventas</button>
    </div>
    <section class="card">
      ${cardTitle('users', 'var(--f-contactados)', 'Tu equipo hoy', 'a quién hablarle y de qué lead')}
      ${t.sellers.length ? `<div class="table-wrap"><table class="funnel-table team-table"><thead><tr>
        <th>Vendedor</th><th>En curso</th><th>Vencidos</th><th>Sin primer toque</th><th>Acuerdos vencidos</th><th>Cotizaciones frías</th>
        <th>Para hoy</th><th>En cotización</th><th>Toques 7 días</th><th>Tus pedidos</th><th>Datos incompletos</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small-note">Da clic en un vendedor para ver su ficha, o en un lead para abrirlo y "Pedir seguimiento". Los avisos grises son datos incompletos (ventas o cotizaciones sin monto, declinados sin motivo) que hacen que los reportes engañen.</p>`
        : '<p class="muted">No hay vendedores activos.</p>'}
    </section>
    <section class="card">${cardTitle('money', 'var(--f-cotizados)', 'Las cotizaciones más grandes', 'los tratos que conviene empujar en persona')}${top}</section>
  </div>`;
  const view = $('#view-team');
  $('#team-assign')?.addEventListener('click', () => setView('assign'));
  view.querySelectorAll('[data-ob-view]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.obTab) state.settingsTab = b.dataset.obTab;
    setView(b.dataset.obView);
  }));
  $('#ob-hide')?.addEventListener('click', () => { try { localStorage.setItem('onboarding-hidden', '1'); } catch { /* sin almacenamiento */ } renderTeam(); });
  $('#weekly-report').addEventListener('click', () => openReport('ventas', '7'));
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  view.querySelectorAll('[data-seller-open]').forEach((b) => b.addEventListener('click', () => openSeller(Number(b.dataset.sellerOpen))));
  animateIn(view);
}

// ---------- Ficha del vendedor: para la junta uno a uno ----------
// Un vendedor contra el promedio del equipo: en la ficha del vendedor (gerente) y en el Resumen del propio vendedor.
const pctS = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
function compareKpis(mine, teamV) {
  const myV = { conv: mine.recibidos ? mine.cerrados / mine.recibidos : null, quoteWin: mine.cotizados ? mine.cerrados / mine.cotizados : null,
    ticket: mine.ticket ?? null, desc: mine.descuento ?? null, first: mine.horas_primer_toque ?? null };
  const cmp = (mv, tv, fmt, lowerIsBetter = false) => {
    if (!teamV) return '';
    if (mv == null || tv == null) return `<div class="delta">equipo: ${tv == null ? '—' : fmt(tv)}</div>`;
    const better = lowerIsBetter ? mv < tv : mv > tv; const same = Math.abs(mv - tv) < 1e-9;
    return `<div class="delta ${same ? '' : better ? 'good' : 'bad'}">equipo: ${fmt(tv)}</div>`;
  };
  const t = teamV || {};
  return `<div class="kpis" style="--cols:5">
      ${textKpi('trend', 'Conversión', pctS(myV.conv), `${mine.cerrados || 0} de ${mine.recibidos || 0} leads`, 'var(--accent)', cmp(myV.conv, t.conv, pctS))}
      ${textKpi('check', 'Cierra de lo cotizado', pctS(myV.quoteWin), `${mine.cerrados || 0} de ${mine.cotizados || 0} cotizaciones`, 'var(--f-cerrados)', cmp(myV.quoteWin, t.quoteWin, pctS))}
      ${textKpi('money', 'Ticket promedio', myV.ticket ? money(myV.ticket) : '—', 'por venta', 'var(--f-cotizados)', cmp(myV.ticket, t.ticket, money))}
      ${textKpi('file', 'Descuento', pctS(myV.desc), 'abajo de lo cotizado', 'var(--declinado)', cmp(myV.desc, t.desc, pctS, true))}
      ${textKpi('clock', 'Primer toque', myV.first == null ? '—' : hours(myV.first), 'desde que llega el lead', 'var(--f-contactados)', cmp(myV.first, t.first, hours, true))}
    </div>`;
}
// Cotizaciones abiertas de un vendedor en una línea: vivas, frías y venta esperada.
function pipeSummary(pipe) {
  if (!pipe) return '<p class="muted">Sin cotizaciones abiertas.</p>';
  return `<p class="big-line"><b>${pipe.vivas}</b> vivas por <b>${money(pipe.vivas_monto)}</b>${pipe.frias ? ` · <span class="conv bad">${pipe.frias} frías por ${money(pipe.frias_monto)}</span>` : ''}</p>
        <p class="muted">Venta esperada: <b>${pipe.esperado == null ? 'sin historial suficiente' : money(pipe.esperado)}</b>${pipe.tasa == null ? '' : ` (cierra ${Math.round(pipe.tasa * 100)}% de sus cotizaciones)`}</p>`;
}

function openSeller(id) { state.sellerId = id; setView('seller'); }
async function renderSeller() {
  const id = state.sellerId;
  const period = $('#f-period').value;
  const base = new URLSearchParams(filterQuery()); ['assigned', 'campaign', 'q', 'stage', 'profile', 'source', 'product', 'channel', 'reason'].forEach((k) => base.delete(k));
  const mineQ = new URLSearchParams(base); mineQ.set('assigned', id);
  const [me, team, t] = await Promise.all([api(`/api/stats?${mineQ}`), api(`/api/stats?${base}`), api('/api/team')]);
  const row = t.sellers.find((r) => r.id === id) || { pedidos_abiertos: [], alertas: [], incompletos: [], pedidos_a_tiempo: null };
  const mine = me.sellerFunnel.find((r) => r.id === id) || {};
  const sellers = team.sellerFunnel.filter((r) => r.id);
  const sum = (k) => sellers.reduce((x, r) => x + (r[k] || 0), 0);
  const avgBy = (k, w) => { const rs = sellers.filter((r) => r[k] != null && r[w]); const tw = rs.reduce((x, r) => x + r[w], 0); return tw ? rs.reduce((x, r) => x + r[k] * r[w], 0) / tw : null; };
  const teamV = { conv: sum('recibidos') ? sum('cerrados') / sum('recibidos') : null, quoteWin: sum('cotizados') ? sum('cerrados') / sum('cotizados') : null,
    ticket: avgBy('ticket', 'cerrados'), desc: avgBy('descuento', 'cerrados'), first: team.touches.speed };
  const pipe = (me.pipeline || []).find((r) => r.id === id);
  const teamReason = team.touches.declineReasons[0];
  const periods = [['', 'Todo el tiempo'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado'], ['30', 'Últimos 30 días'], ['90', 'Últimos 90 días'], ['anio', 'Este año']];
  $('#view-seller').innerHTML = `<div class="dash">
    <div class="seller-head">
      <button type="button" class="ghost small" id="seller-back">← Equipo hoy</button>
      <h2><span class="avatar big" aria-hidden="true">${esc(initials(row.name || mine.key || ''))}</span>${esc(row.name || mine.key || 'Vendedor')}</h2>
      <select id="seller-period" aria-label="Periodo">${periods.map(([v, tx]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${tx}</option>`).join('')}</select>
      <span class="spacer"></span>
      <button type="button" class="ghost small" id="seller-board">Ver sus leads en el tablero</button>
    </div>
    ${compareKpis(mine, teamV)}
    <div class="card chart-card span-6">${cardTitle('funnel', 'var(--accent)', 'Su embudo', 'cuántos llegan a cada paso')}${funnelChart(me.funnel)}</div>
    <div class="card chart-card span-6">${cardTitle('money', 'var(--f-cotizados)', 'Su pipeline', 'cotizaciones abiertas hoy')}
      ${pipeSummary(pipe)}
      ${cardTitle('target', 'var(--declinado)', 'Por qué pierde', teamReason ? `en el equipo, el motivo principal es "${teamReason.key}"` : '')}${reasonBars(me.touches.declineReasons)}</div>
    <div class="card chart-card span-6">${cardTitle('sparkles', 'var(--accent)', 'Tus pedidos', row.pedidos_a_tiempo == null ? 'sin historial de pedidos' : `atiende a tiempo el ${Math.round(row.pedidos_a_tiempo * 100)}% (menos de 24 h)`)}
      ${row.pedidos_abiertos.length ? row.pedidos_abiertos.map((p) => `<div class="today-row"><div class="today-main"><button type="button" class="link name" data-open="${p.id}">${esc(p.name)}</button>
        <span class="${p.horas > 24 ? 'touch-badge late' : 'muted'}">hace ${p.horas} h</span><span class="today-note">“${esc(p.text)}”</span></div></div>`).join('') : '<p class="muted">No tiene pedidos abiertos.</p>'}</div>
    <div class="card chart-card span-6">${cardTitle('phone', 'var(--declinado)', 'Para hablar hoy', 'vencidos, cotizaciones frías y datos incompletos')}
      ${[...row.alertas, ...row.incompletos].length ? `<div class="team-alerts no-pad">${row.alertas.map((a) => `<button type="button" class="chip-alert" data-open="${a.id}"><b>${esc(a.name)}</b> · ${esc(a.why)}</button>`).join('')}
        ${row.incompletos.map((a) => `<button type="button" class="chip-alert data" data-open="${a.id}"><b>${esc(a.name)}</b> · ${esc(a.why)}</button>`).join('')}</div>` : '<p class="muted">Nada pendiente.</p>'}</div>
  </div>`;
  const view = $('#view-seller');
  $('#seller-back').addEventListener('click', () => setView('team'));
  $('#seller-period').addEventListener('change', (e) => { $('#f-period').value = e.target.value; renderSeller(); });
  $('#seller-board').addEventListener('click', () => { $('#f-assigned').value = id; updateMoreFiltersLabel(); setView('board'); });
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openLead(b.dataset.open)));
  animateIn(view);
}

// ---------- Reportes por periodo: cada rol elige las fechas, lo ve, lo imprime/guarda en PDF o lo descarga en Excel ----------
// kind: 'ventas' (gerente y analista), 'vendedor' (el suyo), 'marketing', 'asignacion' (quien asigna leads).
const REPORT_PRESETS = [['7', 'Últimos 7 días'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado'], ['30', 'Últimos 30 días'], ['90', 'Últimos 90 días'], ['anio', 'Este año'], ['custom', 'Elegir fechas']];
async function openReport(kind, preset) {
  // El periodo arranca con el de los filtros (si hay uno) o con el más común para ese reporte.
  const cur = $('#f-period').value;
  const start = cur === 'custom' && periodRange('custom', $('#f-from').value, $('#f-to').value) ? 'custom'
    : REPORT_PRESETS.some(([k]) => k === cur) ? cur : preset || 'mes';
  const r0 = start === 'custom' ? periodRange('custom', $('#f-from').value, $('#f-to').value) : periodRange(start);
  const pending = askForm('Reporte: elige el periodo', `
    <label>Periodo <select name="preset" data-preset>${REPORT_PRESETS.map(([k, t]) => `<option value="${k}" ${k === start ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <div class="row"><label>Desde <input type="date" name="from" value="${ymdLocal(r0.from)}" required></label>
      <label>Hasta <input type="date" name="to" value="${ymdLocal(new Date(r0.to - 1))}" required></label></div>
    <p class="muted small-note">Se abre en otra pestaña: ahí lo imprimes o guardas en PDF, o lo descargas en Excel.</p>`, 'Ver reporte');
  const box = $('#modal-extra');
  $('[data-preset]', box).addEventListener('change', (e) => {
    if (e.target.value === 'custom') return;
    const r = periodRange(e.target.value);
    box.elements.from.value = ymdLocal(r.from); box.elements.to.value = ymdLocal(new Date(r.to - 1));
  });
  ['from', 'to'].forEach((n) => box.elements[n].addEventListener('change', () => { box.elements.preset.value = 'custom'; }));
  const v = await pending;
  if (!v) return;
  const range = periodRange('custom', v.from, v.to);
  if (!range) { toast('Revisa las fechas: "Desde" debe ser antes que "Hasta"', 'error'); return; }
  const w = window.open('', '_blank');
  if (!w) { toast('Permite las ventanas emergentes para abrir el reporte', 'error'); return; }
  w.document.write('<p style="font-family:sans-serif">Preparando el reporte…</p>');
  try {
    const builders = { ventas: salesReport, vendedor: salesReport, marketing: marketingReport, asignacion: assignReport };
    const { title, body } = await builders[kind](range, kind);
    writeReport(w, title, rangeText(range), body);
  } catch (err) { w.close(); toast(err.message, 'error'); }
}

// Periodo anterior del mismo largo, para comparar.
const prevRange = (r) => ({ from: new Date(r.from.getTime() - (r.to - r.from)), to: r.from });
const rangeQuery = (r) => `from=${encodeURIComponent(r.from.toISOString())}&to=${encodeURIComponent(r.to.toISOString())}`;
// Variación contra el periodo anterior; en costos, bajar es bueno.
function reportDelta(a, b, lowerIsBetter = false) {
  if (a == null || b == null || !b) return '';
  const x = ((a - b) / b) * 100;
  if (Math.abs(x) < 0.5) return ' <small style="color:#6b7189">= igual</small>';
  const good = lowerIsBetter ? x < 0 : x > 0;
  return ` <small style="color:${good ? '#037f4c' : '#c21e56'}">${x > 0 ? '↑' : '↓'} ${Math.abs(Math.round(x))}%</small>`;
}
const rCell = (v) => `<td>${v}</td>`;
const rTable = (head, rows, empty = 'Sin datos en el periodo') => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>
  ${rows.length ? rows.join('') : `<tr><td class="muted" colspan="${head.length}">${empty}</td></tr>`}</table>`;
const rKpi = (label, value) => `<div class="k">${label}<b>${value}</b></div>`;
const rDay = (iso) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

// Ventas: lo que pasó en el periodo por fecha de cada hecho (venta el día que se cerró, cotización el día que se envió).
async function salesReport(range, kind) {
  const seller = kind === 'vendedor';
  const [a, p, st] = await Promise.all([api(`/api/activity?${rangeQuery(range)}`), api(`/api/activity?${rangeQuery(prevRange(range))}`), api(`/api/stats?${rangeQuery(range)}`)]);
  const tot = (x, k) => x.sellers.reduce((t, r) => t + (r[k] || 0), 0);
  const team = !seller && can('gerente', 'analista') ? await api('/api/team').catch(() => null) : null;
  const f = st.funnel;
  const myPipe = (st.pipeline || []).filter((r) => (seller ? r.id === state.me.id : r.id));
  const body = `
    <div class="kpis">
      ${rKpi('Leads recibidos', `${a.recibidos.n}${reportDelta(a.recibidos.n, p.recibidos.n)}`)}
      ${rKpi('Toques registrados', `${tot(a, 'toques')}${reportDelta(tot(a, 'toques'), tot(p, 'toques'))}`)}
      ${rKpi('Cotizaciones enviadas', `${tot(a, 'cotizaciones')} · ${money(tot(a, 'cotizado'))}${reportDelta(tot(a, 'cotizado'), tot(p, 'cotizado'))}`)}
      ${rKpi('Ventas cerradas', `${tot(a, 'ventas')} · ${money(tot(a, 'vendido'))}${reportDelta(tot(a, 'vendido'), tot(p, 'vendido'))}`)}
      ${renewals() ? rKpi('Renovaciones', `${tot(a, 'renovaciones')} · ${money(tot(a, 'renovado'))}${reportDelta(tot(a, 'renovado'), tot(p, 'renovado'))}`) : ''}
      ${rKpi('Declinados', `${tot(a, 'declinados')}`)}
    </div>
    <p class="muted">Comparado con el periodo anterior del mismo largo. Cada venta cuenta el día que se cerró y cada cotización el día que se envió, sin importar cuándo llegó el lead.</p>
    ${seller ? '' : `<h2>Por vendedor</h2>${rTable(['Vendedor', 'Leads asignados', 'Primer toque', 'Toques', 'Cotizaciones', 'Cotizado', 'Ventas', 'Vendido', ...(renewals() ? ['Renovado'] : []), 'Declinados'],
      a.sellers.map((r) => `<tr>${rCell(esc(r.name))}${rCell(r.asignados)}${rCell(hours(r.horas_primer_toque))}${rCell(r.toques)}${rCell(r.cotizaciones)}${rCell(money(r.cotizado))}${rCell(r.ventas)}${rCell(money(r.vendido))}${renewals() ? rCell(money(r.renovado)) : ''}${rCell(r.declinados)}</tr>`))}`}
    <h2>Ventas cerradas</h2>${rTable(['Fecha', 'Cliente', ...(seller ? [] : ['Vendedor']), 'Producto', 'Cantidad', 'Monto'],
      a.ventas.map((x) => `<tr>${rCell(rDay(x.at))}${rCell(esc(x.name))}${seller ? '' : rCell(esc(x.seller || '—'))}${rCell(esc(x.product || '—'))}${rCell(x.quantity ?? '—')}${rCell(money(x.amount))}</tr>`))}
    <h2>Cotizaciones enviadas</h2>${rTable(['Fecha', 'Cliente', ...(seller ? [] : ['Vendedor']), 'Producto', 'Monto', 'Cómo va'],
      a.cotizaciones.map((x) => `<tr>${rCell(rDay(x.at))}${rCell(esc(x.name))}${seller ? '' : rCell(esc(x.seller || '—'))}${rCell(esc(x.product || '—'))}${rCell(money(x.amount))}${rCell(esc(label(x.status)))}</tr>`))}
    ${renewals() ? `<h2>Renovaciones</h2>${rTable(['Fecha', 'Cliente', ...(seller ? [] : ['Vendedor']), 'Monto'],
      a.renovaciones.map((x) => `<tr>${rCell(rDay(x.at))}${rCell(esc(x.name))}${seller ? '' : rCell(esc(x.seller || '—'))}${rCell(money(x.amount))}</tr>`))}` : ''}
    <h2>Por qué se perdieron</h2>${rTable(['Motivo', 'Leads'], a.motivos.map((r) => `<tr>${rCell(esc(r.key))}${rCell(r.n)}</tr>`), 'Sin declinados en el periodo')}
    <h2>Embudo de los leads que llegaron en el periodo</h2>${rTable(['Paso', 'Leads', '% de los recibidos'],
      FUNNEL.map(([k, n]) => `<tr>${rCell(n)}${rCell(f[k])}${rCell(`${pctOf(f[k], f.recibidos)}%`)}</tr>`))}
    <h2>Cotizaciones abiertas hoy</h2>${rTable([...(seller ? [] : ['Vendedor']), 'Vivas', 'Frías (más de 15 días sin contacto)', 'Venta esperada'],
      myPipe.map((r) => `<tr>${seller ? '' : rCell(esc(r.key))}${rCell(`${r.vivas} · ${money(r.vivas_monto)}`)}${rCell(r.frias ? `${r.frias} · ${money(r.frias_monto)}` : '0')}${rCell(r.esperado == null ? 'sin historial suficiente' : money(r.esperado))}</tr>`), 'Sin cotizaciones abiertas')}
    ${team ? `<h2>Cotizaciones más grandes hoy</h2>${rTable(['Cliente', 'Vendedor', 'Monto', 'Último contacto'],
      team.top_quotes.map((x) => `<tr>${rCell(esc(x.name))}${rCell(esc(x.seller))}${rCell(money(x.amount))}${rCell(x.dias_sin_contacto === 0 ? 'hoy' : `hace ${x.dias_sin_contacto} días`)}</tr>`), 'Sin cotizaciones abiertas')}` : ''}`;
  return { title: seller ? `Mi reporte de ventas · ${state.me.name}` : 'Reporte de ventas', body };
}

// Marketing: los leads que llegaron en el periodo, de qué campaña y anuncio, cuánto costaron y cuánto vendieron.
async function marketingReport(range) {
  const [cur, prev] = await Promise.all([api(`/api/stats?${rangeQuery(range)}`), api(`/api/stats?${rangeQuery(prevRange(range))}`)]);
  const m = marketingMetrics(cur); const o = marketingMetrics(prev);
  const per = (r, k) => (r.inversion > 0 && r[k] ? money(r.inversion / r[k]) : '—');
  const body = `
    <div class="kpis">
      ${rKpi('Leads', `${m.leads}${reportDelta(m.leads, o.leads)}`)}
      ${rKpi('Cumplen perfil', m.perfil == null ? '—' : `${Math.round(m.perfil)}%`)}
      ${rKpi('Inversión', m.inv ? money(m.inv) : '—')}
      ${rKpi('Costo por lead con perfil', `${m.cplq ? money(m.cplq) : '—'}${reportDelta(m.cplq, o.cplq, true)}`)}
      ${rKpi('Costo por cierre', `${m.cpc ? money(m.cpc) : '—'}${reportDelta(m.cpc, o.cpc, true)}`)}
      ${rKpi('Retorno', `${m.roas == null ? '—' : `${m.roas.toFixed(1)}x`}${reportDelta(m.roas, o.roas)}`)}
    </div>
    <p class="muted">De los leads que llegaron en el periodo, comparado con el periodo anterior del mismo largo. La inversión es la de los meses que toca el periodo.</p>
    <h2>Campañas</h2>${rTable(['Campaña', 'Leads', 'Con perfil', 'Inversión', 'Por lead con perfil', 'Cierres', 'Ventas', 'Retorno'],
      cur.campaignFunnel.map((r) => `<tr>${rCell(esc(r.key))}${rCell(r.recibidos)}${rCell(r.perfilados)}${rCell(r.inversion > 0 ? money(r.inversion) : '—')}${rCell(per(r, 'perfilados'))}${rCell(r.cerrados)}${rCell(r.ingresos ? money(r.ingresos) : '—')}${rCell(r.inversion > 0 && r.ingresos ? `${(r.ingresos / r.inversion).toFixed(1)}x` : '—')}</tr>`))}
    <h2>Anuncios</h2>${rTable(['Anuncio', 'Leads', 'Con perfil', 'Cierres'],
      cur.adFunnel.slice(0, 15).map((r) => `<tr>${rCell(esc(r.key))}${rCell(r.recibidos)}${rCell(r.perfilados)}${rCell(r.cerrados)}</tr>`), 'Sin anuncios identificados')}
    <h2>Por qué se descartan</h2>${rTable(['Motivo', 'Leads'], cur.touches.declineReasons.map((r) => `<tr>${rCell(esc(r.key))}${rCell(r.n)}</tr>`), 'Sin descartes')}
    <h2>Audiencias para remarketing</h2>${rTable(['Audiencia', 'Contactos'], AUDIENCES.map(([k, t]) => `<tr>${rCell(esc(t))}${rCell(cur.audiences[k] ?? 0)}</tr>`))}`;
  return { title: 'Reporte de marketing', body };
}

// Asignación: cuántos leads llegaron, de dónde, cuánto tardaron en tener vendedor y a quién se repartieron.
async function assignReport(range) {
  const [a, p] = await Promise.all([api(`/api/activity?${rangeQuery(range)}`), api(`/api/activity?${rangeQuery(prevRange(range))}`)]);
  const r = a.recibidos;
  const body = `
    <div class="kpis">
      ${rKpi('Leads recibidos', `${r.n}${reportDelta(r.n, p.recibidos.n)}`)}
      ${rKpi('Con vendedor', `${r.asignados} de ${r.n}`)}
      ${rKpi('Tiempo promedio para asignar', `${hours(r.horas_asignar)}${reportDelta(r.horas_asignar, p.recibidos.horas_asignar, true)}`)}
      ${rKpi('Sin asignar hoy', r.sin_asignar_hoy)}
    </div>
    <p class="muted">Comparado con el periodo anterior del mismo largo.</p>
    <h2>De dónde llegaron</h2>${rTable(['Campaña o canal', 'Leads'], r.por_origen.map((x) => `<tr>${rCell(esc(x.key))}${rCell(x.n)}</tr>`))}
    <h2>Cómo se repartieron</h2>${rTable(['Vendedor', 'Leads asignados', 'Primer toque (promedio)'],
      a.sellers.map((x) => `<tr>${rCell(esc(x.name))}${rCell(x.asignados)}${rCell(hours(x.horas_primer_toque))}</tr>`))}`;
  return { title: 'Reporte de asignación', body };
}

// Escribe el reporte en la pestaña nueva, con botones para imprimir/PDF y para descargar en Excel (CSV con acentos).
function writeReport(w, title, sub, body) {
  const company = state.company.name;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:14px/1.45 system-ui,sans-serif;color:#1f2433;max-width:980px;margin:24px auto;padding:0 16px}h1{margin:0}h2{margin:24px 0 8px;font-size:16px}
    .muted{color:#6b7189}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.k{border:1px solid #e4e8f1;border-radius:10px;padding:10px}
    .k b{display:block;font-size:19px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e4e8f1}
    th{font-size:12px;color:#6b7189}.top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.top img{height:40px;max-width:160px;object-fit:contain}
    .actions{margin-left:auto;display:flex;gap:8px}.actions a,.actions button{padding:8px 14px;font:inherit;border:1px solid #c9d1e3;border-radius:8px;background:#fff;color:#1f2433;text-decoration:none;cursor:pointer}
    @media (max-width:640px){.kpis{grid-template-columns:1fr 1fr}}@media print{.actions{display:none}}</style></head><body>
    <div class="top">${state.company.logo ? `<img src="${esc(state.company.logo)}" alt="">` : ''}<div><h1>${esc(title)}</h1>
      <p class="muted" style="margin:2px 0 0">${company ? `${esc(company)} · ` : ''}${esc(sub)}</p></div>
      <div class="actions"><a id="csv" download>Descargar Excel</a><button onclick="print()">Imprimir o guardar PDF</button></div></div>
    ${body}
    <p class="muted" style="margin-top:28px">Generado con ${PLATFORM} el ${esc(new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' }))}${state.me ? ` por ${esc(state.me.name)}` : ''}.</p>
    </body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
  // Excel: cada tabla del reporte, con su título; los números de arriba como primera sección.
  const doc = w.document;
  // Celdas que empiezan como fórmula (=, @, +texto, -texto) se marcan como texto: un nombre malicioso no corre en Excel.
  const safe = (t) => (/^[=@\t\r]/.test(t) || (/^[+-]/.test(t) && !/^[+-][\d\s().,$%-]*$/.test(t)) ? `'${t}` : t);
  const q = (v) => `"${safe(String(v).replace(/\s+/g, ' ').trim()).replace(/"/g, '""')}"`;
  const lines = [[title], [`${company ? `${company} · ` : ''}${sub}`], [], ['Resumen']];
  doc.querySelectorAll('.k').forEach((k) => lines.push([k.firstChild.textContent, k.querySelector('b').textContent]));
  doc.querySelectorAll('h2').forEach((h) => {
    const t = h.nextElementSibling;
    if (t?.tagName !== 'TABLE') return;
    lines.push([], [h.textContent]);
    t.querySelectorAll('tr').forEach((tr) => lines.push([...tr.children].map((c) => c.textContent)));
  });
  const csv = `﻿${lines.map((l) => l.map(q).join(',')).join('\r\n')}`;
  const a = doc.getElementById('csv');
  a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  a.download = `${slug(title)}-${ymdLocal(new Date())}.csv`;
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
    <div class="stats-actions"><button type="button" class="ghost" id="assign-report">${icon('file', 16)} Reporte de asignación</button></div>
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
  $('#assign-report').addEventListener('click', () => openReport('asignacion', 'mes'));
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
      await api(`/api/leads/${r.dataset.id}/assign`, { method: 'POST', body: { assigned_to: Number(sel.value) } });
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
  // Estado de acceso: invitación pendiente (aún no crea su contraseña), activo con su último acceso, o desactivado.
  const status = (u) => {
    if (!u.active) return '<span class="muted user-status">Desactivado</span>';
    if (u.pendiente) {
      const expired = !u.link_vence || u.link_vence < Date.now();
      return `<span class="touch-badge ${expired ? 'late' : 'today'} user-status">${expired ? 'Invitación vencida' : 'Invitación pendiente'}</span>`;
    }
    return `<span class="muted user-status">${u.last_login_at ? `Último acceso ${timeAgo(u.last_login_at)}` : 'Activo'}</span>`;
  };
  $('#view-users').innerHTML = `
    <div class="card" style="margin: 12px 0">
      <h3 style="margin-top:0">Agregar usuario</h3>
      <form id="user-form" class="row" style="flex-wrap:wrap; align-items:end">
        <label>Nombre <input name="name" required></label>
        <label>Email <input name="email" type="email" required></label>
        <label>Rol <select name="role">${roleOpts('vendedor')}</select></label>
        <label class="inline-check" id="op-question"><input type="checkbox" name="can_assign" value="1"> También asigna leads</label>
        <label class="inline-check" id="sell-question"><input type="checkbox" name="can_sell" value="1"> También atiende leads</label>
        <button type="submit" style="flex:0 0 auto">Crear e invitar</button>
      </form>
      <p class="error" id="user-error"></p>
      <p class="muted">Al crearlo se genera un <b>link de invitación</b> (vence en 72 horas) para mandárselo por WhatsApp o correo. Con ese link la persona
        crea su propia contraseña: así confirmas que el acceso le llegó a ella y nadie más la conoce. Si alguien olvida su contraseña,
        dale clic a "Link para contraseña nueva" en su renglón y mándaselo igual.</p>
      <p class="muted"><b>Gerente:</b> dirige; ve Equipo hoy, el Resumen y todos los leads, pide seguimientos y corrige; reasigna solo en emergencias.
        <b>Coordinador de leads:</b> su único trabajo es capturar y asignar leads y corregir sus datos; no ve reportes. <b>Vendedor:</b> trabaja los leads que le asignan y ve su propio Resumen.
        <b>Gerente de marketing:</b> Resumen de marketing, campañas a revisar, ficha de cada campaña, links y audiencias. <b>Analista:</b> solo lectura.</p>
      <p class="muted"><b>También asigna leads:</b> cualquier usuario puede tener además la pestaña Asignación (por ejemplo, el gerente en un equipo chico).
        Si se la das a un vendedor, en Equipo hoy verás cuántos leads se asignó a sí mismo.</p>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Funciones extra</th><th>Acceso</th><th>Activo</th><th></th></tr></thead><tbody>
    ${state.users.map((u) => `<tr data-id="${u.id}">
      <td>${esc(u.name)}${(u.role === 'vendedor' || u.can_sell) && u.active ? ` <span class="muted small">· ${u.en_curso} en curso</span>` : ''}</td><td>${esc(u.email)}</td>
      <td><select data-f="role" aria-label="Rol">${roleOpts(u.role)}</select></td>
      <td>${u.role === 'operador' ? '<span class="muted">Asignar es su trabajo</span>' : `<label class="inline-check"><input type="checkbox" data-f="can_assign" ${u.can_assign ? 'checked' : ''}> También asigna leads</label>`}
        ${['vendedor', 'analista'].includes(u.role) ? '' : `<br><label class="inline-check"><input type="checkbox" data-f="can_sell" ${u.can_sell ? 'checked' : ''}> También atiende leads</label>`}</td>
      <td>${status(u)}</td>
      <td><input type="checkbox" data-f="active" aria-label="Activo" ${u.active ? 'checked' : ''}></td>
      <td>${u.active && u.id !== state.me.id ? `<button class="ghost small" data-f="link">${u.pendiente ? 'Reenviar invitación' : 'Link para contraseña nueva'}</button>` : ''}</td>
    </tr>`).join('')}
    </tbody></table></div>`;

  // Al Coordinador de leads no se le pregunta: asignar ya es su trabajo.
  const roleSel = $('#user-form [name=role]');
  const syncQuestion = () => {
    const isCoord = roleSel.value === 'operador';
    $('#op-question').classList.toggle('hidden', isCoord);
    const box = $('#op-question input'); box.disabled = isCoord; if (isCoord) box.checked = false;
    const noSell = ['vendedor', 'analista'].includes(roleSel.value);
    $('#sell-question').classList.toggle('hidden', noSell);
    const sellBox = $('#sell-question input'); sellBox.disabled = noSell; if (noSell) sellBox.checked = false;
  };
  roleSel.addEventListener('change', syncQuestion); syncQuestion();
  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('/api/users', { method: 'POST', body });
      state.users = await api('/api/users'); fillFilters(); renderUsers();
      showAccessLink({ name: body.name, email: body.email }, r);
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
      if (!(u.role === 'vendedor' || u.can_sell) || !u.active || !u.en_curso) return true;
      const ok = await ask(`${u.name} tiene ${u.en_curso} ${u.en_curso === 1 ? 'lead en curso' : 'leads en curso'}. Quedarán sin asignar para repartirlos en Asignación. ¿Continuar?`, { okLabel: 'Continuar' });
      if (!ok) restore(el);
      return ok;
    };
    const released = (r) => { if (r?.released) toast(`${r.released} ${r.released === 1 ? 'lead quedó' : 'leads quedaron'} sin asignar; repártelos en Asignación`, 'ok'); };
    $('[data-f=role]', tr).addEventListener('change', async (e) => {
      if (e.target.value !== 'vendedor' && !await confirmRelease(e.target, (el) => { el.value = u.role; })) return;
      released(await patch({ role: e.target.value }));
    });
    $('[data-f=can_sell]', tr)?.addEventListener('change', async (e) => {
      if (!e.target.checked && !await confirmRelease(e.target, (el) => { el.checked = true; })) return;
      released(await patch({ can_sell: e.target.checked }));
      if (String(u.id) === String(state.me.id)) { state.me = await api('/api/me'); start(); }
    });
    $('[data-f=can_assign]', tr)?.addEventListener('change', async (e) => {
      await patch({ can_assign: e.target.checked });
      if (String(u.id) === String(state.me.id)) { state.me = await api('/api/me'); start(); }
    });
    $('[data-f=active]', tr).addEventListener('change', async (e) => {
      if (!e.target.checked && !await confirmRelease(e.target, (el) => { el.checked = true; })) return;
      released(await patch({ active: e.target.checked }));
    });
    $('[data-f=link]', tr)?.addEventListener('click', async () => {
      try {
        const r = await api(`/api/users/${u.id}/access-link`, { method: 'POST' });
        renderUsers();
        showAccessLink(u, r);
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// Muestra el link de acceso listo para mandar: copiar, WhatsApp o correo. El link anterior de esa persona deja de servir.
async function showAccessLink(u, r) {
  const first = String(u.name || '').split(/\s+/)[0];
  const company = state.company.name || 'la empresa';
  const msg = r.kind === 'invite'
    ? `Hola ${first}, te di de alta en ${PLATFORM}, la plataforma de leads de ${company}. Entra a este link para crear tu contraseña (vence en 72 horas): ${r.link}`
    : `Hola ${first}, este es tu link para crear una contraseña nueva en ${PLATFORM} (${company}). Vence en 72 horas: ${r.link}`;
  const done = askForm(r.kind === 'invite' ? `Invitación para ${u.name}` : `Contraseña nueva para ${u.name}`, `
    <p class="muted" style="margin:0">Mándale este link. Es de un solo uso y vence en 72 horas; si generas otro, este deja de servir.</p>
    <div class="link-box"><input readonly value="${esc(r.link)}" aria-label="Link de acceso"><button type="button" class="ghost small" id="link-copy">Copiar</button></div>
    <div class="link-box">
      <a class="wa-btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">${WA_ICON}<span>Mandar por WhatsApp</span></a>
      <a class="button-link ghost small" href="mailto:${encodeURIComponent(u.email || '')}?subject=${encodeURIComponent(`Tu acceso a ${PLATFORM} · ${company}`)}&body=${encodeURIComponent(msg)}">Mandar por correo</a>
    </div>`, 'Listo');
  $('#link-copy').addEventListener('click', async (e) => {
    const input = e.target.previousElementSibling; input.select();
    try { await navigator.clipboard.writeText(msg); } catch { document.execCommand('copy'); }
    e.target.textContent = 'Copiado con mensaje';
  });
  await done;
}

// ---------- Primer uso ----------
// ¿Quién usará la cuenta? Si es para un cliente, no se pide contraseña: al final sale su link de invitación.
$('#setup-form').querySelectorAll('[name=who]').forEach((r) => r.addEventListener('change', () => {
  const client = $('#setup-form [name=who]:checked').value === 'client';
  $('#setup-pass').classList.toggle('hidden', client);
  $('#setup-form [name=password]').required = !client; $('#setup-form [name=password]').disabled = client;
  $('#setup-client-note').classList.toggle('hidden', !client);
  $('[data-who-label]').textContent = client ? 'Nombre del gerente del cliente' : 'Tu nombre';
  $('[data-who-mail]').textContent = client ? 'Su email' : 'Tu email';
  $('#setup-submit').textContent = client ? 'Crear e invitar' : 'Crear y entrar';
}));
$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { who, ...body } = Object.fromEntries(new FormData(e.target));
    const r = await api('/api/setup', { method: 'POST', body: { ...body, captcha: captchaToken('cap-setup') } });
    applyCompany(await api('/api/company'));
    $('#setup').classList.add('hidden');
    if (r.invited) {
      await showAccessLink({ name: r.name, email: r.email }, r);
      showLogin();
      return;
    }
    state.me = r;
    state.view = 'settings';
    start();
  } catch (err) { $('#setup-error').textContent = err.message; captchaReset('cap-setup'); }
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

  const sys = can('gerente') ? await api('/api/system').catch(() => null) : null;
  const kb = (b) => (b == null ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  // Pestañas para no tener todo en una sola página.
  const groups = [...(can('gerente') ? [['empresa', 'Empresa']] : []), ['campanas', 'Campañas y links'], ['canales', 'Formulario y WhatsApp'], ['listas', 'Productos y canales'], ...(can('gerente') ? [['datos', 'Tus datos']] : [])];
  const active = groups.some(([k]) => k === state.settingsTab) ? state.settingsTab : groups.some(([k]) => k === pref.get('settingsTab')) ? pref.get('settingsTab') : groups[0][0];
  const co = state.company;
  const g = (k) => `data-group="${k}" class="settings-group ${k === active ? '' : 'hidden'}"`;
  $('#view-settings').innerHTML = `<div class="settings">
    <div class="tabs settings-tabs" role="tablist">${groups.map(([k, t]) => `<button type="button" role="tab" data-stab="${k}" class="${k === active ? 'active' : ''}">${t}</button>`).join('')}</div>
    <div ${g('empresa')}>
    ${can('gerente') ? `<div class="card">
      ${cardTitle('layers', 'var(--accent)', 'Tu empresa', 'aparece en la app, los mensajes de WhatsApp y los reportes')}
      <form id="company-form">
        <label>Nombre de la empresa <input name="name" value="${esc(co.name)}" required maxlength="80"></label>
        <label>Logo <span class="muted small">(PNG, JPG o WebP; se ajusta solo)</span></label>
        <div class="price-row">${co.logo ? `<img class="logo-preview" src="${esc(co.logo)}" alt="Logo actual">` : '<span class="muted">Sin logo</span>'}
          <input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp" aria-label="Subir logo">
          ${co.logo ? '<button type="button" class="ghost small" id="logo-remove">Quitar logo</button>' : ''}</div>
        <label>¿Cómo le llamas a lo que vendes y se renueva?
          <select name="term">${Object.entries(F.TERMS).map(([k, [w]]) => `<option value="${k}" ${k === co.term ? 'selected' : ''}>${esc(cap(w))}</option>`).join('')}</select></label>
        <label class="inline-check"><input type="checkbox" name="renewals" ${co.renewals ? 'checked' : ''}> Mis clientes renuevan: al cerrar una venta se pregunta cuándo termina y se avisa al vendedor 30 días antes para ofrecer la renovación</label>
        <p class="muted small-note">Si lo que vendes es de una sola vez (por ejemplo, un equipo o un evento), quita la casilla: después de vender solo se pedirán referidos.</p>
        <button type="submit">Guardar</button>
      </form>
    </div>` : ''}
    </div>
    <div ${g('datos')}>
    ${can('gerente') ? `<div class="card">
      ${cardTitle('file', 'var(--accent)', 'Descarga tu cartera', 'tus datos son tuyos: llévatelos cuando quieras')}
      <p class="muted">Un archivo de Excel con <b>todos tus contactos y su clasificación</b>: una hoja con toda la cartera y una por clasificación
        (clientes, cotizando, en proceso, declinados con y sin perfil), con montos, vendedor, origen y fechas. Trae también cada toque, el historial
        de cada contacto, tus productos con precios, campañas con su inversión y tu equipo. Se abre en Excel, Google Sheets o Numbers.</p>
      <a class="button-link" id="cartera-download" href="/api/export/cartera.xlsx" download>Descargar mi cartera (Excel)</a>
      ${sys?.cartera ? `<p class="muted small-note">${sys.cartera.last ? `Última descarga: ${shortDate(sys.cartera.last)}.` : 'Aún no la has descargado.'} Te la recordamos cada mes.</p>` : ''}
      <p class="muted small-note">Solo el gerente puede descargarla: trae los datos de contacto de todos tus clientes. Guárdala en un lugar seguro.</p>
    </div>` : ''}
    ${sys ? `<div class="card">
      ${cardTitle('layers', 'var(--f-cerrados)', 'Respaldos y datos')}
      ${sys.storage_warning ? '<p class="decline-note">La base de datos no está en un disco persistente: se borrará en la próxima actualización. En Railway agrega un volumen montado en /data.</p>' : ''}
      <p class="muted">Copia técnica de todo el sistema, para restaurarlo si algo falla (no se abre en Excel; para ver tus datos usa "Descargar mi cartera").
        Se hace una cada día y se guardan las últimas 14 en el servidor. Descarga una de vez en cuando (por ejemplo cada semana) y guárdala en tu computadora o en Drive.</p>
      <p>${sys.leads} leads · base de ${kb(sys.size)} · ${sys.last_backup ? `último respaldo automático: ${shortDate(`${sys.last_backup}T12:00:00`)} (${sys.backups} guardados)` : 'aún sin respaldo automático'}</p>
      <p>${!sys.offsite?.configured ? '<span class="touch-badge today">Sin copia fuera del servidor</span> <span class="muted">Pide a quien administra la plataforma que la active.</span>'
        : sys.offsite.error && !sys.offsite.last ? `<span class="touch-badge late">La copia fuera del servidor falló</span> <span class="muted">${esc(sys.offsite.error)}</span>`
        : `<span class="touch-badge ok">Copia fuera del servidor</span> <span class="muted">${sys.offsite.last ? `la última, ${timeAgo(sys.offsite.last)}` : 'se hará con el próximo respaldo'}</span>`}</p>
      <a class="button-link" href="/api/backup" download>Descargar respaldo completo</a>
    </div>` : ''}
    </div>
    <div ${g('campanas')}>
    ${campaignEditor()}
    ${linkBuilder()}
    </div>
    <div ${g('canales')}>
    <div class="card">
      ${cardTitle('chat', 'var(--whatsapp)', 'Mensajes de WhatsApp')}
      <p class="muted">El botón de WhatsApp abre el chat del cliente con este mensaje ya escrito, según lo que toque con el lead. El vendedor lo puede cambiar antes de enviarlo.
        Se reemplazan solos: <code>{nombre}</code> (primer nombre del cliente), <code>{vendedor}</code>, <code>{producto}</code>, <code>{empresa}</code> y <code>{servicio}</code> (${esc(F.term())}).</p>
      <form id="wa-form" class="wa-form">
        ${[['cadencia', 'Primer contacto (aún no contesta)'], ['seguimiento', 'Ya contestó: perfilar o cotizar'], ['cotizacion', 'Seguimiento de la cotización'], ['recontacto', 'Volver a contactar (lo pospuso)'], ['postventa', `Cliente: cómo va ${F.theTerm()} y referidos`], ...(renewals() ? [['renovacion', 'Cliente: ofrecer la renovación']] : [])]
          .map(([k, t]) => `<label>${t}<textarea name="${k}" rows="3" maxlength="1000">${esc(s.wa_templates[k])}</textarea></label>`).join('')}
        <p class="muted small-note">Si dejas uno vacío, vuelve al mensaje de fábrica.</p>
        <button type="submit">Guardar mensajes</button>
      </form>
    </div>
    </div>
    <div ${g('listas')}>
    <div class="lists">
      ${listEditor('producto', 'Productos', 'Lo que vendes. Se elige en cada lead como producto de interés.', 'Ej. Paquete básico, Plan anual')}
      ${listEditor('canal', 'Canales de percepción', 'Cómo se enteró el cliente de ustedes.', 'Ej. Radio, Evento, TikTok')}
    </div>
    </div>
    <div ${g('canales')}>
    <div class="card">
      ${cardTitle('file', 'var(--accent)', 'Formulario de tu página web')}
      <p>Pásale esto a quien administra tu página web. Cada vez que alguien llene el formulario, el lead aparece aquí solo.</p>
      <p class="muted">En cada anuncio usa el link de tu página con la campaña y el nombre del anuncio, por ejemplo
        <code>https://TU-SITIO/?utm_campaign=FB-Promo-Octubre&amp;utm_source=facebook&amp;utm_content=video-testimonio</code>.
        El formulario los guarda solos y el Resumen te dice qué campaña y qué anuncio cierran.</p>
      <label>Dirección a donde se envía el formulario</label>${copyField(s.form_url)}
      <label>Clave del formulario</label>${copyField(s.form_api_key)}
      <label>Ejemplo de formulario listo para pegar en la página</label>${copyField(snippet, true)}
      <p class="muted">Para anuncios de Facebook/Instagram (formularios de Meta) o Google Ads se conecta con Zapier o Make usando la misma dirección y clave.</p>
      <button type="button" class="ghost" id="regen">Cambiar la clave (si llega spam)</button>
    </div>
    </div>
  </div>`;
  $('#view-settings').querySelectorAll('[data-stab]').forEach((b) => b.addEventListener('click', () => {
    state.settingsTab = b.dataset.stab; pref.set('settingsTab', b.dataset.stab);
    $('#view-settings').querySelectorAll('[data-stab]').forEach((x) => x.classList.toggle('active', x === b));
    $('#view-settings').querySelectorAll('.settings-group').forEach((x) => x.classList.toggle('hidden', x.dataset.group !== b.dataset.stab));
  }));

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
      const extra = f.dataset.kind === 'producto' ? { price: f.elements.price.value || null, fixed_price: f.elements.fixed_price.checked,
        ...(f.elements.duration_months ? { duration_months: f.elements.duration_months.value || null } : {}) } : {};
      await api('/api/catalog', { method: 'POST', body: { kind: f.dataset.kind, name, ...extra } });
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
    const savePrice = async () => {
      try {
        const dur = $('[data-duration]', row);
        await api(`/api/catalog/${id}`, { method: 'PATCH', body: { price: $('[data-price]', row).value || null, fixed_price: $('[data-fixed]', row).checked,
          ...(dur ? { duration_months: dur.value || null } : {}) } });
        toast('Guardado', 'ok');
      } catch (err) { toast(err.message, 'error'); }
      await reloadCatalog();
    };
    $('[data-price]', row)?.addEventListener('change', savePrice);
    $('[data-fixed]', row)?.addEventListener('change', savePrice);
    $('[data-duration]', row)?.addEventListener('change', savePrice);
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
  $('#cartera-download')?.addEventListener('click', (e) => { if (window.crmCartera) { e.preventDefault(); window.crmCartera(); } });
  $('#company-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      applyCompany(await api('/api/company', { method: 'PATCH', body: { name: f.elements.name.value, term: f.elements.term.value, renewals: f.elements.renewals.checked } }));
      toast('Datos de la empresa guardados', 'ok');
      renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
  // El logo se reduce en el navegador (máx. 480×120) para que pese poco y se vea bien en cualquier lado.
  $('#logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const url = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 480 / img.width, 120 / img.height);
          const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('No se pudo leer la imagen'));
        img.src = URL.createObjectURL(file);
      });
      applyCompany(await api('/api/company', { method: 'PATCH', body: { logo: url } }));
      toast('Logo guardado', 'ok'); renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#logo-remove')?.addEventListener('click', async () => {
    applyCompany(await api('/api/company', { method: 'PATCH', body: { logo: '' } })); renderSettings();
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

// Rango de un periodo, por días completos en hora local: { from, to } con `to` exclusivo. null si las fechas no sirven.
function periodRange(key, fromStr, toStr) {
  const d = new Date(); const y = d.getFullYear(); const m = d.getMonth();
  const tomorrow = new Date(y, m, d.getDate() + 1);
  const back = (days) => ({ from: new Date(y, m, d.getDate() + 1 - days), to: tomorrow });
  if (key === '7' || key === '30' || key === '90') return back(Number(key));
  if (key === 'mes') return { from: new Date(y, m, 1), to: tomorrow };
  if (key === 'mes_pasado') return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
  if (key === 'anio') return { from: new Date(y, 0, 1), to: tomorrow };
  if (key === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr || '') || !/^\d{4}-\d{2}-\d{2}$/.test(toStr || '')) return null;
    const from = new Date(`${fromStr}T00:00:00`); const to = new Date(new Date(`${toStr}T00:00:00`).getTime() + 86400e3);
    return from < to ? { from, to } : null;
  }
  return null;
}
const ymdLocal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const rangeText = (r) => `${r.from.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })} al ${new Date(r.to - 1).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;

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
      <label>Página a donde lleva el anuncio<input name="url" type="url" placeholder="https://tu-sitio.com/promocion" value="${esc(pref.get('landingUrl') || '')}"></label>
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
      <input name="name" placeholder="Ej. FB Promo Octubre" aria-label="Nombre de la campaña" maxlength="120">
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
      ${kind === 'producto' ? `<input name="price" inputmode="decimal" placeholder="Precio (opcional)" aria-label="Precio de lista" style="max-width:150px">
        <label class="inline-check"><input type="checkbox" name="fixed_price"> Precio fijo</label>
        ${renewals() ? '<input name="duration_months" inputmode="numeric" placeholder="Dura (meses)" aria-label="Duración en meses" style="max-width:120px">' : ''}` : ''}
      <button type="submit">Agregar</button>
    </form>
    ${kind === 'producto' ? `<p class="muted small-note">Con <b>precio fijo</b>, al cotizar o vender el monto se calcula solo (precio × cantidad) y el vendedor no lo puede cambiar; solo el gerente lo corrige. Sin precio fijo, el precio de lista sale como referencia y el vendedor captura el real.${renewals() ? ` Si pones cuántos <b>meses dura</b>, al vender se calcula sola la fecha en que termina ${esc(F.theTerm())} y se avisa la renovación a tiempo.` : ''}</p>` : ''}
    <ul class="items">
      ${items.map((i) => `<li data-item="${i.id}" data-active="${i.active}" class="${i.active ? '' : 'inactive'}">
        <span>${esc(i.name)}${i.active ? '' : ' <small>(quitado)</small>'}</span>
        ${kind === 'producto' ? `<span class="price-row"><input data-price inputmode="decimal" value="${i.price ?? ''}" placeholder="Precio" aria-label="Precio de ${esc(i.name)}">
          <label class="inline-check"><input type="checkbox" data-fixed ${i.fixed_price ? 'checked' : ''}> fijo</label>
          ${renewals() ? `<input data-duration inputmode="numeric" value="${i.duration_months ?? ''}" placeholder="Meses" aria-label="Meses que dura ${esc(i.name)}" style="max-width:80px">` : ''}</span>` : ''}
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
  // Los leads nuevos aparecen solos: se recarga cada 30 s si no hay un detalle abierto.
  setInterval(() => {
    if (state.me && $('#drawer').classList.contains('hidden') && document.activeElement?.id !== 'today-q' && !['users', 'settings', 'assign', 'team', 'seller', 'campaign'].includes(state.view)) refresh();
  }, 30000);
  state.meta = await api('/api/meta');
  applyCompany(await api('/api/company'));
  const accessToken = new URLSearchParams(location.search).get('acceso');
  if (accessToken) return showAccess(accessToken);
  if ((await api('/api/setup')).needed) {
    showAuth(true);
    $('#setup').classList.remove('hidden');
    return;
  }
  try {
    state.me = await api('/api/me');
    start();
  } catch {
    showLogin();
  }
})();
