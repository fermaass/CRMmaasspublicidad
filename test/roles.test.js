const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');

test('bases anteriores: Gerente de marketing pasa a Administrador y Analista a Director, sin perder a nadie', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roles-')), 'crm.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('gerente','marketing','vendedor','analista','operador')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      can_assign INTEGER NOT NULL DEFAULT 0, last_login_at TEXT, can_sell INTEGER NOT NULL DEFAULT 0);
    INSERT INTO users (name, email, password_hash, role, can_sell, last_login_at) VALUES
      ('Fer', 'f@x.mx', 'h', 'gerente', 1, '2026-10-01'), ('Mar', 'm@x.mx', 'h', 'marketing', 0, NULL),
      ('Lalo', 'l@x.mx', 'h', 'analista', 0, NULL), ('Coco', 'c@x.mx', 'h', 'operador', 0, NULL), ('Ana', 'a@x.mx', 'h', 'vendedor', 0, NULL);`);
  old.close();
  const db = openDb(file);
  const roles = Object.fromEntries(db.prepare('SELECT name, role FROM users').all().map((u) => [u.name, u.role]));
  assert.deepEqual(roles, { Fer: 'gerente', Mar: 'gerente', Lalo: 'director', Coco: 'operador', Ana: 'vendedor' });
  const fer = db.prepare("SELECT * FROM users WHERE name = 'Fer'").get();
  assert.equal(fer.can_sell, 1); assert.equal(fer.last_login_at, '2026-10-01');
  assert.throws(() => db.prepare("UPDATE users SET role = 'marketing' WHERE id = 1").run(), 'el rol viejo ya no se acepta');
  db.close();
  // Abrirla otra vez no vuelve a migrar ni falla.
  assert.equal(openDb(file).prepare('SELECT COUNT(*) AS n FROM users').get().n, 5);
});
