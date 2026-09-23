const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const STATUSES = ['nuevo', 'nuevo_perfil', 'cotizando', 'declinado', 'vendido'];
const PROFILES = ['sin_perfilar', 'cumple', 'no_cumple'];
const ROLES = ['gerente', 'marketing', 'vendedor', 'analista'];
const SOURCES = ['formulario', 'whatsapp', 'llamada', 'otro'];
// Orígenes que se capturan a mano (el formulario es el único automático).
const MANUAL_SOURCES = ['whatsapp', 'llamada', 'otro'];
const LABELS = {
  nuevo: 'Nuevo', nuevo_perfil: 'Nuevo – cumple perfil', cotizando: 'Cotizando', declinado: 'Declinado', vendido: 'Vendido',
  sin_perfilar: 'Sin perfilar', cumple: 'Cumple perfil', no_cumple: 'No cumple',
  formulario: 'Formulario', whatsapp: 'WhatsApp', llamada: 'Llamada', otro: 'Otro', correo: 'Correo', visita: 'Visita',
};

const CATALOG_KINDS = ['canal', 'producto', 'campana'];

// Toques: cada intento de contacto del vendedor. Su resultado mueve al lead de etapa.
// La cadencia (qué toca y cuándo) vive en public/followup.js para que servidor y navegador usen la misma regla.
const FOLLOWUP = require('../public/followup.js');
const MAX_TOUCHES = FOLLOWUP.MAX;
const CADENCE_DAYS = FOLLOWUP.CADENCE;
const TOUCH_CHANNELS = ['llamada', 'whatsapp', 'correo', 'visita'];
const TOUCH_OUTCOMES = {
  sin_respuesta: 'No contestó',
  conversacion: 'Contestó, falta perfilar',
  cumple: 'Contestó y cumple perfil',
  no_cumple: 'Contestó pero no cumple perfil',
  seguimiento: 'Sigue en conversación',
  cotizado: 'Se envió cotización',
  vendido: 'Cerró venta',
  rechazo: 'No le interesó',
};
// Qué resultados tienen sentido según la etapa en que va el lead.
const OUTCOMES_BY_STATUS = {
  nuevo: ['sin_respuesta', 'cumple', 'no_cumple', 'conversacion'],
  nuevo_perfil: ['sin_respuesta', 'seguimiento', 'cotizado', 'rechazo'],
  cotizando: ['sin_respuesta', 'seguimiento', 'vendido', 'rechazo'],
};
const NO_ANSWER = 'No contestó (5 toques)';
const POSTPONED = 'Lo pospuso / sin presupuesto ahora';
const DECLINE_REASONS = [NO_ANSWER, 'No cumple perfil', 'Precio', 'Eligió a otro proveedor', POSTPONED, 'Otro'];
const MILESTONES = ['assigned_at', 'contacted_at', 'profiled_at', 'quoted_at', 'won_at', 'declined_at'];
// Canales iniciales; se editan desde Configuración.
const DEFAULT_CHANNELS = ['Facebook', 'Instagram', 'Google', 'Espectacular / valla', 'Recomendación', 'Otro'];

function catalogDDL(table) {
  return `CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN (${CATALOG_KINDS.map((k) => `'${k}'`).join(',')})),
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      budget REAL, -- inversión total (solo campañas; se usa si no hay inversión por mes)
      channel_id INTEGER, -- canal al que pertenece la campaña (p. ej. Facebook)
      UNIQUE (kind, name)
    );`;
}

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN (${ROLES.map((r) => `'${r}'`).join(',')})),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      phone_key TEXT,
      email TEXT COLLATE NOCASE,
      source TEXT NOT NULL CHECK (source IN (${SOURCES.map((s) => `'${s}'`).join(',')})),
      campaign TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN (${STATUSES.map((s) => `'${s}'`).join(',')})),
      profile TEXT NOT NULL DEFAULT 'sin_perfilar' CHECK (profile IN (${PROFILES.map((p) => `'${p}'`).join(',')})),
      decline_reason TEXT,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS leads_phone_key ON leads(phone_key);
    CREATE INDEX IF NOT EXISTS leads_email ON leads(email);
    CREATE INDEX IF NOT EXISTS leads_status ON leads(status);

    CREATE TABLE IF NOT EXISTS lead_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS lead_events_lead ON lead_events(lead_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Listas que se administran desde Configuración: canales de percepción, productos y campañas.
    ${catalogDDL('catalog_items')}
  `);

  // Bases creadas antes de existir las campañas: se rehace la tabla para aceptar el nuevo tipo.
  const catSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'catalog_items'").get().sql;
  if (!catSql.includes("'campana'")) {
    db.exec(`PRAGMA foreign_keys = OFF;
      ${catalogDDL('catalog_new')}
      INSERT INTO catalog_new (id, kind, name, active) SELECT id, kind, name, active FROM catalog_items;
      DROP TABLE catalog_items;
      ALTER TABLE catalog_new RENAME TO catalog_items;
      PRAGMA foreign_keys = ON;`);
  }

  // Quién administra los leads (los asigna a vendedores). El gerente siempre puede; a los demás se les da este permiso.
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'can_assign')) {
    db.exec('ALTER TABLE users ADD COLUMN can_assign INTEGER NOT NULL DEFAULT 0');
  }
  const leadCols = db.prepare('PRAGMA table_info(leads)').all().map((c) => c.name);
  if (!leadCols.includes('channel_id')) db.exec('ALTER TABLE leads ADD COLUMN channel_id INTEGER REFERENCES catalog_items(id)');
  if (!leadCols.includes('product_id')) db.exec('ALTER TABLE leads ADD COLUMN product_id INTEGER REFERENCES catalog_items(id)');
  if (!leadCols.includes('sale_amount')) db.exec('ALTER TABLE leads ADD COLUMN sale_amount REAL');
  const catCols = db.prepare('PRAGMA table_info(catalog_items)').all().map((c) => c.name);
  if (!catCols.includes('budget')) db.exec('ALTER TABLE catalog_items ADD COLUMN budget REAL');
  if (!catCols.includes('channel_id')) db.exec('ALTER TABLE catalog_items ADD COLUMN channel_id INTEGER');
  // Monto cotizado, fecha para volver a contactar, primer toque y de qué anuncio viene.
  for (const [col, type] of [['quote_amount', 'REAL'], ['recontact_at', 'TEXT'], ['first_touch_at', 'TEXT'],
    ['utm_source', 'TEXT'], ['utm_medium', 'TEXT'], ['utm_content', 'TEXT']]) {
    if (!leadCols.includes(col)) db.exec(`ALTER TABLE leads ADD COLUMN ${col} ${type}`);
  }
  // Inversión de cada campaña por mes ('AAAA-MM').
  db.exec(`CREATE TABLE IF NOT EXISTS campaign_budgets (
      campaign_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      amount REAL NOT NULL,
      PRIMARY KEY (campaign_id, month)
    );`);
  if (!leadCols.includes('touch_count')) {
    db.exec(`ALTER TABLE leads ADD COLUMN touch_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE leads ADD COLUMN response_touch INTEGER; -- en qué toque respondió por primera vez
      ALTER TABLE leads ADD COLUMN quote_touch INTEGER;    -- en qué toque se cotizó
      ALTER TABLE leads ADD COLUMN last_touch_at TEXT;`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS lead_touches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      n INTEGER NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      channel TEXT NOT NULL,
      outcome TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lead_touches_lead ON lead_touches(lead_id);`);
  // Hitos del embudo: la fecha en que el lead pasó por cada paso. No se borran aunque el lead retroceda o se decline.
  if (!leadCols.includes('won_at')) {
    for (const col of MILESTONES) db.exec(`ALTER TABLE leads ADD COLUMN ${col} TEXT`);
    // Datos anteriores: se reconstruye lo que se sabe por la etapa y el perfil actuales.
    db.exec(`
      UPDATE leads SET assigned_at = created_at WHERE assigned_to IS NOT NULL;
      UPDATE leads SET profiled_at = updated_at WHERE profile = 'cumple';
      UPDATE leads SET quoted_at = updated_at, contacted_at = updated_at WHERE status IN ('cotizando', 'vendido');
      UPDATE leads SET won_at = updated_at WHERE status = 'vendido';
      UPDATE leads SET declined_at = updated_at WHERE status = 'declinado';
    `);
  }

  // Toda campaña usada en algún lead aparece en la lista de campañas.
  db.exec(`INSERT OR IGNORE INTO catalog_items (kind, name)
    SELECT DISTINCT 'campana', campaign FROM leads WHERE campaign IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM catalog_items c WHERE c.kind = 'campana' AND c.name = leads.campaign COLLATE NOCASE)`);

  if (!db.prepare("SELECT 1 FROM catalog_items WHERE kind = 'canal'").get()) {
    const add = db.prepare("INSERT INTO catalog_items (kind, name) VALUES ('canal', ?)");
    for (const name of DEFAULT_CHANNELS) add.run(name);
  }
  return db;
}

function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || null;
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// Las claves se generan solas la primera vez; si vienen en variables de entorno, esas mandan.
function ensureSettings(db, config = {}) {
  const random = () => require('node:crypto').randomBytes(18).toString('base64url');
  const initial = {
    form_api_key: config.formApiKey,
  };
  if (config.autoAssign === true) setSetting(db, 'auto_assign', '1');
  for (const [key, fromEnv] of Object.entries(initial)) {
    if (fromEnv) setSetting(db, key, fromEnv);
    else if (!getSetting(db, key)) setSetting(db, key, random());
  }
}

// Últimos 10 dígitos: así "+52 1 55 1234 5678" (WhatsApp) y "55 1234 5678" (formulario) son el mismo contacto.
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
}

// Mensajes de WhatsApp según lo que toque con el lead. {nombre}, {vendedor} y {producto} se reemplazan al enviar.
const WA_TEMPLATES = {
  cadencia: 'Hola {nombre}, soy {vendedor} de Maass Publicidad. Vi que nos escribiste por {producto}. ¿Te puedo llamar o prefieres que te comparta opciones por aquí?',
  seguimiento: 'Hola {nombre}, soy {vendedor} de Maass Publicidad. Para prepararte una propuesta de {producto}, ¿me confirmas zona, fechas y presupuesto aproximado?',
  cotizacion: 'Hola {nombre}, ¿pudiste revisar la cotización de {producto} que te enviamos? Con gusto resolvemos cualquier duda.',
  recontacto: 'Hola {nombre}, soy {vendedor} de Maass Publicidad. Quedamos de retomar lo de {producto}. ¿Cómo vas con tus planes?',
};

module.exports = {
  WA_TEMPLATES,
  openDb, phoneKey, getSetting, setSetting, ensureSettings, CATALOG_KINDS,
  MAX_TOUCHES, CADENCE_DAYS, TOUCH_CHANNELS, TOUCH_OUTCOMES, OUTCOMES_BY_STATUS, NO_ANSWER, POSTPONED, DECLINE_REASONS, FOLLOWUP, STATUSES, PROFILES, ROLES, SOURCES, MANUAL_SOURCES, LABELS,
};
