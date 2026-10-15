// Base de datos de Rentaypunto: un solo archivo SQLite en el volumen del servidor.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Perfiles del panel. El Dueño puede todo; el Gerente todo menos dinero de Meta, comisiones y altas de usuarios.
const ROLES = ['vendedor', 'gerente', 'dueno'];
const ROLE_LABELS = { vendedor: 'Vendedor', gerente: 'Gerente', dueno: 'Dueño' };

// Estados de una propiedad. Solo Disponible y Apartada se ven en el sitio público.
const PROP_STATUS = ['borrador', 'disponible', 'apartada', 'rentada', 'pausada'];
const PROP_LABELS = { borrador: 'Borrador', disponible: 'Disponible', apartada: 'Apartada', rentada: 'Rentada', pausada: 'Pausada' };
const VISIBLE = ['disponible', 'apartada'];

// Etapas del lead (cada solicitud de visita es un lead).
const STAGES = ['nuevo', 'contactado', 'cita', 'visito', 'expediente', 'firmado', 'perdido'];
const STAGE_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', cita: 'Cita confirmada', visito: 'Visitó', expediente: 'Expediente', firmado: 'Firmado', perdido: 'Perdido' };
const LOST_REASONS = ['Precio', 'Ubicación', 'Ya rentó otra', 'No contesta', 'No calificó', 'Otro'];

const EXTRAS = ['Mascotas', 'Estacionamiento', 'Amueblado', 'Seguridad 24h'];
const INCLUDES = ['Agua', 'Luz', 'Gas', 'Internet', 'Mantenimiento'];
const REQUIREMENTS = ['Póliza jurídica', 'Aval', 'Fiador', 'Depósito y comprobante de ingresos'];
const PROP_TYPES = ['Casa', 'Departamento', 'Estudio', 'Otro'];
const DEFAULT_ZONES = ['Juriquilla', 'El Refugio', 'Centro Sur', 'Zibatá', 'Milenio III', 'Centro Histórico', 'Cumbres del Lago'];
const ACTA_ITEMS = ['Llaves entregadas', 'Lecturas de luz, agua y gas anotadas', 'Estado de paredes, pisos y puertas revisado', 'Inventario de muebles y electrodomésticos', 'Fotos de cada espacio', 'Firma del inquilino y del propietario'];
const OWNER_REQUESTS = { pausar: 'Pausar', reanudar: 'Reanudar', precio: 'Cambio de precio', ya_rentada: 'Ya la rentó por su cuenta', renovacion: 'Renovación', otro: 'Otro' };
const DEFAULT_HOURS = ['10:00', '11:00', '12:00', '13:00', '16:00', '17:00', '18:00'];

const { slugify } = require('../public/panel/seo-shared.js');
// Teléfono a 10 dígitos (quita lada 52 y el 1 de WhatsApp). '' si no es válido.
function phone10(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  return d.length === 10 ? d : '';
}

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const list = (a) => a.map((x) => `'${x}'`).join(',');
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT, -- WhatsApp del asesor (10 dígitos)
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN (${list(ROLES)})),
      publish_direct INTEGER NOT NULL DEFAULT 0, -- vendedor que publica sin aprobación
      totp_secret TEXT, -- verificación en dos pasos (Gerente y Dueño)
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- pending = 1: ya puso su contraseña pero le falta el código de verificación en dos pasos.
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pending INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL
    );

    -- Links de invitación o de contraseña nueva: un solo uso, vencen en 72 h. Se guarda solo su huella.
    CREATE TABLE IF NOT EXISTS user_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1
    );

    -- Registros de "Renta tu propiedad". No tienen cuenta: los atiende un asesor.
    CREATE TABLE IF NOT EXISTS owners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      best_time TEXT,
      prop_type TEXT,
      zone TEXT,
      colonia TEXT,
      bedrooms INTEGER,
      m2 INTEGER,
      expected_rent INTEGER,
      occupied TEXT,
      available_from TEXT,
      furnished TEXT,
      pets TEXT,
      listed_elsewhere TEXT,
      lives_outside TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo','contactado','publicado','descartado')),
      advisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE, -- RP-0001
      title TEXT NOT NULL,
      prop_type TEXT,
      zone_id INTEGER NOT NULL REFERENCES zones(id),
      colonia TEXT, -- lo que se muestra en público (colonia o referencia)
      address_private TEXT, -- dirección exacta: solo el panel, se comparte con quien tiene cita confirmada
      rent INTEGER NOT NULL,
      deposit_months REAL NOT NULL DEFAULT 1,
      maintenance INTEGER NOT NULL DEFAULT 0,
      m2 INTEGER,
      bedrooms INTEGER,
      bathrooms REAL,
      parking INTEGER,
      max_occupants INTEGER,
      min_term INTEGER,
      extras TEXT NOT NULL DEFAULT '[]', -- JSON
      includes TEXT NOT NULL DEFAULT '[]', -- JSON
      near TEXT,
      consider_note TEXT,
      description TEXT,
      requirements TEXT,
      available_from TEXT,
      status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN (${list(PROP_STATUS)})),
      advisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      owner_id INTEGER REFERENCES owners(id) ON DELETE SET NULL,
      seo_slug TEXT NOT NULL UNIQUE, -- renta/<zona>/<titulo>-<codigo>
      seo_title TEXT NOT NULL,
      seo_desc TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      published_at TEXT,
      rented_at TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      wa_clicks INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS properties_status ON properties(status);

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      file TEXT NOT NULL, -- nombre base; existen <file>.jpg y <file>-sm.jpg
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS photos_property ON photos(property_id);

    -- Cada solicitud de visita es un lead, ligado a la propiedad que eligió.
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      visit_date TEXT, -- AAAA-MM-DD
      visit_time TEXT, -- HH:MM
      stage TEXT NOT NULL DEFAULT 'nuevo' CHECK (stage IN (${list(STAGES)})),
      lost_reason TEXT,
      advisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      origin TEXT NOT NULL DEFAULT 'Directo', -- Meta Ads, Google, Directo, u otro utm_source
      utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT,
      search_context TEXT, -- lo que respondió en "Encuentra tu renta"
      message TEXT,
      followup_done INTEGER NOT NULL DEFAULT 0,
      contacted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS leads_stage ON leads(stage);
    CREATE INDEX IF NOT EXISTS leads_advisor ON leads(advisor_id);
    CREATE INDEX IF NOT EXISTS leads_slot ON leads(property_id, visit_date, visit_time);

    -- Historial del lead: notas, cambios de etapa, asignaciones.
    CREATE TABLE IF NOT EXISTS lead_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS lead_events_lead ON lead_events(lead_id);

    -- "Avísame": prospectos que no encontraron propiedad.
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT NOT NULL,
      filters TEXT NOT NULL DEFAULT '{}', -- JSON con los filtros
      filters_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo','contactado','cerrado')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- Quejas, inconformidades y sugerencias.
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      name TEXT,
      contact TEXT,
      property_ref TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'en_gestion' CHECK (status IN ('en_gestion','resuelto')),
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- Solicitudes de contacto por la póliza jurídica.
    CREATE TABLE IF NOT EXISTS legal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      who TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo','contactado','cerrado')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS ops_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL, place TEXT, message TEXT
    );
  `);
  // Las tickets empiezan en el folio 1001 para que no parezcan pocos.
  if (!db.prepare("SELECT 1 FROM sqlite_sequence WHERE name = 'tickets'").get()) {
    db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('tickets', 1000)").run();
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM zones').get().n === 0) {
    const ins = db.prepare('INSERT INTO zones (name, slug) VALUES (?, ?)');
    for (const z of DEFAULT_ZONES) ins.run(z, slugify(z));
  }
  migrate(db);
  return db;
}

// Cambios de la base de una fase a otra. Se aplican solos al arrancar y nunca borran datos.
function addColumn(db, table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
function migrate(db) {
  // Fase 2: hitos del lead (no se pierden aunque después se marque Perdido), contrato y acta de entrega.
  addColumn(db, 'leads', 'confirmed_at', 'TEXT');
  addColumn(db, 'leads', 'visited_at', 'TEXT');
  addColumn(db, 'leads', 'signed_at', 'TEXT');
  addColumn(db, 'leads', 'opinion_token', 'TEXT');
  addColumn(db, 'properties', 'contract_start', 'TEXT');
  addColumn(db, 'properties', 'contract_end', 'TEXT');
  addColumn(db, 'properties', 'acta_items', "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, 'alerts', 'notified_at', 'TEXT');
  db.exec(`
    -- Visitas a la ficha y clics a WhatsApp por día (para reportes semanales y el Resumen por periodo).
    CREATE TABLE IF NOT EXISTS property_days (
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      wa_clicks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (property_id, day)
    );
    -- Opinión de quien visitó (llega por un enlace de un solo uso). No guarda nombre.
    CREATE TABLE IF NOT EXISTS opinions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      lead_id INTEGER UNIQUE REFERENCES leads(id) ON DELETE SET NULL,
      liked TEXT NOT NULL CHECK (liked IN ('si','mas_o_menos','no')),
      rent_opinion TEXT NOT NULL CHECK (rent_opinion IN ('justa','alta','baja')),
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    -- Lo que pide el propietario por WhatsApp (pausar, cambiar precio, ya la rentó...). El asesor lo registra y se aplica.
    CREATE TABLE IF NOT EXISTS owner_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('pausar','reanudar','precio','ya_rentada','renovacion','otro')),
      new_rent INTEGER,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'nueva' CHECK (status IN ('nueva','aplicada','rechazada')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at TEXT
    );
    -- Reportes semanales enviados al propietario.
    CREATE TABLE IF NOT EXISTS owner_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    -- Fotos del acta de entrega: privadas (solo el panel las muestra).
    CREATE TABLE IF NOT EXISTS acta_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      file TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    -- Inversión en Meta por mes (solo el Dueño la ve).
    CREATE TABLE IF NOT EXISTS meta_spend (month TEXT PRIMARY KEY, amount INTEGER NOT NULL);
  `);
  // Leads de la fase 1: se calculan sus hitos con la etapa en la que van.
  db.exec(`UPDATE leads SET confirmed_at = COALESCE(confirmed_at, updated_at) WHERE stage IN ('cita','visito','expediente','firmado') AND confirmed_at IS NULL;
    UPDATE leads SET visited_at = COALESCE(visited_at, updated_at) WHERE stage IN ('visito','expediente','firmado') AND visited_at IS NULL;
    UPDATE leads SET signed_at = COALESCE(signed_at, updated_at) WHERE stage = 'firmado' AND signed_at IS NULL;`);
}

function getSetting(db, key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
function getJsonSetting(db, key, fallback) {
  try { const v = getSetting(db, key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

// Lo que se puede configurar desde el panel (Dueño). Todo lo "por definir" del brief vive aquí, no en el código.
function siteSettings(db) {
  return {
    whatsapp: getSetting(db, 'whatsapp', '') || '', // número público de WhatsApp (10 dígitos)
    visit_hours: getJsonSetting(db, 'visit_hours', DEFAULT_HOURS),
    visit_days: Number(getSetting(db, 'visit_days', '7')) || 7,
    complaints_promise: getSetting(db, 'complaints_promise', '') || '', // p. ej. "48 horas hábiles"; vacío = no se promete plazo
    fees_text: getSetting(db, 'fees_text', '') || '', // modelo de cobro al propietario; vacío = "Por definir"
    legal_text: getSetting(db, 'legal_text', '') || '', // alcance y precio de la póliza; vacío = propuesta "por definir"
    company_legal_name: getSetting(db, 'company_legal_name', '') || '',
    notify_email: getSetting(db, 'notify_email', '') || '', // copia de cada lead (además del asesor)
    meta_pixel_id: getSetting(db, 'meta_pixel_id', '') || '', // píxel de Meta (el token de la API de Conversiones va en Railway)
    commission_months: Number(getSetting(db, 'commission_months', '1')), // supuesto: Rentaypunto cobra 1 mes de renta al cerrar
    commission_pct: Number(getSetting(db, 'commission_pct', '20')), // supuesto: 20% de ese cobro para el asesor
  };
}

module.exports = {
  openDb, getSetting, setSetting, getJsonSetting, siteSettings, slugify, phone10,
  ROLES, ROLE_LABELS, PROP_STATUS, PROP_LABELS, VISIBLE, STAGES, STAGE_LABELS, LOST_REASONS,
  EXTRAS, INCLUDES, REQUIREMENTS, PROP_TYPES, DEFAULT_HOURS, ACTA_ITEMS, OWNER_REQUESTS,
};
