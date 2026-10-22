const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');

test('bases anteriores: el gerente de antes y el Gerente de marketing pasan a Administrador y el Analista a Director, sin perder a nadie', () => {
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
  assert.deepEqual(roles, { Fer: 'admin', Mar: 'admin', Lalo: 'director', Coco: 'operador', Ana: 'vendedor' });
  const fer = db.prepare("SELECT * FROM users WHERE name = 'Fer'").get();
  assert.equal(fer.can_sell, 1); assert.equal(fer.last_login_at, '2026-10-01');
  assert.throws(() => db.prepare("UPDATE users SET role = 'marketing' WHERE id = 1").run(), 'el rol viejo ya no se acepta');
  db.close();
  // Abrirla otra vez no vuelve a migrar ni falla.
  assert.equal(openDb(file).prepare('SELECT COUNT(*) AS n FROM users').get().n, 5);
});

test('base con los niveles de la versión anterior (gerente = Administrador): pasa a admin y deja libre "gerente" para el Gerente', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roles-')), 'crm.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('gerente','director','operador','vendedor')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      can_assign INTEGER NOT NULL DEFAULT 0, last_login_at TEXT, can_sell INTEGER NOT NULL DEFAULT 0);
    INSERT INTO users (name, email, password_hash, role, can_assign, can_sell) VALUES
      ('Fer', 'f@x.mx', 'h', 'gerente', 1, 1), ('Diana', 'd@x.mx', 'h', 'director', 0, 0), ('Edgar', 'e@x.mx', 'h', 'vendedor', 1, 0);`);
  old.close();
  const db = openDb(file);
  const users = db.prepare('SELECT name, role, can_assign, can_sell FROM users ORDER BY id').all().map((u) => ({ ...u }));
  assert.deepEqual(users, [{ name: 'Fer', role: 'admin', can_assign: 1, can_sell: 1 }, { name: 'Diana', role: 'director', can_assign: 0, can_sell: 0 },
    { name: 'Edgar', role: 'vendedor', can_assign: 1, can_sell: 0 }]);
  db.prepare("UPDATE users SET role = 'gerente' WHERE name = 'Diana'").run();
  db.close();
  assert.equal(openDb(file).prepare("SELECT role FROM users WHERE name = 'Diana'").get().role, 'gerente', 'abrirla otra vez no la vuelve a migrar');
});
