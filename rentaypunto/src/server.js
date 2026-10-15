// Rentaypunto: un solo programa con dos aplicaciones separadas.
//  - Sitio público en SITE_URL (rentaypunto.com), sin login.
//  - Panel interno en PANEL_HOST (panel.rentaypunto.com), con login. Si no hay PANEL_HOST (pruebas), el panel vive en /panel/.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { openDb, getSetting, setSetting, STAGE_LABELS } = require('./db');
const { siteRouter } = require('./site');
const { panelRouter } = require('./panel');
const { photoStore } = require('./photos');
const { mailer } = require('./notify');
const { offsiteConfig, uploadBackup } = require('./offsite');
const { dailyBackup } = require('./backup');
const { seedDemo } = require('./demo');
const { metaCapi } = require('./meta');
const { vault, parseKey } = require('./vault');
const { whatsapp } = require('./whatsapp');
const { indexNow } = require('./indexnow');
const { originGuard, baseHeaders, siteCsp, panelCsp } = require('./security');

function loadConfig(env = process.env) {
  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
  const dataDir = env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');
  const trim = (v) => String(v || '').trim().replace(/\/+$/, '');
  return {
    port: Number(env.PORT) || 3000,
    dataDir,
    dbPath: env.DB_PATH || path.join(dataDir, 'rentaypunto.db'),
    storageWarning: onRailway && !env.RAILWAY_VOLUME_MOUNT_PATH && !env.DATA_DIR,
    siteUrl: trim(env.SITE_URL), // p. ej. https://www.rentaypunto.com (para URLs canónicas, mapa del sitio y Open Graph)
    panelHost: trim(env.PANEL_HOST).replace(/^https?:\/\//, '').toLowerCase(), // p. ej. panel.rentaypunto.com
    cookieSecure: env.COOKIE_SECURE === 'true' || onRailway,
    setupCode: env.SETUP_CODE,
    resendKey: env.RESEND_API_KEY,
    mailFrom: env.MAIL_FROM, // p. ej. "Rentaypunto <avisos@rentaypunto.com>"
    mfaOff: env.MFA_OFF === 'true', // solo para pruebas locales
    metaToken: env.META_CAPI_TOKEN, // token de la API de Conversiones (Administrador de eventos de Meta)
    metaApiVersion: env.META_API_VERSION || 'v23.0',
    metaTestCode: env.META_TEST_EVENT_CODE, // solo para probar en el Administrador de eventos
    docsKey: parseKey(env.DOCS_KEY), // llave de la bóveda de documentos (32 bytes en base64)
    docsKeyInvalid: Boolean(env.DOCS_KEY) && !parseKey(env.DOCS_KEY),
    waToken: env.WA_TOKEN, // WhatsApp Cloud API: token permanente del usuario del sistema
    waPhoneId: env.WA_PHONE_ID, // ID del número de WhatsApp Business
    waLang: env.WA_LANG || 'es_MX',
    // Candado de origen: el mismo valor se pone en Cloudflare (Reglas → Transformación → encabezado X-Origin-Auth). Ver SEGURIDAD.md.
    originSecret: env.ORIGIN_SECRET && env.ORIGIN_SECRET.length >= 24 ? env.ORIGIN_SECRET : null,
    version: `${require('../package.json').version}-${Date.now().toString(36)}`,
  };
}

function logError(db, place, message) {
  try {
    db.prepare('INSERT INTO ops_errors (at, place, message) VALUES (?, ?, ?)').run(new Date().toISOString(), String(place).slice(0, 120), String(message).slice(0, 300));
    db.prepare('DELETE FROM ops_errors WHERE id <= (SELECT MAX(id) - 300 FROM ops_errors)').run();
  } catch { /* el registro de fallas nunca debe tumbar la app */ }
}

function createApp({ db, config, mail = mailer(config), photos = photoStore(path.join(config.dataDir, 'fotos'), offsiteConfig()), meta = metaCapi(config),
  actas = photoStore(path.join(config.dataDir, 'actas'), offsiteConfig(), console, 'actas'),
  vlt = vault(path.join(config.dataDir, 'docs'), config.docsKey, offsiteConfig()), wa = whatsapp(db, config), seo = indexNow(db, config) }) {
  ensureSetupCode(db, config);
  const panelBase = () => (config.panelHost ? `https://${config.panelHost}` : `${config.siteUrl || ''}/panel`);
  const managers = () => db.prepare("SELECT email FROM users WHERE active = 1 AND role IN ('gerente','dueno')").all().map((u) => u.email);
  const extra = () => getSetting(db, 'notify_email', '');
  const notify = { staff: (subject, text) => mail.send([...managers(), extra()].filter(Boolean), `Rentaypunto · ${subject}`, text) };
  // Aviso de lead nuevo: al asesor de la propiedad; si no tiene, a Gerente y Dueño.
  const onLead = (id, reassigned) => {
    const l = db.prepare(`SELECT l.*, p.code, p.title, u.email AS advisor_email, u.name AS advisor_name FROM leads l
      LEFT JOIN properties p ON p.id = l.property_id LEFT JOIN users u ON u.id = l.advisor_id WHERE l.id = ?`).get(id);
    if (!l) return;
    const to = l.advisor_email ? [l.advisor_email] : managers();
    const text = `${reassigned ? 'Te asignaron un lead' : 'Nuevo lead'}: ${l.name} (WhatsApp ${l.phone})\n`
      + `Propiedad: ${l.code ? `${l.code} · ${l.title}` : '—'}\nVisita: ${l.visit_date || '—'} ${l.visit_time || ''}\nEtapa: ${STAGE_LABELS[l.stage]}\nOrigen: ${l.origin}\n`
      + `${l.search_context ? `Busca: ${l.search_context}\n` : ''}${l.advisor_name ? '' : 'Sin asesor asignado: asígnalo en el panel.\n'}\nÁbrelo en el panel: ${panelBase()}/`;
    wa.onLead(id);
    mail.send([...to, reassigned ? '' : extra()].filter(Boolean), `Rentaypunto · ${reassigned ? 'Lead asignado' : 'Nuevo lead'}: ${l.name}${l.code ? ` · ${l.code}` : ''}`, text);
  };

  // Expediente, documentos de propietario o comprobante recibido: aviso al asesor (o a Gerente y Dueño si no hay asesor).
  const onFileReceived = (type, id) => {
    const row = type === 'lead' ? db.prepare('SELECT l.name, u.email FROM leads l LEFT JOIN users u ON u.id = l.advisor_id WHERE l.id = ?').get(id)
      : type === 'owner' ? db.prepare('SELECT o.name, u.email FROM owners o LEFT JOIN users u ON u.id = o.advisor_id WHERE o.id = ?').get(id)
        : db.prepare('SELECT p.code AS name, u.email FROM properties p LEFT JOIN users u ON u.id = p.advisor_id WHERE p.id = ?').get(id);
    if (!row) return;
    const what = type === 'lead' ? 'envió su expediente' : type === 'owner' ? 'envió los documentos de su propiedad' : 'subió un comprobante de pago';
    mail.send((row.email ? [row.email] : managers()).filter(Boolean), `Rentaypunto · ${row.name} ${what}`, `${row.name} ${what}. Revísalo en el panel: ${panelBase()}/`);
    wa.onFile(type, id);
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(originGuard(config));
  app.use(baseHeaders(config));
  app.get('/health', (req, res) => {
    try { db.prepare('SELECT 1').get(); res.send('ok'); } catch (err) { res.status(503).send(`base de datos sin respuesta: ${err.message}`); }
  });
  app.use('/fotos', express.static(photos.dir, { maxAge: '30d', immutable: true, fallthrough: false }));

  const panel = panelRouter({ db, config, photos, actas, onLead, vlt, wa, seo });
  const site = siteRouter({ db, config, notify, onLead, meta, vlt, onFileReceived });
  if (config.panelHost) {
    // Cada dirección ve solo su aplicación: el panel no existe en rentaypunto.com y el sitio no existe en el panel.
    const pcsp = panelCsp(); const scsp = siteCsp(config);
    app.use((req, res, next) => (req.hostname.toLowerCase() === config.panelHost ? pcsp(req, res, () => panel(req, res, next)) : scsp(req, res, () => site(req, res, next))));
  } else {
    app.use((req, res, next) => (req.path === '/panel' ? res.redirect(301, '/panel/') : next()));
    app.use('/panel', panelCsp(), panel);
    app.use(siteCsp(config), site);
  }

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.status === 404 || err.statusCode === 404) return res.status(404).end();
    if (!err.status || err.status >= 500) { console.error(err); logError(db, `${req.method} ${req.path.replace(/\/\d+/g, '/:id')}`, err.message); }
    if (res.headersSent) return;
    const status = err.status && err.status < 500 ? err.status : 500;
    const msg = status === 500 ? 'Algo salió mal y no se guardó. Intenta de nuevo.'
      : err.type === 'entity.parse.failed' ? 'Datos inválidos' : err.type === 'entity.too.large' ? 'Lo que mandaste es demasiado grande' : err.message;
    res.status(status).json({ error: msg });
  });
  return app;
}

// Código de instalación para crear al Dueño la primera vez (se ve en Railway → Deploy Logs).
function ensureSetupCode(db, config) {
  if (config.setupCode) return config.setupCode;
  let code = getSetting(db, 'setup_code');
  if (!code) { code = crypto.randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})/, '$1-'); setSetting(db, 'setup_code', code); }
  config.setupCode = code;
  return code;
}

if (require.main === module) {
  try { process.loadEnvFile(); } catch { /* sin .env: se usan las variables del entorno */ }
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const check = db.prepare('PRAGMA quick_check').get().quick_check;
  if (check !== 'ok') console.error(`ATENCIÓN: la revisión de la base encontró problemas: ${check}. Restaura el último respaldo.`);
  if (config.storageWarning) console.error('ATENCIÓN: no hay volumen conectado. La base de datos y las fotos se BORRARÁN en la próxima actualización. Agrega un volumen en Railway montado en /data.');
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) console.log(`Primer uso: abre el panel. Código de instalación: ${ensureSetupCode(db, config)}`);
  else ensureSetupCode(db, config);
  // Si alguien perdió el celular con la app de códigos: RESET_2FA=correo en Railway, reiniciar y quitar la variable.
  if (process.env.RESET_2FA) {
    const r = db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE email = ? COLLATE NOCASE').run(process.env.RESET_2FA.trim());
    console.log(r.changes ? `Verificación en dos pasos reiniciada para ${process.env.RESET_2FA}. Quita la variable RESET_2FA.` : `RESET_2FA: no existe el usuario ${process.env.RESET_2FA}`);
  }
  if (process.env.SEED_DEMO === 'true' && seedDemo(db)) console.log('Se cargaron propiedades de ejemplo (SEED_DEMO).');
  if (!config.resendKey) console.log('Sin RESEND_API_KEY: los avisos por correo están apagados (los leads igual llegan al panel).');

  const offsite = offsiteConfig();
  const backup = () => {
    let file;
    try { file = dailyBackup(db, config.dbPath); } catch (err) { console.error('No se pudo hacer el respaldo diario:', err.message); logError(db, 'respaldo', err.message); return; }
    const today = new Date().toISOString().slice(0, 10);
    if (!offsite || !file || String(getSetting(db, 'offsite_last') || '').startsWith(today)) return;
    uploadBackup(file, offsite).then((key) => { setSetting(db, 'offsite_last', new Date().toISOString()); console.log(`Respaldo copiado fuera del servidor: ${key}`); })
      .catch((err) => { console.error('No se pudo copiar el respaldo fuera del servidor:', err.message); logError(db, 'respaldo externo', err.message); });
  };
  backup();
  setInterval(backup, 6 * 3600e3).unref();
  // Borrado automático de documentos (si el Dueño lo activó): expedientes de leads cerrados y documentos de propietarios
  // descartados, pasados N días. Se borra el archivo cifrado y su copia externa; queda constancia en la bitácora.
  const purge = () => { try { const n = purgeDocs(db, vault(path.join(config.dataDir, 'docs'), config.docsKey, offsite)); if (n) console.log(`Documentos borrados por antigüedad: ${n}`); } catch (err) { logError(db, 'borrado de documentos', err.message); } };
  purge();
  setInterval(purge, 24 * 3600e3).unref();
  if (!config.originSecret && process.env.ORIGIN_SECRET) console.error('ATENCIÓN: ORIGIN_SECRET debe tener al menos 24 caracteres; el candado de origen está apagado.');

  if (config.docsKeyInvalid) console.error('ATENCIÓN: DOCS_KEY no es válida (deben ser 32 bytes en base64). La bóveda de documentos queda apagada.');
  else if (!config.docsKey) {
    console.log('Sin DOCS_KEY: la bóveda de documentos (expedientes) está apagada.');
    console.log('Para activarla: entra al panel como Dueño → Equipo → Bóveda de documentos → "Generar llave" y cópiala a la variable DOCS_KEY en Railway.');
  }
  const wa = whatsapp(db, config);
  if (wa.start()) console.log('WhatsApp oficial conectado: mensajes automáticos según la configuración del panel.');
  const server = createApp({ db, config, wa }).listen(config.port, () => {
    console.log(`Rentaypunto en http://localhost:${config.port}${config.panelHost ? ` · panel en https://${config.panelHost}` : ' · panel en /panel/'}`);
  });
  const shutdown = (signal) => {
    console.log(`${signal}: cerrando…`);
    server.close(() => { try { db.close(); } catch { /* ya cerrada */ } process.exit(0); });
    setTimeout(() => { try { db.close(); } catch { /* ya cerrada */ } process.exit(0); }, 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Documentos que ya no se necesitan: de leads perdidos o firmados y de propietarios descartados, más viejos que N días.
function purgeDocs(db, vlt, now = Date.now()) {
  const days = Number(getSetting(db, 'docs_retention_days', '0')) || 0;
  if (!days) return 0;
  const limit = new Date(now - days * 86400e3).toISOString();
  const rows = db.prepare(`SELECT d.id, d.file FROM documents d WHERE d.deleted_at IS NULL AND d.uploaded_at < ? AND (
      (d.subject_type = 'lead' AND d.subject_id IN (SELECT id FROM leads WHERE stage IN ('perdido','firmado') AND updated_at < ?))
      OR (d.subject_type = 'owner' AND d.subject_id IN (SELECT id FROM owners WHERE status = 'descartado')))`).all(limit, limit);
  const now2 = new Date(now).toISOString();
  for (const r of rows) {
    db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(now2, r.id);
    db.prepare("INSERT INTO doc_access (document_id, user_id, action) VALUES (?, NULL, 'borrado automático por antigüedad')").run(r.id);
    vlt.remove(r.file);
  }
  if (rows.length) db.prepare("INSERT INTO audit_log (action, detail) VALUES ('borrado automático de documentos', ?)").run(`${rows.length} documento(s) de más de ${days} días`);
  return rows.length;
}

module.exports = { createApp, loadConfig, ensureSetupCode, purgeDocs };
