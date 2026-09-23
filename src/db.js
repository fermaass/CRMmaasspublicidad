const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const STATUSES = ['nuevo', 'nuevo_perfil', 'cotizando', 'declinado', 'vendido'];
const PROFILES = ['sin_perfilar', 'cumple', 'no_cumple'];
const ROLES = ['gerente', 'marketing', 'vendedor', 'analista'];
const SOURCES = ['formulario', 'whatsapp', 'manual'];

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
  `);
  return db;
}

// Últimos 10 dígitos: así "+52 1 55 1234 5678" (WhatsApp) y "55 1234 5678" (formulario) son el mismo contacto.
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
}

module.exports = { openDb, phoneKey, STATUSES, PROFILES, ROLES, SOURCES };
