// public/sw.js — deterministic click hand-off to SPA
const SW_VERSION = 'v2025-11-11-1';

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

// --- Show the toast on push ---
self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { try { p = JSON.parse(event.data.text()); } catch {} }

  const title = p.title || 'SAFE Alert';
  const body  = p.body  || 'New alert near you.';
  const icon  = scopedUrl('icons/icon-192.png');

  // Store only minimal, robust data on the notification itself.
  const notifData = {
    url:      (p.url || p.deep_link || null),
    deep_link: p.deep_link || null,
    payload:   p.data || null
  };

  const show = self.registration.showNotification(title, {
    body, icon, badge: icon, data: notifData
  });

  event.waitUntil(show);
});

// --- Click: navigate existing SPA tab; openWindow only if no tab exists ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const d = (event.notification && event.notification.data) || {};
  // Prefer explicit URL/deep_link; fall back to payload.case_id
  let url = d.url || d.deep_link || (d.payload && (d.payload.deep_link || d.payload.url)) || null;
  const caseId =
    (d && (d.case_id || d.caseId)) ||
    (d.payload && (d.payload.case_id || d.payload.caseId)) || null;

  // Synthesize deep link if needed
  try {
    if (!url && caseId) url = new URL('/SAFE/open/' + String(caseId), self.registration.scope).href;
    if (!url && caseId) url = self.registration.scope + '?open_case=' + encodeURIComponent(String(caseId));
  } catch (_) {
    if (!url && caseId) url = self.registration.scope + '?open_case=' + encodeURIComponent(String(caseId));
  }
  if (!url) url = self.registration.scope; // absolute fallback

  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    if (tabs && tabs.length) {
      // 1) Tell the SPA exactly where to go
      await broadcastToClients({ type: 'SAFE_NOTIF_CLICK', url, case_id: caseId, sw: SW_VERSION });
      // 2) Bring a SAFE tab to front
      try { await tabs[0].focus(); } catch {}
      return;
    }

    // No controlled tab → open new one
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

// Token rotation hint (unchanged)
self.addEventListener('pushsubscriptionchange', () => {
  broadcastToClients({ type: 'PUSH_TOKEN_EXPIRED', sw: SW_VERSION });
});
