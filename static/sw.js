// Minimal service worker.  It exists only so the app satisfies the
// installability criteria and can run in its own window.  It deliberately
// does NOT cache anything: the fetch handler is empty, so every request
// goes straight to the network.  This avoids serving stale assets, which
// was a real problem during development.
self.addEventListener('install', function() {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
    // Intentionally empty: network pass-through, no offline cache.
});
