(() => {
  "use strict";

  const bridge = window.PlapinatorTV;
  document.body.classList.add("tv-mode");
  try {
    const label = document.getElementById("tv-device-label");
    if (bridge && label) label.textContent = `${bridge.deviceName()} · LOCAL ONLY`;
  } catch {}

  let sheet = null;

  function playerIsOpen() {
    return document.getElementById("player")?.classList.contains("on");
  }

  function clickControl(id) {
    const control = document.getElementById(id);
    if (!control || control.disabled || control.hidden) return false;
    control.click();
    return true;
  }

  function nudgeRange(id, delta) {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) return false;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    input.value = String(Math.max(min, Math.min(max, Number(input.value) + delta)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setPlayback(shouldPlay) {
    if (!playerIsOpen()) {
      if (shouldPlay) clickControl("play-btn");
      return;
    }
    const toggle = document.getElementById("toggle-btn");
    const currentlyPlaying = toggle?.getAttribute("aria-pressed") === "true";
    if (currentlyPlaying !== shouldPlay) clickControl("toggle-btn");
  }

  function handleMediaAction(action) {
    const inPlayer = playerIsOpen();
    switch (action) {
      case "toggle": inPlayer ? clickControl("toggle-btn") : clickControl("play-btn"); break;
      case "play": setPlayback(true); break;
      case "pause": setPlayback(false); break;
      case "next": if (inPlayer) clickControl("next-btn"); break;
      case "previous": if (inPlayer) clickControl("prev-btn"); break;
      case "stop": if (inPlayer) clickControl("exit-btn"); break;
      case "digit-0": if (inPlayer) clickControl("exit-btn"); break;
      case "digit-1": inPlayer ? clickControl("prev-btn") : clickControl("tv-receive-btn"); break;
      case "digit-2": inPlayer ? clickControl("toggle-btn") : clickControl("loose-photos"); break;
      case "digit-3": inPlayer ? clickControl("next-btn") : clickControl("choose-video"); break;
      case "digit-4": inPlayer ? clickControl("hud-photo-shuffle") : clickControl("choose-audio"); break;
      case "digit-5": if (inPlayer) clickControl("hud-audio-shuffle"); break;
      case "digit-7": if (inPlayer) nudgeRange("slide-video-volume", -10); break;
      case "digit-8": if (inPlayer) clickControl("slide-video-mute"); break;
      case "digit-9": inPlayer ? nudgeRange("slide-video-volume", 10) : clickControl("play-btn"); break;
      default: break;
    }
  }

  function closeSheet() {
    if (!sheet) return false;
    try { bridge?.stopSecureReceiver?.(); } catch {}
    sheet.remove();
    sheet = null;
    document.getElementById("tv-receive-btn")?.focus();
    return true;
  }

  function showSheet(html, focusId = "tv-sheet-close") {
    closeSheet();
    sheet = document.createElement("div");
    sheet.className = "tv-sheet-bg";
    sheet.innerHTML = `<section class="tv-sheet" role="dialog" aria-modal="true">${html}<div class="row"><button type="button" class="btn" id="tv-sheet-close">Close</button></div></section>`;
    document.body.appendChild(sheet);
    document.getElementById("tv-sheet-close").onclick = closeSheet;
    sheet.onclick = (event) => { if (event.target === sheet) closeSheet(); };
    requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }

  function startReceiver() {
    if (!bridge) {
      showSheet("<h2>Native receiver unavailable</h2><p>This screen must be opened inside the installed Android TV app.</p>");
      return;
    }
    let session;
    try { session = JSON.parse(bridge.startSecureReceiver()); }
    catch { session = { ok: false, error: "Could not start the private receiver." }; }
    if (!session.ok) {
      showSheet(`<h2>Receiver could not start</h2><p>${escapeHtml(session.error || "Unknown error")}</p>`);
      return;
    }
    const secureUrls = Array.isArray(session.urls) && session.urls.length ? session.urls : [session.url];
    const compatibilityUrls = Array.isArray(session.compatibilityUrls) && session.compatibilityUrls.length
      ? session.compatibilityUrls
      : [session.compatibilityUrl];
    const addressLines = (values) => values.filter(Boolean).map((value) => `<code>${escapeHtml(value)}</code>`).join("");
    showSheet(`
      <h2>Receive from iPhone or Mac · v${escapeHtml(session.version || "0.3.0")}</h2>
      <p>On a device connected to this same home network, try the secure address first:</p>
      <div class="tv-address-list">${addressLines(secureUrls)}</div>
      <p>Because your TV creates this private link itself, Safari may show a certificate warning. Continue only when the browser fingerprint matches this one:</p>
      <p class="fingerprint">CERTIFICATE · ${escapeHtml(session.fingerprint)}</p>
      <div class="tv-compatibility-note">
        <b>If Safari says it cannot establish a secure connection</b>, open this local compatibility address instead:
        <div class="tv-address-list">${addressLines(compatibilityUrls)}</div>
        <small>No cloud is contacted. This fallback relies on your private WPA2/WPA3 home Wi-Fi for transport protection, so do not use it on public or shared Wi-Fi.</small>
      </div>
      <p>Then enter this one-time PIN:</p>
      <div class="tv-pin">${escapeHtml(session.pin)}</div>
      <p>The receiver shuts itself off after ${Number(session.expiresMinutes) || 15} minutes. Six wrong PIN attempts from one device are blocked. Files are copied into this app's private storage.</p>`);
  }

  function showUsbHelp() {
    showSheet(`
      <h2>Load from USB</h2>
      <ol>
        <li>Put images, videos, overlay videos, or audio files on a USB drive.</li>
        <li>Plug the drive into the Sony TV.</li>
        <li>Close this help and choose <b>Add Files</b>, <b>Choose Video</b>, or <b>Add Audio Files</b>.</li>
        <li>Select the USB drive in Android's file picker.</li>
      </ol>
      <p>A normal cable directly between the MacBook and TV will not act like a storage drive because both devices are USB hosts. Use a USB drive or the private Wi-Fi receiver instead.</p>`);
  }

  document.getElementById("tv-receive-btn")?.addEventListener("click", startReceiver);
  document.getElementById("tv-usb-help-btn")?.addEventListener("click", showUsbHelp);

  async function dispatchFiles(role, rows) {
    if (!rows.length) return;
    const inputId = role === "audio" ? "audio-input" : role === "overlay" ? "video-input" : "loose-input";
    const input = document.getElementById(inputId);
    if (!input) throw new Error(`Missing ${inputId}`);
    const transfer = new DataTransfer();
    for (const row of rows) {
      const response = await fetch(row.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not open ${row.name}`);
      const blob = await response.blob();
      transfer.items.add(new File([blob], row.name || "media", { type: row.type || blob.type || "application/octet-stream" }));
      if (role === "overlay") break;
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  window.PlapiTV = {
    async onNativeUploads(rows) {
      const list = Array.isArray(rows) ? rows : [];
      try {
        const roles = ["slides", "audio", "overlay"];
        for (const role of roles) await dispatchFiles(role, list.filter((row) => row.role === role));
        const message = `${list.length} private transfer${list.length === 1 ? "" : "s"} added.`;
        const status = document.getElementById("status");
        if (status) status.textContent = message;
      } catch (error) {
        const status = document.getElementById("status");
        if (status) status.textContent = `Transfer arrived but could not be imported: ${error.message}`;
      }
    },
    handleBack() {
      if (closeSheet()) return;
      const player = document.getElementById("player");
      if (player?.classList.contains("on")) {
        document.getElementById("exit-btn")?.click();
        return;
      }
      try { bridge?.closeApp?.(); } catch {}
    },
    handleMediaAction,
  };

  function runRandomTitleGlitch() {
    const title = document.getElementById("tv-title-glitch");
    const noise = document.getElementById("tv-title-noise");
    const displace = document.getElementById("tv-title-displace");
    if (!title || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const steps = 3 + Math.floor(Math.random() * 7);
    let frame = 0;
    title.classList.add("is-distorting");
    const distort = () => {
      const topA = Math.floor(Math.random() * 68);
      const heightA = 7 + Math.floor(Math.random() * 20);
      const topB = Math.floor(Math.random() * 72);
      const heightB = 6 + Math.floor(Math.random() * 18);
      title.style.setProperty("--slice-a", `inset(${topA}% 0 ${Math.max(0, 100 - topA - heightA)}% 0)`);
      title.style.setProperty("--slice-b", `inset(${topB}% 0 ${Math.max(0, 100 - topB - heightB)}% 0)`);
      title.style.setProperty("--slice-a-x", `${Math.round((Math.random() - 0.5) * 42)}px`);
      title.style.setProperty("--slice-b-x", `${Math.round((Math.random() - 0.5) * 34)}px`);
      title.style.setProperty("--title-skew", `${((Math.random() - 0.5) * 4).toFixed(2)}deg`);
      noise?.setAttribute("seed", String(Math.floor(Math.random() * 9999)));
      noise?.setAttribute("baseFrequency", `${(0.006 + Math.random() * 0.025).toFixed(3)} ${(0.10 + Math.random() * 0.30).toFixed(3)}`);
      displace?.setAttribute("scale", String(5 + Math.floor(Math.random() * 22)));
      frame += 1;
      if (frame < steps) setTimeout(distort, 38 + Math.random() * 92);
      else {
        title.classList.remove("is-distorting");
        displace?.setAttribute("scale", "0");
        setTimeout(runRandomTitleGlitch, 1400 + Math.random() * 7200);
      }
    };
    distort();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function focusables() {
    return [...document.querySelectorAll("button:not([disabled]):not([hidden]), input:not([disabled]):not([type=hidden]), [tabindex]:not([tabindex='-1'])")]
      .filter((node) => node.offsetParent !== null && !node.closest("[aria-hidden='true']"));
  }

  function moveFocus(key) {
    const current = document.activeElement;
    if (current?.matches("input[type=range]")) return false;
    const nodes = focusables();
    if (!nodes.length) return false;
    if (!nodes.includes(current)) {
      nodes[0].focus();
      return true;
    }
    const from = current.getBoundingClientRect();
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    const horizontal = key === "ArrowLeft" || key === "ArrowRight";
    const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
    let best = null;
    let score = Infinity;
    for (const node of nodes) {
      if (node === current) continue;
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const primary = horizontal ? x - fx : y - fy;
      if (primary * direction <= 4) continue;
      const secondary = horizontal ? Math.abs(y - fy) : Math.abs(x - fx);
      const nextScore = Math.abs(primary) + secondary * 2.6;
      if (nextScore < score) { best = node; score = nextScore; }
    }
    if (!best) return false;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    return true;
  }

  document.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (playerIsOpen()) return;
    if (moveFocus(event.key)) event.preventDefault();
  });

  requestAnimationFrame(() => {
    document.getElementById("tv-receive-btn")?.focus();
    setTimeout(runRandomTitleGlitch, 700 + Math.random() * 900);
  });
})();
