const test = require('node:test');
const assert = require('node:assert');
const { start, client, owner } = require('./helpers');

const site = (t) => client(t.base, '');
const base = { zone_id: 1, colonia: 'Cerca de la UAQ', m2: 60, bathrooms: 1, status: 'disponible',
  description: 'Departamento iluminado con cocina equipada, a unos minutos de plazas, transporte y universidades de la zona norte.' };

test('páginas por búsqueda: estudiantes, familias, mascotas; solo existen con propiedades y se indexan con 2 o más', async (t) => {
  const app = await start(); t.after(app.close);
  const d = await owner(app);
  await d.post('/api/properties', { ...base, title: 'Depto. amueblado para estudiante', prop_type: 'Departamento', rent: 8500, bedrooms: 1, extras: ['Amueblado'], includes: ['Internet'] });
  await d.post('/api/properties', { ...base, title: 'Depto. de 1 recámara', prop_type: 'Departamento', rent: 9500, bedrooms: 1, extras: ['Mascotas'] });
  await d.post('/api/properties', { ...base, title: 'Casa para familia con jardín', prop_type: 'Casa', rent: 21000, bedrooms: 3, bathrooms: 2, m2: 160, extras: ['Mascotas', 'Estacionamiento'], zone_id: 2 });
  const pub = site(app);

  const est = await pub.get('/renta/juriquilla/departamentos-para-estudiantes');
  assert.equal(est.status, 200);
  assert.match(est.text, /<h1 class="zt">Departamentos en renta para estudiantes en Juriquilla<\/h1>/);
  assert.match(est.text, /tu hijo o hija que se muda/);
  assert.match(est.text, /"@type":"FAQPage"/);
  assert.match(est.text, /"@type":"ItemList"/);
  assert.ok(!est.text.includes('Casa para familia'), 'solo las que le quedan a esa búsqueda');
  assert.ok(!/name="robots" content="noindex"/.test(est.text), '2 propiedades: se indexa');

  const fam = await pub.get('/renta/el-refugio/para-familias');
  assert.equal(fam.status, 200);
  assert.match(fam.text, /name="robots" content="noindex"/, 'con una sola propiedad no se indexa');
  assert.equal((await pub.get('/renta/el-refugio/departamentos-para-estudiantes')).status, 302, 'sin propiedades: manda a la zona');
  assert.equal((await pub.get('/renta/juriquilla/no-existe')).status, 404);

  // Querétaro completo
  const city = await pub.get('/renta/queretaro/que-aceptan-mascotas');
  assert.match(city.text, /Rentas que aceptan mascotas en Querétaro/);
  assert.match(city.text, /perro o gato/);
  assert.match(city.text, /en otras zonas/);
  const cz = await pub.get('/renta/queretaro');
  assert.equal(cz.status, 200);
  assert.match(cz.text, /Casas y departamentos en renta en Querétaro<\/h1>/);

  // Portada: enlaces por intención y FAQ con marcado
  const home = (await pub.get('/')).text;
  assert.match(home, /href="\/renta\/queretaro\/departamentos-para-estudiantes"/);
  assert.match(home, /mi hijo que viene a estudiar/);
  assert.match(home, /"@type":"FAQPage"/);
  assert.match(home, /"@type":"RealEstateAgent"/);

  // Ficha: "Ideal para" enlaza a su búsqueda; FAQ con datos de la propiedad
  const props = (await d.get('/api/properties')).body;
  const f = (await pub.get(`/${props.find((p) => p.title.startsWith('Depto. amueblado')).seo_slug}`)).text;
  assert.match(f, /href="\/renta\/juriquilla\/departamentos-para-estudiantes"/);
  assert.match(f, /¿Cuánto necesito para entrar a depto\. amueblado para estudiante\?/);
  assert.match(f, /Más rentas en Juriquilla/);

  // Mapa del sitio: páginas por búsqueda indexables, imágenes y Querétaro
  const map = (await pub.get('/sitemap.xml')).text;
  assert.match(map, /xmlns:image=/);
  assert.ok(map.includes('/renta/juriquilla/departamentos-para-estudiantes<'));
  assert.ok(!map.includes('/renta/el-refugio/para-familias<'), 'la de una sola propiedad no va');
  assert.ok(map.includes('/renta/queretaro<'));
  const robots = (await pub.get('/robots.txt')).text;
  assert.match(robots, /Disallow: \/expediente\//);
});

test('texto de zona editable, nombre reservado y lista de páginas en el panel', async (t) => {
  const app = await start(); t.after(app.close);
  const d = await owner(app);
  await d.post('/api/properties', { ...base, title: 'Depto. 1', prop_type: 'Departamento', rent: 9000, bedrooms: 1 });
  assert.equal((await d.patch('/api/zones/1', { intro: 'Juriquilla es una zona tranquila al norte de la ciudad.', near: 'UNAM, UAQ, Antea' })).status, 200);
  const z = (await site(app).get('/renta/juriquilla')).text;
  assert.match(z, /zona tranquila al norte/);
  assert.match(z, /UNAM, UAQ, Antea/);
  assert.equal((await d.post('/api/zones', { name: 'Querétaro' })).status, 400);
  const seo = (await d.get('/api/seo')).body;
  assert.equal(seo.pages[0].slug, 'queretaro');
  assert.ok(seo.pages.find((p) => p.slug === 'juriquilla').landings.some((l) => l.path === '/renta/juriquilla/1-recamara'));
  assert.equal((await d.patch('/api/settings', { social_links: 'facebook.com/x' })).status, 400);
  await d.patch('/api/settings', { social_links: 'https://www.facebook.com/rentaypunto https://www.instagram.com/rentaypunto' });
  assert.match((await site(app).get('/')).text, /"sameAs":\["https:\/\/www\.facebook\.com\/rentaypunto"/);
});

test('IndexNow: avisa al publicar y al cambiar, con la llave publicada en el sitio', async (t) => {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.indexnow.org/')) { calls.push(JSON.parse(opts.body)); return new Response('', { status: 202 }); }
    return orig(url, opts);
  };
  t.after(() => { global.fetch = orig; });
  const app = await start({ indexNow: true, indexNowDelay: 10 }); t.after(app.close);
  const d = await owner(app);
  const p = (await d.post('/api/properties', { ...base, title: 'Depto. 1', rent: 9000, bedrooms: 1, status: 'borrador' })).body;
  await new Promise((ok) => setTimeout(ok, 40));
  assert.equal(calls.length, 0, 'un borrador no se avisa');
  await d.post(`/api/properties/${p.id}/status`, { status: 'disponible' });
  await new Promise((ok) => setTimeout(ok, 60));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, 'www.rentaypunto.com');
  assert.ok(calls[0].urlList.includes(`https://www.rentaypunto.com/${p.seo_slug}`));
  assert.ok(calls[0].urlList.includes('https://www.rentaypunto.com/renta/juriquilla'));
  const keyFile = await site(app).get(`/${calls[0].key}.txt`);
  assert.equal(keyFile.text, calls[0].key);
  assert.equal((await site(app).get('/otra.txt')).status, 404);
  await d.patch(`/api/properties/${p.id}`, { zone_id: 3 });
  await new Promise((ok) => setTimeout(ok, 60));
  assert.ok(calls[1].urlList.includes(`https://www.rentaypunto.com/${p.seo_slug}`), 'la URL vieja también, para que vean la redirección');
});
