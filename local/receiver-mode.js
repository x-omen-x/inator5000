/* OMENS PLAPINATOR — private image-only screen sharing UI.
 * Receiver Mode uses local/private-lan.js only. There is deliberately no cloud,
 * STUN, TURN, remote rendezvous, or internet fallback in this path.
 */
(() => {
  "use strict";
  if (window.__plapReceiverMode) return;
  window.__plapReceiverMode = true;

  const $ = (id) => document.getElementById(id);
  const appState = typeof state !== "undefined" ? state : null;
  const HELPER_KEY = "plap-private-lan-helper";

  function addStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #screen-share-panel{margin-top:1rem;padding:1rem;border:1px solid rgba(57,255,106,.35);border-radius:12px;background:rgba(0,12,4,.72)}
      #screen-share-panel .screen-share-title{font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin:0 0 .35rem}
      #screen-share-panel .screen-share-copy{margin:.2rem 0 .8rem;color:var(--muted,#a9c9b0);font-size:.86rem;line-height:1.45}
      #screen-share-panel .screen-share-row{display:flex;gap:.65rem;flex-wrap:wrap;align-items:center}
      #screen-share-panel button{min-height:44px}
      #screen-share-state{margin:.65rem 0 0;color:#7cff7c;font-size:.78rem;line-height:1.4}
      #screen-share-code-wrap{margin:.8rem 0;padding:.75rem;border:1px dashed rgba(57,255,106,.35);border-radius:10px;background:rgba(0,0,0,.22)}
      #screen-share-code{font:900 clamp(24px,6vw,40px)/1 monospace;letter-spacing:.12em;color:#7cff7c;margin:.3rem 0;word-break:break-all}
      #screen-share-code-input{width:15rem;max-width:100%;text-transform:uppercase;letter-spacing:.1em;text-align:center}
      #screen-share-helper{width:min(25rem,100%)}
      .screen-share-private{display:block;margin:.45rem 0 .8rem;color:#8fb99a;font-size:.76rem;line-height:1.45}
      body.plap-receiver #screen-share-send{display:none}
      body.plap-receiver #screen-share-code-input{display:none}
      body.plap-receiver #screen-share-receive{font-weight:800}
      #lan-hud{display:none!important}
    `;
    document.head.appendChild(style);
  }

  function setUi(text) {
    const el = $("screen-share-state");
    if (el) el.textContent = text;
  }

  function randomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  }

  function receiverCode() {
    let code = sessionStorage.getItem("plap-private-receiver-code");
    if (!/^[A-Z2-9]{10}$/.test(code || "")) {
      code = randomCode();
      sessionStorage.setItem("plap-private-receiver-code", code);
    }
    return code;
  }

  function helperValue() {
    return String($("screen-share-helper")?.value || "").trim();
  }

  function rememberHelper() {
    const value = helperValue();
    if (value) localStorage.setItem(HELPER_KEY, value);
    return value;
  }

  function stopOldLanCore() {
    try { window.lanShare?.stop?.("off"); } catch {}
  }

  async function startReceiver() {
    stopOldLanCore();
    window.privateLan?.stop?.();
    document.body.classList.add("plap-receiver");
    const helper = rememberHelper();
    if (!helper) {
      setUi("Enter the Mac PRIVATE LAN HOST address first.");
      $("screen-share-helper")?.focus();
      return;
    }
    const code = receiverCode();
    $("screen-share-code").textContent = code;
    $("screen-share-code-wrap").hidden = false;
    setUi("Connecting only to your private Mac LAN helper…");
    try {
      await window.privateLan.startReceiver({ helper, code, onStatus: setUi });
      setUi("Private LAN receiver on · type this pairing code on the sending device");
    } catch (err) {
      setUi(`${err.message} No cloud fallback was attempted.`);
    }
  }

  async function startSender() {
    stopOldLanCore();
    window.privateLan?.stop?.();
    const slides = Array.isArray(appState?.slides) ? appState.slides : [];
    const images = slides.filter((slide) => slide?.kind === "image" && slide.file);
    const skipped = slides.length - images.length;
    const helper = rememberHelper();
    const code = String($("screen-share-code-input")?.value || "").trim().toUpperCase();

    if (!helper) {
      setUi("Enter the Mac PRIVATE LAN HOST address first.");
      $("screen-share-helper")?.focus();
      return;
    }
    if (!/^[A-Z2-9]{10}$/.test(code)) {
      setUi("Enter the 10-character pairing code shown on the receiver TV.");
      $("screen-share-code-input")?.focus();
      return;
    }
    if (!images.length) {
      setUi("No images to send.");
      return;
    }

    setUi(`Encrypting private LAN session for ${images.length} image${images.length === 1 ? "" : "s"}${skipped ? ` · ${skipped} non-image item${skipped === 1 ? "" : "s"} excluded` : ""}…`);
    try {
      await window.privateLan.startSender({ helper, code, images, onStatus: setUi });
      setUi(`Private LAN sender on · ${images.length} image${images.length === 1 ? "" : "s"} ready · videos/audio excluded`);
    } catch (err) {
      setUi(`${err.message} No cloud fallback was attempted.`);
    }
  }

  function buildPanel() {
    if ($("screen-share-panel")) return;
    const panel = document.createElement("section");
    panel.id = "screen-share-panel";
    panel.innerHTML = `
      <p class="screen-share-title">Screens · Private LAN</p>
      <p class="screen-share-copy">Images are encrypted before leaving this browser and can only travel through your Mac on your local network. Videos, audio, and overlays are excluded.</p>
      <label class="screen-share-private" for="screen-share-helper">PRIVATE LAN HOST · use the <b>https://192.168.x.x:8787</b> address printed by the Mac helper</label>
      <input id="screen-share-helper" class="field bio-field" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://192.168.1.23:8787" aria-label="Private LAN Mac helper address" />
      <small class="screen-share-private">🔒 No Netlify rendezvous · no STUN · no TURN · no remote server · no internet fallback</small>
      <div id="screen-share-code-wrap" hidden>
        <small>PRIVATE PAIRING CODE</small>
        <div id="screen-share-code">----------</div>
        <small>Type this on the device that already has your images.</small>
      </div>
      <div class="screen-share-row">
        <input id="screen-share-code-input" class="field bio-field" type="text" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="TV PAIRING CODE" aria-label="Receiver pairing code" />
        <button type="button" class="btn" id="screen-share-send">Send images to screens</button>
        <button type="button" class="btn outline" id="screen-share-receive">Receiver mode</button>
        <button type="button" class="btn ghost" id="screen-share-stop">Stop</button>
      </div>
      <p id="screen-share-state">Off · private LAN only</p>`;

    const status = $("status");
    if (status?.parentNode) status.parentNode.insertBefore(panel, status);
    else $("main-content")?.appendChild(panel);

    const helper = localStorage.getItem(HELPER_KEY) || "";
    $("screen-share-helper").value = helper;
    $("screen-share-helper").addEventListener("change", rememberHelper);
    $("screen-share-code-input").addEventListener("input", (event) => {
      event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 10);
    });
    $("screen-share-send").onclick = startSender;
    $("screen-share-receive").onclick = startReceiver;
    $("screen-share-stop").onclick = () => {
      window.privateLan?.stop?.();
      stopOldLanCore();
      document.body.classList.remove("plap-receiver");
      $("screen-share-code-wrap").hidden = true;
      setUi("Off · private LAN only");
    };
  }

  async function boot() {
    addStyles();
    buildPanel();
    stopOldLanCore();
    const params = new URLSearchParams(location.search);
    if (params.get("receiver") === "1" && helperValue()) await startReceiver();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
