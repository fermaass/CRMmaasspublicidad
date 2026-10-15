// Páginas del sitio público, armadas en el servidor (así Google lee todo sin depender de JavaScript).
const { money, jsonLd } = require('./seo');
const MATCH = require('../public/sitio/match.js');
const BRAND = require('../public/sitio/brand.js');
const { EXTRAS } = require('./db');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// JSON dentro de <script>: sin "<" para que nadie pueda cerrar la etiqueta desde un texto.
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const fdate = MATCH.fdate;
const waHref = (num, text) => `https://wa.me/52${num}?text=${encodeURIComponent(text)}`;
const photoUrl = (file, small) => `/fotos/${file}${small ? '-sm' : ''}.jpg`;
const I = BRAND.icon;

// Estructura común: encabezado, banner opcional a todo lo ancho, contenido y pie.
function layout({ ctx, title, desc, path, body, hero = '', og = {}, ld, noindex, active, bodyClass, scripts = [] }) {
  const url = `${ctx.siteUrl}${path}`;
  const nav = [['/', 'Propiedades', 'home'], ['/renta/queretaro', 'Zonas', 'zonas'], ['/#como-funciona', 'Cómo funciona', 'how'], ['/renta-tu-propiedad', 'Renta tu propiedad', 'pub'], ['/ayuda', 'Ayuda', 'help']];
  const links = nav.map(([h, t, k]) => `<a href="${h}"${active === k ? ' class="on" aria-current="page"' : ''}>${t}</a>`).join('');
  const wa = ctx.settings.whatsapp;
  const cta = wa ? `<a class="b sm navcta" target="_blank" rel="noopener" data-wa="0" href="${esc(waHref(wa, 'Hola, quiero rentar una propiedad en Querétaro.'))}">${I('chat')} WhatsApp</a>`
    : '<a class="b sm navcta" href="/#listado">Ver propiedades</a>';
  const zones = (ctx.zones || []).slice(0, 8);
  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`}
<meta name="theme-color" content="#0f766e">
<meta property="og:type" content="website"><meta property="og:site_name" content="Rentaypunto"><meta property="og:locale" content="es_MX">
<meta property="og:title" content="${esc(og.title || title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
${og.image ? `<meta property="og:image" content="${esc(og.image)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="icon" href="/sitio/icon.svg" type="image/svg+xml">
<link rel="preload" href="/sitio/fonts/plus-jakarta-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/sitio/site.css?v=${ctx.version}">
${ld ? `<script type="application/ld+json">${json(ld)}</script>` : ''}
${pixel(ctx.settings.meta_pixel_id)}
</head><body${bodyClass ? ` class="${bodyClass}"` : ''}>
${BRAND.sprite()}
<header class="top"><div class="w nav"><a class="logo" href="/" aria-label="Rentaypunto, inicio">${BRAND.logo(34)}</a>
<nav class="mainnav" aria-label="Principal">${links}</nav>${cta}
<details class="mmenu"><summary aria-label="Menú">${I('menu')}</summary><nav aria-label="Menú">${links}${wa ? `<a target="_blank" rel="noopener" data-wa="0" href="${esc(waHref(wa, 'Hola, quiero rentar una propiedad en Querétaro.'))}">Escríbenos por WhatsApp</a>` : ''}</nav></details></div></header>
<main>${hero}<div class="w">${body}</div></main>
<footer class="foot"><div class="w"><div class="cols">
<div><span class="logo-in">${BRAND.mark(30)}<span class="word">Renta<b>y</b>punto</span></span><p>Casas y departamentos en renta en Querétaro, con costo de entrada claro y un asesor que te acompaña por WhatsApp.</p></div>
<div><h3>Rentar</h3><a href="/#listado">Propiedades disponibles</a><a href="/renta/queretaro/departamentos-para-estudiantes">Para estudiantes</a><a href="/renta/queretaro/para-familias">Para familias</a><a href="/renta/queretaro/que-aceptan-mascotas">Aceptan mascotas</a><a href="/renta/queretaro/amueblados">Amueblados</a></div>
<div><h3>Zonas</h3>${zones.map((z) => `<a href="/renta/${z.slug}">${esc(z.name)}</a>`).join('')}</div>
<div><h3>Rentaypunto</h3><a href="/renta-tu-propiedad">Renta tu propiedad</a><a href="/certeza-juridica">Póliza jurídica</a><a href="/ayuda">Ayuda</a><a href="/quejas">Quejas y sugerencias</a>${wa ? `<a target="_blank" rel="noopener" data-wa="0" href="${esc(waHref(wa, 'Hola, tengo una pregunta.'))}">WhatsApp</a>` : ''}</div>
</div><div class="legal"><span>© Rentaypunto · Querétaro, México</span><a href="/aviso-de-privacidad">Aviso de privacidad</a></div></div></footer>
<script>window.RP=${json({ wa, today: ctx.today })}</script>
${scripts.map((s) => `<script>${s}</script>`).join('')}
<script src="/sitio/brand.js?v=${ctx.version}"></script>
<script src="/sitio/match.js?v=${ctx.version}"></script>
<script src="/sitio/site.js?v=${ctx.version}"></script>
</body></html>`;
}

// Banner de páginas internas: ruta, título y entrada.
const pageHero = ({ crumbs: c = [], h1, lead, eyebrow, h1Class = 'zt' }) => `<section class="phero"><div class="w">
${c.length ? `<nav class="bc" aria-label="Ruta">${c.map(([t, h], i) => (h && i < c.length - 1 ? `<a href="${h}">${esc(t)}</a> ›` : `<span>${esc(t)}</span>`)).join(' ')}</nav>` : ''}
${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}<h1 class="${h1Class}">${esc(h1)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</div></section>`;

// Píxel de Meta (código estándar de Meta). Solo si el Dueño configuró el ID en el panel.
function pixel(id) {
  if (!/^\d{5,20}$/.test(String(id || ''))) return '';
  return `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');</script>`;
}

// Costo de entrada: primer mes + depósito + mantenimiento (si no va incluido).
const entryOf = (p) => p.rent + Math.round((p.deposit_months || 0) * p.rent) + ((p.includes || []).includes('Mantenimiento') ? 0 : (p.maintenance || 0));

// Tarjeta de propiedad (la misma estructura la arma site.js para el buscador).
function card(p) {
  const img = p.photo ? `<img src="${photoUrl(p.photo, true)}" alt="${esc(p.title)} en renta en ${esc(p.zone)}, Querétaro" loading="lazy">` : BRAND.noPhoto();
  return `<article class="pc" data-id="${p.id}"><div class="pc-img">${img}
<div class="pc-badges"><span class="tag">${I('pin')} ${esc(p.zone)}</span>${p.status === 'apartada' ? '<span class="tag wa">Apartada</span>' : ''}</div>
<button class="heart" type="button" data-fav="${p.id}" aria-pressed="false" aria-label="Guardar en favoritos">${I('heart')}</button></div>
<div class="pc-body"><div class="pc-price">${money(p.rent)} <small>/mes</small></div>
<a class="pc-title" href="/${esc(p.slug)}">${esc(p.title)}</a>
${p.colonia ? `<div class="pc-loc">${I('pin')} ${esc(p.colonia)}</div>` : ''}
<div class="specs"><span>${I('bed')} ${p.bedrooms || 0} rec.</span><span>${I('bath')} ${p.bathrooms || 0} baños</span>${p.m2 ? `<span>${I('area')} ${p.m2} m²</span>` : ''}${(p.extras || []).includes('Mascotas') ? `<span>${I('paw')}</span>` : ''}</div>
<div class="pc-foot"><span>Entrada: <b>${money(entryOf(p))}</b></span><span class="go">Ver ficha ${I('arrow')}</span></div></div></article>`;
}

const alertForm = (filtersText, filters) => `<div class="card" id="avisame"><h2>${I('bell')} ¿No encuentras lo que buscas?</h2>
<p class="note">Te avisamos por WhatsApp cuando entre algo así: <b>${esc(filtersText)}</b></p>
<form data-form="avisame" novalidate><input type="hidden" name="filters" value="${esc(json(filters))}">
<div class="filters"><div><label for="al_n">Nombre (opcional)</label><input id="al_n" name="name" autocomplete="name" maxlength="80"></div>
<div><label for="al_w">WhatsApp</label><input id="al_w" name="phone" type="tel" inputmode="numeric" placeholder="10 dígitos" autocomplete="tel" required></div></div>
<div class="hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
<label class="chk"><input type="checkbox" name="privacy" required> Acepto el <a href="/aviso-de-privacidad" target="_blank">aviso de privacidad</a></label>
<p class="err" data-err></p><p><button class="b">Avísame</button></p></form>
<div data-done hidden><p><b>Listo.</b> Un asesor te escribe por WhatsApp cuando entre una propiedad así.</p></div></div>`;

function filtersText(f, zones) {
  const a = [];
  const z = zones.find((x) => x.slug === f.zona);
  if (z) a.push(z.name);
  if (f.min) a.push(`desde ${money(f.min)}`);
  if (f.max) a.push(`hasta ${money(f.max)}`);
  if (f.rec) a.push(`${f.rec}+ rec.`);
  if (f.ban) a.push(`${f.ban}+ baños`);
  if (f.m2) a.push(`${f.m2}+ m²`);
  if (f.extra) a.push(f.extra);
  return a.join(' · ') || 'Cualquier propiedad';
}

// Preguntas frecuentes visibles y su marcado para Google.
function faqBlock(faq, title = 'Preguntas frecuentes') {
  if (!faq || !faq.length) return { html: '', ld: null };
  return {
    html: `<div class="card"><h2>${esc(title)}</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`,
    ld: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  };
}
const crumbs = (ctx, items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${ctx.siteUrl}${path}` })) });
const landingChips = (L) => (L.length ? `<div class="chips">${L.map((l) => `<a class="chip" href="${l.path}">${esc(l.short)} (${l.n})</a>`).join('')}</div>` : '');
// Ícono y frase de cada búsqueda por intención (tarjetas "¿Para quién buscas?").
const PERSONA = {
  'departamentos-para-estudiantes': ['cap', 'Para estudiantes', 'Si vienes a estudiar o buscas para tu hijo'],
  'para-una-persona-o-pareja': ['user', 'Para una persona o pareja', 'Lo justo para vivir solo o de dos'],
  'para-familias': ['family', 'Para familias', 'Recámaras, cochera y escuelas cerca'],
  'que-aceptan-mascotas': ['paw', 'Aceptan mascotas', 'Para que tu perro o gato venga contigo'],
  amueblados: ['sofa', 'Amueblados', 'Si llegas por trabajo o vienes de otra ciudad'],
  'con-servicios-incluidos': ['bolt', 'Servicios incluidos', 'Un solo pago al mes, sin recibos'],
  economicas: ['tag', 'Económicas', 'Hasta $12,000 al mes'],
};
const ZONE_GRADS = ['linear-gradient(135deg,#0f766e,#14b8a6)', 'linear-gradient(135deg,#0e4f6e,#0ea5b7)', 'linear-gradient(135deg,#7c4a03,#d97706)', 'linear-gradient(135deg,#155e75,#0891b2)',
  'linear-gradient(135deg,#3f4d14,#65a30d)', 'linear-gradient(135deg,#7f1d1d,#c2410c)', 'linear-gradient(135deg,#1e3a8a,#2563eb)', 'linear-gradient(135deg,#134e4a,#0d9488)'];
const zoneArt = '<svg class="zart" viewBox="0 0 150 110" aria-hidden="true"><path fill="currentColor" d="M0 110V70h150v40zM6 70V52a10 10 0 0 1 20 0v18zM32 70V52a10 10 0 0 1 20 0v18zM58 70V52a10 10 0 0 1 20 0v18zM84 70V52a10 10 0 0 1 20 0v18zM110 70V52a10 10 0 0 1 20 0v18zM0 42h150v6H0z"/></svg>';

let HOME_FAQ_HTML = ''; let HOME_FAQ_LD = null;
const HOME_FAQ = [
  ['¿Cómo agendo una visita?', 'Entra a la ficha de la propiedad, elige día y hora y deja tu nombre y WhatsApp. Tu asesor te confirma por ese medio.'],
  ['¿Cuánto necesito para entrar a rentar en Querétaro?', 'Depende de cada propiedad: el primer mes, el depósito y, si aplica, el mantenimiento. Cada ficha lo calcula en "Cuánto necesitas".'],
  ['¿Qué documentos piden para rentar?', 'INE, Constancia de Situación Fiscal y comprobante de ingresos. Algunas propiedades piden además aval, fiador o póliza jurídica; lo dice cada ficha.'],
  ['Busco departamento para mi hijo que viene a estudiar, ¿cómo le hago?', 'Usa "Encuentra tu renta" eligiendo "Estudiante o joven", o entra a la sección de departamentos para estudiantes. Puedes agendar la visita y compartir la ficha por WhatsApp aunque estés en otra ciudad.'],
  ['¿Hay rentas que acepten mascotas?', 'Sí: usa el filtro Extras → Mascotas o entra a la sección de rentas que aceptan mascotas.'],
  ['¿Tengo una propiedad, ustedes me la rentan?', 'Sí. Regístrala en "Renta tu propiedad": un asesor te contacta, la publicamos, agendamos las visitas y filtramos a los prospectos.'],
];
({ html: HOME_FAQ_HTML, ld: HOME_FAQ_LD } = faqBlock(HOME_FAQ));

const ownerBand = () => `<section class="cta-band"><svg class="bigic" aria-hidden="true"><use href="#i-key"/></svg><div><span class="eyebrow" style="color:#ffe7b0">Para propietarios</span>
<h2>¿Tienes una casa o departamento para rentar?</h2><p>La publicamos con ficha propia, agendamos las visitas, filtramos a los prospectos y te mandamos un reporte semanal por WhatsApp.</p></div>
<a class="b ac lg" href="/renta-tu-propiedad">Registrar mi propiedad ${I('arrow')}</a></section>`;

function home(ctx, { list, all, zones, f, cityLandings = [] }) {
  const sel = (v, cur) => (String(v) === String(cur || '') ? ' selected' : '');
  const zoneCounts = zones.map((z, i) => {
    const L = all.filter((p) => p.zone_slug === z.slug);
    return { ...z, n: L.length, min: L.length ? Math.min(...L.map((p) => p.rent)) : 0, grad: ZONE_GRADS[i % ZONE_GRADS.length] };
  }).filter((z) => z.n > 0);
  const finderData = all.map((p) => ({ ...p, description: undefined, near: undefined, photos_all: undefined }));
  const personas = cityLandings.filter((l) => PERSONA[l.key]);
  const filtered = Object.values(f).some(Boolean);
  const hero = `<section class="hero">${BRAND.hero()}<div class="w hero-in"><div>
<span class="eyebrow">${I('pin')} Querétaro</span>
<h1>Tu próxima renta en Querétaro, <em>sin sorpresas</em></h1>
<p class="lead">Casas y departamentos con ficha completa, el costo de entrada calculado y visita agendada en minutos. Un asesor te confirma por WhatsApp.</p>
<ul class="trust"><li>${I('tag')} Costo de entrada claro</li><li>${I('chat')} Asesor por WhatsApp</li><li>${I('shield')} Póliza jurídica opcional</li></ul></div>
<form class="qs" method="get" action="/#listado" role="search"><h2>${I('search')} Busca tu renta</h2>
<label for="qs_z">Zona</label><select id="qs_z" name="zona"><option value="">Todo Querétaro</option>${zones.map((z) => `<option value="${z.slug}"${sel(z.slug, f.zona)}>${esc(z.name)}</option>`).join('')}</select>
<div class="row2"><div><label for="qs_m">Renta máxima</label><select id="qs_m" name="max"><option value="">Sin límite</option>${[8000, 10000, 12000, 15000, 20000, 25000, 35000].map((n) => `<option value="${n}"${sel(n, f.max)}>${money(n)}</option>`).join('')}</select></div>
<div><label for="qs_r">Recámaras</label><select id="qs_r" name="rec"><option value="">Cualquiera</option>${[1, 2, 3, 4].map((n) => `<option value="${n}"${sel(n, f.rec)}>${n}+</option>`).join('')}</select></div></div>
<button class="b full lg">${I('search')} Ver propiedades</button>
<p class="note" style="margin:10px 0 0;text-align:center">o <a href="#finder">responde 4 preguntas</a> y te decimos cuáles te quedan</p></form></div></section>`;
  const body = `<div class="features">
<div class="feat"><span class="ib">${I('tag')}</span><div><b>Sabes cuánto necesitas</b><span>Primer mes, depósito y mantenimiento sumados en cada ficha.</span></div></div>
<div class="feat"><span class="ib">${I('calendar')}</span><div><b>Agenda en minutos</b><span>Elige día y hora; tu asesor confirma por WhatsApp.</span></div></div>
<div class="feat"><span class="ib">${I('lock')}</span><div><b>Tus documentos, protegidos</b><span>Tu expediente se guarda cifrado y solo lo ve quien lo revisa.</span></div></div>
<div class="feat"><span class="ib">${I('shield')}</span><div><b>Contrato con respaldo</b><span>Contrato de arrendamiento y póliza jurídica si la eliges.</span></div></div></div>

${personas.length ? `<section class="sec"><span class="eyebrow">Para quién buscas</span><h2>Encuentra rentas pensadas para ti</h2><p class="sub">Elige tu situación y te mostramos lo que hoy hay disponible.</p>
<div class="personas">${personas.map((l) => { const [ic, t, d] = PERSONA[l.key]; return `<a class="persona" href="${l.path}"><span class="ib">${I(ic)}</span><b>${t}</b><span>${d}</span><small>${l.n} disponible(s) →</small></a>`; }).join('')}</div></section>` : ''}

<section class="sec" id="listado"><span class="eyebrow">Disponibles hoy</span><h2>${filtered ? 'Resultados de tu búsqueda' : 'Propiedades en renta'}</h2>
<details class="card filtercard"${filtered ? ' open' : ''}><summary>${I('search')} Más filtros${filtered ? ` · <span class="note">${esc(filtersText(f, zones))}</span>` : ''}</summary>
<form method="get" action="/#listado" id="filtros"><div class="filters" style="margin-top:12px">
<div><label for="fz">Zona</label><select id="fz" name="zona"><option value="">Todas</option>${zones.map((z) => `<option value="${z.slug}"${sel(z.slug, f.zona)}>${esc(z.name)}</option>`).join('')}</select></div>
<div><label for="fmin">Precio mín. (MXN)</label><input id="fmin" name="min" type="number" inputmode="numeric" placeholder="0" value="${esc(f.min || '')}"></div>
<div><label for="fmax">Precio máx. (MXN)</label><input id="fmax" name="max" type="number" inputmode="numeric" placeholder="Sin límite" value="${esc(f.max || '')}"></div>
<div><label for="fr">Recámaras (mín.)</label><select id="fr" name="rec"><option value="">Cualquiera</option>${[1, 2, 3, 4].map((n) => `<option${sel(n, f.rec)}>${n}</option>`).join('')}</select></div>
<div><label for="fb">Baños (mín.)</label><select id="fb" name="ban"><option value="">Cualquiera</option>${[1, 2, 3].map((n) => `<option${sel(n, f.ban)}>${n}</option>`).join('')}</select></div>
<div><label for="fm">m² (mín.)</label><input id="fm" name="m2" type="number" inputmode="numeric" placeholder="0" value="${esc(f.m2 || '')}"></div>
<div><label for="fe">Extras</label><select id="fe" name="extra"><option value="">Todos</option>${EXTRAS.map((e) => `<option${sel(e, f.extra)}>${e}</option>`).join('')}</select></div>
<div><label for="fo">Ordenar por</label><select id="fo" name="orden"><option value="">Más recientes</option><option value="precio"${sel('precio', f.orden)}>Precio: menor a mayor</option><option value="-precio"${sel('-precio', f.orden)}>Precio: mayor a menor</option></select></div></div>
<p style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0"><button class="b">Aplicar filtros</button> <a class="b s" href="/#listado">Limpiar</a></p></form></details>
<div class="listbar"><span class="note" id="cnt">${list.length} propiedad(es) encontrada(s)</span><label class="chk" style="margin:0"><input id="ffav" type="checkbox"> ${I('heart')} Solo mis favoritos</label></div>
<div class="grid" id="track">${list.map(card).join('') || `<div class="card empty"><b>No hay propiedades con esos filtros.</b><p class="note">Prueba quitar algún filtro o deja tu WhatsApp abajo y te avisamos cuando entre una parecida.</p><a class="b s" href="/#listado">Limpiar filtros</a> <a class="b" href="#avisame">Avísame</a></div>`}</div></section>

${zoneCounts.length ? `<section class="sec"><span class="eyebrow">Explora por zona</span><h2>Rentas en las mejores zonas de Querétaro</h2>
<div class="zones">${zoneCounts.map((z) => `<a class="zone" style="--zg:${z.grad}" href="/renta/${z.slug}">${zoneArt}<b>${esc(z.name)}</b><span>${z.n} disponible(s) · desde ${money(z.min)}</span></a>`).join('')}</div></section>` : ''}

<section class="sec card" id="finder"><span class="eyebrow">${I('star')} Encuentra tu renta</span><h2 style="margin:6px 0">Te decimos cuáles te quedan mejor</h2>
<p class="note">Responde unas preguntas y te mostramos las 3 propiedades que mejor te quedan, con el porqué de cada una.</p>
<label>¿Quién va a vivir?</label><div class="chips" id="q_perfil">${[['Una persona o pareja', 2], ['Familia pequeña', 4], ['Familia grande', 6], ['Estudiante o joven', 1]].map(([v, n]) => `<button type="button" class="chip" data-v="${v}" data-n="${n}" aria-pressed="false">${v}</button>`).join('')}</div>
<p class="note">"Estudiante o joven" incluye a quien viene de otro estado.</p>
<div class="filters"><div><label for="q_pers">Cuántas personas</label><input id="q_pers" type="number" min="1" inputmode="numeric"></div>
<div><label for="q_presu">Renta máxima al mes (MXN)</label><input id="q_presu" type="number" inputmode="numeric"></div>
<div><label for="q_cuando">¿Para cuándo?</label><select id="q_cuando"><option value="">Solo estoy viendo</option><option value="mes">Este mes</option><option value="dos">En 1 a 2 meses</option></select></div></div>
<label>Qué es lo más importante (hasta 3)</label><div class="chips" id="q_prior">${['Seguridad', 'Cochera', 'Mascotas', 'Amueblado', 'Servicios incluidos', 'Espacio'].map((v) => `<button type="button" class="chip" data-v="${v}" aria-pressed="false">${v}</button>`).join('')}</div>
<p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"><button type="button" class="b" id="q_go">Ver mis mejores opciones</button> <button type="button" class="b s" id="q_clear">Borrar</button></p><div id="finderout"></div></section>

${alertForm(filtersText(f, zones), f)}
${cityLandings.length ? `<section class="sec"><h2>Busca según lo que necesitas</h2>${landingChips(cityLandings)}</section>` : ''}
<section class="sec" id="como-funciona"><span class="eyebrow">Cómo funciona</span><h2>De la búsqueda a las llaves, en 4 pasos</h2><ol class="steps" style="margin-top:16px">
<li><span class="ib">${I('search')}</span><b>Elige</b><span>Filtra por zona, precio y lo que necesitas, y revisa la ficha completa.</span></li>
<li><span class="ib">${I('calendar')}</span><b>Agenda</b><span>Escoge día y hora. Tu asesor confirma por WhatsApp.</span></li>
<li><span class="ib">${I('doc')}</span><b>Arma tu expediente</b><span>INE, constancia fiscal y comprobante de ingresos, desde tu celular.</span></li>
<li><span class="ib">${I('key')}</span><b>Firma y múdate</b><span>Contrato de arrendamiento, con póliza jurídica si la eliges.</span></li></ol></section>
<section class="sec">${HOME_FAQ_HTML}</section>
${ownerBand()}`;
  const st = ctx.settings;
  const org = { '@context': 'https://schema.org', '@type': 'RealEstateAgent', name: 'Rentaypunto', url: `${ctx.siteUrl}/`, logo: `${ctx.siteUrl}/sitio/icon.svg`,
    areaServed: { '@type': 'City', name: 'Querétaro' }, address: { '@type': 'PostalAddress', addressLocality: 'Querétaro', addressRegion: 'Querétaro', addressCountry: 'MX' },
    ...(st.whatsapp ? { telephone: `+52${st.whatsapp}` } : {}), ...(st.social_links && st.social_links.length ? { sameAs: st.social_links } : {}) };
  return layout({
    ctx, path: '/', active: 'home', body, hero,
    title: 'Casas y departamentos en renta en Querétaro | Rentaypunto',
    desc: 'Casas y departamentos en renta en Querétaro para estudiantes, familias, con mascotas o amueblados. Costo de entrada claro y visita agendada en minutos.',
    ld: [org, { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Rentaypunto', url: `${ctx.siteUrl}/` }, HOME_FAQ_LD],
    noindex: filtered, // los listados filtrados no se indexan (evita páginas duplicadas)
    scripts: [`window.FINDER=${json(finderData)}`],
  });
}

function zonePage(ctx, { zone, list, zones, landings = [] }) {
  const pr = list.map((p) => p.rent);
  const city = zone.slug === 'queretaro';
  const place = city ? 'Querétaro' : `${zone.name}, Querétaro`;
  const intro = list.length
    ? `Hay ${list.length} casa(s) y departamento(s) en renta en ${place}, desde ${money(Math.min(...pr))} hasta ${money(Math.max(...pr))} al mes. Cada ficha tiene el costo de entrada completo, lo que incluye la renta y lo que hay cerca; agenda tu visita en minutos.`
    : `Por ahora no hay propiedades disponibles en ${place}. Déjanos tu WhatsApp y te avisamos cuando entre una.`;
  const faq = faqBlock(city ? [] : [
    [`¿Cuánto cuesta rentar en ${zone.name}?`, list.length ? `Hoy, las rentas publicadas en ${zone.name} van de ${money(Math.min(...pr))} a ${money(Math.max(...pr))} al mes. A eso se suma el depósito y, si aplica, el mantenimiento: cada ficha lo calcula.` : `Por ahora no tenemos propiedades publicadas en ${zone.name}; deja tu WhatsApp y te avisamos.`],
    [`¿Hay rentas para estudiantes o con mascotas en ${zone.name}?`, 'Revisa las secciones de arriba: solo aparecen las que hoy tienen propiedades disponibles.'],
  ], `Preguntas sobre rentar en ${zone.name}`);
  const hero = pageHero({ crumbs: [['Propiedades', '/'], [city ? 'Querétaro' : zone.name]], eyebrow: `${I('pin')} ${esc(city ? 'Todas las zonas' : zone.name)}`, h1: `Casas y departamentos en renta en ${place}`, lead: intro });
  const body = `${zone.intro ? `<div class="card"><p style="margin:0">${esc(zone.intro).replace(/\n/g, '<br>')}</p>${zone.near ? `<p class="note" style="margin:10px 0 0">${I('pin')} <b>Cerca:</b> ${esc(zone.near)}</p>` : ''}</div>` : ''}
${landings.length ? `<section class="sec" style="margin-top:24px"><h2>Busca en ${esc(city ? 'Querétaro' : zone.name)} según lo que necesitas</h2>${landingChips(landings)}</section>` : ''}
<div class="grid" style="margin-top:24px">${list.map(card).join('')}</div>
${list.length ? '' : alertForm(zone.name, { zona: city ? '' : zone.slug })}
<section class="sec">${faq.html}</section>
<section class="sec"><h2>${city ? 'Rentas por zona' : 'Otras zonas'}</h2><div class="chips">${zones.filter((z) => z.id !== zone.id).map((z) => `<a class="chip" href="/renta/${z.slug}">${I('pin')} ${esc(z.name)}</a>`).join('')}</div></section>
${ownerBand()}`;
  const t = `Casas y departamentos en renta en ${city ? 'Querétaro' : zone.name}`;
  return layout({
    ctx, path: `/renta/${zone.slug}`, active: 'zonas', body, hero,
    title: `${t}${t.length <= 46 ? ' | Rentaypunto' : ''}`.slice(0, 60),
    desc: intro.slice(0, 155),
    noindex: !list.length,
    ld: [crumbs(ctx, [['Propiedades', '/'], [city ? 'Querétaro' : zone.name, `/renta/${zone.slug}`]]), faq.ld].filter(Boolean),
  });
}

// Página por intención: "departamentos para estudiantes en Juriquilla", "rentas que aceptan mascotas en Querétaro"...
function landingPage(ctx, { lg, related, sameInZones }) {
  const city = lg.zone.slug === 'queretaro';
  const faq = faqBlock(lg.faq);
  const pz = PERSONA[lg.key];
  const hero = pageHero({ crumbs: [['Propiedades', '/'], [city ? 'Querétaro' : lg.zone.name, `/renta/${lg.zone.slug}`], [lg.short]], eyebrow: `${I(pz ? pz[0] : 'search')} ${esc(lg.short)}`, h1: lg.h1, lead: lg.intro });
  const body = `<div class="grid" style="margin-top:24px">${lg.list.map(card).join('')}</div>
${lg.n < 3 ? alertForm(`${lg.short} en ${city ? 'Querétaro' : lg.zone.name}`, { zona: city ? '' : lg.zone.slug }) : ''}
<section class="sec">${faq.html}</section>
${related.length ? `<section class="sec"><h2>También te puede servir</h2>${landingChips(related)}</section>` : ''}
${sameInZones.length ? `<section class="sec"><h2>${esc(lg.short)} en otras zonas</h2>${landingChips(sameInZones.map((x) => ({ ...x, short: x.zone.name })))}</section>` : ''}`;
  return layout({
    ctx, path: lg.path, active: 'zonas', body, hero, title: lg.title, desc: lg.intro.slice(0, 152).replace(/\s+\S*$/, '') + '…',
    noindex: !lg.indexable,
    ld: [crumbs(ctx, [['Propiedades', '/'], [city ? 'Querétaro' : lg.zone.name, `/renta/${lg.zone.slug}`], [lg.short, lg.path]]), faq.ld,
      { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: lg.list.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${ctx.siteUrl}/${p.slug}` })) }].filter(Boolean),
  });
}

function ficha(ctx, { p, sim, slots, op, idealLinks = {}, zoneLandings = [] }) {
  const inc = p.includes;
  const mi = inc.includes('Mantenimiento');
  const mv = mi ? 0 : (p.maintenance || 0);
  const deposit = Math.round((p.deposit_months || 0) * p.rent);
  const entry = p.rent + deposit + mv;
  const monthly = p.rent + mv;
  const apart = ['Agua', 'Luz', 'Gas', 'Internet'].filter((k) => !inc.includes(k));
  const idl = MATCH.ideal(p); const cons = MATCH.considera(p); const pk = MATCH.parkOf(p);
  const url = `${ctx.siteUrl}/${p.slug}`;
  const photos = p.photos.map((x) => photoUrl(x.file));
  const shown = photos.slice(0, 5);
  const imgs = photos.length
    ? `<div class="gal n${Math.min(shown.length, 3) === 3 ? '' : shown.length}">${shown.map((src, i) => `<img src="${src}" alt="${esc(p.title)} en ${esc(p.zone)}, Querétaro - foto ${i + 1}" data-lb="${i}" tabindex="0"${i ? ' loading="lazy"' : ' fetchpriority="high"'}>`).join('')}
${photos.length > 1 ? `<button type="button" class="b s sm more" data-lb="0">${I('camera')} Ver ${photos.length} fotos</button>` : ''}</div>`
    : `<div class="gal-empty">${BRAND.noPhoto()}</div>`;
  const share = `https://wa.me/?text=${encodeURIComponent(`Mira esta renta: ${p.title} en ${p.zone}, ${money(p.rent)}/mes. ${url}`)}`;
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.colonia || ''} ${p.zone} Querétaro`)}`;
  const waText = `Hola, me interesa ${p.title} (${p.code}) en ${p.zone}, ${money(p.rent)}/mes. Ficha: ${url}`;
  const gone = !['disponible', 'apartada'].includes(p.status);
  // Preguntas que se hace quien la ve (las respuestas salen de los datos de la propiedad).
  const pfaq = faqBlock([
    [`¿Cuánto necesito para entrar a ${p.title.toLowerCase()}?`, `${money(entry)} en total: primer mes de renta (${money(p.rent)}), depósito de ${p.deposit_months} mes(es) (${money(deposit)})${mv ? ` y el primer mes de mantenimiento (${money(mv)})` : ''}. Después pagas ${money(monthly)} al mes.`],
    ['¿Aceptan mascotas?', p.extras.includes('Mascotas') ? 'Sí, se indican mascotas como permitidas. Confirma con tu asesor las condiciones.' : 'No está indicado como permitido. Pregúntale a tu asesor antes de agendar.'],
    ['¿Qué incluye la renta?', inc.length ? `Incluye ${inc.join(', ').toLowerCase()}.${apart.length ? ` Por tu cuenta: ${apart.join(', ').toLowerCase()}.` : ''}` : 'Los servicios (agua, luz, gas e internet) van por tu cuenta.'],
    ...(p.min_term ? [['¿Cuál es el plazo mínimo del contrato?', `${p.min_term} meses.`]] : []),
    ...(p.requirements ? [['¿Qué piden para rentarla?', `${p.requirements}, además de INE, Constancia de Situación Fiscal y comprobante de ingresos.`]] : []),
  ], 'Preguntas sobre esta propiedad');
  const ks = [['bed', p.bedrooms || 0, 'Recámaras'], ['bath', p.bathrooms || 0, 'Baños'], ...(p.m2 ? [['area', `${p.m2} m²`, 'Construcción']] : []),
    ['car', pk || '—', 'Cochera'], ['paw', p.extras.includes('Mascotas') ? 'Sí' : 'No indicado', 'Mascotas'], ...(p.extras.includes('Amueblado') ? [['sofa', 'Sí', 'Amueblado']] : [])];
  const body = `<div style="margin-top:16px"><nav class="bc" aria-label="Ruta"><a href="/">Propiedades</a> › <a href="/renta/${p.zone_slug}">${esc(p.zone)}</a> › <span>${esc(p.title)}</span></nav></div>
<div style="margin-top:12px">${imgs}</div>
<div class="fgrid"><div class="ftitle">
<div class="chips" style="gap:6px">${p.status === 'apartada' ? '<span class="tag wa">Apartada</span>' : ''}<span class="tag">${I('pin')} ${esc(p.colonia || p.zone)}</span><span class="tag">${esc(p.code)}</span></div>
<h1 class="zt">${esc(p.h1)}</h1>
${idl.length ? `<p style="margin:6px 0"><b>Ideal para:</b> ${idl.map((x) => (idealLinks[x] ? `<a class="tag ok" href="${idealLinks[x]}">${esc(x)}</a>` : `<span class="tag ok">${esc(x)}</span>`)).join(' ')} <span class="note">Sugerido según sus características</span></p>` : ''}
<div class="keyspecs">${ks.map(([ic, v, l]) => `<div>${I(ic)}<b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>
<div class="acts"><button type="button" class="b s sm" data-fav="${p.id}" aria-pressed="false">♡ Guardar</button>
<a class="b s sm" target="_blank" rel="noopener" href="${esc(share)}">${I('share')} Compartir por WhatsApp</a>
<a class="b s sm" target="_blank" rel="noopener" href="${esc(map)}">${I('map')} Ver zona en el mapa</a></div>
${p.description ? `<div class="card"><h2>Descripción</h2><p style="margin:0">${esc(p.description).replace(/\n/g, '<br>')}</p></div>` : ''}
<div class="card" id="parati" hidden></div>
${op && op.n >= 3 ? `<div class="card"><h2>${I('star')} Opiniones de quienes la visitaron</h2><p>A <b>${op.liked} de ${op.n}</b> personas que la visitaron les gustó.</p><p class="note">Opiniones anónimas que recibimos después de cada visita.</p></div>` : ''}
<div class="card"><h2>Qué incluye</h2><div class="svc">${['Agua', 'Luz', 'Gas', 'Internet', 'Mantenimiento'].map((k) => `<div><b>${k}</b><br>${inc.includes(k) ? '<span class="cok">✓ Incluido</span>' : '<span class="note">Por tu cuenta</span>'}</div>`).join('')}</div>
<div class="fi"><span>Plazo mínimo del contrato</span><b>${p.min_term ? `${p.min_term} meses` : '—'}</b></div>
<div class="fi"><span>Ocupantes máximos</span><b>${p.max_occupants || '—'}</b></div>
<div class="fi"><span>Disponible desde</span><b>${p.available_from ? fdate(p.available_from) : 'Ya'}</b></div>
${p.requirements ? `<div class="fi"><span>Requisitos</span><b>${esc(p.requirements)}</b></div>` : ''}
${p.near ? `<div class="fi"><span>Cerca de</span><b>${esc(p.near)}</b></div>` : ''}
${cons.length ? `<h4>Considera</h4><ul class="why">${cons.map((c) => `<li class="c">${esc(c)}</li>`).join('')}</ul>` : ''}
<p class="note">${I('lock')} La dirección exacta se comparte cuando tu cita está confirmada.</p></div>
<div class="card"><h2>Cuánto necesitas</h2><h4>Para entrar</h4>
<div class="fi"><span>Renta del primer mes</span><b>${money(p.rent)}</b></div>
<div class="fi"><span>Depósito (${p.deposit_months} mes(es))</span><b>${money(deposit)}</b></div>
<div class="fi"><span>Mantenimiento (primer mes)</span><b>${mi ? 'Incluido' : money(p.maintenance || 0)}</b></div>
<div class="fi tot"><span>Total estimado</span><b>${money(entry)}</b></div>
<h4>Cada mes</h4><div class="fi tot"><span>Pago mensual fijo</span><b>${money(monthly)}</b></div>
<p class="note">${apart.length ? `Aparte, según tu consumo: ${apart.join(', ').toLowerCase()}.` : 'Agua, luz, gas e internet incluidos.'} La póliza jurídica y otros costos se definen con tu asesor.</p></div>
${pfaq.html}
</div><aside class="stick"><div class="card pricebox"><div class="big">${money(p.rent)} <small>/mes</small></div>
<div class="entry"><span>Para entrar</span><b>${money(entry)}</b></div>
${p.advisor ? `<p class="note" style="margin:0 0 6px">${I('user')} Te atiende <b>${esc(p.advisor)}</b>, asesor de Rentaypunto</p>` : ''}
<div id="bkbox">${gone ? '<h2>Esta propiedad ya no está disponible</h2><p class="note">Revisa las similares o vuelve al listado.</p><a class="b full" href="/">Ver propiedades</a>' : '<p class="note">Cargando horarios…</p>'}</div></div></aside></div>
${sim.length ? `<section class="sec"><h2>Propiedades similares</h2><div class="grid" style="margin-top:14px">${sim.map(card).join('')}</div></section>` : ''}
${zoneLandings.length ? `<section class="sec"><h2>Más rentas en ${esc(p.zone)}</h2>${landingChips(zoneLandings)}</section>` : ''}
${gone ? '' : `<div class="sbar"><a class="b" href="#bkbox">${I('calendar')} Agendar visita</a>${ctx.settings.whatsapp ? `<a class="b s" target="_blank" rel="noopener" data-wa="${p.id}" href="${esc(waHref(ctx.settings.whatsapp, waText))}">${I('chat')} WhatsApp</a>` : ''}</div>`}`;
  const ld = jsonLd({ ...p, seo_title: p.seo_title, seo_desc: p.seo_desc }, url, photos.map((s) => ctx.siteUrl + s));
  return layout({
    ctx, path: `/${p.slug}`, active: 'home', body, bodyClass: 'ficha', title: p.seo_title, desc: p.seo_desc,
    og: { title: `${p.title} · ${money(p.rent)}/mes`, image: photos[0] ? ctx.siteUrl + photos[0] : '' },
    ld: gone ? null : [ld, pfaq.ld, { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Propiedades', item: `${ctx.siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: p.zone, item: `${ctx.siteUrl}/renta/${p.zone_slug}` },
      { '@type': 'ListItem', position: 3, name: p.title, item: url }] }],
    noindex: gone,
    scripts: [`window.PROP=${json({ id: p.id, code: p.code, title: p.title, zone: p.zone, rent: p.rent, slug: p.slug, url, photos, waText, gone, slots, p: { ...p, description: undefined } })}`],
  });
}

function simplePage(ctx, { path, title, desc, h1, lead, inner, active, noindex, eyebrow }) {
  return layout({ ctx, path, title, desc, active, noindex, hero: pageHero({ h1, lead, eyebrow, h1Class: '' }), body: `<div style="margin-top:8px">${inner}</div>` });
}

function owners(ctx, { zones, ref }) {
  const s = ctx.settings;
  const opt = (a) => a.map((x) => `<option>${esc(x)}</option>`).join('');
  const inner = `<div class="g2">
<div class="card"><h2>Qué hacemos por ti</h2><ul class="ticks"><li>${I('check')}<span>Publicamos tu propiedad con ficha propia y fotos.</span></li><li>${I('check')}<span>Agendamos las visitas y filtramos a los prospectos.</span></li><li>${I('check')}<span>Priorizamos prospectos con expediente completo.</span></li><li>${I('check')}<span>Te mandamos un reporte semanal por WhatsApp con visitas y citas.</span></li><li>${I('check')}<span>Puedes sumar póliza jurídica para el contrato.</span></li></ul></div>
<div class="card"><h2>Cuánto cuesta</h2>${s.fees_text ? `<p>${esc(s.fees_text)}</p>` : '<p><span class="tag wa">Por definir</span></p><p class="note">Te explicamos el costo completo antes de que firmes cualquier cosa.</p>'}</div>
<div class="card"><h2>Cómo cuidamos tu propiedad</h2><ul class="ticks"><li>${I('check')}<span>Validamos el expediente del inquilino: INE, constancia fiscal y comprobante de ingresos.</span></li><li>${I('check')}<span>Contrato de arrendamiento.</span></li><li>${I('check')}<span>Póliza jurídica opcional.</span></li><li>${I('check')}<span>Acta de entrega con fotos cuando se renta.</span></li></ul></div>
<div class="card"><h2>Qué sigue después de registrarte</h2><ol class="nx"><li>Tu asesor te escribe por WhatsApp.</li><li>Revisamos tus documentos de propiedad.</li><li>Visita para fotos y detalles.</li><li>Publicamos la ficha y te avisamos.</li><li>Te mandamos por WhatsApp un reporte semanal con visitas y citas de tu propiedad.</li></ol></div></div>
<div class="card" id="registro"><h2>Registra tu propiedad</h2><p class="note">En la ficha pública solo mostramos zona y colonia. La dirección exacta se comparte únicamente con prospectos que tienen una cita confirmada.</p>
<form data-form="propietario" novalidate><div class="filters">
<div><label for="ow_n">Tu nombre</label><input id="ow_n" name="name" autocomplete="name" required maxlength="80"></div>
<div><label for="ow_w">WhatsApp</label><input id="ow_w" name="phone" type="tel" inputmode="numeric" placeholder="10 dígitos" autocomplete="tel" required></div>
<div><label for="ow_hr">Mejor horario para contactarte</label><select id="ow_hr" name="best_time">${opt(['Mañana', 'Tarde', 'Noche'])}</select></div>
<div><label for="ow_t">Tipo</label><select id="ow_t" name="prop_type">${opt(['Casa', 'Departamento', 'Estudio', 'Otro'])}</select></div>
<div><label for="ow_z">Zona</label><select id="ow_z" name="zone">${opt(zones.map((z) => z.name).concat('Otra'))}</select></div>
<div><label for="ow_col">Colonia o referencia</label><input id="ow_col" name="colonia" maxlength="120"></div>
<div><label for="ow_rec">Recámaras</label><select id="ow_rec" name="bedrooms" required><option value="">Elige</option>${opt(['1', '2', '3', '4', '5'])}</select></div>
<div><label for="ow_m2">m² (aprox.)</label><input id="ow_m2" name="m2" type="number" inputmode="numeric"></div>
<div><label for="ow_r">Renta que esperas (MXN/mes)</label><input id="ow_r" name="expected_rent" type="number" inputmode="numeric" required></div>
<div><label for="ow_h">¿Está desocupada?</label><select id="ow_h" name="occupied">${opt(['Desocupada', 'Ocupada (se desocupa pronto)'])}</select></div>
<div><label for="ow_d">Disponible desde</label><input id="ow_d" name="available_from" type="date"></div>
<div><label for="ow_a">¿Amueblada?</label><select id="ow_a" name="furnished">${opt(['No', 'Sí', 'Parcial'])}</select></div>
<div><label for="ow_p">¿Aceptas mascotas?</label><select id="ow_p" name="pets">${opt(['Depende', 'Sí', 'No'])}</select></div>
<div><label for="ow_o">¿Está publicada en otro lado?</label><select id="ow_o" name="listed_elsewhere">${opt(['No', 'Sí'])}</select></div>
<div><label for="ow_f">¿Vives fuera de Querétaro?</label><select id="ow_f" name="lives_outside">${opt(['No', 'Sí'])}</select></div></div>
<div id="ow_est" class="card" style="margin:12px 0"><p class="note">Elige zona y recámaras para ver una referencia de renta.</p></div>
<p class="note">Para publicar necesitamos tu identificación oficial y el predial o la escritura: confirman que eres el dueño y protegen a los inquilinos del fraude. Tu asesor te los pide después del registro.</p>
<label for="ow_m">Algo más que debamos saber</label><textarea id="ow_m" name="notes" rows="2" maxlength="1000"></textarea>
<div class="hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
<label class="chk"><input type="checkbox" name="privacy" required> Acepto el <a href="/aviso-de-privacidad" target="_blank">aviso de privacidad</a></label>
<p class="err" data-err></p><p><button class="b">Registrar mi propiedad</button></p></form>
<div data-done hidden><h2>✓ Recibimos tu registro</h2><p>Folio: <b data-folio></b></p><p><b>Qué sigue</b></p><ol class="nx"><li>Tu asesor te escribe por WhatsApp.</li><li>Revisamos tus documentos de propiedad.</li><li>Visita para fotos y detalles.</li><li>Publicamos la ficha y te avisamos.</li><li>Te mandamos por WhatsApp un reporte semanal con visitas y citas de tu propiedad.</li></ol><p><a class="b s" href="/renta-tu-propiedad">Registrar otra propiedad</a></p></div></div>
<div class="card"><h2>Preguntas de propietarios</h2>
<details><summary>¿Quién publica mi propiedad?</summary><p>Nosotros. Tú te registras y tu asesor arma y publica la ficha. Te mantiene al tanto por WhatsApp.</p></details>
<details><summary>¿Se publica mi dirección exacta?</summary><p>No. La ficha muestra zona y colonia. La dirección exacta se comparte solo con prospectos con cita confirmada.</p></details>
<details><summary>¿Qué documentos necesito?</summary><p>Identificación oficial y predial o escritura de la propiedad.</p></details>
<details><summary>¿Puedo pausar la publicación o cambiar el precio?</summary><p>Sí. Se lo pides a tu asesor por WhatsApp y él lo aplica. También puedes avisar si ya la rentaste por tu cuenta.</p></details>
<details><summary>¿Cuánto cuesta el servicio?</summary><p>${s.fees_text ? esc(s.fees_text) : 'Por definir. Te lo explicamos completo antes de firmar.'}</p></details>
<details><summary>¿Qué pasa cuando se renta?</summary><p>Se hace el contrato y el acta de entrega con fotos. Tu asesor te avisa cuándo vence el contrato.</p></details></div>`;
  return layout({
    ctx, path: '/renta-tu-propiedad', active: 'pub', title: 'Renta tu casa o departamento en Querétaro | Rentaypunto',
    desc: 'Registra tu propiedad: la publicamos, agendamos las visitas y filtramos a los prospectos. Te mandamos un reporte semanal por WhatsApp.',
    hero: pageHero({ eyebrow: `${I('key')} Para propietarios`, h1: 'Renta tu propiedad con Rentaypunto', lead: 'Regístrala y nosotros la publicamos, agendamos las visitas y filtramos a los prospectos. Tu asesor te mantiene al tanto por WhatsApp.', h1Class: '' }),
    body: `<div style="margin-top:8px">${inner}</div>`,
    scripts: [`window.REF=${json(ref)}`],
  });
}

function help(ctx) {
  const inner = `<div class="g2"><div class="card"><h2>¿Algo salió mal?</h2><p class="note">Cuéntanos y le damos seguimiento.</p><a class="b" href="/quejas">Quejas y sugerencias</a></div>
<div class="card"><h2>Certeza jurídica</h2><p class="note">Póliza para validar al inquilino, el contrato y asesoría.</p><a class="b" href="/certeza-juridica">Ver póliza jurídica</a></div></div>
<div class="card"><h2>Preguntas frecuentes</h2>
<details><summary>¿Cómo agendo una visita?</summary><p>Entra a la ficha de la propiedad, elige día y hora y deja tu nombre y WhatsApp. Tu asesor te confirma por ahí.</p></details>
<details><summary>¿Qué documentos necesito?</summary><p>Para tu expediente: INE, Constancia de Situación Fiscal y comprobante de ingresos. Algunas propiedades piden además aval o fiador; aparece en la ficha como Requisitos.</p></details>
<details><summary>¿Cuánto necesito para entrar?</summary><p>Depende de cada propiedad. La ficha calcula la renta del primer mes, el depósito y el mantenimiento. La póliza jurídica se define aparte con tu asesor.</p></details>
<details><summary>¿Puedo rentar con mascotas?</summary><p>Usa el filtro Extras → Mascotas. Cada ficha indica las condiciones.</p></details>
<details><summary>¿Qué es la póliza jurídica?</summary><p>Un servicio con un despacho aliado: validación de inquilino, contrato de arrendamiento y asesoría.${ctx.settings.legal_text ? '' : ' El alcance y el precio están por definir.'}</p></details>
<details><summary>¿Qué hago si tengo un problema después de rentar?</summary><p>Levanta un reporte en <a href="/quejas">Quejas y sugerencias</a>. Recibes un folio y seguimiento.</p></details></div>
<div class="card"><p><a href="/aviso-de-privacidad">Aviso de privacidad</a></p></div>`;
  return simplePage(ctx, { path: '/ayuda', active: 'help', title: 'Ayuda | Rentaypunto', desc: 'Preguntas frecuentes sobre rentar con Rentaypunto: visitas, documentos, costo de entrada, mascotas y póliza jurídica.', h1: 'Ayuda', lead: 'Respuestas rápidas y a dónde acudir si algo no sale bien.', inner });
}

function complaints(ctx) {
  const promise = ctx.settings.complaints_promise;
  const inner = `<div class="card"><form data-form="queja" novalidate><div class="filters">
<div><label for="s_n">Nombre</label><input id="s_n" name="name" maxlength="80"></div>
<div><label for="s_c">WhatsApp o correo</label><input id="s_c" name="contact" required maxlength="120"></div>
<div><label for="s_t">Tipo</label><select id="s_t" name="kind"><option>Queja</option><option>Inconformidad</option><option>Sugerencia</option></select></div>
<div><label for="s_p">Propiedad (código, opcional)</label><input id="s_p" name="property_ref" maxlength="40" placeholder="RP-0001"></div></div>
<p><label for="s_m">Cuéntanos qué pasó</label><textarea id="s_m" name="message" rows="4" required maxlength="2000"></textarea></p>
<div class="hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
<label class="chk"><input type="checkbox" name="privacy" required> Acepto el <a href="/aviso-de-privacidad" target="_blank">aviso de privacidad</a></label>
<p class="err" data-err></p><p><button class="b">Enviar</button></p></form>
<div data-done hidden><h2>✓ Recibimos tu reporte</h2><p>Tu folio es <b data-folio></b>. Guárdalo para darle seguimiento.${promise ? ` Te respondemos en máximo ${esc(promise)}.` : ''}</p></div></div>`;
  return simplePage(ctx, { path: '/quejas', active: 'help', title: 'Quejas, inconformidades y sugerencias | Rentaypunto', desc: 'Cuéntanos qué pasó. Recibes un folio y damos seguimiento con el propietario.', h1: 'Quejas, inconformidades y sugerencias', lead: promise ? `Las gestionamos con el propietario y respondemos en máximo ${promise}.` : 'Las gestionamos con el propietario y te damos seguimiento con tu folio.', inner });
}

function legal(ctx) {
  const t = ctx.settings.legal_text;
  const inner = `<div class="g2"><div class="card"><h2>Póliza jurídica</h2>${t ? `<p>${esc(t).replace(/\n/g, '<br>')}</p>` : `<p class="note">Alcance y precio por definir con el despacho aliado. Propuesta de planes:</p>
<p><span class="tag wa">Plan Básico</span> Validación de inquilino y contrato de arrendamiento.</p>
<p><span class="tag wa">Plan Plus</span> Lo del Básico, más asesoría en incumplimientos y apoyo en desocupación.</p><p class="note">Precio: por definir.</p>`}</div>
<div class="card"><h2>Solicitar contacto</h2><form data-form="juridico" novalidate>
<label for="l_n">Nombre</label><input id="l_n" name="name" required maxlength="80">
<label for="l_t">WhatsApp</label><input id="l_t" name="phone" type="tel" inputmode="numeric" placeholder="10 dígitos" required>
<label for="l_r">Soy</label><select id="l_r" name="who"><option>Inquilino</option><option>Propietario</option></select>
<div class="hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
<label class="chk"><input type="checkbox" name="privacy" required> Acepto el <a href="/aviso-de-privacidad" target="_blank">aviso de privacidad</a></label>
<p class="err" data-err></p><p><button class="b">Quiero que me contacten</button></p></form>
<div data-done hidden><p><b>Listo.</b> Un asesor te contacta por WhatsApp.</p></div></div></div>`;
  return simplePage(ctx, { path: '/certeza-juridica', active: 'help', title: 'Póliza jurídica para tu renta | Rentaypunto', desc: 'Certeza legal en tu contrato de arrendamiento en Querétaro: validación de inquilino, contrato y asesoría con un despacho aliado.', h1: 'Certeza legal en tu contrato', lead: 'Alianza con un despacho de abogados aliado.', inner });
}

function privacy(ctx) {
  const name = ctx.settings.company_legal_name || 'Rentaypunto (razón social por definir)';
  const inner = `<div class="card"><p><span class="tag wa">Borrador</span> <span class="note">Texto por validar con el despacho jurídico antes de publicar el sitio.</span></p>
<p><b>Responsable:</b> ${esc(name)}, Querétaro, México.</p>
<p><b>Datos que recabamos:</b> nombre y WhatsApp; si registras una propiedad, sus características; si armas tu expediente de inquilino, INE, Constancia de Situación Fiscal y comprobante de ingresos.</p>
<p><b>Para qué los usamos:</b> agendar y confirmar visitas, contactarte, avisarte de propiedades que coincidan con tu búsqueda, validar tu solicitud de renta y dar seguimiento a quejas.</p>
<p><b>Medición:</b> usamos el píxel de Meta y sus herramientas de medición para saber qué anuncios traen visitas. Cuando agendas una visita, a Meta le llega tu teléfono cifrado (no legible) para medir el anuncio.</p>
<p><b>Quién los ve:</b> solo el personal de Rentaypunto que los necesita para atenderte.</p>
<p><b>Tus derechos ARCO</b> (acceso, rectificación, cancelación y oposición): medio de contacto por definir.</p></div>`;
  return simplePage(ctx, { path: '/aviso-de-privacidad', title: 'Aviso de privacidad | Rentaypunto', desc: 'Aviso de privacidad de Rentaypunto: qué datos recabamos y para qué los usamos.', h1: 'Aviso de privacidad', inner, noindex: true });
}

function opinion(ctx, { l, done, token }) {
  if (!l) return notFound(ctx, 'Este enlace de opinión no existe o ya no sirve.');
  const radio = (name, list) => list.map(([v, t]) => `<label class="chk"><input type="radio" name="${name}" value="${v}" required> ${t}</label>`).join('');
  const inner = done ? '<div class="card"><p><b>Ya recibimos tu opinión.</b> ¡Gracias!</p><p><a class="b" href="/">Ver más propiedades</a></div>'
    : `<div class="card"><form data-form="opinion" novalidate><input type="hidden" name="token" value="${esc(token)}">
<p><b>¿Te gustó la propiedad?</b></p>${radio('liked', [['si', 'Sí'], ['mas_o_menos', 'Más o menos'], ['no', 'No']])}
<p><b>La renta te parece…</b></p>${radio('rent_opinion', [['justa', 'Justa'], ['alta', 'Alta'], ['baja', 'Baja']])}
<p><label for="op_r">Si no te convenció, ¿por qué?</label><select id="op_r" name="reason"><option value="">No aplica</option>${['Precio', 'Ubicación', 'Tamaño', 'Estado de la propiedad', 'Encontré otra opción', 'Otro'].map((x) => `<option>${x}</option>`).join('')}</select></p>
<p class="err" data-err></p><p><button class="b">Enviar opinión</button></p></form>
<div data-done hidden><p><b>¡Gracias!</b> Tu opinión le llega al propietario sin tu nombre.</p><p><a class="b s" href="/">Ver más propiedades</a></p></div></div>`;
  return simplePage(ctx, { path: '/opinion', noindex: true, title: 'Tu opinión de la visita | Rentaypunto', desc: 'Cuéntanos qué te pareció la propiedad que visitaste.', h1: '¿Qué te pareció la visita?', lead: `${l.code} · ${l.title}. Es anónima y toma 20 segundos.`, inner });
}

// ---------- Expediente y portal (páginas privadas por enlace) ----------
const DOC_ST = { pendiente: ['En revisión', 'wa'], validado: ['Validado', 'ok'], rechazado: ['Rechazado', 'no'] };
function fileGone(ctx) {
  return simplePage(ctx, { path: '/expediente', noindex: true, title: 'Enlace no disponible | Rentaypunto', desc: 'Enlace privado.', h1: 'Este enlace ya no sirve',
    lead: 'Venció, ya se usó o tu asesor generó uno nuevo. Pídele a tu asesor un enlace nuevo por WhatsApp.', inner: '<p><a class="b" href="/">Ver propiedades</a></p>' });
}
function filePage(ctx, { link, s, docs, kinds, enabled }) {
  const lead = link.subject_type === 'lead';
  const title = lead ? 'Mi expediente de inquilino' : 'Documentos de tu propiedad';
  if (link.closed) {
    return simplePage(ctx, { path: '/expediente', noindex: true, title: `${title} | Rentaypunto`, desc: 'Enlace privado.', h1: '✓ Recibimos tus documentos',
      lead: 'Tu asesor los revisa y te avisa por WhatsApp. Si falta algo, te manda un enlace nuevo.', inner: '' });
  }
  const rows = Object.entries(kinds).map(([k, [label, required, max]]) => {
    const mine = docs.filter((d) => d.kind === k);
    const live = mine.filter((d) => d.status !== 'rechazado').length;
    return `<div class="card"><h2>${esc(label)} ${required ? '' : '<span class="tag">Opcional</span>'}</h2>
${mine.map((d) => `<div class="fi"><span>${esc(d.original_name || k)} <span class="tag ${DOC_ST[d.status][1]}">${DOC_ST[d.status][0]}</span>${d.note ? `<br><span class="note">${esc(d.note)}</span>` : ''}</span>${d.status === 'pendiente' ? `<button type="button" class="b s sm" data-quitar="${d.id}">Quitar</button>` : ''}</div>`).join('')}
${live < max ? `<label class="b s sm" style="margin-top:8px">${live ? 'Agregar otro' : 'Subir'} <input type="file" accept="application/pdf,image/jpeg,image/png" data-kind="${k}" hidden></label>` : ''}
</div>`;
  }).join('');
  const inner = !enabled ? '<div class="card"><p>Por ahora no podemos recibir documentos por aquí. Tu asesor te dirá cómo enviarlos.</p></div>'
    : `<div class="card"><p>Hola ${esc(String(s.name || '').split(' ')[0])}. ${lead ? `Este es tu expediente para ${esc(s.code ? `${s.code} · ${s.title}` : 'tu renta')}.` : 'Sube los documentos que confirman que eres el dueño.'} Puedes subir fotos claras o PDF (hasta 8 MB cada uno).</p>
<p class="note">Este enlace es solo para ti: no lo compartas. Tus documentos se guardan cifrados y solo los ve el personal de Rentaypunto que los revisa.${lead ? ' Se usan únicamente para validar tu solicitud de renta.' : ''}</p></div>
${lead && s.requirements ? `<p class="note">Esta propiedad pide además: <b>${esc(s.requirements)}</b>.</p>` : ''}
<div id="docs">${rows}</div>
${lead ? `<div class="card"><h2>Tu búsqueda</h2><div class="filters">
<div><label for="pf_b">Presupuesto máximo al mes (MXN)</label><input id="pf_b" name="budget" type="number" inputmode="numeric"></div>
<div><label for="pf_d">Fecha de mudanza</label><input id="pf_d" name="move_date" type="date"></div>
<div><label for="pf_o">¿Cuántas personas van a vivir?</label><input id="pf_o" name="occupants" type="number" inputmode="numeric"></div>
<div><label for="pf_p">Mascotas</label><select id="pf_p" name="pets"><option>No</option><option>Sí, perro</option><option>Sí, gato</option><option>Sí, otra</option></select></div>
<div><label for="pf_j">Ocupación</label><input id="pf_j" name="occupation" maxlength="80" placeholder="Empleado, negocio propio, estudiante…"></div></div>
<label for="pf_n">Algo más que tu asesor deba saber</label><textarea id="pf_n" name="notes" rows="2" maxlength="500"></textarea></div>` : ''}
<p class="err" id="ex_err"></p><p><button type="button" class="b" id="ex_send">Enviar ${lead ? 'mi expediente' : 'documentos'}</button></p>
<p class="note">Cuando lo envíes, este enlace se cierra. Si después falta algo, tu asesor te manda uno nuevo.</p>`;
  return simplePage(ctx, { path: '/expediente', noindex: true, title: `${title} | Rentaypunto`, desc: 'Enlace privado.', h1: title, inner });
}
function portalPage(ctx, { s, pays, concepts, enabled, month }) {
  const months = []; const d = new Date(`${month}-15T12:00:00Z`);
  for (let i = 0; i < 6; i++) { months.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); }
  const label = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  const inner = !enabled ? '<div class="card"><p>Por ahora no podemos recibir comprobantes por aquí. Envíalos a tu asesor.</p></div>'
    : `<div class="card"><p>Hola ${esc(String(s.name || '').split(' ')[0])}. Aquí subes tus comprobantes de pago de <b>${esc(`${s.code} · ${s.title}`)}</b> y ves si ya se validaron.</p><p class="note">Este enlace es solo para ti. Los comprobantes se guardan cifrados.</p></div>
<div class="card"><h2>Subir comprobante</h2><div class="filters"><div><label for="pt_m">Mes</label><select id="pt_m">${months.map((m) => `<option value="${m}">${esc(label(m))}</option>`).join('')}</select></div>
<div><label for="pt_c">Concepto</label><select id="pt_c">${Object.entries(concepts).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
<p><label class="b">Elegir archivo y subir <input type="file" id="pt_f" accept="application/pdf,image/jpeg,image/png" hidden></label></p><p class="err" id="pt_err"></p></div>
<div class="card"><h2>Mis pagos</h2>${pays.length ? pays.map((p) => `<div class="fi"><span>${esc(label(p.month))} · ${esc(concepts[p.concept])}${p.note ? `<br><span class="note">${esc(p.note)}</span>` : ''}</span><span class="tag ${DOC_ST[p.status][1]}">${DOC_ST[p.status][0]}</span></div>`).join('') : '<p class="note">Aún no hay comprobantes.</p>'}</div>`;
  return simplePage(ctx, { path: '/portal', noindex: true, title: 'Mis pagos | Rentaypunto', desc: 'Enlace privado.', h1: 'Mis pagos de renta', inner });
}

function notFound(ctx, msg) {
  return simplePage(ctx, { path: '/404', noindex: true, title: 'No encontramos esta página | Rentaypunto', desc: 'Página no encontrada.', h1: 'No encontramos esta página', lead: msg || 'Puede que la dirección esté mal escrita o que la propiedad ya no esté publicada.', inner: '<p><a class="b" href="/">Ver propiedades disponibles</a></p>' });
}

// Mapa del sitio: portada, zonas y páginas por búsqueda con propiedades, fichas publicadas (con sus fotos) y páginas fijas.
function sitemap(ctx, { props, zones, landings, lastmod }) {
  const u = (loc, mod, imgs = []) => `<url><loc>${esc(ctx.siteUrl + loc)}</loc>${mod ? `<lastmod>${String(mod).slice(0, 10)}</lastmod>` : ''}${imgs.map((i) => `<image:image><image:loc>${esc(ctx.siteUrl + i)}</image:loc></image:image>`).join('')}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${[u('/', lastmod), u('/renta/queretaro', lastmod), ...zones.map((z) => u(`/renta/${z.slug}`, z.lastmod)), ...landings.map((l) => u(l.path, l.lastmod)),
    ...props.map((p) => u(`/${p.seo_slug}`, p.updated_at, p.photos.slice(0, 10).map((f) => photoUrl(f.file)))),
    u('/renta-tu-propiedad'), u('/ayuda'), u('/quejas'), u('/certeza-juridica')].join('\n')}
</urlset>`;
}

module.exports = { esc, home, zonePage, landingPage, ficha, owners, help, complaints, legal, privacy, opinion, fileGone, filePage, portalPage, notFound, sitemap, filtersText };
