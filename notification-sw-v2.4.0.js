// v2.4.0 — Web App/PWA notification helper.
'use strict';

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification?.data?.url || '/';
    event.waitUntil((async () => {
        const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            try {
                if ('focus' in client) {
                    await client.focus();
                    return;
                }
            } catch (_) {}
        }
        if (clients.openWindow) {
            try { await clients.openWindow(url); } catch (_) {}
        }
    })());
});
