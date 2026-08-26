const CACHE = "omens-plapinator-v35";
const APP_CACHE_PREFIXES = ["omens-plapinator-", "gooninator-reloaded-", "gooninator-local-", "cloudyplap-pack-"];
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=18",
  "./app.js?v=21",
  "./fonts.css",
  "./vendor/jszip.min.js",
  "./spurr.m4a",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./og.jpg",
  "./fonts/orbitron.woff2",
  "./fonts/share-tech-mono.woff2",
  "./fonts/f0.ttf",
  "./fonts/f3.ttf",
  "./fonts/f4.ttf",
  "./fonts/matrix-code-nfi.woff",
  "./fonts/matrix.woff",
  "./version.json",
  "./local/perf.js?v=1",
  "./local/live-update.js?v=4",
  "./local/cloudyplap.js?v=14",
  "./local/splat.js?v=1",
  "./local/five-thousand.js?v=3",
  "./local/five-thousand.css?v=2",
  "./local/theme.css?v=14",
  "./local/fonts/title-faces.css?v=5",
  "./local/fonts/bungee.woff2",
  "./local/fonts/bungee-shade.woff2",
  "./local/fonts/bungee-inline.woff2",
  "./local/fonts/bungee-outline.woff2",
  "./local/fonts/anton.woff2",
  "./local/fonts/bebasneue.woff2",
  "./local/fonts/newrocker.woff2",
  "./local/fonts/eater.woff2",
  "./local/fonts/creepster.woff2",
  "./local/fonts/ghastly-panic.ttf",
  "./local/assets/mascot-idle.png",
  "./local/assets/pipe.png?v=2",
  "./local/assets/smoke-wisp-loop.mp4",
  "./local/assets/smoke-puff.mp4",
  "./local/assets/app-icon.png",
  "./local/assets/share-card.jpg",
  "./local/assets/chrome-fill.jpg",
  "./local/assets/chrome-real.jpg",
  "./local/assets/beepboop.m4a",
  "./local/assets/sparkle/spark.svg",
  "./local/assets/frame-green.png",
];

self.addEventListener("install", (event) => {
  // Build a complete new shell before activating it. `reload` bypasses any
  // stale immutable HTTP entry; a failed download leaves the previous worker
  // and cache intact instead of installing a partial update.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== CACHE &&
                APP_CACHE_PREFIXES.some((prefix) => String(key).startsWith(prefix)),
            )
            // These are app-shell Cache Storage entries only. User photos,
            // videos and audio live in IndexedDB and are never read or erased
            // by the service worker update path.
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirst(request, fallback) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (fallback ? await cache.match(fallback) : undefined);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.protocol === "blob:" || url.protocol === "data:") return;
  if (/soundcloud\.com|snd\.sc|w\.soundcloud/.test(url.hostname)) return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/version.json")) {
    event.respondWith(networkFirst(request, "./version.json"));
    return;
  }

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  event.respondWith(cacheFirst(request));
});
