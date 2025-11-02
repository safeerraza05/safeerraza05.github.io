// public/sw.js

// Fast activate on update
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Resolve URLs relative to the SW scope (works on GitHub Pages subpaths like /SAFE/)
function scopedUrl(path) {
  try { return new URL(path, self.registration.scope).href; } catch { return path; }
}

// Broadcast a message to all controlled windows
async function broadcastToClients(message) {
  try {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      try { tab.postMessage(message); } catch {}
    }
  } catch {}
}

// --- Handle incoming Web Push ---
// Shows a notification AND pings open tabs so your AlertBell can update (expects type: 'SAFE_PUSH').
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {
    try { data = JSON.parse(event.data.text()); } catch { data = {}; }
  }

  const title   = data.title || 'SAFE Alert';
  const body    = data.body  || 'New alert near you.';
  const url     = (data.url || '/').toString();   // deep link to open
  const payload = data.data || null;              // full FR-6 payload from backend
  const icon    = scopedUrl('icons/icon-192.png'); // GH Pages-safe

  const showNotif = self.registration.showNotification(title, {
    body,
    icon,
    badge: icon,
    data: { url, payload },  // keep payload on the notif too
  });

  // Also notify open tabs so the bell can blink and the inbox can update
  const pingTabs = broadcastToClients({ type: 'SAFE_PUSH', url, payload, title, body });

  event.waitUntil(Promise.all([showNotif, pingTabs]));
});

// --- Click → focus or open the target URL ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification?.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (tabs) => {
      // Prefer a tab already controlled by this SW; otherwise open one
      for (const tab of tabs) {
        try {
          if (tab.url && tab.url.startsWith(self.registration.scope)) {
            try { if ('navigate' in tab) await tab.navigate(url); } catch {}
            return tab.focus();
          }
        } catch {}
      }
      if (tabs[0]) {
        try { if ('navigate' in tabs[0]) await tabs[0].navigate(url); } catch {}
        return tabs[0].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// --- Token rotation hook ---
// Browsers can rotate push tokens. We can't re-subscribe here (no email/VAPID available),
// so tell pages to refresh/rebind the token if needed.
self.addEventListener('pushsubscriptionchange', () => {
  // Page can listen for this and call rebind/enable again (non-blocking)
  broadcastToClients({ type: 'PUSH_TOKEN_EXPIRED' });
});
