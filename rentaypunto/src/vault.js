// Bóveda de documentos sensibles (INE, constancia fiscal, comprobantes, predial): se guardan cifrados con AES-256-GCM.
// La llave vive solo en Railway (DOCS_KEY), nunca en el código ni en la base: si alguien copia el disco o un respaldo,
// los archivos no se pueden leer sin ella. Si se pierde la llave, los documentos no se recuperan (guárdala en tu gestor de contraseñas).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { putObject, deleteObject } = require('./offsite');

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = [
  ['application/pdf', [0x25, 0x50, 0x44, 0x46], 'pdf'], // %PDF
  ['image/jpeg', [0xff, 0xd8, 0xff], 'jpg'],
  ['image/png', [0x89, 0x50, 0x4e, 0x47], 'png'],
];

// Acepta la llave en base64 (44 caracteres) o hex (64). null si no hay o no sirve.
function parseKey(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const k = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  return k.length === 32 ? k : null;
}
// El tipo se decide por el contenido del archivo, no por su nombre.
function sniff(buf) {
  const t = TYPES.find(([, magic]) => magic.every((b, i) => buf[i] === b));
  return t ? { mime: t[0], ext: t[2] } : null;
}

function vault(dir, key, offsite, log = console) {
  if (key) fs.mkdirSync(dir, { recursive: true });
  return {
    enabled: Boolean(key),
    // Guarda el archivo cifrado. Devuelve { file, iv, tag, mime, size } o { error }.
    put(buf) {
      if (!key) return { error: 'La bóveda de documentos no está activa (falta DOCS_KEY).' };
      if (!buf || !buf.length) return { error: 'El archivo está vacío.' };
      if (buf.length > MAX_BYTES) return { error: 'El archivo pesa más de 8 MB. Toma la foto de nuevo o usa un PDF más ligero.' };
      const t = sniff(buf);
      if (!t) return { error: 'Solo se aceptan PDF, JPG o PNG.' };
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(buf), c.final()]);
      const file = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(path.join(dir, `${file}.bin`), enc);
      if (offsite) putObject(`${offsite.prefix}/docs/${file}.bin`, enc, 'application/octet-stream', offsite).catch((err) => log.error('No se pudo copiar el documento cifrado al almacenamiento externo:', err.message));
      return { file, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), mime: t.mime, ext: t.ext, size: buf.length };
    },
    get(doc) {
      if (!key) throw new Error('Falta DOCS_KEY');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(doc.iv, 'base64'));
      d.setAuthTag(Buffer.from(doc.tag, 'base64'));
      return Buffer.concat([d.update(fs.readFileSync(path.join(dir, `${doc.file}.bin`))), d.final()]);
    },
    // Borra el archivo aquí y su copia externa (para cumplir cuando alguien pide que se eliminen sus datos).
    remove(file) {
      try { fs.unlinkSync(path.join(dir, `${file}.bin`)); } catch { /* ya no existe */ }
      if (offsite) deleteObject(`${offsite.prefix}/docs/${file}.bin`, offsite).catch((err) => log.error('No se pudo borrar la copia externa del documento:', err.message));
    },
    exists(file) { return fs.existsSync(path.join(dir, `${file}.bin`)); },
  };
}

module.exports = { vault, parseKey, sniff, MAX_BYTES };
