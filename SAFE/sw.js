// public/sw.js — full replacement (robust deep-link handling)

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
  const url     = (data.url || data.deep_link || '/').toString();   // prefer explicit deep_link
  const payload = data.data || null;                                 // full FR-6 payload from backend
  const icon    = scopedUrl('icons/icon-192.png');                   // GH Pages-safe

  const showNotif = self.registration.showNotification(title, {
    body,
    icon,
    badge: icon,
    data: { url, deep_link: data.deep_link, payload },  // keep everything for click handler
  });

  // Also notify open tabs so the bell can blink and the inbox can update
  const pingTabs = broadcastToClients({ type: 'SAFE_PUSH', url, payload, title, body });

  event.waitUntil(Promise.all([showNotif, pingTabs]));
});

// --- Click → focus or open the target URL ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Extract absolute URL from payload variants
  const data = (event.notification && event.notification.data) || {};
  let target = data.url || data.deep_link || (data.payload && (data.payload.deep_link || data.payload.url));

  // Fallback to scope root if nothing present
  if (!target) target = self.registration.scope;

  event.waitUntil((async () => {
    // Resolve relative URLs (e.g., "open/123") against the SW scope (/SAFE/)
    try { target = new URL(target, self.registration.scope).href; } catch {}

    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      try {
        if (tab.url && tab.url.startsWith(self.registration.scope)) {
          try { if ('navigate' in tab) await tab.navigate(target); } catch {}
          return tab.focus();
        }
      } catch {}
    }

    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

// --- Token rotation hook ---
// Browsers can rotate push tokens. We can't re-subscribe here (no email/VAPID available),
// so tell pages to refresh/rebind the token if needed.
self.addEventListener('pushsubscriptionchange', () => {
  broadcastToClients({ type: 'PUSH_TOKEN_EXPIRED' });
});
