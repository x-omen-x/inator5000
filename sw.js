const CACHE = "gooninator-reloaded-v25";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./fonts.css",
  "./vendor/jszip.min.js",
  "./spurr.m4a",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./fonts/orbitron.woff2",
  "./fonts/share-tech-mono.woff2",
  "./fonts/f0.ttf",
  "./fonts/f3.ttf",
  "./fonts/f4.ttf",
  "./fonts/matrix-code-nfi.woff",
  "./fonts/matrix.woff",
  "./version.json",
  "./local/perf.js?v=1",
  "./local/live-update.js?v=2",
  "./local/splat.js?v=1",
  "./local/fonts/title-faces.css?v=3",
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
  "./local/assets/chrome-real.jpg",
  "./local/assets/beepboop.m4a",
  "./local/assets/sparkle/spark.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

// live-update.js asks the new worker to take over as soon as it has swapped the
// page's modules, so the next cold start is already on the new shell.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol === "blob:" || url.protocol === "data:") return;
  // The build manifest must not be answered from the offline cache — it is how
  // an open instance learns there is something new — but it is fine for the
  // edge to answer it. A revalidating request usually comes back as an empty
  // 304 instead of a fresh download.
  if (url.origin === location.origin && url.pathname.endsWith("/version.json")) {
    event.respondWith(
      fetch(req, { cache: "no-cache" }).catch(() => caches.match("./version.json")),
    );
    return;
  }
  if (/soundcloud\.com|snd\.sc|w\.soundcloud/.test(url.hostname)) return;
  event.respondWith(
    (async () => {
      // A ?v= buster means a hot update asked for this exact build, so the
      // offline pack (which is keyed by bare path) must not answer it.
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        const neuralHost = /jsdelivr\.net|huggingface\.co|hf\.co|cdn-lfs/.test(url.hostname);
        if (res.ok && (url.origin === location.origin || neuralHost)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      } catch {
        return caches.match("./index.html");
      }
    })(),
  );
});
