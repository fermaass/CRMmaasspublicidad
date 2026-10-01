// Respaldos: una copia completa al día en la carpeta "respaldos" junto a la base (se guardan las últimas 14),
// y una copia al momento que el gerente puede descargar para tenerla fuera del servidor.
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 14;
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Copia consistente aunque haya escrituras en curso (VACUUM INTO lee una foto completa de la base).
function snapshot(db, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO ${sqlString(file)}`);
  return file;
}

function backupDir(dbPath) { return path.join(path.dirname(dbPath), 'respaldos'); }

function listBackups(dbPath) {
  const dir = backupDir(dbPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^crm-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort()
    .map((f) => ({ file: f, size: fs.statSync(path.join(dir, f)).size }));
}

// Respaldo del día (si ya existe, no hace nada) y limpieza de los viejos.
function dailyBackup(db, dbPath, today = new Date().toISOString().slice(0, 10)) {
  if (dbPath === ':memory:') return null;
  const file = path.join(backupDir(dbPath), `crm-${today}.db`);
  if (!fs.existsSync(file)) snapshot(db, file);
  const all = listBackups(dbPath);
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.unlinkSync(path.join(backupDir(dbPath), old.file));
  return file;
}

module.exports = { snapshot, dailyBackup, listBackups, backupDir, KEEP };
