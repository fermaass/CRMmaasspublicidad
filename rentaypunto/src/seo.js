// SEO: lo automático vive en public/panel/seo-shared.js (lo comparten servidor y panel). Aquí, los datos estructurados.
const shared = require('../public/panel/seo-shared.js');

function jsonLd(p, url, photos) {
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: p.seo_title,
    url,
    description: p.seo_desc,
    datePosted: String(p.published_at || p.created_at || '').slice(0, 10),
    image: photos.length ? photos : undefined,
    offers: { '@type': 'Offer', price: p.rent, priceCurrency: 'MXN' },
    about: {
      '@type': 'Accommodation',
      numberOfBedrooms: p.bedrooms || undefined,
      numberOfBathroomsTotal: p.bathrooms || undefined,
      floorSize: p.m2 ? { '@type': 'QuantitativeValue', value: p.m2, unitCode: 'MTK' } : undefined,
      address: { '@type': 'PostalAddress', addressLocality: p.zone, addressRegion: 'Querétaro', addressCountry: 'MX' },
    },
  };
}

module.exports = { ...shared, jsonLd };
