// Restaurar un respaldo al arrancar: se pone RESTORE_FROM y se reinicia el servicio.
//   RESTORE_FROM=respaldos/crm-2026-10-01.db      → un respaldo diario del volumen
//   RESTORE_FROM=r2:maass/crm-2026-10-01.db.gz     → un respaldo de fuera del servidor (usa las variables BACKUP_S3_*)
// Antes de reemplazar, guarda la base actual en respaldos/antes-de-restaurar-<fecha>.db. Lo hace UNA vez por respaldo:
// aunque la variable se quede puesta, al reiniciar otra vez no vuelve a restaurar (hay que quitarla después).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { snapshot, backupDir } = require('./backup');
const { downloadBackup } = require('./offsite');

async function restoreIfAsked({ dbPath, source, offsite, fetchImpl, log = console.log }) {
  if (!source || !dbPath || dbPath === ':memory:') return null;
  const dir = path.dirname(dbPath);
  const marker = path.join(dir, `.restaurado-${crypto.createHash('sha256').update(String(source)).digest('hex').slice(0, 12)}`);
  if (fs.existsSync(marker)) {
    log(`RESTORE_FROM=${source} ya se restauró antes; no se repite. Quita la variable RESTORE_FROM.`);
    return null;
  }
  let data;
  if (String(source).startsWith('r2:')) {
    if (!offsite) throw new Error('RESTORE_FROM usa r2: pero faltan las variables BACKUP_S3_*');
    data = await downloadBackup(String(source).slice(3), offsite, fetchImpl);
  } else {
    const file = path.resolve(dir, String(source));
    if (!file.startsWith(path.resolve(dir) + path.sep)) throw new Error('RESTORE_FROM debe ser un archivo dentro del volumen');
    if (!fs.existsSync(file)) throw new Error(`No existe ${source} en el volumen`);
    data = fs.readFileSync(file);
  }
  if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
  if (data.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') throw new Error(`${source} no es un respaldo válido`);
  // Se revisa la copia antes de tocar nada.
  const tmp = `${dbPath}.restaurando`;
  fs.writeFileSync(tmp, data);
  const check = new DatabaseSync(tmp);
  try {
    if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error(`${source} está dañado`);
    if (!check.prepare("SELECT 1 FROM sqlite_master WHERE name = 'leads'").get()) throw new Error(`${source} no es una base de Maass Leads`);
  } catch (err) { check.close(); fs.rmSync(tmp, { force: true }); throw err; }
  check.close();
  let saved = null;
  if (fs.existsSync(dbPath)) {
    const current = new DatabaseSync(dbPath);
    saved = path.join(backupDir(dbPath), `antes-de-restaurar-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`);
    try { snapshot(current, saved); } finally { current.close(); }
  }
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  fs.renameSync(tmp, dbPath);
  fs.writeFileSync(marker, `${new Date().toISOString()} ${source}\n`);
  log(`Respaldo restaurado desde ${source}.${saved ? ` La base anterior quedó en ${path.relative(dir, saved)}.` : ''} Quita la variable RESTORE_FROM.`);
  return { saved };
}

module.exports = { restoreIfAsked };
