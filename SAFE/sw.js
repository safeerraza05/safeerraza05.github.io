// public/sw.js — Phase B+ (force openWindow for /open/, add ?open_case= fallback, version bump)
// Bumps version so browsers fetch the latest worker on deploy
const SW_VERSION = 'v2025-11-10-2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function scopedUrl(path) {
  try { return new URL(path, self.registration.scope).href; } catch { return path; }
}

// Broadcast helper (used for in-page bells, optional)
async function broadcastToClients(message) {
  try {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) { try { tab.postMessage(message); } catch {} }
  } catch {}
}

// ---- receive push, show toast, forward minimal payload to pages
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { try { data = JSON.parse(event.data.text()); } catch {} }

  const title   = data.title || 'SAFE Alert';
  const body    = data.body  || 'New alert near you.';
  const url     = (data.url || data.deep_link || '/').toString();
  const payload = data.data || null;
  const icon    = scopedUrl('icons/icon-192.png');

  const showNotif = self.registration.showNotification(title, {
    body,
    icon,
    badge: icon,
    data: { url, deep_link: data.deep_link, payload }, // available to click handler
  });

  const pingTabs = broadcastToClients({ type: 'SAFE_PUSH', url, payload, title, body, sw: SW_VERSION });
  event.waitUntil(Promise.all([showNotif, pingTabs]));
});

// ---- click → open precise target (new tab for /open/<id>), with robust fallbacks
self.addEventListener('notificationclick', (event) => {
  event.preventDefault();
  event.notification.close();

  const data = (event.notification && event.notification.data) || {};
  let target = data.url || data.deep_link || (data.payload && (data.payload.deep_link || data.payload.url)) || '';

  // Extract case id from payload if present
  const caseId =
    (data && (data.case_id || data.caseId)) ??
    (data.payload && (data.payload.case_id || data.payload.caseId)) ?? null;

  event.waitUntil((async () => {
    // Normalize/resolve
    try {
      let u = new URL(target || '.', self.registration.scope);
      // Convert any /cases/<id> → /open/<id>
      const m = u.pathname.match(/\/(cases|open)\/(\d+)/);
      if (m && m[2]) {
        u.pathname = `/SAFE/open/${m[2]}`;
        u.search = ''; // ensure clean deep-link
        target = u.href;
      } else if (!target && caseId) {
        // If no usable URL but we have an id, synthesize a deep link
        target = new URL(`/SAFE/open/${String(caseId)}`, self.registration.scope).href;
      } else {
        // Fallback to scope root if still empty
        if (!target) target = self.registration.scope;
        else target = u.href;
      }
    } catch {
      // absolute fallback to root if URL parsing fails
      target = self.registration.scope;
    }

    // If we ended up with an /open/<id>, always open in a new tab/window (deterministic)
    if (/\/open\/\d+/.test(target) && self.clients.openWindow) {
      return self.clients.openWindow(target);
    }

    // Otherwise prefer focusing an existing SAFE tab and navigating it
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      try {
        if (tab.url && tab.url.startsWith(self.registration.scope)) {
          try { if ('navigate' in tab) await tab.navigate(target); } catch {}
          return tab.focus();
        }
      } catch {}
    }
    // No suitable tab found → open new window
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

// ---- token rotation hint
self.addEventListener('pushsubscriptionchange', () => {
  broadcastToClients({ type: 'PUSH_TOKEN_EXPIRED', sw: SW_VERSION });
});
