/* Launch-only app-shell update check.

   An open tab never hot-swaps or polls. A new build is checked once when this
   document opens; if the shell is newer, the page reloads once so the normal
   service-worker navigation path can apply it. IndexedDB media is not touched.
   Offline launches keep using the already-cached shell.

   The manual title / iOS-save pass is isolated in its own files. They are
   loaded only after the existing app modules have mounted, so none of the
   established UI, mascot, TINA mode, slideshow, or 5000 boot module is
   replaced. */
(function launchUpdate() {
  if (window.__liveUpdate) return;

  const script = document.currentScript;
  const ROOT = (script && script.src ? script.src : "local/live-update.js").replace(
    /local\/[^/]+$/,
    "",
  );
  // Kept inside the updater for this isolated patch so the restored baseline
  // index.html does not have to be rewritten just to change one data attribute.
  const build = "2026-08-31-1";
  let manifest = null;
  let checked = false;

  async function checkAtLaunch() {
    if (checked || !navigator.onLine) return;
    checked = true;
    try {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      const updatePromise = registration?.update?.();
      await updatePromise?.catch?.(() => undefined);
      const response = await fetch(`${ROOT}version.json`, { cache: "no-cache" });
      if (!response.ok) return;
      const next = await response.json();
      if (!next?.build) return;
      manifest = next;
      if (next.build === build) return;

      // Prevent an old cached document from reloading forever if the network
      // disappears between the check and the navigation.
      const reloadKey = `flashreel-update-reload:${next.build}`;
      if (sessionStorage.getItem(reloadKey) === "1") return;
      sessionStorage.setItem(reloadKey, "1");
      window.setTimeout(() => location.reload(), 0);
    } catch {
      /* Offline or mid-deploy: keep the current shell intact. */
    }
  }

  function loadStyle(href, id) {
    if (document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve) => {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
      // A cached/offline stylesheet can paint before some WebKit versions fire
      // load. Do not hold the enhancement scripts hostage to that event.
      window.setTimeout(resolve, 1200);
    });
  }

  function loadScript(src, id) {
    if (document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.id = id;
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = resolve;
      document.body.appendChild(s);
    });
  }

  async function loadManualEnhancements() {
    // Wait until the baseline synchronous scripts have run. This means these
    // files can only decorate the existing header / download controls; they do
    // not race or replace the app's own construction code.
    await loadStyle(`${ROOT}local/manual-title.css?v=1`, "manual-title-css");
    await loadScript(`${ROOT}local/manual-title.js?v=1`, "manual-title-js");
    await loadScript(`${ROOT}local/ios-save-fix.js?v=1`, "ios-save-fix-js");
  }

  window.__liveUpdate = {
    get build() {
      return build;
    },
    get manifest() {
      return manifest;
    },
    check: checkAtLaunch,
  };

  // This is intentionally the only update check from the page. There are no
  // update polling timers, focus/visibility/online listeners, hot swaps, or
  // periodic background sync.
  checkAtLaunch();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadManualEnhancements, { once: true });
  } else {
    loadManualEnhancements();
  }
})();
