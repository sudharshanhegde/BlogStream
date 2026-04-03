const CACHE_NAME = "notecast-v1";
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

  // Backend API calls — network only, never cache
  if (url.hostname !== location.hostname) {
    // Cloudinary audio — network first, no caching (large files)
    if (url.hostname.includes("cloudinary.com") || url.hostname.includes("res.cloudinary")) {
      event.respondWith(fetch(event.request));
      return;
    }
    // Any other external origin (API) — network only
    event.respondWith(fetch(event.request));
    return;
  }

  // Static frontend assets — cache first, fallback to network
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
