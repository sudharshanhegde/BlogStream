const CACHE_NAME = "notecast-v5";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/library.html",
  "/app.js",
  "/library.js",
  "/style.css",
  "/manifest.json",
  "/ambient/rain.mp3",
  "/ambient/ocean.mp3",
  "/ambient/lofi.mp3",
];

// ── Install: cache all static assets ─────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache what's available, ignore missing ambient files gracefully
      return Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

// ── Activate: remove old caches ───────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ─────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Let the browser handle all cross-origin requests natively (API + Cloudinary)
  // Never intercept them — doing so breaks CORS
  if (url.hostname !== location.hostname) {
    return;
  }

  // Same-origin frontend assets only — cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
