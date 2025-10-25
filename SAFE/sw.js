// public/sw.js

// Fast activate on update
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Resolve asset paths correctly under a scoped base (e.g., /SAFE/)
function scopedUrl(path) {
  try { return new URL(path, self.registration.scope).href; } catch { return path; }
}

// Broadcast a message to all open tabs under this SW scope
async function broadcastToClients(message) {
  try {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      try { tab.postMessage(message); } catch {}
    }
  } catch {}
}

// --- Web Push: show notification AND ping pages (for blinking bell/inbox) ---
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  const title   = data.title || 'SAFE Alert';
  const body    = data.body  || 'New alert near you.';
  const url     = (data.url || '/').toString();   // deep link to open
  const payload = data.data || null;              // full alert payload for the app

  const icon  = scopedUrl('icons/icon-192.png');
  const badge = scopedUrl('icons/icon-192.png');

  const showNotif = self.registration.showNotification(title, {
    body,
    icon,
    badge,
    data: { url, payload },
  });

  // Also notify open tabs so UI can blink a bell and update an inbox immediately
  const pingTabs = broadcastToClients({ type: 'SAFE_PUSH', title, body, url, payload });

  event.waitUntil(Promise.all([showNotif, pingTabs]));
});

// --- Click → focus or open the target URL ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification?.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        // If any tab is already open, navigate it and focus
        if ('focus' in tab) { tab.navigate(url); return tab.focus(); }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// (Optional) Handle subscription change events if you later want to re-register keys
// self.addEventListener('pushsubscriptionchange', async (event) => { /* no-op */ });
