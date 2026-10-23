// Notificaciones al celular (Web Push): solo cuando a alguien le llega un lead. Funcionan con la app instalada en el
// celular (en iPhone, agregada a la pantalla de inicio) y en el navegador de la computadora. No requieren ningún servicio
// pagado: las claves (VAPID) se generan solas la primera vez y se guardan en la base.
const webpush = require('web-push');
const { getSetting, setSetting } = require('./db');

function setupPush(db, { send = webpush.sendNotification.bind(webpush) } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
  if (!getSetting(db, 'vapid_public')) {
    const keys = webpush.generateVAPIDKeys();
    setSetting(db, 'vapid_public', keys.publicKey);
    setSetting(db, 'vapid_private', keys.privateKey);
  }
  const publicKey = getSetting(db, 'vapid_public');
  webpush.setVapidDetails('https://maasspublicidad.com', publicKey, getSetting(db, 'vapid_private'));

  function subscribe(userId, sub) {
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
      throw new Error('Suscripción inválida');
    }
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(userId, sub.endpoint, String(sub.keys.p256dh), String(sub.keys.auth), new Date().toISOString());
  }
  const unsubscribe = (userId, endpoint) => db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, String(endpoint || ''));
  const devices = (userId) => db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId).n;

  // Envía a todos los celulares/navegadores del usuario. Los que ya no existen (desinstaló o quitó el permiso) se borran.
  async function sendTo(userId, payload) {
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
    const results = await Promise.all(subs.map((s) => send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 })
      .then(() => true)
      .catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        else console.error('No se pudo mandar la notificación:', err.statusCode || err.message);
        return false;
      })));
    return results.filter(Boolean).length;
  }

  // Se manda después de que se guardó todo (fuera de la transacción) y solo si el lead sigue con esa persona:
  // si la operación se deshizo, no sale nada.
  const later = (fn) => setTimeout(() => { fn().catch((err) => console.error('Notificación:', err.message)); }, 50);
  const leadInfo = (leadId) => db.prepare(`SELECT l.id, l.assigned_to, COALESCE(l.name, l.phone, l.email) AS name, l.source, l.campaign, c.name AS channel
      FROM leads l LEFT JOIN catalog_items c ON c.id = l.channel_id WHERE l.id = ?`).get(leadId);
  const origin = (l) => [{ formulario: 'Formulario', whatsapp: 'WhatsApp', llamada: 'Llamada', otro: 'Otro' }[l.source] || l.source, l.campaign || l.channel].filter(Boolean).join(' · ');

  // A la persona que le asignaron el lead (no si se lo asignó ella misma).
  function leadAssigned(leadId, sellerId, byUserId) {
    if (!sellerId || sellerId === byUserId) return;
    later(async () => {
      const l = leadInfo(leadId);
      if (!l || l.assigned_to !== sellerId) return;
      await sendTo(sellerId, { title: `Nuevo lead: ${l.name}`, body: `${origin(l)}. Tócalo cuanto antes: entre más rápido, más cierres.`, url: `/?lead=${l.id}`, tag: `lead-${l.id}` });
    });
  }
  // Llegó un lead y nadie lo tiene: a quienes asignan.
  function leadUnassigned(leadId) {
    later(async () => {
      const l = leadInfo(leadId);
      if (!l || l.assigned_to) return;
      const assigners = db.prepare("SELECT id FROM users WHERE active = 1 AND (role = 'operador' OR can_assign = 1)").all();
      for (const u of assigners) await sendTo(u.id, { title: `Lead por asignar: ${l.name}`, body: `${origin(l)}. Está esperando vendedor en Asignación.`, url: `/?lead=${l.id}`, tag: `lead-${l.id}` });
    });
  }

  return { publicKey, subscribe, unsubscribe, devices, sendTo, leadAssigned, leadUnassigned };
}

module.exports = { setupPush };
