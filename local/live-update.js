/* Launch-only app-shell update check.

   An open tab never hot-swaps or polls. A new build is checked once when this
   document opens; if the shell is newer, the page reloads once so the normal
   service-worker navigation path can apply it. IndexedDB media is not touched.
   Offline launches keep using the already-cached shell.

   The post-baseline enhancements are isolated in their own files. They load
   after the established app modules have mounted, so the existing UI, mascot,
   TINA mode and slideshow engine remain the source of truth. */
(function launchUpdate() {
  if (window.__liveUpdate) return;

  const script = document.currentScript;
  const ROOT = (script && script.src ? script.src : "local/live-update.js").replace(
    /local\/[^/]+$/,
    "",
  );
  const build = "2026-09-03-2";
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

  function removeFiveThousand() {
    try { window.__hotTeardown?.("five-thousand"); } catch {}
    document.querySelectorAll(".five-k-block,#five-k").forEach((node) => node.remove());
    if (!document.getElementById("five-k-removal-style")) {
      const style = document.createElement("style");
      style.id = "five-k-removal-style";
      style.textContent = ".five-k-block,#five-k{display:none!important}";
      document.head.appendChild(style);
    }
  }

  async function loadEnhancements() {
    removeFiveThousand();
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

  checkAtLaunch();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadEnhancements, { once: true });
  } else {
    loadEnhancements();
  }
})();
