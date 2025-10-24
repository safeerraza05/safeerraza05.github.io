// public/sw.js

// (Optional) fast activate on update
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// --- Web Push: show notification when a push arrives ---
self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'SAFE Alert';
    const body  = data.body  || 'New alert near you.';
    const url   = data.url   || '/';
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',     // optional
        badge: '/icons/icon-192.png',    // optional
        data: { url }
      })
    );
  } catch {
    event.waitUntil(
      self.registration.showNotification('SAFE Alert', {
        body: 'Open the app for details.'
      })
    );
  }
});

// --- Click → focus or open the target URL ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if ('focus' in tab) { tab.navigate(url); return tab.focus(); }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
