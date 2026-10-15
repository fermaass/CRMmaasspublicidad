// Sitio público: favoritos, buscador guiado, agendado, formularios y medición (UTM y clics a WhatsApp).
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const M = window.MATCH;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: no pasa nada */ } },
  };
  let tt;
  function toast(m) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = m; t.style.opacity = 1; clearTimeout(tt); tt = setTimeout(() => { t.style.opacity = 0; }, 4500);
  }
  const okTel = (v) => { let d = String(v).replace(/\D/g, ''); if (d.length === 13 && d.startsWith('521')) d = d.slice(3); else if (d.length === 12 && d.startsWith('52')) d = d.slice(2); return d.length === 10; };

  // ---------- Medición: de dónde llegó (UTM del anuncio). Se recuerda 30 días ----------
  const qs = new URLSearchParams(location.search);
  if (qs.get('utm_source')) {
    store.set('rp_utm', { source: qs.get('utm_source'), medium: qs.get('utm_medium') || '', campaign: qs.get('utm_campaign') || '', content: qs.get('utm_content') || '', at: Date.now() });
  }
  const utm = () => { const u = store.get('rp_utm', null); return u && Date.now() - u.at < 30 * 86400e3 ? u : null; };
  // Píxel de Meta: solo si el sitio lo tiene configurado.
  const fbq = function () { if (typeof window.fbq === 'function') { try { window.fbq.apply(null, arguments); } catch (x) { /* el píxel nunca debe romper la página */ } } };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-wa]');
    if (!a) return;
    fbq('track', 'Contact');
    try { fetch('/api/wa-click', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ property_id: Number(a.dataset.wa) || null }) }); } catch (x) { /* no importa */ }
  });

  // ---------- Favoritos (se guardan en este navegador) ----------
  let favs = store.get('rp_favs', []);
  function paintFavs() {
    $$('[data-fav]').forEach((b) => {
      const on = favs.includes(Number(b.dataset.fav));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (b.classList.contains('heart')) { b.textContent = on ? '♥' : '♡'; b.setAttribute('aria-label', on ? 'Quitar de favoritos' : 'Guardar en favoritos'); }
      else b.textContent = on ? '♥ En favoritos' : '♡ Guardar';
    });
    const only = $('#ffav');
    if (only) {
      let n = 0;
      $$('#track .p').forEach((c) => { const show = !only.checked || favs.includes(Number(c.dataset.id)); c.hidden = !show; if (show) n++; });
      const cnt = $('#cnt');
      if (cnt) cnt.textContent = n + ' propiedad(es) encontrada(s)' + (favs.length ? ' · ' + favs.length + ' en favoritos' : '');
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    e.preventDefault();
    const id = Number(b.dataset.fav); const i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1); else favs.push(id);
    store.set('rp_favs', favs); paintFavs();
  });
  if ($('#ffav')) $('#ffav').addEventListener('change', paintFavs);
  paintFavs();

  // ---------- Formularios ----------
  async function post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    let out = {}; try { out = await r.json(); } catch (e) { /* respuesta vacía */ }
    if (!r.ok) throw new Error(out.error || 'No se pudo enviar. Revisa tu internet e intenta de nuevo.');
    return out;
  }
  const ENDPOINT = { avisame: '/api/avisame', propietario: '/api/propietario', queja: '/api/queja', juridico: '/api/juridico', opinion: '/api/opinion' };
  $$('form[data-form]').forEach((f) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('[data-err]', f); err.textContent = '';
      const data = Object.fromEntries(new FormData(f).entries());
      data.privacy = f.privacy ? f.privacy.checked : true;
      if (f.dataset.form === 'opinion' && (!data.liked || !data.rent_opinion)) { err.textContent = 'Contesta las dos preguntas.'; return; }
      if (data.filters) { try { data.filters = JSON.parse(data.filters); } catch (x) { data.filters = {}; } }
      if (f.phone && !okTel(data.phone)) { err.textContent = 'Escribe tu WhatsApp a 10 dígitos.'; f.phone.focus(); return; }
      if (!data.privacy) { err.textContent = 'Acepta el aviso de privacidad para continuar.'; return; }
      const btn = $('button.b', f); btn.disabled = true;
      try {
        const out = await post(ENDPOINT[f.dataset.form], data);
        if (f.dataset.form === 'avisame') fbq('track', 'Subscribe');
        if (f.dataset.form === 'propietario') fbq('track', 'CompleteRegistration');
        const done = f.parentElement.querySelector('[data-done]');
        if (done) { $$('[data-folio]', done).forEach((x) => { x.textContent = out.folio || ''; }); done.hidden = false; f.hidden = true; done.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
    });
  });

  // ---------- Estimador de renta (Renta tu propiedad) ----------
  if (window.REF && $('#ow_est')) {
    const render = () => {
      const r = Number($('#ow_rec').value); const z = $('#ow_z').value; const el = $('#ow_est');
      if (!r) { el.innerHTML = '<p class="note">Elige zona y recámaras para ver una referencia de renta.</p>'; return; }
      let L = window.REF.filter((p) => p.zone === z && Math.abs(p.bedrooms - r) <= 1); let amb = 'en ' + z;
      if (L.length < 2) { L = window.REF.filter((p) => Math.abs(p.bedrooms - r) <= 1); amb = 'en toda la plataforma'; }
      if (L.length < 2) { el.innerHTML = '<p class="note">Aún no hay suficientes propiedades parecidas para darte una referencia. Tu asesor te propondrá un rango.</p>'; return; }
      const ps = L.map((p) => p.rent); const avg = ps.reduce((a, b) => a + b, 0) / ps.length;
      el.innerHTML = '<p><b>Referencia de renta</b><br>Propiedades parecidas en Rentaypunto (' + esc(amb) + ', ' + L.length + '): de ' + M.money(Math.min.apply(null, ps)) + ' a ' + M.money(Math.max.apply(null, ps)) + ', promedio ' + M.money(avg) + '.</p><p class="note">Sale solo de nuestras propiedades, no del mercado completo. Tu asesor te propone el precio final.</p>';
    };
    $('#ow_rec').addEventListener('input', render); $('#ow_z').addEventListener('input', render);
  }

  // ---------- Buscador "Encuentra tu renta" ----------
  const busca = () => store.get('rp_busca', null);
  function card(p) {
    return '<div class="p" data-id="' + p.id + '"><div class="ph">' + (p.photo ? '<img src="/fotos/' + p.photo + '-sm.jpg" alt="' + esc(p.title) + '" loading="lazy">' : '') + '<span>' + esc(p.zone) + '</span>'
      + '<button class="heart" type="button" data-fav="' + p.id + '" aria-pressed="false" aria-label="Guardar en favoritos">♡</button></div><div class="pb"><div class="pr">' + M.money(p.rent) + '/mes</div><b>' + esc(p.title) + '</b>'
      + '<div class="ch">' + (p.m2 ? '<span>📐 ' + p.m2 + ' m²</span>' : '') + '<span>🛏 ' + (p.bedrooms || 0) + '</span><span>🛁 ' + (p.bathrooms || 0) + '</span></div>'
      + '<a class="b" href="/' + esc(p.slug) + '">Ver ficha y agendar</a></div></div>';
  }
  function showFinder(b) {
    const all = window.FINDER.map((p) => ({ p: p, f: M.fit(p, b, window.RP.today) }));
    const ok = all.filter((x) => !x.f.ex).sort((a, c) => c.f.s - a.f.s); const top = ok.slice(0, 3); const out = all.length - ok.length;
    let h = '<h3>Tus mejores opciones</h3><p class="note">' + esc(M.buscaTxt(b)) + '</p>';
    if (top.length) h += '<div class="grid">' + top.map((x) => '<div class="rec">' + card(x.p) + '<ul class="why">' + x.f.R.map((r) => '<li class="y">' + esc(r) + '</li>').join('') + x.f.X.map((r) => '<li class="n">' + esc(r) + '</li>').join('') + '</ul></div>').join('') + '</div>';
    else h += '<p>Ninguna propiedad cumple con tu presupuesto y capacidad por ahora. Sube un poco el presupuesto o <a href="#avisame">deja tu WhatsApp</a> y te avisamos.</p>';
    if (out) h += '<p class="note">' + out + ' propiedad(es) descartada(s) por presupuesto o capacidad.</p>';
    if (b.perfil === 'Estudiante o joven') h += '<p class="note">Si quien paga vive en otro estado, usa "Compartir por WhatsApp" en la ficha para enviarle el resumen.</p>';
    $('#finderout').innerHTML = h; paintFavs();
  }
  if (window.FINDER && $('#finder')) {
    $$('#q_perfil .chip').forEach((c) => c.addEventListener('click', () => {
      $$('#q_perfil .chip').forEach((x) => x.setAttribute('aria-pressed', x === c ? 'true' : 'false'));
      $('#q_pers').value = c.dataset.n;
    }));
    $$('#q_prior .chip').forEach((c) => c.addEventListener('click', () => {
      const on = c.getAttribute('aria-pressed') === 'true';
      if (!on && $$('#q_prior .chip[aria-pressed=true]').length >= 3) return toast('Elige hasta 3 prioridades.');
      c.setAttribute('aria-pressed', on ? 'false' : 'true');
    }));
    $('#q_go').addEventListener('click', () => {
      const pe = $('#q_perfil .chip[aria-pressed=true]');
      if (!pe) return toast('Elige quién va a vivir.');
      const b = { perfil: pe.dataset.v, pers: Number($('#q_pers').value) || 0, presu: Number($('#q_presu').value) || 0, cuando: $('#q_cuando').value, prior: $$('#q_prior .chip[aria-pressed=true]').map((c) => c.dataset.v) };
      store.set('rp_busca', b); showFinder(b); $('#finderout').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('#q_clear').addEventListener('click', () => {
      store.set('rp_busca', null); $$('#finder .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      $('#q_pers').value = ''; $('#q_presu').value = ''; $('#q_cuando').value = ''; $('#finderout').innerHTML = '';
    });
    const b = busca();
    if (b) {
      $$('#q_perfil .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.v === b.perfil ? 'true' : 'false'));
      $$('#q_prior .chip').forEach((c) => c.setAttribute('aria-pressed', (b.prior || []).includes(c.dataset.v) ? 'true' : 'false'));
      $('#q_pers').value = b.pers || ''; $('#q_presu').value = b.presu || ''; $('#q_cuando').value = b.cuando || '';
      showFinder(b);
    }
  }

  // ---------- Expediente y portal de pagos (enlace privado) ----------
  const token = (location.pathname.match(/^\/(?:expediente|portal)\/([\w-]+)/) || [])[1];
  // Fotos muy pesadas se achican (máx. 2400 px) para que suban con datos del celular; los PDF van tal cual.
  function prepare(file) {
    if (!/^image\/(jpeg|png)$/.test(file.type) || file.size <= 3 * 1024 * 1024) return Promise.resolve(file);
    return new Promise((ok) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 2400 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob((b) => { URL.revokeObjectURL(url); ok(b || file); }, 'image/jpeg', 0.85); };
      img.onerror = () => { URL.revokeObjectURL(url); ok(file); };
      img.src = url;
    });
  }
  async function upload(url, file) {
    const body = await prepare(file);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: body });
    let out = {}; try { out = await r.json(); } catch (e) { /* vacío */ }
    if (!r.ok) throw new Error(out.error || 'No se pudo subir. Revisa tu internet e intenta de nuevo.');
  }
  if (token && $('#docs')) {
    $$('[data-kind]').forEach((inp) => { inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      toast('Subiendo…');
      try { await upload('/api/expediente/' + token + '/docs?kind=' + inp.dataset.kind, f); location.reload(); } catch (x) { toast(x.message); }
    }; });
    $$('[data-quitar]').forEach((b) => { b.onclick = async () => { try { await post('/api/expediente/' + token + '/docs/' + b.dataset.quitar + '/quitar', {}); location.reload(); } catch (x) { toast(x.message); } }; });
    $('#ex_send').onclick = async () => {
      const data = {}; $$('#pf_b,#pf_d,#pf_o,#pf_p,#pf_j,#pf_n').forEach((e) => { data[e.name] = e.value; });
      $('#ex_err').textContent = ''; $('#ex_send').disabled = true;
      try { await post('/api/expediente/' + token + '/enviar', data); location.reload(); } catch (x) { $('#ex_err').textContent = x.message; $('#ex_send').disabled = false; }
    };
  }
  if (token && $('#pt_f')) {
    $('#pt_f').onchange = async function () {
      const f = this.files[0]; if (!f) return; $('#pt_err').textContent = ''; toast('Subiendo…');
      try { await upload('/api/portal/' + token + '/comprobante?month=' + $('#pt_m').value + '&concept=' + $('#pt_c').value, f); location.reload(); } catch (x) { $('#pt_err').textContent = x.message; }
    };
  }

  // ---------- Ficha: galería, "para tu búsqueda" y agendado ----------
  const P = window.PROP;
  if (!P) return;
  const b = busca();
  if (b && !P.gone) {
    const fi = M.fit(P.p, b, window.RP.today);
    $('#parati').innerHTML = '<h2>Para tu búsqueda</h2><p class="note">' + esc(M.buscaTxt(b)) + '</p><ul class="why">' + fi.R.map((r) => '<li class="y">' + esc(r) + '</li>').join('') + fi.X.map((r) => '<li class="n">' + esc(r) + '</li>').join('') + '</ul>';
    $('#parati').hidden = false;
  }
  // Galería a pantalla completa
  let lbi = 0;
  function showLb() {
    let o = $('#lb');
    if (!o) { o = document.createElement('div'); o.id = 'lb'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Galería de fotos'); document.body.appendChild(o); }
    o.innerHTML = '<button class="lbx" aria-label="Cerrar">✕</button><button class="lbp" aria-label="Anterior">‹</button><img src="' + P.photos[lbi] + '" alt="' + esc(P.title) + ' - foto ' + (lbi + 1) + '"><button class="lbn" aria-label="Siguiente">›</button><div class="lbc">' + (lbi + 1) + ' / ' + P.photos.length + '</div>';
    o.style.display = 'flex';
    $('.lbx', o).onclick = () => { o.style.display = 'none'; };
    $('.lbp', o).onclick = () => { lbi = (lbi - 1 + P.photos.length) % P.photos.length; showLb(); };
    $('.lbn', o).onclick = () => { lbi = (lbi + 1) % P.photos.length; showLb(); };
  }
  document.addEventListener('click', (e) => { const x = e.target.closest('[data-lb]'); if (x && P.photos.length) { lbi = Number(x.dataset.lb); showLb(); } });
  document.addEventListener('keydown', (e) => {
    const o = $('#lb'); if (!o || o.style.display !== 'flex') { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.lb) { lbi = Number(e.target.dataset.lb); showLb(); } return; }
    if (e.key === 'Escape') o.style.display = 'none';
    if (e.key === 'ArrowRight') $('.lbn', o).click();
    if (e.key === 'ArrowLeft') $('.lbp', o).click();
  });

  if (P.gone) return;
  fbq('track', 'ViewContent', { content_ids: [P.code], content_type: 'product', value: P.rent, currency: 'MXN' });
  const bk = { d: '', h: '', name: '', phone: '', ok: false, done: null };
  const waLink = (extra) => (window.RP.wa ? 'https://wa.me/52' + window.RP.wa + '?text=' + encodeURIComponent(P.waText + (extra || '') + (b ? ' Busco para: ' + M.buscaTxt(b) + '.' : '')) : '');
  function keep() { const n = $('#bk_n'); if (n) { bk.name = n.value; bk.phone = $('#bk_w').value; bk.ok = $('#bk_c').checked; } }
  function dayLabel(iso, i) {
    if (i === 0) return 'Hoy'; if (i === 1) return 'Mañana';
    return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '');
  }
  function renderBook() {
    const box = $('#bkbox');
    if (bk.done) {
      const c = bk.done; const fl = new Date(c.date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
      const wl = waLink('. Quiero visitarla el ' + M.fdate(c.date) + ' a las ' + c.time + '. Soy ' + c.name + '. Folio ' + c.folio + '.');
      box.innerHTML = '<h2>✓ Cita solicitada</h2><div class="fi"><span>Propiedad</span><b>' + esc(P.code + ' · ' + P.title) + '</b></div><div class="fi"><span>Día y hora</span><b>' + esc(fl) + ', ' + c.time + '</b></div><div class="fi"><span>Folio</span><b>' + esc(c.folio) + '</b></div>'
        + '<p><b>Qué sigue</b></p><ol class="nx"><li>Tu asesor te confirma por WhatsApp.</li><li>Ten a la mano INE, Constancia de Situación Fiscal y comprobante de ingresos.</li><li>Con tu expediente completo te atienden primero.</li></ol>'
        + (wl ? '<p><a class="b" target="_blank" rel="noopener" data-wa="' + P.id + '" href="' + esc(wl) + '">Escribir por WhatsApp</a></p>' : '')
        + '<p><button type="button" class="b s sm" id="bk_new">Agendar otra visita</button></p>';
      $('#bk_new').onclick = () => { bk.d = ''; bk.h = ''; bk.done = null; renderBook(); };
      return;
    }
    const D = P.slots.map((x, i) => '<button type="button" class="chip day" data-d="' + x.date + '" aria-pressed="' + (bk.d === x.date) + '"' + (x.slots.some((s) => s.free) ? '' : ' disabled') + '><small>' + dayLabel(x.date, i) + '</small><b>' + Number(x.date.slice(8)) + '</b></button>').join('');
    let H = '<p class="note">Elige primero un día.</p>';
    const day = P.slots.find((x) => x.date === bk.d);
    if (day) H = '<div class="chips">' + day.slots.map((s) => '<button type="button" class="chip" data-h="' + s.time + '"' + (s.free ? '' : ' disabled') + ' aria-pressed="' + (bk.h === s.time) + '">' + s.time + '</button>').join('') + '</div>';
    const wl = waLink('');
    box.innerHTML = '<h2>Agenda tu visita</h2><label>Día</label><div class="chips">' + D + '</div><label>Hora</label>' + H
      + '<label for="bk_n">Nombre</label><input id="bk_n" autocomplete="name" maxlength="80" value="' + esc(bk.name) + '">'
      + '<label for="bk_w">WhatsApp</label><input id="bk_w" type="tel" inputmode="numeric" autocomplete="tel" placeholder="10 dígitos" value="' + esc(bk.phone) + '">'
      + '<div class="hp" aria-hidden="true"><input id="bk_hp" tabindex="-1" autocomplete="off"></div>'
      + '<label class="chk"><input type="checkbox" id="bk_c"' + (bk.ok ? ' checked' : '') + '> Acepto el <a href="/aviso-de-privacidad" target="_blank">aviso de privacidad</a></label>'
      + '<p class="note">Usamos tus datos solo para agendar y confirmar tu visita.</p><p class="err" id="bk_err"></p><p><button type="button" class="b" id="bk_go">Agendar visita</button></p>'
      + (wl ? '<a class="wl" target="_blank" rel="noopener" data-wa="' + P.id + '" href="' + esc(wl) + '">¿Prefieres escribir? Abre WhatsApp con esta propiedad</a>' : '');
    $$('[data-d]', box).forEach((x) => { x.onclick = () => { keep(); bk.d = x.dataset.d; const d2 = P.slots.find((y) => y.date === bk.d); if (bk.h && !d2.slots.some((s) => s.time === bk.h && s.free)) bk.h = ''; renderBook(); }; });
    $$('[data-h]', box).forEach((x) => { x.onclick = () => { keep(); bk.h = x.dataset.h; renderBook(); }; });
    $('#bk_go').onclick = agendar;
  }
  async function agendar() {
    keep(); const err = $('#bk_err'); err.textContent = '';
    if (!bk.d || !bk.h) { err.textContent = 'Elige día y hora.'; return; }
    if (!bk.name.trim()) { err.textContent = 'Escribe tu nombre.'; return; }
    if (!okTel(bk.phone)) { err.textContent = 'Escribe tu WhatsApp a 10 dígitos.'; return; }
    if (!bk.ok) { err.textContent = 'Acepta el aviso de privacidad para continuar.'; return; }
    const btn = $('#bk_go'); btn.disabled = true;
    try {
      const out = await post('/api/visita', { property_id: P.id, date: bk.d, time: bk.h, name: bk.name.trim(), phone: bk.phone, privacy: true, website: $('#bk_hp').value, busca: b ? M.buscaTxt(b) : '', utm: utm() });
      const day = P.slots.find((y) => y.date === bk.d); const s = day && day.slots.find((x) => x.time === bk.h); if (s) s.free = false;
      fbq('track', 'Lead', { content_ids: [out.code], content_type: 'product', value: out.rent, currency: 'MXN' }, { eventID: out.event_id });
      bk.done = { date: bk.d, time: bk.h, name: bk.name.trim(), folio: out.folio }; renderBook();
      $('#bkbox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (x) {
      if (/horario/i.test(x.message)) { const day = P.slots.find((y) => y.date === bk.d); const s = day && day.slots.find((z) => z.time === bk.h); if (s) s.free = false; bk.h = ''; renderBook(); $('#bk_err').textContent = x.message; }
      else { err.textContent = x.message; btn.disabled = false; }
    }
  }
  renderBook();
}());
