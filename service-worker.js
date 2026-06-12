const CACHE_NAME = "pokedex-trainer-os-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.mjs",
  "./src/audio.mjs",
  "./src/auth.mjs",
  "./src/core.mjs",
  "./src/pokemon-api.mjs",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./icons/pokedex-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => null),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).catch(() => caches.match("./index.html")),
    ),
  );
});
