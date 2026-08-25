/* Live update channel.

   Every instance already open polls version.json and, when the build id moves,
   swaps the hot stylesheets and re-runs the hot scripts in place — no reload,
   no lost state. Hot scripts tear their previous instance down through
   __hotRegister/__hotTeardown before the replacement runs.

   Keep this file boring: it is the one piece that cannot hot-swap itself. */
(function liveUpdate() {
  if (window.__liveUpdate) return;

  const script = document.currentScript;
  const ROOT = (script && script.src ? script.src : "local/live-update.js").replace(
    /local\/[^/]+$/,
    "",
  );
  let build = (script && script.dataset.build) || "0";

  const teardowns = new Map();
  window.__hotRegister = (name, fn) => teardowns.set(name, fn);
  window.__hotTeardown = (name) => {
    const fn = teardowns.get(name);
    if (!fn) return;
    teardowns.delete(name);
    try {
      fn();
    } catch {
      /* a module that cannot clean up still gets replaced */
    }
  };

  let manifest = null;
  let busy = false;
  let timer = 0;

  function toast(message) {
    let el = document.getElementById("live-update-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "live-update-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    window.clearTimeout(el.__hide);
    el.__hide = window.setTimeout(() => el.classList.remove("show"), 4200);
  }

  function tail(path) {
    return String(path).split("?")[0].replace(/^\.?\//, "");
  }

  function swapStyles(paths, nextBuild) {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
    paths.forEach((path) => {
      const want = tail(path);
      const old = links.find((l) => tail(new URL(l.href, location.href).pathname).endsWith(want));
      const fresh = document.createElement("link");
      fresh.rel = "stylesheet";
      fresh.href = `${ROOT}${want}?v=${encodeURIComponent(nextBuild)}`;
      if (old) {
        fresh.addEventListener("load", () => old.remove(), { once: true });
        fresh.addEventListener("error", () => fresh.remove(), { once: true });
        old.after(fresh);
      } else {
        document.head.appendChild(fresh);
      }
    });
  }

  function runScript(path, nextBuild) {
    return new Promise((resolve) => {
      const el = document.createElement("script");
      el.src = `${ROOT}${tail(path)}?v=${encodeURIComponent(nextBuild)}`;
      el.dataset.hot = tail(path);
      el.addEventListener("load", () => resolve(true), { once: true });
      el.addEventListener("error", () => resolve(false), { once: true });
      document.body.appendChild(el);
    });
  }

  async function apply(next) {
    busy = true;
    try {
      if (next.reload) {
        toast(next.note ? `updated · ${next.note}` : "updated · reloading");
        window.setTimeout(() => location.reload(), 180);
        return;
      }
      // Stylesheets first so the incoming scripts land on the new rules.
      swapStyles(next.css || [], next.build);

      // Every hot script is torn down, then re-run in declared order: the set is
      // small and the order is what index.html uses on a cold load.
      [...teardowns.keys()].forEach((name) => window.__hotTeardown(name));
      document.querySelectorAll("script[data-hot]").forEach((el) => el.remove());
      for (const path of next.js || []) {
        // eslint-disable-next-line no-await-in-loop
        await runScript(path, next.build);
      }

      build = next.build;
      if (script) script.dataset.build = next.build;
      toast(next.note ? `updated · ${next.note}` : "updated");
      // Bring the cached shell in line for the next cold start too.
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        reg?.update?.().catch?.(() => undefined);
        reg?.waiting?.postMessage?.({ type: "SKIP_WAITING" });
      }
    } finally {
      busy = false;
    }
  }

  /* This used to ask for the manifest every 25 seconds, with a cache-busting
     query on it so no cache anywhere could ever answer. One tab left open
     overnight was several thousand billed requests for a file that changes
     when someone deploys, which is not several thousand times a night.
     
     Two changes. The clock is slow now — a quarter of an hour, and nothing at
     all while the tab is in the background, where an update could not be shown
     anyway. And the request is a plain conditional one, so the CDN answers
     most of them and the rest come back as an empty 304. The moments that
     actually matter — coming back to the tab, reconnecting, a new worker
     taking over — still check immediately, throttled so a flurry of them
     costs one request. */
  const SLOW_MS = 15 * 60 * 1000;
  const FLOOR_MS = 60 * 1000;
  let lastCheck = 0;

  async function check(force) {
    if (busy || !navigator.onLine) return;
    const now = Date.now();
    if (!force && now - lastCheck < FLOOR_MS) return;
    lastCheck = now;
    try {
      // No buster and no no-store: let the edge and the browser validate it.
      const res = await fetch(`${ROOT}version.json`, { cache: "no-cache" });
      if (!res.ok) return;
      const next = await res.json();
      if (!next || !next.build) return;
      manifest = next;
      if (next.build !== build) await apply(next);
    } catch {
      /* offline or mid-deploy — the next tick tries again */
    }
  }

  function schedule() {
    window.clearTimeout(timer);
    // A hidden tab is not polled at all. It catches up the moment it is shown.
    if (document.hidden) return;
    timer = window.setTimeout(() => {
      check().finally(schedule);
    }, SLOW_MS);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check();
    schedule();
  });
  window.addEventListener("focus", () => check());
  window.addEventListener("online", () => check());
  // Restoring from the back/forward cache resumes a tab that may have sat idle
  // through a deploy.
  window.addEventListener("pageshow", () => check());
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => check());
  }

  window.__liveUpdate = {
    get build() {
      return build;
    },
    get manifest() {
      return manifest;
    },
    check,
  };

  // First pass runs straight away: a tab that was already open when the deploy
  // landed picks the change up before anyone touches it.
  check(true).finally(schedule);
})();
