// La Ruta del Churchill — service worker.
// Strategy: network-first for same-origin files (the game updates often;
// world-data.js must never go stale), falling back to cache offline.
// CDN assets (React/Babel/fonts — versioned URLs) are cache-first.
const CACHE = "churchill-99a91f7f30";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./world-data.js",
  "./world.js",
  "./engine.js",
  "./tweaks-panel.jsx",
  "./ui.jsx",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === self.location.origin) {
    // network-first: fresh game files when online, cached shell offline
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true })
          .then((hit) => hit || caches.match("./index.html")))
    );
  } else {
    // cache-first for immutable CDN files (unpkg is versioned, fonts stable)
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
      )
    );
  }
});
