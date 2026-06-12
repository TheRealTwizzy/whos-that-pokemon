const CACHE_PREFIX = "pokedex-trainer-os-";
const CACHE_NAME = `${CACHE_PREFIX}v4`;
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
    caches.keys().then(async (keys) => {
      const oldAppCaches = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
      if (!oldAppCaches.length) return;

      const clients = await self.clients.matchAll({ type: "window" });
      await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => null)));
    }),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).catch(() => caches.match("./index.html")),
    ),
  );
});
