// public/sw.js — Phase B+ (final deep-link hardening + SPA fallback hint)
// Force browsers to fetch this exact worker on deploy by bumping SW_VERSION
const SW_VERSION = 'v2025-11-10-2';

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

  event.waitUntil(Promise.all([
    showNotif,
    broadcastToClients({ type: 'SAFE_PUSH', url, payload, title, body, sw: SW_VERSION })
  ]));
});

// --- Click → focus or open the target URL ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = (event.notification && event.notification.data) || {};
  let target = data.url || data.deep_link || (data.payload && (data.payload.deep_link || data.payload.url));

  // Fallbacks: build from case id, or as a last resort hint the SPA to redirect
  const caseId = (data && (data.case_id || data.caseId)) || (data.payload && (data.payload.case_id || data.payload.caseId));
  if (!target && caseId != null) {
    // First try the direct public page
    target = `open/${caseId}`; // resolved below under SW scope (/SAFE/)
  }

  event.waitUntil((async () => {
    // If still nothing, synthesize a SPA hint like /SAFE/?open_case=123
    if (!target && caseId != null) {
      try {
        const u = new URL(self.registration.scope);
        u.searchParams.set('open_case', String(caseId));
        target = u.href;
      } catch {
        target = self.registration.scope + '?open_case=' + String(caseId);
      }
    }

    // Fallback to scope root if still nothing at all
    if (!target) target = self.registration.scope;

    // Normalize any /cases/{id} → /open/{id} and resolve rel/abs under scope
    try {
      let u = new URL(target, self.registration.scope);
      if (/\/cases\//.test(u.pathname)) {
        u.pathname = u.pathname.replace(/\/cases\//, '/open/');
      }
      target = u.href;
    } catch {}

    // If this is an Open Case deep-link, always open a NEW tab/window for determinism
    if (/\/open\/(\d+)/.test(target) && self.clients.openWindow) {
      return self.clients.openWindow(target);
    }

    // Otherwise prefer focus + navigate of an existing SAFE tab
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      try {
        if (tab.url && tab.url.startsWith(self.registration.scope)) {
          try { if ('navigate' in tab) await tab.navigate(target); } catch {}
          return tab.focus();
        }
      } catch {}
    }

    // No suitable tab: open a new one
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

// --- Token rotation hook ---
self.addEventListener('pushsubscriptionchange', () => {
  broadcastToClients({ type: 'PUSH_TOKEN_EXPIRED', sw: SW_VERSION });
});
