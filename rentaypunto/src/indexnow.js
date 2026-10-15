// IndexNow: avisa a Bing (y a otros buscadores que lo usan) en cuanto se publica, cambia o se renta una propiedad,
// para que la revisen en horas y no en semanas. Google no usa IndexNow: para Google está el mapa del sitio en Search Console.
// Los avisos se juntan un minuto y se mandan en un solo envío.
const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./db');

function indexNowKey(db) {
  let k = getSetting(db, 'indexnow_key');
  if (!k) { k = crypto.randomBytes(16).toString('hex'); setSetting(db, 'indexnow_key', k); }
  return k;
}

function indexNow(db, config, log = console) {
  const enabled = Boolean(config.siteUrl) && config.indexNow !== false;
  const pending = new Set();
  let timer = null;
  async function flush() {
    timer = null;
    const urlList = [...pending]; pending.clear();
    if (!urlList.length) return;
    const key = indexNowKey(db);
    try {
      const r = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ host: new URL(config.siteUrl).host, key, keyLocation: `${config.siteUrl}/${key}.txt`, urlList }),
      });
      if (!r.ok && r.status !== 202) throw new Error(`IndexNow respondió ${r.status}`);
      setSetting(db, 'indexnow_last', JSON.stringify({ at: new Date().toISOString(), n: urlList.length }));
    } catch (err) {
      log.error('No se pudo avisar a los buscadores:', err.message);
    }
  }
  // Una propiedad cambió: su ficha, su zona, la página de Querétaro y la portada.
  function propertyChanged(id, oldSlug) {
    if (!enabled) return;
    const p = db.prepare('SELECT p.seo_slug, z.slug AS zone FROM properties p JOIN zones z ON z.id = p.zone_id WHERE p.id = ?').get(id);
    if (p) [`/${p.seo_slug}`, `/renta/${p.zone}`].forEach((u) => pending.add(config.siteUrl + u));
    if (oldSlug && (!p || oldSlug !== p.seo_slug)) pending.add(`${config.siteUrl}/${oldSlug}`);
    pending.add(`${config.siteUrl}/renta/queretaro`); pending.add(`${config.siteUrl}/`);
    if (!timer) { timer = setTimeout(() => flush(), config.indexNowDelay ?? 60e3); timer.unref?.(); }
  }
  return { enabled, propertyChanged, flush, pending };
}

module.exports = { indexNow, indexNowKey };
