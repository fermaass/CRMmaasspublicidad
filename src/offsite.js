// Copia de los respaldos FUERA del servidor (Cloudflare R2 o cualquier almacenamiento compatible con S3).
// Si el servidor o su volumen se pierden, la información sigue a salvo. Firma AWS Signature V4, sin dependencias.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const sha256hex = (v) => crypto.createHash('sha256').update(v).digest('hex');
const hmac = (key, v) => crypto.createHmac('sha256', key).update(v).digest();
// Codificación de URI que pide AWS (encodeURIComponent deja sin codificar !'()*).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Devuelve los encabezados firmados (incluye authorization). headers: los que se firman, además de host y x-amz-date.
function signV4({ method, url, headers = {}, payloadHash, accessKey, secretKey, region, service, amzDate }) {
  const u = new URL(url);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), host: u.host, 'x-amz-date': amzDate };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalPath = u.pathname.split('/').map((seg) => enc(decodeURIComponent(seg))).join('/') || '/';
  const canonicalQuery = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

// fetch solo dice "fetch failed" cuando no logra conectar; el motivo real (dirección que no existe, certificado, etc.) viene en err.cause.
async function send(fetchImpl, url, opts) {
  try { return await fetchImpl(url, opts); } catch (err) {
    const c = err.cause;
    const why = c?.code === 'ENOTFOUND' ? `no existe la dirección ${c.hostname || new URL(url).host}: revisa BACKUP_S3_ENDPOINT`
      : c ? `${c.code || ''} ${c.message || ''}`.trim() : '';
    throw new Error(why ? `No se pudo conectar al almacenamiento (${why})` : err.message);
  }
}

// Configuración desde variables de entorno. null si no está completa.
function offsiteConfig(env = process.env) {
  const { BACKUP_S3_ENDPOINT: endpoint, BACKUP_S3_BUCKET: bucket, BACKUP_S3_KEY_ID: accessKey, BACKUP_S3_SECRET: secretKey } = env;
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  const prefix = (env.BACKUP_S3_PREFIX || env.RAILWAY_SERVICE_NAME || 'crm').replace(/[^\w.-]+/g, '-');
  // Se perdonan errores comunes al copiar: espacios, comillas, sin https:// o con el nombre del bucket al final.
  let ep = String(endpoint).trim().replace(/^["']|["']$/g, '').trim();
  if (!/^https?:\/\//i.test(ep)) ep = `https://${ep}`;
  try { ep = new URL(ep).origin; } catch { /* se queda como está y el error lo dirá */ }
  return { endpoint: ep, bucket: String(bucket).trim(), accessKey: String(accessKey).trim(), secretKey: String(secretKey).trim(), region: env.BACKUP_S3_REGION || 'auto', prefix };
}

// Sube un respaldo comprimido. Devuelve la ruta en el almacenamiento.
async function uploadBackup(file, cfg, fetchImpl = fetch) {
  const body = zlib.gzipSync(fs.readFileSync(file));
  const key = `${cfg.prefix}/${path.basename(file)}.gz`;
  const url = `${cfg.endpoint}/${enc(cfg.bucket)}/${key.split('/').map(enc).join('/')}`;
  const payloadHash = sha256hex(body);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const headers = signV4({ method: 'PUT', url, payloadHash, accessKey: cfg.accessKey, secretKey: cfg.secretKey, region: cfg.region, service: 's3', amzDate,
    headers: { 'content-type': 'application/gzip', 'x-amz-content-sha256': payloadHash } });
  delete headers.host; // lo pone fetch
  const r = await send(fetchImpl, url, { method: 'PUT', headers, body, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`El almacenamiento respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return key;
}

// Baja un respaldo del almacenamiento (para restaurar). key = la ruta dentro del bucket, p. ej. maass/crm-2026-10-01.db.gz
async function downloadBackup(key, cfg, fetchImpl = fetch) {
  const url = `${cfg.endpoint}/${enc(cfg.bucket)}/${String(key).split('/').map(enc).join('/')}`;
  const payloadHash = sha256hex('');
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const headers = signV4({ method: 'GET', url, payloadHash, accessKey: cfg.accessKey, secretKey: cfg.secretKey, region: cfg.region, service: 's3', amzDate,
    headers: { 'x-amz-content-sha256': payloadHash } });
  delete headers.host;
  const r = await send(fetchImpl, url, { headers, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`El almacenamiento respondió ${r.status} al bajar ${key}`);
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { signV4, offsiteConfig, uploadBackup, downloadBackup, sha256hex };
