/* OMENS PLAPINATOR — simple image-only screen sharing UI.
   Media transfer is delegated to lan-share.js, whose WebRTC data channel carries
   bytes peer-to-peer. The rendezvous endpoint only exchanges short-lived WebRTC
   connection metadata. Videos, audio, and overlay media are never catalogued by
   this UI, so they cannot be transferred to a receiver. */
(() => {
  "use strict";
  if (window.__plapReceiverMode) return;
  window.__plapReceiverMode = true;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function addStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #screen-share-panel{margin-top:1rem;padding:1rem;border:1px solid rgba(57,255,106,.35);border-radius:12px;background:rgba(0,12,4,.72)}
      #screen-share-panel .screen-share-title{font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin:0 0 .35rem}
      #screen-share-panel .screen-share-copy{margin:.2rem 0 .8rem;color:var(--muted,#a9c9b0);font-size:.86rem;line-height:1.45}
      #screen-share-panel .screen-share-row{display:flex;gap:.65rem;flex-wrap:wrap}
      #screen-share-panel button{min-height:44px}
      #screen-share-state{margin:.65rem 0 0;color:#7cff7c;font-size:.78rem}
      .lan-hud{position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:99999;min-width:min(92vw,620px);padding:.65rem .8rem;border:1px solid rgba(57,255,106,.45);border-radius:10px;background:rgba(0,10,3,.94);color:#dfffe7;font:12px/1.35 monospace;box-shadow:0 0 24px rgba(0,255,65,.12)}
      .lan-hud-head{display:flex;align-items:center;gap:.55rem}.lan-hud-title{color:#7cff7c}.lan-hud-detail{flex:1;color:#a9c9b0}.lan-hud-stop{background:transparent;border:0;color:#a9c9b0;font-size:18px}.lan-hud-bar{height:3px;margin-top:.45rem;background:rgba(255,255,255,.09);overflow:hidden}.lan-hud-bar i{display:block;height:100%;background:#39ff6a}.lan-hud-peers{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem}.lan-chip{border:1px solid rgba(57,255,106,.25);padding:.15rem .35rem;border-radius:999px}.lan-chip em{margin-left:.3rem;color:#7a9680;font-style:normal}.lan-chip b{margin-left:.3rem}
      #lan-save-sheet{display:none!important}
      body.plap-receiver #screen-share-send{display:none}
      body.plap-receiver #screen-share-receive{font-weight:800}
    `;
    document.head.appendChild(style);
  }

  function setUi(text) {
    const el = $("screen-share-state");
    if (el) el.textContent = text;
  }

  async function loadLanCore() {
    if (window.lanShare) return true;
    if (!document.querySelector('script[data-plap-lan-core]')) {
      const script = document.createElement("script");
      script.src = `lan-share.js?v=receiver-1`;
      script.dataset.plapLanCore = "1";
      document.body.appendChild(script);
    }
    for (let i = 0; i < 80; i++) {
      if (window.lanShare) return true;
      await sleep(50);
    }
    return false;
  }

  function forceMirrorOnly() {
    // The networking core's old optional persistence sheet is deliberately
    // suppressed. Receiver media lives in memory for this session only.
    const observer = new MutationObserver(() => {
      const mirror = $("lan-keep-mirror");
      if (mirror) mirror.click();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const existing = $("lan-keep-mirror");
    if (existing) existing.click();
  }

  async function startReceiver() {
    setUi("Starting receiver…");
    document.body.classList.add("plap-receiver");
    forceMirrorOnly();
    if (!(await loadLanCore())) {
      setUi("Receiver could not start in this browser.");
      return;
    }
    try {
      await window.lanShare.start();
      setUi("Receiver on · waiting for images from another Plapinator on this Wi‑Fi");
    } catch {
      setUi("Receiver could not start in this browser.");
    }
  }

  async function startSender() {
    const slides = Array.isArray(window.state?.slides) ? window.state.slides : [];
    const images = slides.filter((slide) => slide?.kind === "image" && slide.file);
    const skipped = slides.length - images.length;
    if (!images.length) {
      setUi("No images to send.");
      return;
    }
    setUi(`Preparing ${images.length} image${images.length === 1 ? "" : "s"}${skipped ? ` · ${skipped} video${skipped === 1 ? "" : "s"} excluded` : ""}…`);
    if (!(await loadLanCore())) {
      setUi("Screen sharing could not start in this browser.");
      return;
    }

    // Build the WebRTC catalogue while only image slides are visible to the
    // networking core. Restore the full local library immediately afterward.
    const originalSlides = window.state.slides;
    const originalTracks = window.state.tracks;
    const originalOverlay = window.state.overlayFile;
    try {
      window.state.slides = images;
      window.state.tracks = [];
      window.state.overlayFile = null;
      await window.lanShare.start();
    } finally {
      window.state.slides = originalSlides;
      window.state.tracks = originalTracks;
      window.state.overlayFile = originalOverlay;
    }
    setUi(`Sharing ${images.length} image${images.length === 1 ? "" : "s"} · videos/audio never sent`);
  }

  function buildPanel() {
    if ($("screen-share-panel")) return;
    const panel = document.createElement("section");
    panel.id = "screen-share-panel";
    panel.innerHTML = `
      <p class="screen-share-title">Screens</p>
      <p class="screen-share-copy">Send images directly to another Plapinator on this Wi‑Fi. Videos, audio, and overlays are excluded completely.</p>
      <div class="screen-share-row">
        <button type="button" class="btn" id="screen-share-send">Send images to screens</button>
        <button type="button" class="btn outline" id="screen-share-receive">Receiver mode</button>
        <button type="button" class="btn ghost" id="screen-share-stop" hidden>Stop</button>
      </div>
      <p id="screen-share-state">Off · media is never uploaded to the rendezvous service</p>`;
    const status = $("status");
    if (status?.parentNode) status.parentNode.insertBefore(panel, status);
    else $("main-content")?.appendChild(panel);

    $("screen-share-send").onclick = startSender;
    $("screen-share-receive").onclick = startReceiver;
    $("screen-share-stop").onclick = () => {
      window.lanShare?.stop?.("off");
      document.body.classList.remove("plap-receiver");
      setUi("Off");
    };
  }

  async function boot() {
    addStyles();
    buildPanel();
    const params = new URLSearchParams(location.search);
    if (params.get("receiver") === "1") await startReceiver();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
