// public/sw.js — FINAL (cache last push + openWindow for /open and ?open_case=)
const SW_VERSION = 'v2025-11-11-2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function absUrl(pathOrUrl) {
  try { return new URL(pathOrUrl, self.registration.scope).href; } catch { return self.registration.scope; }
}

async function broadcastToClients(message) {
  try {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) { try { tab.postMessage(message); } catch {} }
  } catch {}
}

// Receive push → show notification AND broadcast details so page can cache fallback
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { try { data = JSON.parse(event.data.text()); } catch {} }

  const title = data.title || 'SAFE Alert';
  const body  = data.body  || 'New alert near you.';
  const url   = (data.url || data.deep_link || '').toString();
  const payload = data.data || null;
  const icon    = absUrl('icons/icon-192.png');

  event.waitUntil(broadcastToClients({ type: 'SAFE_PUSH', url, payload, sw: SW_VERSION }));

  event.waitUntil(
    self.registration.showNotification(title, {
      body, icon, badge: icon,
      data: { url, deep_link: data.deep_link || null, payload }
    })
  );
});

// Click → open precise target with deterministic fallbacks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const d = (event.notification && event.notification.data) || {};
  let target = d.url || d.deep_link || (d.payload && (d.payload.deep_link || d.payload.url)) || '';
  let caseId = (d && (d.case_id || d.caseId)) || (d.payload && (d.payload.case_id || d.payload.caseId)) || null;

  event.waitUntil((async () => {
    // If click contains no usable data, ask an existing tab for the cached LAST_SAFE_PUSH
    if (!target && !caseId) {
      try {
        const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (tabs.length) {
          const ch = new MessageChannel();
          const ask = new Promise((resolve) => { ch.port1.onmessage = (e) => resolve(e.data || null); });
          tabs[0].postMessage({ type: 'SAFE_GET_LAST_PUSH' }, [ch.port2]);
          const fallback = await ask; // { url?, case_id? }
          if (fallback) {
            target = fallback.url || '';
            caseId = fallback.case_id || caseId;
          }
        }
      } catch {}
    }

    // Normalize/synthesize a definitive target
    try {
      if (target) {
        const u = new URL(target, self.registration.scope);
        const m = u.pathname.match(/\/(?:cases|open)\/(\d+)/);
        if (m && m[1]) { u.pathname = '/SAFE/open/' + m[1]; u.search = ''; target = u.href; }
        else           { target = u.href; }
      } else if (caseId) {
        target = absUrl('/SAFE/open/' + String(caseId));
      } else {
        target = absUrl('/'); // absolute fallback
      }
    } catch {
      target = caseId ? absUrl('/SAFE/open/' + String(caseId)) : absUrl('/');
    }

    // Consider /open/<id> or /?open_case=<id> as hard deep-links → always open new tab
    const isHardLink = /\/open\/\d+/.test(target) || /[?&]open_case=\d+\b/.test(target);
    if (isHardLink && self.clients.openWindow) {
      return self.clients.openWindow(target);
    }

    // Otherwise try to reuse a SAFE tab
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

// Token rotation hint
self.addEventListener('pushsubscriptionchange', () => {
  broadcastToClients({ type: 'PUSH_TOKEN_EXPIRED', sw: SW_VERSION });
});
