/* iOS installed-app ZIP save bridge.
   Safari standalone PWAs can ignore an asynchronously-triggered <a download>
   for blob: URLs. Build the ZIP normally, then present one explicit user-tap
   Save button so iOS can hand the finished File to the native share sheet.
   No media leaves the device unless the user chooses a share destination. */
(function iosInstalledZipFix() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)")?.matches;
  if (!isIOS || !isStandalone) return;

  const $id = (id) => document.getElementById(id);
  let tray = null;
  let queue = [];
  let saving = false;

  function cleanName(name) {
    return String(name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 80) || "file";
  }

  async function slideBlob(slide) {
    if (slide?.file instanceof Blob) return slide.file;
    if (!slide?.url) throw new Error("Media is unavailable");
    const res = await fetch(slide.url);
    if (!res.ok) throw new Error(`Could not read media (${res.status})`);
    return res.blob();
  }

  async function makeZip(slides, zipName) {
    if (!window.JSZip) throw new Error("Zip engine missing");
    if (!slides?.length) throw new Error("There is no media in that selection to zip");
    setStatus?.(`Packing ${slides.length} media item${slides.length === 1 ? "" : "s"}…`);
    const zip = new JSZip();
    const folder = zip.folder(zipName) || zip;
    let packed = 0;
    let skipped = 0;
    for (const slide of slides) {
      try {
        const blob = await slideBlob(slide);
        packed += 1;
        folder.file(
          `${String(packed).padStart(3, "0")}-${cleanName(slide.alt || (slide.kind === "video" ? "video" : "image"))}`,
          blob,
        );
      } catch (err) {
        skipped += 1;
        console.error("Could not add media to zip:", slide?.alt, err);
      }
      if ((packed + skipped) % 16 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    if (!packed) throw new Error("None of the selected media could be read");
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    return {
      file: new File([blob], `${cleanName(zipName)}.zip`, { type: "application/zip", lastModified: Date.now() }),
      packed,
      skipped,
    };
  }

  function ensureTray() {
    if (tray?.isConnected) return tray;
    tray = document.createElement("div");
    tray.id = "ios-zip-save-tray";
    tray.setAttribute("role", "dialog");
    tray.setAttribute("aria-modal", "true");
    tray.setAttribute("aria-labelledby", "ios-zip-save-title");
    tray.innerHTML = `
      <div class="ios-zip-save-card">
        <div class="ios-zip-save-kicker">ZIP READY</div>
        <strong id="ios-zip-save-title">Save to Files</strong>
        <p id="ios-zip-save-copy"></p>
        <div class="ios-zip-save-actions">
          <button type="button" class="btn" id="ios-zip-save-button">Save ZIP</button>
          <button type="button" class="btn ghost" id="ios-zip-save-close">Cancel</button>
        </div>
      </div>`;
    const style = document.createElement("style");
    style.textContent = `
      #ios-zip-save-tray{position:fixed;inset:0;z-index:12050;display:grid;place-items:end center;padding:1rem max(1rem,env(safe-area-inset-right)) calc(1rem + env(safe-area-inset-bottom)) max(1rem,env(safe-area-inset-left));background:rgba(0,0,0,.56);backdrop-filter:blur(8px)}
      #ios-zip-save-tray[hidden]{display:none!important}
      .ios-zip-save-card{width:min(100%,34rem);padding:1rem;border:1px solid rgba(105,255,140,.58);border-radius:1rem;background:rgba(0,10,3,.97);box-shadow:0 0 32px rgba(25,220,75,.18),0 18px 70px rgba(0,0,0,.72);color:#d8ffe2;font-family:"Share Tech Mono",ui-monospace,monospace}
      .ios-zip-save-kicker{margin-bottom:.35rem;font-size:.68rem;letter-spacing:.22em;color:#77ff99}.ios-zip-save-card strong{display:block;font-size:1.08rem}.ios-zip-save-card p{margin:.55rem 0 .9rem;color:rgba(215,255,225,.72);line-height:1.42}.ios-zip-save-actions{display:flex;gap:.6rem;flex-wrap:wrap}.ios-zip-save-actions .btn{flex:1 1 9rem}`;
    document.head.appendChild(style);
    document.body.appendChild(tray);
    $id("ios-zip-save-close").onclick = () => {
      if (saving) return;
      queue = [];
      tray.hidden = true;
      setStatus?.("ZIP save cancelled. Your media is unchanged.");
    };
    $id("ios-zip-save-button").onclick = saveNext;
    return tray;
  }

  function prettySize(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function showQueue(items) {
    queue = items.filter(Boolean);
    if (!queue.length) return;
    const modal = ensureTray();
    modal.hidden = false;
    updateTray();
  }

  function updateTray() {
    if (!tray || !queue.length) return;
    const item = queue[0];
    const extra = queue.length > 1 ? ` · ${queue.length} ZIPs left` : "";
    $id("ios-zip-save-copy").textContent = `${item.file.name} · ${prettySize(item.file.size)}${extra}. Tap Save ZIP, then choose Save to Files in the iOS sheet.`;
    $id("ios-zip-save-button").textContent = queue.length > 1 ? `Save ZIP · ${queue.length} left` : "Save ZIP";
  }

  function directFallback(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  async function saveNext() {
    if (saving || !queue.length) return;
    saving = true;
    const button = $id("ios-zip-save-button");
    button.disabled = true;
    const item = queue[0];
    try {
      const shareData = { files: [item.file], title: item.file.name };
      const canShareFiles = typeof navigator.share === "function" &&
        (!navigator.canShare || navigator.canShare(shareData));
      if (canShareFiles) {
        // Called directly from this button's user gesture. This is the key
        // difference from the old async <a download> path in standalone mode.
        await navigator.share(shareData);
      } else {
        directFallback(item.file);
      }
      queue.shift();
      if (queue.length) {
        setStatus?.(`Saved ${item.file.name}. ${queue.length} ZIP${queue.length === 1 ? "" : "s"} still ready.`);
        updateTray();
      } else {
        tray.hidden = true;
        setStatus?.(`ZIP saved. Nothing was uploaded.`);
      }
    } catch (err) {
      // AbortError means the user dismissed the sheet. Keep the prepared file
      // queued so they can tap Save again without rebuilding the ZIP.
      if (err?.name !== "AbortError") {
        console.error("iOS ZIP save failed:", err);
        setStatus?.("iOS could not open the save sheet. Tap Save ZIP again, or open this page in Safari and retry.");
      }
    } finally {
      saving = false;
      button.disabled = false;
    }
  }

  async function buildOne(slides, name) {
    try {
      const out = await makeZip(slides, name);
      showQueue([out]);
      setStatus?.(`${out.file.name} is ready. Tap Save ZIP to put it in Files.`);
    } catch (err) {
      console.error(err);
      setStatus?.(err?.message || "Could not create ZIP.");
    }
  }

  async function buildAlbums() {
    try {
      const names = [...new Set(state.slides.map((s) => s.album))];
      if (!names.length) throw new Error("There are no albums to zip");
      const items = [];
      for (let i = 0; i < names.length; i += 1) {
        const name = names[i];
        setStatus?.(`Packing album ${i + 1} / ${names.length} · ${name}…`);
        items.push(await makeZip(state.slides.filter((s) => s.album === name), name));
      }
      showQueue(items);
      setStatus?.(`${items.length} album ZIP${items.length === 1 ? " is" : "s are"} ready. Tap Save ZIP for each one.`);
    } catch (err) {
      console.error(err);
      setStatus?.(err?.message || "Could not create album ZIPs.");
    }
  }

  function bind() {
    if (typeof state === "undefined") return false;
    const all = $id("zip-all");
    const albums = $id("zip-albums");
    const list = $id("album-list");
    if (!all || !albums || !list) return false;

    all.onclick = (e) => {
      e.preventDefault();
      buildOne(state.slides, "reel-all");
    };
    albums.onclick = (e) => {
      e.preventDefault();
      buildAlbums();
    };
    list.addEventListener("click", (e) => {
      const zipButton = e.target.closest?.("[data-zip-album]");
      if (!zipButton) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const name = zipButton.dataset.zipAlbum;
      buildOne(state.slides.filter((s) => s.album === name), name);
    }, true);
    return true;
  }

  if (!bind()) {
    const mo = new MutationObserver(() => {
      if (bind()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
