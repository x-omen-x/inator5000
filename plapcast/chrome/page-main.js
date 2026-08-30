(() => {
  "use strict";

  const PRIVATE_HOST = "omenplaps.netlify.app";
  const PAGE_CHANNEL = "omens-plapinator-plapcast-page";
  const BRIDGE_CHANNEL = "omens-plapinator-plapcast-bridge";

  if (location.hostname !== PRIVATE_HOST) return;
  if (new URLSearchParams(location.search).get("theme") === "0") return;
  if (!window.__cloudyplap) return;

  function boot() {
    if (typeof state === "undefined" || typeof window.showSlide !== "function") {
      window.setTimeout(boot, 100);
      return;
    }
    if (document.getElementById("plapcast-private-btn")) return;

    let active = false;
    let starting = false;
    let seq = 0;
    let queue = [];
    let queueSize = -1;
    let savedSkipVideos = null;

    const original = {
      showSlide: window.showSlide,
      pickShuffledIndex: window.pickShuffledIndex,
      enterPlayer: window.enterPlayer,
      exitPlayer: window.exitPlayer,
    };

    const button = document.createElement("button");
    button.type = "button";
    button.id = "plapcast-private-btn";
    button.className = "link";
    button.textContent = "PlapCast";
    button.setAttribute("aria-pressed", "false");
    button.title = "Sync this slideshow to your PlapCast Roku receivers";

    const actions = document.querySelector(".topbar-actions");
    if (!actions) return;
    actions.insertBefore(button, actions.firstChild);

    const post = (type, payload = {}) => {
      window.postMessage({ channel: PAGE_CHANNEL, type, ...payload }, location.origin);
    };

    function setButton(text, disabled = false) {
      button.textContent = text;
      button.disabled = disabled;
    }

    function imageIndices() {
      const out = [];
      for (let i = 0; i < state.slides.length; i += 1) {
        if (state.slides[i]?.kind === "image") out.push(i);
      }
      return out;
    }

    function refillQueue() {
      const items = imageIndices().filter((i) => i !== state.index);
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      queue = items;
      queueSize = state.slides.length;
    }

    function ensureQueue() {
      if (queueSize !== state.slides.length || !queue.length) refillQueue();
    }

    function syncPickShuffledIndex() {
      if (!active) return original.pickShuffledIndex();
      ensureQueue();
      let next = queue.shift();
      if (typeof next !== "number" || state.slides[next]?.kind !== "image") {
        refillQueue();
        next = queue.shift();
      }
      return typeof next === "number" ? next : state.index;
    }

    function nextImageIndex() {
      if (!state.slides.length) return -1;
      if (state.shuffle) {
        ensureQueue();
        return typeof queue[0] === "number" ? queue[0] : state.index;
      }
      for (let n = 1; n <= state.slides.length; n += 1) {
        const i = (state.index + n) % state.slides.length;
        if (state.slides[i]?.kind === "image") return i;
      }
      return -1;
    }

    function notifySlide() {
      if (!active) return;
      const slide = state.slides[state.index];
      if (!slide || slide.kind !== "image") return;
      const nextIndex = nextImageIndex();
      const next = nextIndex >= 0 ? state.slides[nextIndex] : null;
      seq += 1;
      post("SHOW", {
        seq,
        current: slide.id,
        next: next?.kind === "image" ? next.id : "",
        fit: state.fit || "contain",
        zoom: Number(state.zoom) || 1,
        crossfade: Number(state.crossfade) || 0,
      });
    }

    function installHooks() {
      window.pickShuffledIndex = syncPickShuffledIndex;
      window.showSlide = function plapCastShowSlide() {
        original.showSlide();
        notifySlide();
      };
      window.enterPlayer = function plapCastEnterPlayer() {
        original.enterPlayer();
        if (active && state.slides[state.index]?.kind === "video" && typeof window.step === "function") {
          window.step(1);
        }
      };
      window.exitPlayer = function plapCastExitPlayer() {
        original.exitPlayer();
        if (active) post("BLANK");
      };
    }

    function removeHooks() {
      window.showSlide = original.showSlide;
      window.pickShuffledIndex = original.pickShuffledIndex;
      window.enterPlayer = original.enterPlayer;
      window.exitPlayer = original.exitPlayer;
      queue = [];
      queueSize = -1;
    }

    function activate() {
      active = true;
      starting = false;
      seq = 0;
      savedSkipVideos = state.skipVideos;
      state.skipVideos = true;
      const skip = document.getElementById("skip-videos");
      if (skip) skip.checked = true;
      refillQueue();
      installHooks();
      button.setAttribute("aria-pressed", "true");
      setButton("PlapCast ON");
    }

    function deactivate(sendStop = true) {
      if (sendStop) post("STOP");
      active = false;
      starting = false;
      removeHooks();
      if (savedSkipVideos !== null) {
        state.skipVideos = savedSkipVideos;
        const skip = document.getElementById("skip-videos");
        if (skip) skip.checked = state.skipVideos;
      }
      savedSkipVideos = null;
      button.setAttribute("aria-pressed", "false");
      setButton("PlapCast");
    }

    button.addEventListener("click", () => {
      if (starting) return;
      if (active) {
        deactivate(true);
        return;
      }

      const slides = state.slides
        .filter((slide) => slide?.kind === "image" && slide.id && slide.url)
        .map((slide) => ({
          id: slide.id,
          name: slide.file?.name || slide.alt || `${slide.id}.jpg`,
          type: slide.file?.type || "image/jpeg",
          url: slide.url,
        }));

      if (!slides.length) {
        setButton("No images");
        window.setTimeout(() => setButton("PlapCast"), 1200);
        return;
      }

      starting = true;
      setButton(`PlapCast 0/${slides.length}`, true);
      post("START", { slides });
    });

    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const msg = event.data;
      if (!msg || msg.channel !== BRIDGE_CHANNEL) return;

      if (msg.type === "SESSION_STARTED") {
        const count = Number(msg.rokuCount) || 0;
        button.title = count
          ? `PlapCast helper connected · ${count} Roku${count === 1 ? "" : "s"}`
          : "PlapCast helper connected · add Roku IPs in the Mac app";
      } else if (msg.type === "UPLOAD_PROGRESS") {
        setButton(`PlapCast ${msg.done}/${msg.total}`, true);
      } else if (msg.type === "READY") {
        activate();
      } else if (msg.type === "STOPPED") {
        if (!active) setButton("PlapCast");
      } else if (msg.type === "ERROR") {
        active = false;
        starting = false;
        removeHooks();
        button.setAttribute("aria-pressed", "false");
        setButton("PlapCast error");
        button.title = msg.message || "PlapCast error";
        console.error("PlapCast:", msg.message || "unknown error");
        window.setTimeout(() => setButton("PlapCast"), 1800);
      }
    });
  }

  boot();
})();
