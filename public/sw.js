// Recibe las notificaciones aunque la app esté cerrada y, al tocarlas, abre la app en el lead.
// No guarda nada en caché: la app siempre se carga del servidor (así cada actualización se ve al momento).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Maass Leads', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Maass Leads', {
    body: data.body || '', tag: data.tag, renotify: Boolean(data.tag), icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) { await open.focus(); open.postMessage({ openUrl: url }); return; }
    await self.clients.openWindow(url);
  })());
});
