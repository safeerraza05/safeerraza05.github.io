// public/sw.js — FINAL
const SW_VERSION = 'v2025-11-10-3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function scopedUrl(path) {
  try { return new URL(path, self.registration.scope).href; } catch { return path; }
}

async function broadcastToClients(message) {
  try {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) { try { tab.postMessage(message); } catch {} }
  } catch {}
}

// Receive push → show notification
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { try { data = JSON.parse(event.data.text()); } catch {} }

  const title = data.title || 'SAFE Alert';
  const body  = data.body  || 'New alert near you.';
  const url   = (data.url || data.deep_link || '/').toString();
  const payload = data.data || null;
  const icon    = scopedUrl('icons/icon-192.png');

  const showNotif = self.registration.showNotification(title, {
    body,
    icon,
    badge: icon,
    data: { url, deep_link: data.deep_link, payload },
  });
  const pingTabs = broadcastToClients({ type: 'SAFE_PUSH', url, payload, title, body, sw: SW_VERSION });
  event.waitUntil(Promise.all([showNotif, pingTabs]));
});

// Click → open precise target with deterministic fallbacks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = (event.notification && event.notification.data) || {};
  let target = data.url || data.deep_link || (data.payload && (data.payload.deep_link || data.payload.url)) || '';
  const caseId = (data && (data.case_id || data.caseId)) || (data.payload && (data.payload.case_id || data.payload.caseId)) || null;

  event.waitUntil((async () => {
    try {
      let u = new URL(target || '.', self.registration.scope);
      const m = u.pathname.match(/\/(?:cases|open)\/(\d+)/);
      if (m && m[1]) {
        u.pathname = '/SAFE/open/' + m[1];
        u.search = '';
        target = u.href;
      } else if (!target && caseId) {
        // Try to synthesize a full deep link; if it fails, fall back to query-hint
        try {
          target = new URL('/SAFE/open/' + String(caseId), self.registration.scope).href;
        } catch (_) {
          target = self.registration.scope + '?open_case=' + encodeURIComponent(String(caseId));
        }
      } else if (!target && caseId) {
        target = self.registration.scope + '?open_case=' + encodeURIComponent(String(caseId));
      } else {
        target = u.href;
      }
    } catch (_) {
      // Absolute fallback
      target = caseId ? (self.registration.scope + '?open_case=' + encodeURIComponent(String(caseId))) : self.registration.scope;
    }

    // If we have an /open/<id>, always open in a new tab/window for determinism
    if (/\/open\/\d+/.test(target) && self.clients.openWindow) {
      return self.clients.openWindow(target);
    }

    // Otherwise, try to reuse an existing SAFE tab
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      try {
        if (tab.url && tab.url.startsWith(self.registration.scope)) {
          try { if ('navigate' in tab) await tab.navigate(target); } catch {}
          return tab.focus();
        }
      } catch {}
    }

    // No suitable tab → open new
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

// Token rotation hint
self.addEventListener('pushsubscriptionchange', () => {
  broadcastToClients({ type: 'PUSH_TOKEN_EXPIRED', sw: SW_VERSION });
});