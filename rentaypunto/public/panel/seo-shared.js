// SEO automático de cada ficha. Lo usan el servidor y el panel (mismo archivo), así lo que se ve al capturar es lo que se publica.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SEO = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');

  // Título ≤60, descripción ≤155, URL renta/<zona>/<titulo>-<codigo> y H1.
  function seoAuto(o) {
    const base = String(o.title || 'Propiedad').trim() || 'Propiedad';
    const z = o.zone || 'Querétaro';
    const extras = o.extras || [];
    let t = base + ' en renta en ' + z + ' · ' + money(o.rent) + '/mes | Rentaypunto';
    if (t.length > 60) t = base + ' en renta en ' + z + ' | Rentaypunto';
    if (t.length > 60) t = base + ' en renta en ' + z;
    if (t.length > 60) t = (base + ' en renta, ' + z).slice(0, 60);
    const ex = extras.length ? ', ' + extras.slice(0, 2).join(' y ').toLowerCase() : '';
    let d = 'Renta ' + base.toLowerCase() + ' en ' + z + ', Querétaro: ' + (o.m2 || 0) + ' m², ' + (o.bedrooms || 0) + ' rec., '
      + (o.bathrooms || 0) + ' baños' + ex + '. ' + money(o.rent) + '/mes. Agenda tu visita.';
    if (d.length > 155) d = d.slice(0, 152).trim() + '…';
    return {
      slug: 'renta/' + slugify(z) + '/' + slugify(base) + '-' + String(o.code || 'rp-nuevo').toLowerCase(),
      title: t, desc: d, h1: base + ' en renta en ' + z,
    };
  }

  function seoChecks(p, seo, photos) {
    return [
      ['Título SEO de 30 a 60 caracteres', seo.title.length >= 30 && seo.title.length <= 60],
      ['Meta descripción de 120 a 155 caracteres', seo.desc.length >= 120 && seo.desc.length <= 155],
      ['URL propia con zona y código', /^renta\/[a-z0-9-]+\/[a-z0-9-]+$/.test(seo.slug)],
      ['Precio, m², recámaras y baños completos', Boolean(p.rent && p.m2 && p.bedrooms && p.bathrooms)],
      ['Descripción de al menos 80 caracteres', String(p.description || '').length >= 80],
      ['Al menos 3 fotos', photos >= 3],
      ['Colonia o referencia de ubicación', Boolean(String(p.colonia || '').trim())],
    ];
  }

  // La URL siempre termina en el código: renta/<zona>/<texto>-<código>. Así nunca se pierde la propiedad.
  function cleanSlug(slug, zoneSlug, code) {
    const c = String(code).toLowerCase();
    let tail = slugify(String(slug || '').split('/').pop());
    if (tail.endsWith(c)) tail = tail.slice(0, -c.length).replace(/-+$/, '');
    return 'renta/' + zoneSlug + '/' + (tail || 'propiedad') + '-' + c;
  }

  // Descripción sugerida, en frases como las buscaría la gente ("para estudiante", "acepta mascotas", "para familia").
  // ideal = lista de "Ideal para" (match.js). Es un punto de partida: el asesor la ajusta con lo que vio en la propiedad.
  function suggestDescription(o, ideal) {
    const n = (v) => Number(v) || 0;
    const tipo = o.prop_type === 'Casa' ? 'Casa' : o.prop_type === 'Estudio' ? 'Estudio' : 'Departamento';
    const ex = o.extras || []; const inc = (o.includes || []).filter((x) => x !== 'Mantenimiento');
    const out = [];
    const join = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1] : a[0] || '');
    // "Colonia o referencia": si es una referencia ("cerca de…", "frente al club") va entre paréntesis.
    const col = String(o.colonia || '').trim();
    const isRef = /^(cerca|a |frente|junto|torre|privada|acceso|en )/i.test(col);
    const place = (col && !isRef ? col + ', ' : '') + (o.zone || 'Querétaro') + ', Querétaro' + (col && isRef ? ' (' + col.charAt(0).toLowerCase() + col.slice(1) + ')' : '');
    out.push(tipo + ' en renta en ' + place + ', con ' + n(o.bedrooms) + ' recámara' + (n(o.bedrooms) === 1 ? '' : 's') + ' y ' + n(o.bathrooms) + ' baño' + (n(o.bathrooms) === 1 ? '' : 's') + (n(o.m2) ? ' en ' + n(o.m2) + ' m²' : '') + '.');
    const feats = [];
    if (ex.indexOf('Amueblado') >= 0) feats.push('viene amueblado');
    if (ex.indexOf('Mascotas') >= 0) feats.push('acepta mascotas');
    if (n(o.parking)) feats.push('tiene estacionamiento para ' + n(o.parking) + ' auto' + (n(o.parking) === 1 ? '' : 's'));
    else if (ex.indexOf('Estacionamiento') >= 0) feats.push('tiene estacionamiento');
    if (ex.indexOf('Seguridad 24h') >= 0) feats.push('cuenta con seguridad 24 horas');
    if (feats.length) { const t = join(feats); out.push(t.charAt(0).toUpperCase() + t.slice(1) + '.'); }
    if (inc.length) out.push('La renta incluye ' + join(inc).toLowerCase() + (o.includes.indexOf('Mantenimiento') >= 0 ? ', además del mantenimiento' : '') + '.');
    else if ((o.includes || []).indexOf('Mantenimiento') >= 0) out.push('El mantenimiento va incluido en la renta.');
    if (o.near) out.push('Cerca de ' + o.near.replace(/\.$/, '') + '.');
    const who = ideal || [];
    if (who.indexOf('Estudiante o joven') >= 0) out.push('Ideal si vienes a estudiar a Querétaro o buscas departamento para tu hijo o hija: espacio práctico y fácil de mantener.');
    else if (who.indexOf('Una persona o pareja') >= 0) out.push('Ideal para vivir solo o en pareja.');
    if (who.indexOf('Familia grande') >= 0 || who.indexOf('Familia pequeña') >= 0) out.push('Pensada para familia: espacio para todos' + (n(o.parking) >= 2 ? ' y cochera para dos autos' : '') + '.');
    if (n(o.min_term)) out.push('Contrato mínimo de ' + n(o.min_term) + ' meses.');
    out.push('Agenda tu visita en línea y un asesor te confirma por WhatsApp.');
    return out.join(' ');
  }

  return { slugify, money, seoAuto, seoChecks, cleanSlug, suggestDescription };
}));
