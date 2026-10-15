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

  return { slugify, money, seoAuto, seoChecks, cleanSlug };
}));
