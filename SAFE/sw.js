// public/sw.js

// (Optional) fast activate on update
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Resolve asset URLs relative to the SW scope (handles GH Pages subpath)
function scopedUrl(path) {
  try {
    return new URL(path, self.registration.scope).href;
  } catch {
    return path; // fallback
  }
}

// --- Web Push: show notification when a push arrives ---
self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'SAFE Alert';
    const body  = data.body  || 'New alert near you.';
    const url   = data.url   || '/';
    const icon  = scopedUrl('icons/icon-192.png'); // no leading slash
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon,
        badge: icon,
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
        // Prefer focusing an existing tab; navigate it to url if needed
        if ('focus' in tab) {
          try { if ('navigate' in tab) tab.navigate(url); } catch {}
          return tab.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
