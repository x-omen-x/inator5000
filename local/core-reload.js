/* One-time bridge for tabs still running the pre-removal live updater. */
(function coreReload() {
  const target = "2026-08-24-1";
  const key = `omens-core-reload-${target}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* navigation still works without session storage */
  }
  const url = new URL(location.href);
  url.searchParams.set("_build", target);
  location.replace(url.href);
})();
