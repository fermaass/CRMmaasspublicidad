// Páginas por intención de búsqueda: "departamento para estudiante", "renta para una persona", "casa para familia con mascotas"...
// Se arman solas con las propiedades publicadas. Una página solo existe si tiene propiedades, y solo se indexa si tiene 2 o más
// (con una sola sería una página "delgada" para Google). Los textos describen la propiedad, nunca excluyen a nadie.
const MATCH = require('../public/sitio/match.js');
const { money } = require('./seo');

const CITY = { slug: 'queretaro', name: 'Querétaro' };
const MIN_INDEX = 2;

const isHouse = (p) => (p.prop_type ? p.prop_type === 'Casa' : /\bcasa\b/i.test(p.title));
const isFlat = (p) => (p.prop_type ? ['Departamento', 'Estudio'].includes(p.prop_type) : /depa|departamento|estudio|loft/i.test(p.title));
const has = (p, x) => (p.extras || []).includes(x);
const ideal = (p, who) => MATCH.ideal(p).includes(who);
const where = (z) => (z.slug === CITY.slug ? 'Querétaro' : `${z.name}, Querétaro`);

// Cada página: a quién le habla, con qué palabras busca esa persona y qué preguntas se hace.
// h1/title reciben el lugar ("Juriquilla" o "Querétaro"); intro recibe {lugar, n, min, max}.
const LANDINGS = [
  {
    key: 'departamentos-para-estudiantes', short: 'Para estudiantes', who: 'Estudiante o joven',
    match: (p) => ideal(p, 'Estudiante o joven'),
    h1: (l) => `Departamentos en renta para estudiantes en ${l}`,
    intro: (x) => `¿Vienes a estudiar a ${x.lugar} o buscas un departamento para tu hijo o hija que se muda a la ciudad? Reunimos ${x.n} opción(es) pensadas para estudiantes y jóvenes: espacios de 1 y 2 recámaras, amueblados o con renta accesible, desde ${money(x.min)} al mes. Cada ficha te dice cuánto necesitas para entrar, qué servicios incluye y qué hay cerca, y puedes agendar la visita en línea aunque estés en otro estado.`,
    faq: [
      ['Mi hijo viene de otro estado, ¿podemos agendar la visita a distancia?', 'Sí. Agendas desde la ficha y el asesor confirma por WhatsApp. El resumen de cada propiedad se puede compartir por WhatsApp con quien va a pagar la renta, para decidir juntos antes de la visita.'],
      ['¿Qué documentos piden para rentar?', 'INE, Constancia de Situación Fiscal y comprobante de ingresos. Si el estudiante no tiene ingresos propios, pregunta a tu asesor si puede respaldarlo un aval; los requisitos de cada propiedad están en su ficha.'],
      ['¿Hay departamentos amueblados para estudiantes?', 'Sí, usa el filtro Amueblado o revisa la etiqueta en cada ficha. Algunos incluyen agua, luz o internet en la renta.'],
    ],
  },
  {
    key: 'para-una-persona-o-pareja', short: 'Para una persona o pareja', who: 'Una persona o pareja',
    match: (p) => ideal(p, 'Una persona o pareja'),
    h1: (l) => `Rentas para una persona o pareja en ${l}`,
    intro: (x) => `Si vas a rentar solo o en pareja, no necesitas pagar por espacio que no vas a usar. Aquí están ${x.n} departamento(s) y estudio(s) en ${x.lugar} del tamaño justo para una o dos personas, desde ${money(x.min)} al mes, con el costo de entrada calculado y la opción de agendar tu visita en minutos.`,
    faq: [
      ['¿Cuánto necesito para entrar a rentar?', 'El primer mes de renta, el depósito y, si aplica, el mantenimiento. Cada ficha lo calcula en "Cuánto necesitas".'],
      ['¿Puedo rentar si trabajo por mi cuenta?', 'Pregúntale a tu asesor: cada propietario define qué comprobantes de ingresos acepta (nómina, estados de cuenta o declaraciones).'],
    ],
  },
  {
    key: 'para-familias', short: 'Para familias', who: 'Familia',
    match: (p) => ideal(p, 'Familia pequeña') || ideal(p, 'Familia grande'),
    h1: (l) => `Casas y departamentos en renta para familias en ${l}`,
    intro: (x) => `Buscar casa para la familia es otra cosa: recámaras suficientes, cochera, seguridad y escuelas cerca. Estas ${x.n} propiedad(es) en ${x.lugar} tienen espacio para familia, desde ${money(x.min)} hasta ${money(x.max)} al mes. Revisa en cada ficha cuántas personas caben, si tiene privada o vigilancia y qué hay alrededor.`,
    faq: [
      ['¿Aceptan mascotas?', 'Depende de cada propiedad. Busca la etiqueta Mascotas o entra a la página de rentas que aceptan mascotas.'],
      ['¿Hay casas en privada con seguridad?', 'Sí, usa el filtro Seguridad 24h o revisa la nota "Cerca de" y "Considera" en cada ficha.'],
    ],
  },
  {
    key: 'que-aceptan-mascotas', short: 'Aceptan mascotas',
    match: (p) => has(p, 'Mascotas'),
    h1: (l) => `Rentas que aceptan mascotas en ${l}`,
    intro: (x) => `¿Tienes perro o gato y no quieres dejarlo? Estas ${x.n} casa(s) y departamento(s) en ${x.lugar} indican que aceptan mascotas, desde ${money(x.min)} al mes. Las condiciones (tamaño, cuántas, depósito adicional) las confirma tu asesor antes de la visita.`,
    faq: [
      ['¿Cobran depósito extra por la mascota?', 'Algunos propietarios sí. Tu asesor te lo confirma antes de la visita para que no haya sorpresas.'],
      ['¿Aceptan perros grandes?', 'Depende de cada propiedad: las casas con patio o jardín suelen ser la mejor opción. Pregúntalo al agendar.'],
    ],
  },
  {
    key: 'amueblados', short: 'Amueblados',
    match: (p) => has(p, 'Amueblado'),
    h1: (l) => `Departamentos y casas amueblados en renta en ${l}`,
    intro: (x) => `Si te mudas a ${x.lugar} por trabajo, por un proyecto o vienes de otra ciudad, un lugar amueblado te deja llegar solo con tu maleta. Hay ${x.n} opción(es) amuebladas desde ${money(x.min)} al mes; en cada ficha ves qué servicios incluye la renta y el plazo mínimo del contrato.`,
    faq: [
      ['¿Rentan por menos de un año?', 'Algunas propiedades aceptan contratos de 6 meses. El plazo mínimo aparece en cada ficha.'],
      ['¿Qué incluye "amueblado"?', 'Cada propiedad tiene su propio inventario: pídeselo a tu asesor antes de la visita. Al rentar se revisa pieza por pieza en el acta de entrega.'],
    ],
  },
  {
    key: 'con-servicios-incluidos', short: 'Servicios incluidos',
    match: (p) => (p.includes || []).some((x) => ['Agua', 'Luz', 'Gas', 'Internet'].includes(x)),
    h1: (l) => `Rentas con servicios incluidos en ${l}`,
    intro: (x) => `Pagar un solo monto al mes y olvidarte de recibos: estas ${x.n} propiedad(es) en ${x.lugar} incluyen en la renta agua, luz, gas o internet (cada ficha dice cuáles). Ideal si es tu primer depa, si vienes a estudiar o si quieres tener claro tu gasto mensual.`,
    faq: [['¿Cómo sé qué servicios incluye?', 'En la ficha, la sección "Qué incluye" marca cada servicio como incluido o por tu cuenta.']],
  },
  {
    key: 'economicas', short: 'Económicas',
    match: (p) => p.rent <= 12000,
    h1: (l) => `Rentas económicas en ${l}: hasta $12,000 al mes`,
    intro: (x) => `Rentar barato en ${x.lugar} sin sorpresas: ${x.n} propiedad(es) de hasta $12,000 al mes, desde ${money(x.min)}. En cada ficha está el costo de entrada completo (primer mes, depósito y mantenimiento) para que sepas cuánto necesitas desde el principio.`,
    faq: [['¿El mantenimiento va incluido?', 'Depende de cada propiedad: la ficha te dice si va incluido o cuánto es aparte.']],
  },
  {
    key: 'casas', short: 'Casas', match: isHouse,
    h1: (l) => `Casas en renta en ${l}`,
    intro: (x) => `${x.n} casa(s) en renta en ${x.lugar}, desde ${money(x.min)} hasta ${money(x.max)} al mes. Fichas completas con recámaras, cochera, si aceptan mascotas, costo de entrada y lo que hay cerca. Agenda tu visita en línea y un asesor te confirma por WhatsApp.`,
    faq: [],
  },
  {
    key: 'departamentos', short: 'Departamentos', match: isFlat,
    h1: (l) => `Departamentos en renta en ${l}`,
    intro: (x) => `${x.n} departamento(s) en renta en ${x.lugar}, desde ${money(x.min)} al mes. Revisa recámaras, estacionamiento, seguridad y qué incluye la renta, y agenda tu visita en minutos.`,
    faq: [],
  },
  ...[1, 2, 3].map((n) => ({
    key: `${n}-recamara${n > 1 ? 's' : ''}`, short: `${n} recámara${n > 1 ? 's' : ''}`,
    match: (p) => Number(p.bedrooms) === n,
    h1: (l) => `Rentas de ${n} recámara${n > 1 ? 's' : ''} en ${l}`,
    intro: (x) => `${x.n} casa(s) y departamento(s) de ${n} recámara${n > 1 ? 's' : ''} en renta en ${x.lugar}, desde ${money(x.min)} al mes${n === 1 ? ': lo justo si vas a vivir solo o en pareja' : n === 3 ? ': espacio para familia o para tener un estudio en casa' : ''}.`,
    faq: [],
  })),
];
const BY_KEY = Object.fromEntries(LANDINGS.map((l) => [l.key, l]));

function build(def, zone, props) {
  const list = props.filter(def.match);
  const rents = list.map((p) => p.rent);
  const lugar = where(zone);
  const placeShort = zone.slug === CITY.slug ? 'Querétaro' : zone.name;
  const h1 = def.h1(placeShort);
  return {
    key: def.key, short: def.short, zone, list, n: list.length, indexable: list.length >= MIN_INDEX,
    path: `/renta/${zone.slug}/${def.key}`,
    h1,
    title: `${h1}${h1.length <= 46 ? ' | Rentaypunto' : ''}`.slice(0, 60),
    intro: list.length ? def.intro({ lugar, n: list.length, min: Math.min(...rents), max: Math.max(...rents) }) : '',
    faq: def.faq,
  };
}
// Las páginas que existen para un lugar (Querétaro completo o una zona), con cuántas propiedades tiene cada una.
function landingsFor(zone, props) {
  return LANDINGS.map((d) => build(d, zone, props)).filter((l) => l.n > 0);
}
function landing(key, zone, props) {
  const d = BY_KEY[key];
  return d ? build(d, zone, props) : null;
}
// Para enlazar desde la ficha: "Ideal para estudiantes" lleva a su página.
const IDEAL_LINK = { 'Estudiante o joven': 'departamentos-para-estudiantes', 'Una persona o pareja': 'para-una-persona-o-pareja', 'Familia pequeña': 'para-familias', 'Familia grande': 'para-familias' };

module.exports = { CITY, LANDINGS, landingsFor, landing, IDEAL_LINK, MIN_INDEX };
