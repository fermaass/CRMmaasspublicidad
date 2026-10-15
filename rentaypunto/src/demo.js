// Propiedades de ejemplo para el servicio de PRUEBAS (variable SEED_DEMO=true). Nunca en el sitio real.
const { seoAuto } = require('./seo');

const DEMO = [
  ['Depto. con vista al parque', 'Juriquilla', 'Cerca del parque lineal', 14500, 1, 900, 85, 2, 2, 1, 4, 12, ['Estacionamiento', 'Seguridad 24h'], ['Agua'], 'disponible', 'Piso 3 con cocina integral y vista al parque. A pocos minutos de comercios, escuelas y el parque lineal de la zona.', 'Póliza jurídica'],
  ['Casa familiar en privada', 'El Refugio', 'Privada con caseta', 19800, 1, 1200, 160, 3, 2, 2, 6, 12, ['Mascotas', 'Estacionamiento'], [], 'disponible', 'Jardín y cochera para 2 autos. Privada tranquila con áreas verdes y vigilancia en la entrada, cerca de escuelas.', 'Aval'],
  ['Estudio amueblado', 'Centro Sur', 'Cerca de plazas comerciales', 8900, 1, 500, 42, 1, 1, 0, 2, 6, ['Amueblado'], ['Agua', 'Luz', 'Internet'], 'disponible', 'Ideal para una persona o pareja. Amueblado, con servicios incluidos y a pasos de plazas comerciales.', 'Fiador'],
  ['Casa nueva en Zibatá', 'Zibatá', 'Cerca de escuelas', 23500, 2, 1500, 190, 4, 3, 2, 7, 12, ['Mascotas', 'Seguridad 24h'], [], 'apartada', 'Casa nueva con cuatro recámaras y acabados modernos. Cerca de escuelas y áreas verdes del fraccionamiento.', 'Póliza jurídica'],
  ['Depto. moderno Milenio', 'Milenio III', 'Acceso controlado', 12000, 1, 700, 70, 2, 1, 1, 4, 12, ['Estacionamiento'], ['Mantenimiento', 'Internet'], 'disponible', 'Departamento moderno en edificio con acceso controlado, cerca de avenidas principales y supermercados.', 'Póliza jurídica'],
  ['Casa en Cumbres del Lago', 'Cumbres del Lago', 'Frente al club', 17500, 1, 1000, 120, 3, 2, 2, 5, 12, ['Mascotas', 'Estacionamiento'], [], 'disponible', 'Casa con patio, cochera techada y cercanía al club de la zona. Fraccionamiento con vigilancia.', 'Aval'],
];

function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM properties').get().n > 0) return false;
  const zone = db.prepare('SELECT * FROM zones WHERE name = ?');
  const ins = db.prepare(`INSERT INTO properties (code, title, zone_id, colonia, rent, deposit_months, maintenance, m2, bedrooms, bathrooms, parking, max_occupants, min_term,
    extras, includes, status, description, requirements, seo_slug, seo_title, seo_desc, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  DEMO.forEach((d, i) => {
    const [title, zn, colonia, rent, dep, mant, m2, rec, ban, park, ocu, term, extras, includes, status, desc, req] = d;
    const z = zone.get(zn);
    const code = `RP-${String(i + 1).padStart(4, '0')}`;
    const s = seoAuto({ title: `${title} (ejemplo)`, zone: zn, rent, m2, bedrooms: rec, bathrooms: ban, extras, code });
    ins.run(code, `${title} (ejemplo)`, z.id, colonia, rent, dep, mant, m2, rec, ban, park, ocu, term, JSON.stringify(extras), JSON.stringify(includes), status, desc, req, s.slug, s.title, s.desc, new Date().toISOString());
  });
  return true;
}

module.exports = { seedDemo };
