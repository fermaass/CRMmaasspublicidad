// Panel interno de Rentaypunto. Todo lo que se ve aquí, el servidor vuelve a revisar si el perfil tiene permiso.
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = SEO.money;
  const fdate = (s) => { if (!s) return '—'; const a = String(s).slice(0, 10).split('-'); return a[2] + '/' + a[1] + '/' + a[0]; };
  const fdt = (s) => (s ? new Date(s).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const tel = (p) => (p ? String(p).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : '');
  const ROLE = { vendedor: 'Vendedor', gerente: 'Gerente', dueno: 'Dueño' };
  const PST = { borrador: 'Borrador', disponible: 'Disponible', apartada: 'Apartada', rentada: 'Rentada', pausada: 'Pausada' };
  const STG = { nuevo: 'Nuevo', contactado: 'Contactado', cita: 'Cita confirmada', visito: 'Visitó', expediente: 'Expediente', firmado: 'Firmado', perdido: 'Perdido' };
  const S = { me: null, cfg: null, users: [], leads: [], props: [], follow: null, tab: 'hoy', lead: null, edit: null, losing: false, newLead: false, qk: null, pending: [] };
  const mgr = () => S.me && (S.me.role === 'gerente' || S.me.role === 'dueno');
  const canPub = () => mgr() || (S.me && S.me.publish_direct);

  let tt;
  function toast(m) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = m; t.style.opacity = 1; clearTimeout(tt); tt = setTimeout(() => { t.style.opacity = 0; }, 4500);
  }
  async function api(path, opts) {
    opts = opts || {};
    const r = await fetch('api/' + path, { method: opts.method || 'GET', headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
    let out = null; try { out = await r.json(); } catch (e) { /* vacío */ }
    if (r.status === 401 && !opts.quiet) { S.me = null; boot(); throw new Error('Tu sesión terminó. Vuelve a entrar.'); }
    if (!r.ok) throw new Error((out && out.error) || 'No se pudo guardar. Revisa tu internet e intenta de nuevo.');
    return out;
  }
  // Ejecuta una acción con aviso de error, sin perder lo escrito.
  async function act(fn, ok) { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message); return undefined; } }
  const today = () => S.cfg.today;
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const hoursAgo = (s) => (Date.now() - new Date(s).getTime()) / 3600e3;
  const ago = (s) => { const h = hoursAgo(s); return h < 1 ? 'hace minutos' : h < 24 ? 'hace ' + Math.floor(h) + ' h' : 'hace ' + Math.floor(h / 24) + ' día(s)'; };
  const siteUrl = () => S.cfg.siteUrl || location.origin;
  const userName = (id) => { const u = S.users.find((x) => x.id === id); return u ? u.name : 'Sin asesor'; };
  const advisors = () => S.users.filter((u) => u.active);
  const opts = (list, cur, fmt) => list.map((x) => { const v = typeof x === 'object' ? x[0] : x; const t = typeof x === 'object' ? x[1] : (fmt ? fmt(x) : x); return '<option value="' + esc(v) + '"' + (String(v) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');

  // ---------- Entrar ----------
  function screen(html) { $('#tabs').innerHTML = ''; $('#who').textContent = ''; $('#app').innerHTML = '<div class="center card">' + html + '</div>'; }
  async function boot() {
    const qs = new URLSearchParams(location.search);
    if (qs.get('acceso')) return accessScreen(qs.get('acceso'));
    try { S.me = await api('me', { quiet: true }); } catch (e) { S.me = null; }
    if (!S.me) {
      const st = await api('setup', { quiet: true }).catch(() => ({ needed: false }));
      return st.needed ? setupScreen() : loginScreen();
    }
    await loadAll();
    render();
  }
  function loginScreen(msg) {
    screen('<h2>Entrar al panel</h2><form id="lf"><label for="le">Correo</label><input id="le" type="email" autocomplete="username" required>'
      + '<label for="lp">Contraseña</label><input id="lp" type="password" autocomplete="current-password" required><p class="err" id="lerr">' + esc(msg || '') + '</p><p><button class="b">Entrar</button></p></form>'
      + '<p class="note">¿Olvidaste tu contraseña? Pide al Dueño un link para crear una nueva.</p>');
    $('#lf').onsubmit = async (e) => {
      e.preventDefault(); $('#lerr').textContent = '';
      try { const r = await api('login', { method: 'POST', body: { email: $('#le').value, password: $('#lp').value }, quiet: true }); afterLogin(r); }
      catch (x) { $('#lerr').textContent = x.message; }
    };
  }
  function setupScreen() {
    screen('<h2>Primer uso del panel</h2><p class="note">Crea la cuenta del Dueño. El código de instalación está en Railway → tu servicio → Deploy Logs.</p><form id="sf">'
      + '<label for="sc">Código de instalación</label><input id="sc" required autocomplete="off"><label for="sn">Tu nombre</label><input id="sn" required autocomplete="name">'
      + '<label for="se">Tu correo</label><input id="se" type="email" required autocomplete="username"><label for="sp">Contraseña (10 caracteres o más)</label><input id="sp" type="password" minlength="10" required autocomplete="new-password">'
      + '<p class="err" id="serr"></p><p><button class="b">Crear cuenta</button></p></form>');
    $('#sf').onsubmit = async (e) => {
      e.preventDefault(); $('#serr').textContent = '';
      try { const r = await api('setup', { method: 'POST', body: { setup_code: $('#sc').value, name: $('#sn').value, email: $('#se').value, password: $('#sp').value }, quiet: true }); afterLogin(r); }
      catch (x) { $('#serr').textContent = x.message; }
    };
  }
  async function accessScreen(token) {
    let info;
    try { info = await api('access/' + encodeURIComponent(token), { quiet: true }); } catch (x) { history.replaceState(null, '', location.pathname); return loginScreen(x.message); }
    screen('<h2>Hola, ' + esc(info.name) + '</h2><p class="note">' + (info.kind === 'invite' ? 'Crea tu contraseña para entrar al panel de Rentaypunto.' : 'Crea tu contraseña nueva.') + ' Tu correo de acceso es <b>' + esc(info.email) + '</b>.</p>'
      + '<form id="af"><label for="ap">Contraseña (10 caracteres o más)</label><input id="ap" type="password" minlength="10" required autocomplete="new-password"><label for="ap2">Repítela</label><input id="ap2" type="password" required autocomplete="new-password"><p class="err" id="aerr"></p><p><button class="b">Guardar y entrar</button></p></form>');
    $('#af').onsubmit = async (e) => {
      e.preventDefault();
      if ($('#ap').value !== $('#ap2').value) { $('#aerr').textContent = 'Las contraseñas no coinciden.'; return; }
      try { const r = await api('access/' + encodeURIComponent(token), { method: 'POST', body: { password: $('#ap').value }, quiet: true }); history.replaceState(null, '', location.pathname); afterLogin(r); }
      catch (x) { $('#aerr').textContent = x.message; }
    };
  }
  async function afterLogin(r) {
    if (r && r.mfa) return mfaScreen();
    S.me = r; await loadAll(); render();
  }
  async function mfaScreen() {
    let info;
    try { info = await api('2fa', { quiet: true }); } catch (x) { return loginScreen(x.message); }
    if (info.mode === 'setup') {
      screen('<h2>Verificación en dos pasos</h2><p>Tu perfil puede ver datos de todo el equipo, así que además de la contraseña pedimos un código de tu celular.</p>'
        + '<ol class="note"><li>Instala <b>Google Authenticator</b> (o Microsoft Authenticator) en tu celular.</li><li>En la app toca <b>+</b> y escanea este código. Si estás en el mismo celular, usa el botón o escribe la clave.</li><li>Escribe abajo el número de 6 dígitos que te muestra.</li></ol>'
        + '<div id="qr"></div><p class="note">Clave: <code>' + esc(info.secret.replace(/(.{4})/g, '$1 ').trim()) + '</code></p><p><a class="b s sm" href="' + esc(info.uri) + '">Abrir en la app del celular</a></p>'
        + '<form id="mf"><label for="mc">Código de 6 dígitos</label><input id="mc" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><p class="err" id="merr"></p><p><button class="b">Activar y entrar</button></p></form>');
      const sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      sc.onload = () => { try { new window.QRCode($('#qr'), { text: info.uri, width: 180, height: 180 }); } catch (e) { /* queda la clave escrita */ } };
      document.head.appendChild(sc);
    } else {
      screen('<h2>Código de verificación</h2><p class="note">Abre tu app de códigos (Google Authenticator) y escribe el número de 6 dígitos de Rentaypunto.</p>'
        + '<form id="mf"><label for="mc">Código</label><input id="mc" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><p class="err" id="merr"></p><p><button class="b">Entrar</button></p></form><p class="note">¿Cambiaste de celular? Pide al Dueño que reinicie tu verificación.</p>');
    }
    $('#mc').focus();
    $('#mf').onsubmit = async (e) => {
      e.preventDefault(); $('#merr').textContent = '';
      try { S.me = await api('2fa', { method: 'POST', body: { code: $('#mc').value }, quiet: true }); await loadAll(); render(); }
      catch (x) { $('#merr').textContent = x.message; }
    };
  }

  // ---------- Datos ----------
  async function loadAll() {
    const [cfg, users, leads, props] = await Promise.all([api('config'), api('users'), api('leads'), api('properties')]);
    Object.assign(S, { cfg, users, leads, props });
    if (mgr()) S.follow = await api('follow');
    S.mine = await api('my-numbers');
    S.payPending = await api('payments/pending');
  }
  async function reload(which) {
    if (which.includes('leads')) S.leads = await api('leads');
    if (which.includes('props')) S.props = await api('properties');
    if (which.includes('users')) S.users = await api('users');
    if (which.includes('follow') && mgr()) S.follow = await api('follow');
    if (which.includes('cfg')) S.cfg = await api('config');
    if (which.includes('leads')) S.mine = await api('my-numbers');
    if (which.includes('pay')) S.payPending = await api('payments/pending');
  }

  // ---------- Pestañas por perfil ----------
  const TABS = [['hoy', 'Hoy', 'vgd'], ['leads', 'Leads', 'vgd'], ['citas', 'Citas', 'vgd'], ['props', 'Propiedades', 'vgd'], ['res', 'Resumen', 'gd'], ['rep', 'Reportes', 'gd'], ['seg', 'Seguimiento', 'gd'], ['equipo', 'Equipo', 'd']];
  const roleKey = () => ({ vendedor: 'v', gerente: 'g', dueno: 'd' }[S.me.role]);
  function render() {
    const mine = TABS.filter((t) => t[2].includes(roleKey()));
    if (!mine.some((t) => t[0] === S.tab)) S.tab = 'hoy';
    const urgent = S.leads.filter((l) => l.stage === 'nuevo' && hoursAgo(l.created_at) >= 24).length;
    $('#tabs').innerHTML = mine.map((t) => '<button role="tab" data-t="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '">' + t[1] + (t[0] === 'hoy' && urgent ? '<span class="cnt">' + urgent + '</span>' : '') + '</button>').join('');
    $$('#tabs button').forEach((b) => { b.onclick = () => { S.tab = b.dataset.t; S.lead = null; S.losing = false; render(); scrollTo(0, 0); }; });
    $('#who').innerHTML = esc(S.me.name) + ' · ' + ROLE[S.me.role] + ' · <a href="#" id="pw">Contraseña</a> · <a href="#" id="out">Salir</a>';
    $('#out').onclick = async (e) => { e.preventDefault(); await api('logout', { method: 'POST', body: {} }).catch(() => {}); S.me = null; loginScreen(); };
    $('#pw').onclick = (e) => { e.preventDefault(); S.tab = 'pw'; renderPw(); };
    ({ hoy: renderHoy, leads: renderLeads, citas: renderCitas, props: renderProps, res: renderRes, rep: renderRep, seg: renderSeg, equipo: renderEquipo })[S.tab]();
  }
  function renderPw() {
    $('#app').innerHTML = '<div class="card center"><h2>Cambiar mi contraseña</h2><label for="pc">Contraseña actual</label><input id="pc" type="password" autocomplete="current-password"><label for="pn">Nueva (10 caracteres o más)</label><input id="pn" type="password" autocomplete="new-password"><p class="err" id="perr"></p><p><button class="b" id="pgo">Guardar</button> <button class="b s" id="pback">Volver</button></p><p class="note">Se cierra tu sesión en los demás dispositivos.</p></div>';
    $('#pback').onclick = () => { S.tab = 'hoy'; render(); };
    $('#pgo').onclick = async () => { try { await api('me/password', { method: 'POST', body: { current: $('#pc').value, password: $('#pn').value } }); toast('Contraseña cambiada.'); S.tab = 'hoy'; render(); } catch (x) { $('#perr').textContent = x.message; } };
  }

  // ---------- WhatsApp (enlaces wa.me con el mensaje escrito; el asesor lo revisa y lo manda) ----------
  const waL = (phone, msg) => 'https://wa.me/52' + String(phone || '').replace(/\D/g, '').slice(-10) + '?text=' + encodeURIComponent(msg);
  const first = (n) => String(n || '').trim().split(/\s+/)[0];
  const advName = (l) => first(l.advisor_name || S.me.name);
  const propUrl = (slug) => siteUrl() + '/' + slug;
  function similares(l) {
    const p = S.props.find((x) => x.id === l.property_id);
    if (!p) return [];
    return S.props.filter((x) => x.id !== p.id && ['disponible', 'apartada'].includes(x.status) && Math.abs(x.rent - p.rent) <= p.rent * 0.25 && (x.zone_id === p.zone_id || x.bedrooms >= p.bedrooms))
      .sort((a, b) => (a.zone_id === p.zone_id ? 0 : 1) - (b.zone_id === p.zone_id ? 0 : 1) || Math.abs(a.rent - p.rent) - Math.abs(b.rent - p.rent)).slice(0, 3);
  }
  const MSG = {
    nuevo: (l) => 'Hola ' + first(l.name) + ', soy ' + advName(l) + ' de Rentaypunto. Vi que te interesó ' + (l.prop_title || 'una de nuestras propiedades') + (l.visit_date ? '. ¿Te va bien visitarla el ' + fdate(l.visit_date) + ' a las ' + l.visit_time + '?' : '. ¿Cuándo te gustaría visitarla?'),
    conf: (l) => 'Hola ' + first(l.name) + ', te confirmo tu visita a ' + (l.prop_title || 'la propiedad') + (l.prop_zone ? ' (' + l.prop_zone + ')' : '') + ' el ' + fdate(l.visit_date) + ' a las ' + l.visit_time + '. ¿Sigues pudiendo asistir? Soy ' + advName(l) + ' de Rentaypunto.',
    dir: (l) => 'Hola ' + first(l.name) + ', la dirección para tu visita a ' + (l.prop_title || 'la propiedad') + ' es: ' + (l.address_private || '') + '. Te espero el ' + fdate(l.visit_date) + ' a las ' + l.visit_time + '.',
    seg: (l) => 'Hola ' + first(l.name) + ', ¿qué te pareció ' + (l.prop_title || 'la propiedad') + '? Si quieres te ayudo con los siguientes pasos o te muestro otras opciones.',
    sim: (l) => { const s = similares(l); return 'Hola ' + first(l.name) + ', además de ' + (l.prop_title || 'la que viste') + ' te dejo opciones parecidas: ' + (s.length ? s.map((x) => x.title + ' (' + money(x.rent) + ') ' + propUrl(x.seo_slug)).join(' · ') : 'por ahora no hay otra parecida, te aviso en cuanto entre una.'); },
  };
  const waBtn = (l, kind, label, main) => '<a class="b sm' + (main ? '' : ' s') + '" target="_blank" rel="noopener" href="' + esc(waL(l.phone, MSG[kind](l))) + '">' + label + '</a>';
  const mapL = (l) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((l.prop_colonia || '') + ' ' + (l.prop_zone || '') + ' Querétaro');

  // ---------- Hoy ----------
  function box(title, n, body, empty) {
    return '<div class="card"><h2>' + title + ' <span class="tag ' + (n ? 'wa' : '') + '">' + n + '</span></h2>' + (n ? body : '<p class="note">' + (empty || 'Nada pendiente.') + '</p>') + '</div>';
  }
  const fi = (a, b) => '<div class="fi"><span>' + a + '</span><span class="row">' + b + '</span></div>';
  const openBtn = (l) => '<button class="b s sm" data-open="' + l.id + '">Abrir</button>';
  function renderHoy() {
    const t = today(); const tm = addDays(t, 1); let o = '';
    const nu = S.leads.filter((l) => l.stage === 'nuevo').sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    o += box('Leads por atender <span class="note">(meta: responder en menos de 24 h)</span>', nu.length, nu.map((l) => fi('<b>' + esc(l.name) + '</b> · ' + esc(l.prop_code || 'Sin propiedad') + ' <span class="tag ' + (hoursAgo(l.created_at) >= 24 ? 'no' : 'ok') + '">' + ago(l.created_at) + '</span>' + (mgr() ? ' <span class="note">' + esc(l.advisor_name || 'Sin asesor') + '</span>' : ''), waBtn(l, 'nuevo', 'WhatsApp', true) + openBtn(l))).join(''));
    const ci = S.leads.filter((l) => (l.visit_date === t || l.visit_date === tm) && ['nuevo', 'contactado', 'cita'].includes(l.stage)).sort((a, b) => ((a.visit_date + a.visit_time) < (b.visit_date + b.visit_time) ? -1 : 1));
    o += box('Citas de hoy y mañana', ci.length, ci.map((l) => fi('<span class="tag ' + (l.stage === 'cita' ? 'ok' : 'wa') + '">' + (l.visit_date === t ? 'Hoy' : 'Mañana') + ' ' + l.visit_time + '</span> <b>' + esc(l.name) + '</b> · ' + esc(l.prop_code || '') + (l.stage === 'cita' ? '' : ' <span class="note">sin confirmar</span>') + (mgr() ? ' <span class="note">' + esc(l.advisor_name || 'Sin asesor') + '</span>' : ''),
      '<a class="b s sm" target="_blank" rel="noopener" href="' + esc(mapL(l)) + '">Mapa</a>' + waBtn(l, 'conf', 'Confirmar', true) + openBtn(l))).join(''));
    const sg = S.leads.filter((l) => l.stage === 'visito' && !l.followup_done);
    o += box('Seguimiento después de la visita', sg.length, sg.map((l) => fi('<b>' + esc(l.name) + '</b> · ' + esc(l.prop_code || '') + ' <span class="note">visitó el ' + fdate(l.visit_date) + '</span>', waBtn(l, 'seg', 'Mensaje', true) + '<button class="b s sm" data-opinion="' + l.id + '">Pedir opinión</button><button class="b s sm" data-segok="' + l.id + '">Hecho</button>' + openBtn(l))).join(''));
    const ex = S.leads.filter((l) => l.file_status === 'recibido');
    if (ex.length) o += box('Expedientes por revisar', ex.length, ex.map((l) => fi('<b>' + esc(l.name) + '</b> · ' + esc(l.prop_code || ''), openBtn(l))).join(''));
    const pp = S.payPending || [];
    if (pp.length) o += box('Comprobantes de pago por validar', pp.length, pp.map((x) => fi('<b>' + esc(x.code) + '</b> · ' + esc(S.cfg.payConcepts[x.concept]) + ' ' + esc(x.month), '<button class="b s sm" data-edit="' + x.property_id + '">Revisar</button>')).join(''));
    const lim = addDays(t, 60);
    const rn = S.props.filter((p) => p.status === 'rentada' && p.contract_end && p.contract_end <= lim && (mgr() || p.advisor_id === S.me.id)).sort((a, b) => (a.contract_end < b.contract_end ? -1 : 1));
    o += box('Contratos por vencer (60 días)', rn.length, rn.map((p) => { const d = Math.round((new Date(p.contract_end + 'T12:00:00Z') - new Date(t + 'T12:00:00Z')) / 864e5);
      return fi('<b>' + esc(p.code) + '</b> · ' + esc(p.title) + ' <span class="tag ' + (d < 0 ? 'no' : d <= 30 ? 'wa' : '') + '">' + (d < 0 ? 'vencido' : 'vence en ' + d + ' días') + '</span> <span class="note">' + fdate(p.contract_end) + '</span>', '<button class="b s sm" data-edit="' + p.id + '">Abrir</button>'); }).join(''), 'Ningún contrato vence en los próximos 60 días. Captura las fechas del contrato en la propiedad cuando se rente.');
    if (mgr()) {
      const F = S.follow || {};
      const al = (F.alerts || []).filter((a) => a.matches.length && a.status !== 'cerrado');
      if (al.length) o += box('Alertas con propiedades nuevas que coinciden', al.length, al.map((a) => fi('<b>' + esc(a.name || tel(a.phone)) + '</b> · ' + esc(a.filters_text), '<span class="tag ok">' + a.matches.map((m) => esc(m.code)).join(' ') + '</span><button class="b s sm" data-goto="seg">Avisar</button>')).join(''));
      const rq = (F.requests || []).filter((r) => r.status === 'nueva');
      if (rq.length) o += box('Solicitudes de propietarios', rq.length, rq.map((r) => fi('<b>' + esc(r.code) + '</b> · ' + esc(S.cfg.ownerRequests[r.kind]) + (r.new_rent ? ' a ' + money(r.new_rent) : ''), '<button class="b s sm" data-goto="seg">Revisar</button>')).join(''));
      const bo = S.props.filter((p) => p.status === 'borrador');
      o += box('Propiedades por aprobar', bo.length, bo.map((p) => fi('<b>' + esc(p.code) + '</b> · ' + esc(p.title) + ' <span class="note">capturó ' + esc(userName(p.created_by)) + ' · SEO ' + seoScore(p) + '%</span>', '<button class="b s sm" data-edit="' + p.id + '">Revisar</button><button class="b sm" data-pub="' + p.id + '">Publicar</button>')).join(''));
      const sa = S.leads.filter((l) => !l.advisor_id && !['firmado', 'perdido'].includes(l.stage));
      o += box('Leads sin asesor', sa.length, sa.map((l) => fi('<b>' + esc(l.name) + '</b> · ' + esc(l.prop_code || 'Sin propiedad'), '<button class="b s sm" data-open="' + l.id + '">Asignar</button>')).join(''));
    }
    if (!mgr()) o += myNumbersCard();
    $('#app').innerHTML = o;
    bindCommon();
    bindOpinion();
    $$('[data-segok]').forEach((b) => { b.onclick = () => act(async () => { await api('leads/' + b.dataset.segok, { method: 'PATCH', body: { followup_done: true } }); await reload(['leads']); render(); }); });
  }
  // ---------- Documentos cifrados (expediente del inquilino, del propietario o comprobantes) ----------
  const FST = { sin_iniciar: ['Sin iniciar', ''], enviado: ['Enlace enviado', 'wa'], recibido: ['Por revisar', 'wa'], aprobado: ['Aprobado', 'ok'], rechazado: ['Rechazado', 'no'] };
  const DST = { pendiente: ['Por revisar', 'wa'], validado: ['Validado', 'ok'], rechazado: ['Rechazado', 'no'] };
  const LINK_MSG = {
    lead: (n, url) => 'Hola ' + first(n) + ', para avanzar con tu renta arma tu expediente aquí (INE, constancia fiscal y comprobante de ingresos). El enlace es solo para ti y vence en 7 días: ' + url,
    owner: (n, url) => 'Hola ' + first(n) + ', para publicar tu propiedad necesitamos tu identificación y el predial o la escritura. Súbelos aquí (enlace privado, vence en 14 días): ' + url,
    tenancy: (n, url) => 'Hola ' + first(n) + ', aquí puedes subir tus comprobantes de pago de la renta y ver cuáles ya validamos. Guarda este enlace, es solo para ti: ' + url,
  };
  async function fileBox(el, type, id, label) {
    if (!el) return;
    const f = await act(() => api('files/' + type + '/' + id));
    if (!f) return;
    if (!f.enabled) { el.innerHTML = '<p class="note">La bóveda de documentos está apagada: falta DOCS_KEY en Railway (ver PUBLICAR.md).</p>'; return; }
    const st = f.status ? FST[f.status] : null;
    const docs = f.docs.filter((d) => type !== 'tenancy' || true);
    el.innerHTML = (st ? '<p>Estado: <span class="tag ' + st[1] + '">' + st[0] + '</span></p>' : '')
      + '<p class="row"><button class="b sm" data-flink>' + (type === 'tenancy' ? 'Enviar portal de pagos' : f.links.length ? 'Enviar enlace nuevo' : 'Enviar enlace por WhatsApp') + '</button>'
      + (mgr() && type !== 'tenancy' && f.status === 'recibido' ? '<button class="b sm" data-fst="aprobado">Aprobar</button><button class="b no sm" data-fst="rechazado">Rechazar</button>' : '') + '</p>'
      + (f.profile ? '<p class="note">Su búsqueda: ' + [f.profile.budget ? 'hasta ' + money(f.profile.budget) : '', f.profile.move_date ? 'se muda ' + fdate(f.profile.move_date) : '', f.profile.occupants ? f.profile.occupants + ' persona(s)' : '', f.profile.pets ? 'mascotas: ' + esc(f.profile.pets) : '', f.profile.occupation ? esc(f.profile.occupation) : ''].filter(Boolean).join(' · ') + (f.profile.notes ? '<br>' + esc(f.profile.notes) : '') + '</p>' : '')
      + (docs.length ? docs.map((d) => '<div class="fi"><span><b>' + esc((f.kinds[d.kind] || [d.kind])[0]) + '</b> <span class="tag ' + DST[d.status][1] + '">' + DST[d.status][0] + '</span><br><span class="note">' + esc(d.original_name || '') + ' · ' + fdt(d.uploaded_at) + (d.note ? ' · ' + esc(d.note) : '') + '</span></span>'
        + '<span class="row"><a class="b s sm" target="_blank" rel="noopener" href="api/documents/' + d.id + '/file">Ver</a>' + (d.status !== 'validado' ? '<button class="b s sm" data-drev="' + d.id + ':validado">Validar</button>' : '') + (d.status !== 'rechazado' ? '<button class="b s sm" data-drev="' + d.id + ':rechazado">Rechazar</button>' : '') + (mgr() ? '<button class="b s sm" data-ddel="' + d.id + '">Borrar</button>' : '') + '</span></div>').join('')
        : '<p class="note">Aún no hay documentos.</p>')
      + (f.log.length ? '<details><summary class="note">Quién los ha abierto (' + f.log.length + ')</summary><div class="hist">' + f.log.map((x) => '<div><span class="note">' + fdt(x.at) + '</span> · ' + esc(x.user_name || '—') + ' · ' + esc(x.action) + ' doc #' + x.document_id + '</div>').join('') + '</div></details>' : '')
      + '<p class="note">Cifrados en la bóveda. Solo los ven el asesor, el Gerente y el Dueño, y cada vez que se abren queda registrado.</p>';
    const again = () => fileBox(el, type, id, label);
    $('[data-flink]', el).onclick = async () => {
      const w = window.open('', '_blank');
      const r = await act(() => api('files/' + type + '/' + id + '/link', { method: 'POST', body: {} }));
      if (!r) { if (w) w.close(); return; }
      const url = waL(r.phone, LINK_MSG[type](r.name || label, r.url));
      if (w) w.location = url; else location.href = url;
      toast('Enlace creado. El anterior ya no sirve.'); again(); reload(['leads']);
    };
    $$('[data-fst]', el).forEach((b) => { b.onclick = async () => { if (await act(() => api('files/' + type + '/' + id + '/status', { method: 'POST', body: { status: b.dataset.fst } }), 'Expediente ' + b.dataset.fst + '.')) { again(); reload(['leads']); } }; });
    $$('[data-drev]', el).forEach((b) => { b.onclick = async () => {
      const x = b.dataset.drev.split(':'); let note = '';
      if (x[1] === 'rechazado') { note = prompt('¿Por qué se rechaza? (lo verá quien lo subió)') || ''; if (!note.trim()) return; }
      if (await act(() => api('documents/' + x[0] + '/review', { method: 'POST', body: { status: x[1], note: note } }))) { again(); reload(['pay']); }
    }; });
    $$('[data-ddel]', el).forEach((b) => { b.onclick = async () => { if (!confirm('¿Borrar este documento para siempre? No se puede deshacer.')) return; if (await act(() => api('documents/' + b.dataset.ddel, { method: 'DELETE' }), 'Documento borrado.')) again(); }; });
  }
  // Administración de la renta: cuadro de pagos por mes.
  async function payBox(el, p) {
    if (!el) return;
    const r = await act(() => api('properties/' + p.id + '/payments'));
    if (!r) return;
    const months = []; const d = new Date(S.cfg.today.slice(0, 7) + '-15T12:00:00Z');
    for (let i = 0; i < 6; i++) { months.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); }
    const cell = (m, c) => { const x = r.rows.find((y) => y.month === m && y.concept === c); const st = x ? x.status : 'pendiente';
      return '<select data-pay="' + m + ':' + c + '" aria-label="' + esc(c + ' ' + m) + '">' + opts([['pendiente', 'Pendiente'], ['validado', 'Validado'], ['rechazado', 'Rechazado']], st) + '</select>' + (x && x.document_id ? ' <a class="note" target="_blank" href="api/documents/' + x.document_id + '/file">📎</a>' : ''); };
    el.innerHTML = '<p>' + (r.tenant ? 'Inquilino: <b>' + esc(r.tenant.name) + '</b> · ' + tel(r.tenant.phone) : '<span class="err">Sin inquilino: marca como Firmado el lead de quien rentó.</span>') + '</p>'
      + '<div class="tw"><table><thead><tr><th>Mes</th>' + r.concepts.map((c) => '<th>' + esc(S.cfg.payConcepts[c]) + '</th>').join('') + '</tr></thead><tbody>'
      + months.map((m) => '<tr><td>' + m + '</td>' + r.concepts.map((c) => '<td>' + cell(m, c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'
      + '<h4>Comprobantes</h4><div id="paydocs"></div>';
    $$('[data-pay]', el).forEach((sel) => { sel.onchange = () => { const x = sel.dataset.pay.split(':'); act(() => api('properties/' + p.id + '/payments', { method: 'PUT', body: { month: x[0], concept: x[1], status: sel.value } }), 'Guardado.').then(() => reload(['pay'])); }; });
    fileBox($('#paydocs', el), 'tenancy', p.id, r.tenant ? r.tenant.name : '');
  }
  function myNumbersCard() {
    const n = S.mine; if (!n) return '';
    const st = S.cfg.settings;
    return '<div class="card"><h2>Mis números del mes</h2><div class="kpis"><div class="kpi"><div class="kv">' + n.leads + '</div><div class="kl">Leads recibidos</div></div><div class="kpi"><div class="kv">' + n.visited + '</div><div class="kl">Visitaron</div></div><div class="kpi"><div class="kv">' + n.signed + '</div><div class="kl">Rentas firmadas</div></div><div class="kpi"><div class="kv">' + money(n.commission) + '</div><div class="kl">Comisión estimada</div></div></div>'
      + '<p class="note">Supuesto por confirmar: Rentaypunto cobra ' + st.commission_months + ' mes(es) de renta al cerrar y el asesor recibe ' + st.commission_pct + '% de ese cobro. Lo ajusta el Dueño en Equipo.</p></div>';
  }
  // Pedir opinión: genera el enlace de un solo uso y abre WhatsApp con el mensaje.
  function bindOpinion() {
    $$('[data-opinion]').forEach((b) => { b.onclick = async () => {
      const l = S.leads.find((x) => x.id === Number(b.dataset.opinion)) || S.lead;
      const w = window.open('', '_blank');
      const r = await act(() => api('leads/' + l.id + '/opinion-link', { method: 'POST', body: {} }));
      if (!r) { if (w) w.close(); return; }
      if (r.done) { if (w) w.close(); return toast('Ya dejó su opinión. ¡Gracias!'); }
      const url = waL(l.phone, 'Hola ' + first(l.name) + ', gracias por visitar ' + (l.prop_title || 'la propiedad') + '. ¿Nos ayudas con tu opinión? Es anónima y toma 20 segundos: ' + r.url);
      if (w) w.location = url; else location.href = url;
    }; });
  }
  function bindCommon() {
    $$('[data-goto]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.goto; render(); scrollTo(0, 0); }; });
    $$('[data-open]').forEach((b) => { b.onclick = () => { S.tab = 'leads'; openLead(Number(b.dataset.open)); }; });
    $$('[data-edit]').forEach((b) => { b.onclick = () => { S.tab = 'props'; editProp(Number(b.dataset.edit)); }; });
    $$('[data-pub]').forEach((b) => { b.onclick = () => setStatus(Number(b.dataset.pub), 'disponible'); });
  }

  // ---------- Leads ----------
  async function openLead(id) {
    const l = await act(() => api('leads/' + id));
    if (!l) return;
    S.lead = l; S.losing = false; S.newLead = false; render(); scrollTo(0, 0);
  }
  function leadCard() {
    const l = S.lead; if (!l) return '';
    const sim = similares(l);
    return '<div class="card" id="leadcard"><h2>C-' + l.id + ' · ' + esc(l.name) + ' <span class="tag">' + STG[l.stage] + '</span></h2><div class="g2"><div>'
      + fi('Quiere ver', l.prop_code ? '<a target="_blank" rel="noopener" href="' + esc(propUrl(l.prop_slug)) + '">' + esc(l.prop_code + ' · ' + l.prop_title) + '</a>' : '—')
      + fi('Cita', l.visit_date ? fdate(l.visit_date) + ' · ' + l.visit_time : '—')
      + fi('WhatsApp', '<a href="tel:+52' + esc(l.phone) + '">' + tel(l.phone) + '</a>')
      + fi('Origen', esc(l.origin) + (l.utm_campaign ? ' · ' + esc(l.utm_campaign) : ''))
      + fi('Recibido', fdt(l.created_at) + ' (' + ago(l.created_at) + ')')
      + (l.search_context ? fi('Busca', esc(l.search_context)) : '')
      + (l.address_private ? fi('Dirección exacta', esc(l.address_private) + ' <span class="note">compártela solo con la cita confirmada</span>') : '')
      + '<h3 style="margin-top:12px">Notas e historial</h3><textarea id="nt" rows="2" placeholder="Escribe una nota…"></textarea><p><button class="b s sm" id="ntgo">Guardar nota</button></p>'
      + '<div class="hist">' + l.events.map((e) => '<div><span class="note">' + fdt(e.created_at) + (e.user_name ? ' · ' + esc(e.user_name) : '') + '</span><br>' + esc(e.content) + '</div>').join('') + '</div>'
      + '</div><div>'
      + '<label for="lst">Etapa</label><select id="lst">' + opts(S.cfg.lists.stages, S.losing ? 'perdido' : l.stage, (s) => STG[s]) + '</select>'
      + (S.losing ? '<label for="mot">Motivo de pérdida (obligatorio)</label><select id="mot"><option value="">Elige…</option>' + opts(S.cfg.lists.lostReasons) + '</select><p class="row"><button class="b no sm" id="motgo">Marcar como perdido</button><button class="b s sm" id="motno">Cancelar</button></p>'
        : l.stage === 'perdido' ? '<p>Motivo: <span class="tag no">' + esc(l.lost_reason || '—') + '</span></p>' : '')
      + (l.stage === 'firmado' ? '<p class="note">Firmado: la propiedad quedó como Rentada y salió del sitio.</p>' : '')
      + (mgr() ? '<label for="las">Asesor</label><select id="las"><option value="">Sin asesor</option>' + opts(advisors().map((u) => [u.id, u.name]), l.advisor_id) + '</select>' : '')
      + '<div class="filters"><div><label for="lvd">Fecha de la cita</label><input id="lvd" type="date" value="' + esc(l.visit_date || '') + '"></div><div><label for="lvt">Hora</label><input id="lvt" type="time" step="900" value="' + esc(l.visit_time || '') + '"></div></div>'
      + '<p class="row"><button class="b s sm" id="lvgo">Cambiar cita</button>' + (['cita', 'nuevo', 'contactado'].includes(l.stage) && l.visit_date ? '<button class="b s sm" id="noshow">No asistió</button>' : '') + '</p>'
      + '<p class="note">Mensajes listos (abren WhatsApp con el texto escrito; revísalo antes de enviar):</p><p class="row">' + waBtn(l, 'nuevo', 'Primer contacto') + (l.visit_date ? waBtn(l, 'conf', 'Confirmar visita') : '')
      + (l.address_private && l.stage === 'cita' ? waBtn(l, 'dir', 'Enviar dirección') : '') + waBtn(l, 'seg', 'Seguimiento') + waBtn(l, 'sim', 'Enviar similares') + (l.visited_at ? '<button class="b s sm" data-opinion="' + l.id + '">Pedir opinión</button>' : '') + '</p>'
      + '<p class="note">Similares disponibles: ' + (sim.map((x) => esc(x.code + ' ' + x.title + ' ' + money(x.rent))).join(' · ') || 'ninguna por ahora') + '</p>'
      + '</div></div><div class="card" style="background:var(--bg)"><h3>Expediente del inquilino</h3><div id="leadfile"><p class="note">Cargando…</p></div></div><p><button class="b s sm" id="lclose">Cerrar ficha</button></p></div>';
  }
  function bindLead() {
    const l = S.lead; if (!l || !$('#leadcard')) return;
    const patch = async (body, ok) => { const r = await act(() => api('leads/' + l.id, { method: 'PATCH', body: body }), ok); if (r) { await reload(['leads', 'props']); await openLead(l.id); } };
    $('#lclose').onclick = () => { S.lead = null; S.losing = false; render(); };
    bindOpinion();
    fileBox($('#leadfile'), 'lead', l.id, l.name);
    $('#lst').onchange = function () {
      if (this.value === 'perdido') { S.losing = true; render(); return; }
      patch({ stage: this.value }, this.value === 'firmado' ? 'Firmado: la propiedad pasó a Rentada y salió del sitio.' : 'Etapa actualizada.');
    };
    if ($('#motgo')) {
      $('#motgo').onclick = () => { const m = $('#mot').value; if (!m) return toast('Elige el motivo.'); S.losing = false; patch({ stage: 'perdido', lost_reason: m }, 'Marcado como perdido.'); };
      $('#motno').onclick = () => { S.losing = false; render(); };
    }
    if ($('#las')) $('#las').onchange = async function () { const r = await act(() => api('leads/' + l.id + '/assign', { method: 'POST', body: { advisor_id: this.value ? Number(this.value) : null } }), 'Asesor asignado.'); if (r) { await reload(['leads']); await openLead(l.id); } };
    $('#lvgo').onclick = () => patch({ visit_date: $('#lvd').value, visit_time: $('#lvt').value }, 'Cita actualizada.');
    if ($('#noshow')) $('#noshow').onclick = () => patch({ no_show: true }, 'Registrado: no asistió. Vuelve a Contactado.');
    $('#ntgo').onclick = async () => { const t = $('#nt').value.trim(); if (!t) return toast('Escribe la nota.'); const r = await act(() => api('leads/' + l.id + '/notes', { method: 'POST', body: { text: t } }), 'Nota guardada.'); if (r) openLead(l.id); };
  }
  function newLeadCard() {
    if (!S.newLead) return '';
    const avail = S.props.filter((p) => ['disponible', 'apartada'].includes(p.status));
    return '<div class="card" id="nlcard"><h2>Capturar lead</h2><p class="note">Para quien escribió directo por WhatsApp o llamó.</p><div class="filters">'
      + '<div><label for="nl_n">Nombre</label><input id="nl_n"></div><div><label for="nl_w">WhatsApp</label><input id="nl_w" type="tel" inputmode="numeric" placeholder="10 dígitos"></div>'
      + '<div><label for="nl_o">Por dónde llegó</label><select id="nl_o">' + opts(['WhatsApp', 'Llamada', 'Referido', 'Otro']) + '</select></div>'
      + '<div><label for="nl_p">Propiedad</label><select id="nl_p"><option value="">Ninguna todavía</option>' + opts(avail.map((p) => [p.id, p.code + ' · ' + p.title])) + '</select></div>'
      + '<div><label for="nl_d">Fecha de visita (opcional)</label><input id="nl_d" type="date"></div><div><label for="nl_t">Hora</label><input id="nl_t" type="time" step="900"></div>'
      + (mgr() ? '<div><label for="nl_a">Asesor</label><select id="nl_a"><option value="">El de la propiedad</option>' + opts(advisors().map((u) => [u.id, u.name])) + '</select></div>' : '')
      + '</div><label for="nl_m">Nota</label><textarea id="nl_m" rows="2"></textarea><p class="row"><button class="b" id="nlgo">Guardar lead</button><button class="b s" id="nlno">Cancelar</button></p></div>';
  }
  function renderLeads() {
    const f = S.leadFilter || ''; const q = (S.leadQ || '').toLowerCase();
    const L = S.leads.filter((l) => (!f || l.stage === f) && (!q || [l.id, l.name, l.phone, l.prop_code, l.prop_title].join(' ').toLowerCase().includes(q)));
    $('#app').innerHTML = leadCard() + newLeadCard()
      + '<div class="card"><div class="row" style="justify-content:space-between"><h2>Leads</h2><button class="b sm" id="nlopen">+ Lead</button></div><div class="filters"><div><label for="lf">Etapa</label><select id="lf"><option value="">Todas</option>' + opts(S.cfg.lists.stages, f, (s) => STG[s]) + '</select></div>'
      + '<div><label for="lq">Buscar (nombre, WhatsApp, folio, propiedad)</label><input id="lq" value="' + esc(S.leadQ || '') + '"></div></div><p class="note">' + L.length + ' lead(s)</p>'
      + '<div class="tw"><table class="cards"><thead><tr><th>Folio</th><th>Prospecto</th><th>Propiedad</th><th>Cita</th><th>Asesor</th><th>Etapa</th><th></th></tr></thead><tbody>'
      + (L.map((l) => '<tr><td data-l="Folio">C-' + l.id + '</td><td><b>' + esc(l.name) + '</b><br><span class="note">' + tel(l.phone) + ' · ' + esc(l.origin) + '</span>' + (l.stage === 'nuevo' ? ' <span class="tag ' + (hoursAgo(l.created_at) >= 24 ? 'no' : 'ok') + '">' + ago(l.created_at) + '</span>' : '') + '</td>'
        + '<td data-l="Propiedad">' + esc(l.prop_code ? l.prop_code + ' · ' + l.prop_title : '—') + '</td><td data-l="Cita">' + (l.visit_date ? fdate(l.visit_date) + ' ' + l.visit_time : '—') + '</td>'
        + '<td data-l="Asesor">' + esc(l.advisor_name || 'Sin asesor') + '</td><td data-l="Etapa"><span class="tag' + (l.stage === 'perdido' ? ' no' : l.stage === 'firmado' ? ' ok' : '') + '">' + STG[l.stage] + '</span></td><td><button class="b s sm" data-open="' + l.id + '">Abrir</button></td></tr>').join('')
        || '<tr><td colspan="7" class="note">Sin leads.</td></tr>') + '</tbody></table></div></div>';
    $('#lf').onchange = function () { S.leadFilter = this.value; renderLeads(); };
    $('#lq').oninput = function () { S.leadQ = this.value; clearTimeout(S.lqt); S.lqt = setTimeout(() => { renderLeads(); const i = $('#lq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $('#nlopen').onclick = () => { S.newLead = true; S.lead = null; renderLeads(); scrollTo(0, 0); };
    if ($('#nlgo')) {
      $('#nlno').onclick = () => { S.newLead = false; renderLeads(); };
      $('#nlgo').onclick = async () => {
        const body = { name: $('#nl_n').value, phone: $('#nl_w').value, origin: $('#nl_o').value, property_id: $('#nl_p').value ? Number($('#nl_p').value) : null, visit_date: $('#nl_d').value || undefined, visit_time: $('#nl_t').value || undefined, note: $('#nl_m').value };
        if ($('#nl_a') && $('#nl_a').value) body.advisor_id = Number($('#nl_a').value);
        const r = await act(() => api('leads', { method: 'POST', body: body }), 'Lead guardado.');
        if (r) { S.newLead = false; await reload(['leads']); openLead(r.id); }
      };
    }
    bindCommon(); bindLead();
  }

  // ---------- Citas ----------
  function renderCitas() {
    const t = today(); const w = S.citaWhen || 'prox';
    const L = S.leads.filter((l) => l.visit_date && (w === 'todas' || (w === 'prox' ? l.visit_date >= t && !['perdido', 'firmado'].includes(l.stage) : l.visit_date < t)))
      .sort((a, b) => { const x = a.visit_date + a.visit_time; const y = b.visit_date + b.visit_time; return w === 'prox' ? (x < y ? -1 : 1) : (x > y ? -1 : 1); });
    $('#app').innerHTML = leadCard() + '<div class="card"><h2>Citas</h2><div class="row">' + [['prox', 'Próximas'], ['pas', 'Pasadas'], ['todas', 'Todas']].map((x) => '<button class="b sm' + (w === x[0] ? '' : ' s') + '" data-w="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>'
      + '<div class="tw"><table class="cards"><thead><tr><th>Cuándo</th><th>Prospecto</th><th>Propiedad</th><th>Asesor</th><th>Etapa</th><th></th></tr></thead><tbody>'
      + (L.map((l) => '<tr><td data-l="Cuándo"><b>' + fdate(l.visit_date) + ' ' + l.visit_time + '</b>' + (l.visit_date === t ? ' <span class="tag wa">Hoy</span>' : '') + '</td><td><b>' + esc(l.name) + '</b><br><span class="note">' + tel(l.phone) + '</span></td>'
        + '<td data-l="Propiedad">' + esc(l.prop_code ? l.prop_code + ' · ' + l.prop_title : '—') + '</td><td data-l="Asesor">' + esc(l.advisor_name || 'Sin asesor') + '</td><td data-l="Etapa"><span class="tag">' + STG[l.stage] + '</span></td>'
        + '<td><span class="row">' + (['nuevo', 'contactado'].includes(l.stage) ? '<button class="b sm" data-cst="' + l.id + ':cita">Confirmada</button>' : '') + (l.stage === 'cita' ? '<button class="b sm" data-cst="' + l.id + ':visito">Visitó</button><button class="b s sm" data-ns="' + l.id + '">No asistió</button>' : '')
        + waBtn(l, 'conf', 'WhatsApp') + '<button class="b s sm" data-open="' + l.id + '">Abrir</button></span></td></tr>').join('') || '<tr><td colspan="6" class="note">Sin citas.</td></tr>') + '</tbody></table></div></div>';
    $$('[data-w]').forEach((b) => { b.onclick = () => { S.citaWhen = b.dataset.w; renderCitas(); }; });
    $$('[data-cst]').forEach((b) => { b.onclick = () => { const x = b.dataset.cst.split(':'); act(async () => { await api('leads/' + x[0], { method: 'PATCH', body: { stage: x[1] } }); await reload(['leads']); renderCitas(); }, 'Actualizado.'); }; });
    $$('[data-ns]').forEach((b) => { b.onclick = () => act(async () => { await api('leads/' + b.dataset.ns, { method: 'PATCH', body: { no_show: true } }); await reload(['leads']); renderCitas(); }, 'Registrado: no asistió.'); });
    $$('[data-open]').forEach((b) => { b.onclick = () => openLead(Number(b.dataset.open)).then(() => { S.tab = 'citas'; render(); }); });
    bindLead();
  }

  // ---------- Propiedades ----------
  const zoneById = (id) => S.cfg.zones.find((z) => z.id === Number(id));
  function seoScore(p) { const c = SEO.seoChecks(p, { slug: p.seo_slug, title: p.seo_title, desc: p.seo_desc }, (p.photos || []).length); return Math.round(c.filter((x) => x[1]).length / c.length * 100); }
  async function setStatus(id, status) {
    const r = await act(() => api('properties/' + id + '/status', { method: 'POST', body: { status: status } }));
    if (r) {
      toast((status === 'disponible' ? 'Publicada en el sitio.' : 'Estado: ' + PST[status] + '.') + (r.alert_matches ? ' ' + r.alert_matches + ' alerta(s) de búsqueda coinciden: revisa Seguimiento.' : ''));
      await reload(['props', 'follow']); render();
    }
  }
  function editProp(id) { S.edit = id ? JSON.parse(JSON.stringify(S.props.find((p) => p.id === id))) : { status: 'borrador', extras: [], includes: [], photos: [], deposit_months: 1, can_edit: true }; S.pending = []; S.touched = id ? { slug: true, title: true, desc: true } : {}; render(); scrollTo(0, 0); }
  function propForm() {
    const p = S.edit; if (!p) return '';
    const ro = !p.can_edit ? ' disabled' : '';
    const quick = S.qk == null ? S.me.role === 'vendedor' : S.qk;
    const zones = S.cfg.zones.filter((z) => z.active || z.id === p.zone_id);
    const chk = (list, cur, pre) => list.map((x) => '<label class="chk"><input type="checkbox" data-' + pre + '="' + esc(x) + '"' + (cur.includes(x) ? ' checked' : '') + ro + '> ' + esc(x) + '</label>').join('');
    const field = (id, label, val, extra, fu) => '<div' + (fu ? ' class="fu"' : '') + '><label for="a_' + id + '">' + label + '</label><input id="a_' + id + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + ro + '></div>';
    const owners = (S.follow && S.follow.owners) || [];
    return '<div class="card' + (quick ? ' qk' : '') + '" id="propform"><div class="row" style="justify-content:space-between"><h2>' + (p.id ? 'Editando ' + esc(p.code) : 'Nueva propiedad') + '</h2><button class="b s sm" id="qkbtn">' + (quick ? 'Mostrar todos los campos' : 'Captura rápida') + '</button></div>'
      + (!p.can_edit ? '<p class="err">Ya está publicada: solo el Gerente o el Dueño la pueden cambiar.</p>' : '')
      + (!canPub() ? '<p class="note">Lo que guardes queda en <b>Borrador</b> hasta que el Gerente lo revise y lo publique.</p>' : '')
      + '<div class="g2"><div><div class="filters">'
      + field('title', 'Título', p.title, ' placeholder="Depto. 2 recámaras con terraza" maxlength="90"')
      + '<div><label for="a_zone">Zona</label><select id="a_zone"' + ro + '><option value="">Elige</option>' + opts(zones.map((z) => [z.id, z.name]), p.zone_id) + '</select></div>'
      + field('colonia', 'Colonia o referencia (pública)', p.colonia)
      + field('rent', 'Renta mensual (MXN)', p.rent, ' type="number" inputmode="numeric"')
      + field('m2', 'm²', p.m2, ' type="number" inputmode="numeric"')
      + field('bedrooms', 'Recámaras', p.bedrooms, ' type="number" inputmode="numeric"')
      + field('bathrooms', 'Baños', p.bathrooms, ' type="number" inputmode="decimal" step="0.5"')
      + '<div class="fu"><label for="a_type">Tipo</label><select id="a_type"' + ro + '><option value=""></option>' + opts(S.cfg.lists.propTypes, p.prop_type) + '</select></div>'
      + field('deposit_months', 'Depósito (meses)', p.deposit_months, ' type="number" inputmode="decimal" step="0.5"', true)
      + field('maintenance', 'Mantenimiento (MXN/mes)', p.maintenance, ' type="number" inputmode="numeric"', true)
      + field('parking', 'Cocheras (lugares)', p.parking, ' type="number" inputmode="numeric"', true)
      + field('max_occupants', 'Ocupantes máximos', p.max_occupants, ' type="number" inputmode="numeric"', true)
      + field('min_term', 'Plazo mínimo (meses)', p.min_term, ' type="number" inputmode="numeric"', true)
      + field('available_from', 'Disponible desde', p.available_from, ' type="date"', true)
      + field('contract_start', 'Contrato desde', p.contract_start, ' type="date"', true)
      + field('contract_end', 'Contrato hasta', p.contract_end, ' type="date"', true)
      + '<div class="fu"><label for="a_req">Requisitos</label><select id="a_req"' + ro + '><option value=""></option>' + opts(S.cfg.lists.requirements, p.requirements) + '</select></div>'
      + (mgr() ? '<div><label for="a_adv">Asesor</label><select id="a_adv"' + ro + '><option value="">Sin asignar</option>' + opts(advisors().map((u) => [u.id, u.name]), p.advisor_id) + '</select></div>' : '')
      + (canPub() ? '<div><label for="a_st">Estado</label><select id="a_st"' + ro + '>' + opts(S.cfg.lists.propStatus, p.status, (s) => PST[s]) + '</select></div>' : '')
      + '</div>'
      + '<p class="fu"><label>Extras</label>' + chk(S.cfg.lists.extras, p.extras, 'ex') + '</p>'
      + '<p class="fu"><label>Servicios incluidos en la renta</label>' + chk(S.cfg.lists.includes, p.includes, 'inc') + '</p>'
      + '<div class="fu">' + field('near', 'Cerca de (lo que ayuda a decidir)', p.near, ' placeholder="Escuela a 5 min, parque, clínica"') + field('consider_note', 'Nota "Considera" (la ve el cliente)', p.consider_note, ' placeholder="Privada con reglamento: pedir copia"') + '</div>'
      + '<p class="fu"><label for="a_desc">Descripción</label><textarea id="a_desc" rows="4"' + ro + '>' + esc(p.description || '') + '</textarea></p>'
      + '<p><label for="a_addr">Dirección exacta (privada: no sale en el sitio)</label><input id="a_addr" value="' + esc(p.address_private || '') + '"' + ro + '></p>'
      + (mgr() ? '<p class="fu"><label for="a_owner">Propietario registrado</label><select id="a_owner"' + ro + '><option value="">—</option>' + opts(owners.map((o) => [o.id, 'P-' + o.id + ' · ' + o.name])) + '</select></p>' : '')
      + '<h3>Fotos</h3><div class="thumbs" id="thumbs"></div>' + (p.can_edit ? '<input type="file" id="a_files" accept="image/*" multiple><p class="note">La primera foto es la portada. Se achican solas antes de subirse.</p>' : '')
      + '</div><div><h3>SEO de la ficha <span class="tag" id="sc"></span></h3><p class="note">Se llena solo al capturar. Puedes editar cada campo.</p>'
      + '<label for="seo_slug">URL</label><div class="urlrow"><span class="note">…/</span><input id="seo_slug"' + ro + '></div>'
      + '<label for="seo_title">Título SEO <span id="seo_ct" class="note"></span></label><input id="seo_title"' + ro + '>'
      + '<label for="seo_desc">Meta descripción <span id="seo_cd" class="note"></span></label><textarea id="seo_desc" rows="3"' + ro + '></textarea>'
      + '<p class="note">H1 de la ficha: <b id="seo_h1"></b></p><div id="gp"></div><ul class="ck" id="ck"></ul>' + (p.can_edit ? '<p><button class="b s sm" id="seoreset">Restablecer SEO automático</button></p>' : '') + '</div></div>'
      + '<p class="row">' + (p.can_edit ? '<button class="b" id="psave">' + (canPub() ? 'Guardar' : 'Guardar borrador') + '</button>' : '') + '<button class="b s" id="pclose">Cerrar</button>'
      + (p.id && ['disponible', 'apartada'].includes(p.status) ? '<a class="b s" target="_blank" rel="noopener" href="' + esc(propUrl(p.seo_slug)) + '">Ver en el sitio</a>' : '') + '</p><p class="err" id="perr"></p>'
      + (p.id && p.sees_private ? extrasHtml(p) : '') + '</div>';
  }
  // Solicitud del propietario y acta de entrega (solo con la propiedad ya guardada).
  function extrasHtml(p) {
    let h = '<div class="g2"><div class="card"><h3>Lo que pide el propietario</h3><p class="note">Te escribió por WhatsApp: regístralo aquí y el Gerente lo aplica.</p>'
      + '<label for="rq_k">Pide</label><select id="rq_k">' + opts(Object.entries(S.cfg.ownerRequests)) + '</select>'
      + '<label for="rq_r">Renta nueva (si pide cambio de precio)</label><input id="rq_r" type="number" inputmode="numeric"><label for="rq_n">Nota</label><input id="rq_n">'
      + '<p><button class="b s sm" id="rqgo">Registrar solicitud</button></p></div>';
    if (p.status === 'rentada') {
      h += '<div class="card"><h3>Acta de entrega</h3><div id="acta"><p class="note">Cargando…</p></div></div>';
      h += '<div class="card"><h3>Administración: pagos del inquilino</h3><div id="pays"><p class="note">Cargando…</p></div></div>';
    }
    return h + '</div>';
  }
  async function bindExtras(p) {
    if (!$('#rqgo')) return;
    $('#rqgo').onclick = async () => {
      const r = await act(() => api('properties/' + p.id + '/requests', { method: 'POST', body: { kind: $('#rq_k').value, new_rent: $('#rq_r').value, note: $('#rq_n').value } }), mgr() ? 'Registrada. Aplícala en Seguimiento.' : 'Registrada. El Gerente la aplica.');
      if (r) { $('#rq_r').value = ''; $('#rq_n').value = ''; reload(['follow']); }
    };
    if ($('#pays')) payBox($('#pays'), p);
    if (!$('#acta')) return;
    const a = await act(() => api('properties/' + p.id + '/acta'));
    if (!a) return;
    const paint = () => {
      $('#acta').innerHTML = S.cfg.actaItems.map((t, i) => '<label class="chk" style="display:flex"><input type="checkbox" data-ai="' + i + '"' + (a.items[i] ? ' checked' : '') + '> ' + esc(t) + '</label>').join('')
        + '<div class="thumbs">' + a.photos.map((f) => '<div class="thumb"><a target="_blank" href="api/acta-photo/' + f.id + '"><img src="api/acta-photo/' + f.id + '?sm=1" alt="Foto del acta"></a></div>').join('') + '</div>'
        + '<input type="file" id="acta_f" accept="image/*" multiple aria-label="Fotos del acta"><p class="note">Las fotos del acta son privadas: no salen en el sitio. ' + a.items.filter(Boolean).length + '/' + S.cfg.actaItems.length + ' puntos revisados.</p>';
      $$('[data-ai]').forEach((c) => { c.onchange = async () => { a.items[Number(c.dataset.ai)] = c.checked; const items = S.cfg.actaItems.map((_, i) => Boolean(a.items[i])); await act(() => api('properties/' + p.id + '/acta', { method: 'PUT', body: { items: items } })); paint(); }; });
      $('#acta_f').onchange = async function () {
        for (const f of this.files) {
          try { const img = await shrink(f); const r = await api('properties/' + p.id + '/acta/photos', { method: 'POST', body: img }); a.photos.push({ id: r.id }); } catch (e) { toast(e.message); }
        }
        paint();
      };
    };
    paint();
  }
  function formData() {
    const v = (id) => { const e = $('#a_' + id); return e ? e.value : undefined; };
    const d = { title: v('title'), zone_id: Number(v('zone')) || null, colonia: v('colonia'), rent: v('rent'), m2: v('m2'), bedrooms: v('bedrooms'), bathrooms: v('bathrooms'), prop_type: v('type'),
      deposit_months: v('deposit_months'), maintenance: v('maintenance'), parking: v('parking'), max_occupants: v('max_occupants'), min_term: v('min_term'), available_from: v('available_from'),
      requirements: v('req'), near: v('near'), contract_start: v('contract_start') || null, contract_end: v('contract_end') || null, consider_note: v('consider_note'), description: $('#a_desc').value, address_private: v('addr'),
      extras: $$('[data-ex]').filter((x) => x.checked).map((x) => x.dataset.ex), includes: $$('[data-inc]').filter((x) => x.checked).map((x) => x.dataset.inc) };
    if ($('#a_adv')) d.advisor_id = v('adv') ? Number(v('adv')) : null;
    if ($('#a_st')) d.status = v('st');
    if ($('#a_owner')) d.owner_id = v('owner') ? Number(v('owner')) : null;
    return d;
  }
  function updateSeo() {
    const p = S.edit; const d = formData(); const z = zoneById(d.zone_id);
    const a = SEO.seoAuto({ title: d.title, zone: z ? z.name : '', rent: Number(d.rent), m2: d.m2, bedrooms: d.bedrooms, bathrooms: d.bathrooms, extras: d.extras, code: p.code || 'RP-nuevo' });
    if (!S.touched.slug) $('#seo_slug').value = a.slug; if (!S.touched.title) $('#seo_title').value = a.title; if (!S.touched.desc) $('#seo_desc').value = a.desc;
    const s = { slug: $('#seo_slug').value, title: $('#seo_title').value, desc: $('#seo_desc').value };
    const ck = SEO.seoChecks({ ...d, rent: Number(d.rent) }, s, (p.photos || []).length + S.pending.length); const okn = ck.filter((x) => x[1]).length;
    $('#seo_h1').textContent = a.h1; $('#seo_ct').textContent = s.title.length + '/60'; $('#seo_cd').textContent = s.desc.length + '/155';
    $('#sc').textContent = okn + '/' + ck.length; $('#sc').className = 'tag ' + (okn === ck.length ? 'ok' : okn >= 5 ? 'wa' : 'no');
    $('#gp').innerHTML = '<div class="gp"><div class="gu">rentaypunto.com › ' + esc(s.slug).replace(/\//g, ' › ') + '</div><div class="gt">' + esc(s.title) + '</div><div class="gd">' + esc(s.desc) + '</div></div>';
    $('#ck').innerHTML = ck.map((c) => '<li class="' + (c[1] ? 'cok' : 'cno') + '">' + (c[1] ? '✓' : '✗') + ' ' + c[0] + '</li>').join('');
  }
  function paintThumbs() {
    const p = S.edit; const el = $('#thumbs'); if (!el) return;
    el.innerHTML = (p.photos || []).map((f, i) => '<div class="thumb"><img src="/fotos/' + esc(f.file) + '-sm.jpg" alt="Foto ' + (i + 1) + '">' + (p.can_edit ? '<div class="row">' + (i ? '<button data-first="' + f.id + '" title="Hacer portada">★</button>' : '<span class="tag ok">Portada</span>') + '<button data-delph="' + f.id + '" title="Quitar">✕</button></div>' : '') + '</div>').join('')
      + S.pending.map((f, i) => '<div class="thumb pend"><img src="' + f.small + '" alt="Por subir"><div class="row"><span class="tag wa">Por subir</span><button data-delpend="' + i + '">✕</button></div></div>').join('')
      || '<p class="note">Sin fotos.</p>';
    $$('[data-delph]', el).forEach((b) => { b.onclick = async () => { if (!confirm('¿Quitar esta foto?')) return; const r = await act(() => api('photos/' + b.dataset.delph, { method: 'DELETE' })); if (r) { p.photos = p.photos.filter((x) => x.id !== Number(b.dataset.delph)); paintThumbs(); updateSeo(); reload(['props']); } }; });
    $$('[data-first]', el).forEach((b) => { b.onclick = async () => { const id = Number(b.dataset.first); const ids = [id].concat(p.photos.map((x) => x.id).filter((x) => x !== id)); const r = await act(() => api('properties/' + p.id + '/photos/order', { method: 'PUT', body: { ids: ids } }), 'Portada cambiada.'); if (r) { p.photos.sort((a, c) => ids.indexOf(a.id) - ids.indexOf(c.id)); paintThumbs(); reload(['props']); } }; });
    $$('[data-delpend]', el).forEach((b) => { b.onclick = () => { S.pending.splice(Number(b.dataset.delpend), 1); paintThumbs(); updateSeo(); }; });
  }
  // Achica la foto en el celular: grande (1600 px) y miniatura (640 px), en JPEG.
  function shrink(file) {
    return new Promise((ok, fail) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const out = (max, q) => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); };
        const r = { big: out(1600, 0.82), small: out(640, 0.75) }; URL.revokeObjectURL(url); ok(r);
      };
      img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('No se pudo leer ' + file.name + '. Usa JPG o PNG.')); };
      img.src = url;
    });
  }
  async function uploadPending(id) {
    let n = 0;
    while (S.pending.length) {
      const f = S.pending[0];
      try { const r = await api('properties/' + id + '/photos', { method: 'POST', body: f }); S.edit.photos.push({ id: r.id, file: r.file }); S.pending.shift(); n++; paintThumbs(); }
      catch (e) { toast('Una foto no se subió: ' + e.message + ' Sigue en "Por subir"; vuelve a guardar.'); return false; }
    }
    return n;
  }
  function bindPropForm() {
    const p = S.edit; if (!p || !$('#propform')) return;
    paintThumbs(); updateSeo(); if (p.id) bindExtras(p);
    $('#qkbtn').onclick = () => { S.qk = !$('#propform').classList.contains('qk'); $('#propform').classList.toggle('qk', S.qk); $('#qkbtn').textContent = S.qk ? 'Mostrar todos los campos' : 'Captura rápida'; };
    $('#pclose').onclick = () => { if (S.pending.length && !confirm('Hay fotos sin subir. ¿Cerrar de todos modos?')) return; S.edit = null; S.pending = []; render(); };
    if (!p.can_edit) return;
    $$('#propform input, #propform select, #propform textarea').forEach((e) => { if (!/^seo_|a_files/.test(e.id)) e.addEventListener('input', updateSeo); });
    [['slug', 'seo_slug'], ['title', 'seo_title'], ['desc', 'seo_desc']].forEach((x) => { $('#' + x[1]).addEventListener('input', () => { S.touched[x[0]] = true; updateSeo(); }); });
    $('#seoreset').onclick = () => { S.touched = {}; updateSeo(); };
    $('#a_files').onchange = async function () {
      for (const f of this.files) { try { S.pending.push(await shrink(f)); } catch (e) { toast(e.message); } }
      this.value = ''; paintThumbs(); updateSeo();
      if (p.id) { const n = await uploadPending(p.id); if (n) { toast(n + ' foto(s) subida(s).'); reload(['props']); updateSeo(); } }
    };
    $('#psave').onclick = async () => {
      const btn = $('#psave'); btn.disabled = true; $('#perr').textContent = '';
      try {
        const body = { ...formData(), seo_slug: $('#seo_slug').value, seo_title: $('#seo_title').value, seo_desc: $('#seo_desc').value };
        if (!S.touched.slug) delete body.seo_slug; if (!S.touched.title) delete body.seo_title; if (!S.touched.desc) delete body.seo_desc;
        const saved = await api(p.id ? 'properties/' + p.id : 'properties', { method: p.id ? 'PATCH' : 'POST', body: body });
        const keepPending = S.pending.slice();
        S.edit = { ...saved, photos: saved.photos || [] }; S.pending = keepPending;
        if (S.pending.length) await uploadPending(saved.id);
        await reload(['props', 'follow']);
        toast(saved.status === 'borrador' ? 'Guardada como borrador.' + (canPub() ? '' : ' El Gerente la revisa y la publica.') : 'Guardada. Su ficha: ' + propUrl(saved.seo_slug)
          + (saved.alert_matches ? ' · ' + saved.alert_matches + ' alerta(s) de búsqueda coinciden: revisa Seguimiento.' : ''));
        if (!S.pending.length) { S.edit = null; render(); }
      } catch (e) { $('#perr').textContent = e.message; } finally { if ($('#psave')) $('#psave').disabled = false; }
    };
  }
  function renderProps() {
    const f = S.propFilter || '';
    const L = S.props.filter((p) => !f || p.status === f);
    const vis = S.props.filter((p) => ['disponible', 'apartada'].includes(p.status));
    $('#app').innerHTML = propForm()
      + '<div class="card"><div class="row" style="justify-content:space-between"><h2>Propiedades</h2>' + (S.edit ? '' : '<button class="b sm" id="pnew">+ Nueva propiedad</button>') + '</div>'
      + '<div class="filters"><div><label for="pf">Estado</label><select id="pf"><option value="">Todos</option>' + opts(S.cfg.lists.propStatus, f, (s) => PST[s]) + '</select></div></div>'
      + '<div class="tw"><table class="cards"><thead><tr><th>Código</th><th>Propiedad</th><th>Estado</th><th>SEO</th><th>Visitas</th><th>WhatsApp</th><th>Leads</th><th></th></tr></thead><tbody>'
      + (L.map((p) => { const sc = seoScore(p);
        const st = canPub() && p.can_edit ? '<select data-st="' + p.id + '" aria-label="Estado">' + opts(S.cfg.lists.propStatus, p.status, (s) => PST[s]) + '</select>' : '<span class="tag">' + PST[p.status] + '</span>';
        return '<tr><td data-l="Código">' + esc(p.code) + '</td><td><b>' + esc(p.title) + '</b><br><span class="note">' + esc(p.zone) + ' · ' + money(p.rent) + ' · ' + p.photos.length + ' foto(s) · ' + esc(p.advisor_name || 'sin asesor') + '</span></td>'
          + '<td data-l="Estado">' + st + '</td><td data-l="SEO"><span class="tag ' + (sc >= 85 ? 'ok' : sc >= 60 ? 'wa' : 'no') + '">' + sc + '%</span></td><td data-l="Visitas">' + p.views + '</td><td data-l="Clics WhatsApp">' + p.wa_clicks + '</td><td data-l="Leads">' + p.leads + '</td>'
          + '<td><span class="row"><button class="b s sm" data-edit="' + p.id + '">' + (p.can_edit ? 'Editar' : 'Ver') + '</button>' + (mgr() && p.status === 'borrador' ? '<button class="b sm" data-pub="' + p.id + '">Publicar</button>' : '') + (mgr() && !p.leads ? '<button class="b s sm" data-del="' + p.id + '">Eliminar</button>' : '') + '</span></td></tr>'; }).join('')
        || '<tr><td colspan="8" class="note">Sin propiedades. Captura la primera con "+ Nueva propiedad".</td></tr>') + '</tbody></table></div>'
      + '<p class="note">En el sitio y en el mapa del sitio: ' + vis.length + ' ficha(s). Las rentadas, pausadas y borradores no salen.</p></div>';
    if ($('#pnew')) $('#pnew').onclick = () => editProp(null);
    $('#pf').onchange = function () { S.propFilter = this.value; renderProps(); };
    $$('[data-st]').forEach((s) => { s.onchange = () => setStatus(Number(s.dataset.st), s.value); });
    $$('[data-del]').forEach((b) => { b.onclick = async () => { if (!confirm('¿Eliminar esta propiedad y sus fotos? No se puede deshacer.')) return; const r = await act(() => api('properties/' + b.dataset.del, { method: 'DELETE' }), 'Eliminada.'); if (r) { await reload(['props']); render(); } }; });
    bindCommon(); bindPropForm();
  }

  // ---------- Resumen (Gerente y Dueño; el costo solo el Dueño) ----------
  const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 + '%' : '—');
  async function renderRes() {
    const per = S.period || 'mes';
    $('#app').innerHTML = '<p class="note">Cargando…</p>';
    const r = await act(() => api('summary?period=' + per));
    if (!r || S.tab !== 'res') return;
    const f = r.funnel;
    const grp = (rows, h) => '<div class="tw"><table class="cards"><thead><tr><th>' + h + '</th><th>Citas</th><th>Confirmadas</th><th>Visitaron</th><th>Rentas</th><th>Cita → renta</th></tr></thead><tbody>'
      + (rows.map((x) => '<tr><td><b>' + esc(x.key) + '</b></td><td data-l="Citas">' + x.leads + '</td><td data-l="Confirmadas">' + x.confirmed + '</td><td data-l="Visitaron">' + x.visited + '</td><td data-l="Rentas">' + x.signed + '</td><td data-l="Cita → renta">' + pct(x.signed, x.leads) + '</td></tr>').join('') || '<tr><td colspan="6" class="note">Sin datos en este periodo.</td></tr>') + '</tbody></table></div>';
    const bar = (label, n) => '<div class="fi"><span>' + label + '</span><span class="row"><span style="display:inline-block;height:12px;width:' + Math.max(4, f.leads ? Math.round(n / f.leads * 160) : 4) + 'px;background:var(--pr);border-radius:6px"></span> <b>' + n + '</b> <span class="note">' + pct(n, f.leads) + '</span></span></div>';
    let cost = '';
    if (r.cost) {
      const m = S.cfg.today.slice(0, 7);
      cost = '<div class="card"><h2>Costo por cita (Meta Ads)</h2><div class="kpis"><div class="kpi"><div class="kv">' + money(r.cost.spend) + '</div><div class="kl">Inversión del periodo</div></div><div class="kpi"><div class="kv">' + (r.cost.perLead ? money(r.cost.perLead) : '—') + '</div><div class="kl">Por cita (' + r.cost.meta.leads + ')</div></div><div class="kpi"><div class="kv">' + (r.cost.perVisit ? money(r.cost.perVisit) : '—') + '</div><div class="kl">Por visita realizada (' + r.cost.meta.visited + ')</div></div><div class="kpi"><div class="kv">' + (r.cost.perSigned ? money(r.cost.perSigned) : '—') + '</div><div class="kl">Por renta (' + r.cost.meta.signed + ')</div></div></div>'
        + '<div class="filters"><div><label for="ms_m">Mes</label><input id="ms_m" type="month" value="' + m + '"></div><div><label for="ms_a">Inversión en Meta (MXN)</label><input id="ms_a" type="number" inputmode="numeric"></div><div><label>&nbsp;</label><button class="b s" id="msgo">Guardar inversión</button></div></div>'
        + '<p class="note">Meses capturados: ' + (r.spendMonths.map((x) => x.month + ' ' + money(x.amount)).join(' · ') || 'ninguno') + '. Solo cuentan las citas con origen Meta Ads (vienen del anuncio con utm_source=facebook o instagram).</p></div>';
    }
    $('#app').innerHTML = '<div class="card"><div class="row" style="justify-content:space-between"><h2>Resumen</h2><select id="per" style="width:auto">' + opts([['mes', 'Este mes'], ['mes_pasado', 'Mes pasado'], ['anio', 'Este año'], ['todo', 'Todo']], per) + '</select></div>'
      + '<div class="kpis"><div class="kpi"><div class="kv">' + r.views + '</div><div class="kl">Visitas a fichas</div></div><div class="kpi"><div class="kv">' + r.wa + '</div><div class="kl">Clics a WhatsApp</div></div><div class="kpi"><div class="kv">' + f.leads + '</div><div class="kl">Citas solicitadas</div></div><div class="kpi"><div class="kv">' + f.visited + '</div><div class="kl">Visitas realizadas</div></div><div class="kpi"><div class="kv">' + f.signed + '</div><div class="kl">Rentas firmadas</div></div><div class="kpi"><div class="kv">' + pct(f.leads, r.views) + '</div><div class="kl">Visita a ficha → cita</div></div></div>'
      + '<p class="note">Del ' + fdate(r.range.from) + ' al ' + fdate(r.range.to) + '. Las visitas a fichas se cuentan desde la fase 2.</p></div>'
      + '<div class="g2"><div class="card"><h2>Embudo</h2>' + bar('Solicitaron cita', f.leads) + bar('Confirmaron', f.confirmed) + bar('Visitaron', f.visited) + bar('Firmaron', f.signed) + '</div>'
      + '<div class="card"><h2>Por qué se pierden</h2>' + (r.lost.map((x) => '<div class="fi"><span>' + esc(x[0]) + '</span><b>' + x[1] + '</b></div>').join('') || '<p class="note">Sin perdidos en este periodo.</p>') + '</div></div>'
      + cost
      + '<div class="card"><h2>Citas por origen</h2>' + grp(r.byOrigin, 'Origen') + '</div>'
      + '<div class="g2"><div class="card"><h2>Por zona</h2>' + grp(r.byZone, 'Zona') + '</div><div class="card"><h2>Por asesor</h2>' + grp(r.byAdvisor, 'Asesor') + '</div></div>';
    $('#per').onchange = function () { S.period = this.value; renderRes(); };
    if ($('#msgo')) $('#msgo').onclick = async () => { const ok = await act(() => api('meta-spend', { method: 'PUT', body: { month: $('#ms_m').value, amount: $('#ms_a').value } }), 'Inversión guardada.'); if (ok) renderRes(); };
  }

  // ---------- Reportes semanales al propietario ----------
  async function renderRep() {
    $('#app').innerHTML = '<p class="note">Cargando…</p>';
    const L = await act(() => api('reports'));
    if (!L || S.tab !== 'rep') return;
    const t = S.cfg.today;
    const due = (x) => x.owner && x.status !== 'rentada' && (!x.last_sent || x.last_sent.slice(0, 10) <= addDays(t, -7));
    $('#app').innerHTML = '<div class="card"><h2>Reporte semanal para cada propietario</h2><p class="note">Visitas a la ficha, citas y opiniones de la última semana, con una recomendación por reglas simples. "Enviar" abre WhatsApp con el mensaje escrito; revísalo antes de mandarlo. ' + L.filter(due).length + ' por enviar esta semana.</p>'
      + '<div class="tw"><table class="cards"><thead><tr><th>Propiedad</th><th>Propietario</th><th>Semana</th><th>Total</th><th>Recomendación</th><th></th></tr></thead><tbody>'
      + (L.map((x) => '<tr><td><b>' + esc(x.code) + '</b> <span class="tag">' + PST[x.status] + '</span><br><span class="note">' + esc(x.title) + '</span></td><td data-l="Propietario">' + (x.owner ? esc(x.owner.name) + '<br><span class="note">' + tel(x.owner.phone) + '</span>' : '<span class="note">Sin propietario ligado (Propiedades → Editar)</span>') + '</td>'
        + '<td data-l="Semana">' + x.week.views + ' visitas · ' + x.week.leads + ' citas · ' + x.week.visited + ' realizadas</td><td data-l="Total">' + x.total.views + ' visitas · ' + x.total.leads + ' citas · ' + x.days + ' días publicada' + (x.op.n ? '<br><span class="note">' + x.op.liked + '/' + x.op.n + ' les gustó</span>' : '') + '</td>'
        + '<td data-l="Recomendación">' + esc(x.recommendation) + '</td><td>' + (x.owner ? '<a class="b sm' + (due(x) ? '' : ' s') + '" target="_blank" rel="noopener" data-sent="' + x.id + '" href="' + esc(waL(x.owner.phone, x.message)) + '">Enviar</a>' : '') + '<br><span class="note">' + (x.last_sent ? 'Último: ' + fdt(x.last_sent) : 'Nunca enviado') + '</span></td></tr>').join('') || '<tr><td colspan="6" class="note">Sin propiedades publicadas.</td></tr>') + '</tbody></table></div></div>';
    $$('[data-sent]').forEach((b) => { b.addEventListener('click', () => { setTimeout(() => act(async () => { await api('properties/' + b.dataset.sent + '/report-sent', { method: 'POST', body: {} }); renderRep(); }, 'Marcado como enviado.'), 300); }); });
  }

  // ---------- Seguimiento ----------
  const stSel = (kind, id, list, cur, labels) => '<select data-fs="' + kind + ':' + id + '" aria-label="Estado">' + opts(list, cur, (s) => (labels || {})[s] || s.charAt(0).toUpperCase() + s.slice(1)) + '</select>';
  function renderSeg() {
    const F = S.follow || { owners: [], tickets: [], legal: [], alerts: [] };
    const tab = (head, rows, empty) => '<div class="tw"><table class="cards"><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="' + head.length + '" class="note">' + empty + '</td></tr>') + '</tbody></table></div>';
    const waA = (a) => 'Hola' + (a.name ? ' ' + first(a.name) : '') + ', soy de Rentaypunto. Nos pediste avisarte de propiedades así: ' + a.filters_text + '. ¿Sigues buscando?';
    const waMatch = (a) => 'Hola' + (a.name ? ' ' + first(a.name) : '') + ', soy de Rentaypunto. Ya tenemos ' + (a.matches.length === 1 ? 'una propiedad' : a.matches.length + ' propiedades') + ' con lo que buscabas (' + a.filters_text + '): ' + a.matches.map((m) => m.title + ' (' + money(m.rent) + ') ' + propUrl(m.slug)).join(' · ');
    $('#app').innerHTML = '<div class="card"><h2>Propietarios que se registraron</h2>' + tab(['Folio', 'Propietario', 'Propiedad', 'Renta', 'Detalles', 'Estado', ''], F.owners.map((o) => '<tr><td data-l="Folio">P-' + o.id + '<br><span class="note">' + fdate(o.created_at) + '</span></td><td><b>' + esc(o.name) + '</b><br><span class="note">' + tel(o.phone) + ' · ' + esc(o.best_time || '') + '</span></td>'
      + '<td data-l="Propiedad">' + esc(o.prop_type || '') + ' en ' + esc(o.zone || '—') + '<br><span class="note">' + esc(o.colonia || '') + (o.bedrooms ? ' · ' + o.bedrooms + ' rec.' : '') + (o.m2 ? ' · ' + o.m2 + ' m²' : '') + '</span></td><td data-l="Renta">' + (o.expected_rent ? money(o.expected_rent) : '—') + '</td>'
      + '<td data-l="Detalles"><span class="note">' + esc(o.occupied || '') + (o.available_from ? ' · desde ' + fdate(o.available_from) : '') + ' · Amueblada: ' + esc(o.furnished || '—') + ' · Mascotas: ' + esc(o.pets || '—') + ' · En otro lado: ' + esc(o.listed_elsewhere || '—') + ' · Vive fuera: ' + esc(o.lives_outside || '—') + (o.notes ? '<br>' + esc(o.notes) : '') + '</span></td>'
      + '<td data-l="Estado">' + stSel('owners', o.id, ['nuevo', 'contactado', 'publicado', 'descartado'], o.status) + '</td><td><span class="row"><a class="b s sm" target="_blank" rel="noopener" href="' + esc(waL(o.phone, 'Hola ' + first(o.name) + ', soy de Rentaypunto. Recibimos el registro de tu propiedad en ' + (o.zone || 'Querétaro') + ' (folio P-' + o.id + '). ¿Te puedo llamar para revisar los detalles?')) + '">WhatsApp</a><button class="b s sm" data-fromowner="' + o.id + '">Crear propiedad</button><button class="b s sm" data-odocs="' + o.id + '">Documentos' + (o.file_status === 'recibido' ? ' <span class="tag wa">nuevos</span>' : '') + '</button></span></td></tr>'), 'Sin registros.') + '<div id="ownerfile"></div></div>'
      + '<div class="card"><h2>Alertas de búsqueda ("Avísame")</h2><p class="note">Se cruzan solas con las propiedades que se publican después de la alerta (o después del último aviso).</p>' + tab(['Folio', 'Prospecto', 'Busca', 'Coincide con', 'Estado', ''], F.alerts.map((a) => '<tr><td data-l="Folio">A-' + a.id + '<br><span class="note">' + fdate(a.created_at) + '</span></td><td>' + esc(a.name || '—') + '<br><span class="note">' + tel(a.phone) + '</span></td><td data-l="Busca">' + esc(a.filters_text) + '</td>'
        + '<td data-l="Coincide con">' + (a.matches && a.matches.length ? a.matches.map((m) => '<span class="tag ok">' + esc(m.code) + '</span>').join(' ') : '<span class="note">—</span>') + '</td><td data-l="Estado">' + stSel('alerts', a.id, ['nuevo', 'contactado', 'cerrado'], a.status) + '</td>'
        + '<td>' + (a.matches && a.matches.length ? '<a class="b sm" target="_blank" rel="noopener" data-notify="' + a.id + '" href="' + esc(waL(a.phone, waMatch(a))) + '">Avisar</a>' : '<a class="b s sm" target="_blank" rel="noopener" href="' + esc(waL(a.phone, waA(a))) + '">WhatsApp</a>') + '</td></tr>'), 'Sin alertas.') + '</div>'
      + '<div class="card"><h2>Solicitudes de propietarios</h2>' + tab(['Folio', 'Propiedad', 'Pide', 'Registró', 'Estado', ''], (F.requests || []).map((r) => '<tr><td data-l="Folio">S-' + r.id + '<br><span class="note">' + fdate(r.created_at) + '</span></td><td data-l="Propiedad">' + esc(r.code + ' · ' + r.title) + '</td><td data-l="Pide">' + esc(S.cfg.ownerRequests[r.kind]) + (r.new_rent ? ' a ' + money(r.new_rent) + ' <span class="note">(hoy ' + money(r.rent) + ')</span>' : '') + (r.note ? '<br><span class="note">' + esc(r.note) + '</span>' : '') + '</td>'
        + '<td data-l="Registró">' + esc(r.by_name || '—') + '</td><td data-l="Estado"><span class="tag ' + (r.status === 'aplicada' ? 'ok' : r.status === 'rechazada' ? 'no' : 'wa') + '">' + r.status + '</span></td><td>' + (r.status === 'nueva' ? '<span class="row"><button class="b sm" data-rq="' + r.id + ':aplicar">Aplicar</button><button class="b s sm" data-rq="' + r.id + ':rechazar">Rechazar</button></span>' : '') + '</td></tr>'), 'Sin solicitudes. Se registran desde la propiedad (Propiedades → Editar).') + '</div>'
      + '<div class="card"><h2>Opiniones de visitas</h2>' + tab(['Propiedad', 'Opiniones', 'Les gustó', 'Renta alta'], (F.opinions || []).map((o) => '<tr><td>' + esc(o.code + ' · ' + o.title) + '</td><td data-l="Opiniones">' + o.n + '</td><td data-l="Les gustó">' + o.liked + '</td><td data-l="Renta alta">' + o.high + '</td></tr>'), 'Aún sin opiniones. Se piden desde el lead con "Pedir opinión" después de la visita.') + '</div>'
      + '<div class="card"><h2>Quejas, inconformidades y sugerencias</h2>' + tab(['Folio', 'Tipo', 'Quién', 'Propiedad', 'Mensaje', 'Asignado', 'Estado'], F.tickets.map((t) => '<tr><td data-l="Folio">#' + t.id + '<br><span class="note">' + fdate(t.created_at) + '</span></td><td data-l="Tipo">' + esc(t.kind) + '</td><td>' + esc(t.name || '—') + '<br><span class="note">' + esc(t.contact || '') + '</span></td><td data-l="Propiedad">' + esc(t.property_ref || '—') + '</td><td data-l="Mensaje">' + esc(t.message) + '</td>'
      + '<td data-l="Asignado"><select data-tas="' + t.id + '"><option value="">Sin asignar</option>' + opts(advisors().map((u) => [u.id, u.name]), t.assigned_to) + '</select></td><td data-l="Estado">' + stSel('tickets', t.id, ['en_gestion', 'resuelto'], t.status, { en_gestion: 'En gestión', resuelto: 'Resuelto' }) + '</td></tr>'), 'Sin reportes.') + '</div>'
      + '<div class="card"><h2>Solicitudes de contacto jurídico</h2>' + tab(['Folio', 'Nombre', 'WhatsApp', 'Es', 'Fecha', 'Estado'], F.legal.map((l) => '<tr><td data-l="Folio">J-' + l.id + '</td><td>' + esc(l.name) + '</td><td data-l="WhatsApp"><a target="_blank" rel="noopener" href="' + esc(waL(l.phone, 'Hola ' + first(l.name) + ', soy de Rentaypunto. Nos pediste información de la póliza jurídica.')) + '">' + tel(l.phone) + '</a></td><td data-l="Es">' + esc(l.who) + '</td><td data-l="Fecha">' + fdate(l.created_at) + '</td><td data-l="Estado">' + stSel('legal', l.id, ['nuevo', 'contactado', 'cerrado'], l.status) + '</td></tr>'), 'Sin solicitudes.') + '</div>';
    $$('[data-fs]').forEach((s) => { s.onchange = () => { const x = s.dataset.fs.split(':'); act(async () => { await api('follow/' + x[0] + '/' + x[1], { method: 'PATCH', body: { status: s.value } }); await reload(['follow']); }, 'Actualizado.'); }; });
    $$('[data-odocs]').forEach((b) => { b.onclick = () => {
      const o = F.owners.find((x) => x.id === Number(b.dataset.odocs));
      $('#ownerfile').innerHTML = '<div class="card" style="background:var(--bg)"><h3>Documentos de ' + esc(o.name) + ' (P-' + o.id + ')</h3><div id="ofbox"></div></div>';
      fileBox($('#ofbox'), 'owner', o.id, o.name); $('#ownerfile').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }; });
    $$('[data-notify]').forEach((b) => { b.addEventListener('click', () => { setTimeout(() => act(async () => { await api('follow/alerts/' + b.dataset.notify + '/notified', { method: 'POST', body: {} }); await reload(['follow']); renderSeg(); }, 'Marcada como avisada.'), 300); }); });
    $$('[data-rq]').forEach((b) => { b.onclick = () => { const x = b.dataset.rq.split(':'); act(async () => { await api('requests/' + x[0] + '/' + x[1], { method: 'POST', body: {} }); await reload(['follow', 'props']); renderSeg(); }, x[1] === 'aplicar' ? 'Aplicada.' : 'Rechazada.'); }; });
    $$('[data-tas]').forEach((s) => { s.onchange = () => act(async () => { await api('follow/tickets/' + s.dataset.tas, { method: 'PATCH', body: { assigned_to: s.value ? Number(s.value) : null } }); await reload(['follow']); }, 'Asignado.'); });
    $$('[data-fromowner]').forEach((b) => { b.onclick = () => {
      const o = F.owners.find((x) => x.id === Number(b.dataset.fromowner)); const z = S.cfg.zones.find((x) => x.name === o.zone);
      S.tab = 'props';
      S.edit = { status: 'borrador', can_edit: true, photos: [], title: (o.prop_type || 'Casa') + ' en ' + (o.zone || ''), zone_id: z ? z.id : null, colonia: o.colonia, rent: o.expected_rent, m2: o.m2, bedrooms: o.bedrooms,
        available_from: o.available_from, prop_type: o.prop_type, owner_id: o.id, deposit_months: 1, extras: [o.furnished === 'Sí' ? 'Amueblado' : '', o.pets === 'Sí' ? 'Mascotas' : ''].filter(Boolean), includes: [] };
      S.pending = []; S.touched = {}; S.qk = false; render(); scrollTo(0, 0); toast('Datos del registro cargados. Completa fotos y detalles, y guarda.');
    }; });
  }

  // ---------- Equipo y configuración (Dueño) ----------
  function renderEquipo() {
    const st = S.cfg.settings;
    $('#app').innerHTML = '<div class="card"><h2>Equipo y permisos</h2><div class="tw"><table class="cards"><thead><tr><th>Usuario</th><th>Perfil</th><th>Publica sin aprobación</th><th>Leads</th><th>Acceso</th><th></th></tr></thead><tbody>'
      + S.users.map((u) => '<tr><td><b>' + esc(u.name) + '</b><br><span class="note">' + esc(u.email) + (u.phone ? ' · ' + tel(u.phone) : '') + '</span></td>'
        + '<td data-l="Perfil"><select data-urole="' + u.id + '"' + (u.id === S.me.id ? ' disabled' : '') + '>' + opts(S.cfg.lists.roles, u.role, (r) => ROLE[r]) + '</select></td>'
        + '<td data-l="Publica sin aprobación">' + (u.role === 'vendedor' ? '<label class="chk"><input type="checkbox" data-upub="' + u.id + '"' + (u.publish_direct ? ' checked' : '') + '> Permitido</label>' : '<span class="note">Siempre</span>') + '</td>'
        + '<td data-l="Leads">' + u.leads + ' · firmados ' + u.signed + '</td>'
        + '<td data-l="Acceso">' + (!u.active ? '<span class="tag no">Desactivado</span>' : u.invited ? '<span class="tag wa">Invitación pendiente</span>' : '<span class="note">Último: ' + fdt(u.last_login_at) + '</span>') + (['gerente', 'dueno'].includes(u.role) ? '<br><span class="note">Verificación: ' + (u.totp_enabled ? 'activa' : 'pendiente') + '</span>' : '') + '</td>'
        + '<td><span class="row">' + (u.active ? '<button class="b s sm" data-ulink="' + u.id + '">' + (u.invited ? 'Link de invitación' : 'Link de contraseña') + '</button>' : '') + (u.id !== S.me.id && u.totp_enabled ? '<button class="b s sm" data-u2fa="' + u.id + '">Reiniciar verificación</button>' : '')
        + (u.id !== S.me.id ? '<button class="b s sm" data-uact="' + u.id + ':' + (u.active ? 0 : 1) + '">' + (u.active ? 'Desactivar' : 'Activar') + '</button>' : '') + '</span></td></tr>').join('') + '</tbody></table></div>'
      + '<div id="linkout"></div><h3 style="margin-top:14px">Agregar a alguien</h3><div class="filters"><div><label for="u_n">Nombre</label><input id="u_n"></div><div><label for="u_e">Correo</label><input id="u_e" type="email"></div><div><label for="u_w">WhatsApp</label><input id="u_w" type="tel" inputmode="numeric"></div><div><label for="u_r">Perfil</label><select id="u_r">' + opts(S.cfg.lists.roles, 'vendedor', (r) => ROLE[r]) + '</select></div></div>'
      + '<p><button class="b" id="uadd">Crear e invitar</button></p><p class="note">Se genera un link de un solo uso (vence en 72 h) para que la persona cree su propia contraseña. Gerente y Dueño además configuran la verificación en dos pasos al entrar.</p></div>'
      + '<div class="card"><h2>Configuración del sitio</h2><p class="note">Lo que está vacío se muestra como "por definir" en el sitio; no prometemos nada que no hayas confirmado.</p><div class="filters">'
      + '<div><label for="c_wa">WhatsApp público de Rentaypunto</label><input id="c_wa" type="tel" inputmode="numeric" value="' + esc(st.whatsapp) + '" placeholder="10 dígitos"></div>'
      + '<div><label for="c_h">Horarios de visita</label><input id="c_h" value="' + esc(st.visit_hours.join(', ')) + '"></div>'
      + '<div><label for="c_d">Días para agendar</label><input id="c_d" type="number" min="1" max="30" value="' + esc(st.visit_days) + '"></div>'
      + '<div><label for="c_q">Plazo de respuesta a quejas</label><input id="c_q" value="' + esc(st.complaints_promise) + '" placeholder="Ej. 48 horas hábiles"></div>'
      + '<div><label for="c_n">Razón social</label><input id="c_n" value="' + esc(st.company_legal_name) + '"></div>'
      + '<div><label for="c_m">Correo que recibe copia de cada lead</label><input id="c_m" type="email" value="' + esc(st.notify_email) + '"></div>'
      + '<div><label for="c_px">ID del píxel de Meta</label><input id="c_px" inputmode="numeric" value="' + esc(st.meta_pixel_id) + '" placeholder="Solo números"></div>'
      + '<div><label for="c_cm">Cobro al propietario (meses de renta)</label><input id="c_cm" type="number" step="0.5" min="0" value="' + esc(st.commission_months) + '"></div>'
      + '<div><label for="c_cp">% de ese cobro para el asesor</label><input id="c_cp" type="number" min="0" max="100" value="' + esc(st.commission_pct) + '"></div></div>'
      + '<p class="note">Meta: ' + (st.meta_pixel_id ? 'píxel activo en el sitio' : 'sin píxel') + ' · API de Conversiones ' + (S.cfg.capi ? 'activa' : 'apagada (falta META_CAPI_TOKEN en Railway)') + '. El cobro y el % son supuestos para calcular "Mis números"; ajústalos cuando definas el modelo.</p>'
      + '<label for="c_f">Cuánto cuesta (para propietarios)</label><textarea id="c_f" rows="2" placeholder="Vacío = Por definir">' + esc(st.fees_text) + '</textarea>'
      + '<label for="c_l">Póliza jurídica: alcance y precio</label><textarea id="c_l" rows="3" placeholder="Vacío = propuesta Básico/Plus por definir">' + esc(st.legal_text) + '</textarea>'
      + '<p><button class="b" id="csave">Guardar configuración</button></p><p class="note">Avisos por correo: ' + (S.cfg.mail ? 'activos.' : 'apagados (falta RESEND_API_KEY en Railway). Los leads igual llegan aquí.') + '</p></div>'
      + '<div class="card"><h2>WhatsApp oficial</h2><p class="note">' + (S.cfg.wa ? 'Conectado. Elige qué mensajes salen solos (cada uno debe estar aprobado en Meta con el nombre indicado).' : 'Sin conectar: faltan WA_TOKEN y WA_PHONE_ID en Railway. Mientras tanto, los botones de WhatsApp del panel siguen funcionando con enlaces.') + '</p>'
      + [['prospect', 'Confirmación al prospecto cuando agenda'], ['advisor', 'Aviso al asesor cuando le llega un lead'], ['reminder', 'Recordatorio al prospecto la víspera de su cita confirmada (después de las 18:00)'], ['weekly', 'Reporte semanal al propietario (lunes después de las 10:00)'], ['file', 'Aviso al asesor cuando llega un expediente o comprobante']]
        .map((x) => '<label class="chk" style="display:flex"><input type="checkbox" data-wa="' + x[0] + '"' + (st.wa_auto[x[0]] ? ' checked' : '') + (S.cfg.wa ? '' : ' disabled') + '> ' + x[1] + ' <code>' + esc(S.cfg.waTemplates[x[0]]) + '</code></label>').join('')
      + '<div id="walog"></div></div>'
      + '<div class="card"><h2>Bóveda de documentos</h2><p class="note">' + (S.cfg.docs ? 'Activa: los expedientes y comprobantes se guardan cifrados.' : 'Apagada: falta DOCS_KEY en Railway. Sin ella no se pueden pedir expedientes.') + '</p></div>'
      + '<div class="card"><h2>Zonas</h2><div class="row">' + S.cfg.zones.map((z) => '<label class="chk"><input type="checkbox" data-zone="' + z.id + '"' + (z.active ? ' checked' : '') + '> ' + esc(z.name) + '</label>').join('') + '</div><div class="row" style="margin-top:8px"><input id="z_n" placeholder="Nueva zona" style="max-width:240px"><button class="b s sm" id="zadd">Agregar</button></div><p class="note">Una zona apagada ya no aparece en el sitio ni en los filtros.</p></div>';
    const showLink = (name, r, phone) => { $('#linkout').innerHTML = '<div class="card"><p>Link para <b>' + esc(name) + '</b> (vence ' + fdt(r.expires_at) + '):</p><p><code>' + esc(r.link) + '</code></p><p class="row">' + (phone ? '<a class="b sm" target="_blank" rel="noopener" href="' + esc(waL(phone, 'Hola ' + first(name) + ', este es tu acceso al panel de Rentaypunto. Ábrelo y crea tu contraseña: ' + r.link)) + '">Mandar por WhatsApp</a>' : '') + '<button class="b s sm" id="lcopy">Copiar</button></p></div>'; $('#lcopy').onclick = () => navigator.clipboard.writeText(r.link).then(() => toast('Copiado.')); $('#linkout').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    $('#uadd').onclick = async () => {
      const body = { name: $('#u_n').value, email: $('#u_e').value, phone: $('#u_w').value, role: $('#u_r').value };
      const r = await act(() => api('users', { method: 'POST', body: body }), 'Usuario creado.');
      if (r) { await reload(['users']); renderEquipo(); showLink(body.name, r, body.phone); }
    };
    $$('[data-ulink]').forEach((b) => { b.onclick = async () => { const u = S.users.find((x) => x.id === Number(b.dataset.ulink)); const r = await act(() => api('users/' + u.id + '/link', { method: 'POST', body: {} })); if (r) showLink(u.name, r, u.phone); }; });
    $$('[data-u2fa]').forEach((b) => { b.onclick = async () => { if (!confirm('Al entrar tendrá que volver a configurar su app de códigos. ¿Continuar?')) return; const r = await act(() => api('users/' + b.dataset.u2fa + '/reset-2fa', { method: 'POST', body: {} }), 'Verificación reiniciada.'); if (r) { await reload(['users']); renderEquipo(); } }; });
    const upd = async (id, body, ok) => { const r = await act(() => api('users/' + id, { method: 'PATCH', body: body }), ok); await reload(['users']); renderEquipo(); return r; };
    $$('[data-urole]').forEach((s) => { s.onchange = () => upd(Number(s.dataset.urole), { role: s.value }, 'Perfil cambiado.'); });
    $$('[data-upub]').forEach((c) => { c.onchange = () => upd(Number(c.dataset.upub), { publish_direct: c.checked }, c.checked ? 'Ahora publica sin aprobación.' : 'Ahora deja borrador y el Gerente publica.'); });
    $$('[data-uact]').forEach((b) => { b.onclick = () => { const x = b.dataset.uact.split(':'); if (x[1] === '0' && !confirm('Se cierra su sesión y sus leads abiertos quedan sin asesor para repartirlos. ¿Desactivar?')) return; upd(Number(x[0]), { active: x[1] === '1' }, 'Listo.'); }; });
    $('#csave').onclick = async () => {
      const r = await act(() => api('settings', { method: 'PATCH', body: { whatsapp: $('#c_wa').value, visit_hours: $('#c_h').value, visit_days: $('#c_d').value, complaints_promise: $('#c_q').value, company_legal_name: $('#c_n').value, notify_email: $('#c_m').value, meta_pixel_id: $('#c_px').value, commission_months: $('#c_cm').value, commission_pct: $('#c_cp').value, fees_text: $('#c_f').value, legal_text: $('#c_l').value } }), 'Configuración guardada.');
      if (r) { await reload(['cfg']); renderEquipo(); }
    };
    $$('[data-zone]').forEach((c) => { c.onchange = () => act(async () => { await api('zones/' + c.dataset.zone, { method: 'PATCH', body: { active: c.checked } }); await reload(['cfg']); }, 'Zona actualizada.'); });
    $$('[data-wa]').forEach((c) => { c.onchange = () => act(async () => { await api('settings', { method: 'PATCH', body: { wa_auto: { [c.dataset.wa]: c.checked } } }); await reload(['cfg']); }, c.checked ? 'Activado.' : 'Desactivado.'); });
    if (S.cfg.wa) api('wa-log').then((L) => { if ($('#walog')) $('#walog').innerHTML = L.length ? '<details><summary class="note">Últimos mensajes (' + L.length + ')</summary><div class="hist">' + L.map((m) => '<div><span class="note">' + fdt(m.at) + '</span> · ' + esc(m.template) + ' → ' + tel(m.to_phone) + ' · <span class="tag ' + (m.status === 'enviado' ? 'ok' : m.status === 'error' ? 'no' : 'wa') + '">' + esc(m.status) + '</span>' + (m.error ? ' <span class="note">' + esc(m.error) + '</span>' : '') + '</div>').join('') + '</div></details>' : '<p class="note">Aún no sale ningún mensaje.</p>'; }).catch(() => {});
    $('#zadd').onclick = async () => { const r = await act(() => api('zones', { method: 'POST', body: { name: $('#z_n').value } }), 'Zona agregada.'); if (r) { await reload(['cfg']); renderEquipo(); } };
  }

  boot();
}());
