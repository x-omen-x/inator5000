/* Launch-only app-shell update check.

   An open tab never hot-swaps or polls. A new build is checked once when this
   document opens; if the shell is newer, the page reloads once so the normal
   service-worker navigation path can apply it. IndexedDB media is not touched.
   Offline launches keep using the already-cached shell. */
(function launchUpdate() {
  if (window.__liveUpdate) return;

  const script = document.currentScript;
  const ROOT = (script && script.src ? script.src : "local/live-update.js").replace(
    /local\/[^/]+$/,
    "",
  );
  const build = (script && script.dataset.build) || "0";
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

  window.__liveUpdate = {
    get build() {
      return build;
    },
    get manifest() {
      return manifest;
    },
    check: checkAtLaunch,
  };

  // This is intentionally the only check from the page. There are no timers,
  // focus/visibility/online listeners, hot swaps, or periodic background sync.
  checkAtLaunch();
})();
