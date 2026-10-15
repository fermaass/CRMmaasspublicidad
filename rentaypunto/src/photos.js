// Fotos de las propiedades: el panel las achica en el celular antes de subirlas (grande ~1600 px y miniatura ~640 px).
// Se guardan en el volumen del servidor y, si hay almacenamiento externo (R2), también se copian allá como respaldo.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { putObject } = require('./offsite');

const MAX_BYTES = 4 * 1024 * 1024;

function fromDataUrl(v) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''));
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  // Solo JPEG de verdad (empieza con FF D8 FF), no cualquier archivo con otra extensión.
  if (buf.length < 100 || buf.length > MAX_BYTES || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  return buf;
}

function photoStore(dir, offsite, log = console, folder = 'fotos') {
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    // Devuelve el nombre base, o null si las imágenes no son válidas.
    save(propertyId, bigDataUrl, smallDataUrl) {
      const big = fromDataUrl(bigDataUrl); const small = fromDataUrl(smallDataUrl);
      if (!big || !small) return null;
      const name = `p${propertyId}-${crypto.randomBytes(6).toString('hex')}`;
      fs.writeFileSync(path.join(dir, `${name}.jpg`), big);
      fs.writeFileSync(path.join(dir, `${name}-sm.jpg`), small);
      if (offsite) {
        for (const [suffix, buf] of [['', big], ['-sm', small]]) {
          putObject(`${offsite.prefix}/${folder}/${name}${suffix}.jpg`, buf, 'image/jpeg', offsite)
            .catch((err) => log.error('No se pudo copiar la foto al almacenamiento externo:', err.message));
        }
      }
      return name;
    },
    path(name, small) { return path.join(dir, `${name}${small ? '-sm' : ''}.jpg`); },
    remove(name) {
      for (const f of [`${name}.jpg`, `${name}-sm.jpg`]) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ya no existe */ } }
    },
  };
}

module.exports = { photoStore, fromDataUrl };
