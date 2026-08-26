/* omens plapinator theme

   Hot module: torn down and re-run in place by local/live-update.js when a new
   build lands, so open instances pick the change up without a reload. Every
   node, timer, observer and listener it creates is registered for teardown. */
(function cloudyplap() {
  const NAME = "cloudyplap";
  window.__hotTeardown?.(NAME);
  if (new URLSearchParams(location.search).get("theme") === "0") return;
  window.__cloudyplap = true;

  const SRC = document.currentScript?.src || "local/cloudyplap.js";
  const BASE = SRC.replace(/[^/]+$/, "");
  // Carry this script's own cache-buster onto the stylesheets it injects, so a
  // hot re-run picks up the new theme.css instead of the cached one.
  const VER = new URL(SRC, location.href).searchParams.get("v") || "3";

  const disposers = [];
  const timers = new Set();
  const later = (fn, ms) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    disposers.push(() => target.removeEventListener(type, fn, opts));
  };
  const watch = (target, fn, opts) => {
    const mo = new MutationObserver(fn);
    mo.observe(target, opts);
    disposers.push(() => mo.disconnect());
    return mo;
  };

  const faces = document.createElement("link");
  faces.rel = "stylesheet";
  faces.href = `${BASE}fonts/title-faces.css?v=${encodeURIComponent(VER)}`;
  const theme = document.createElement("link");
  theme.rel = "stylesheet";
  theme.href = `${BASE}theme.css?v=${encodeURIComponent(VER)}`;
  // The outgoing copies only go once the replacements have painted, so the
  // page never flashes unstyled during a hot swap.
  const stale = [...document.querySelectorAll('link[data-cloudyplap="1"]')];
  [faces, theme].forEach((link) => {
    link.dataset.cloudyplap = "1";
    document.head.appendChild(link);
  });
  const dropStale = () => stale.forEach((l) => l.remove());
  if (stale.length) {
    theme.addEventListener("load", dropStale, { once: true });
    later(dropStale, 1500);
  }

  document.body.classList.add("theme-cloudyplap");
  document.documentElement.style.background = "#000";

  const TITLE = "omens plapinator";
  document.title = TITLE;

  const brand = document.getElementById("brand-title");
  if (brand) {
    brand.hidden = true;
    brand.textContent = "";
  }

  function word(text) {
    const s = document.createElement("span");
    s.className = "brand-word";
    s.textContent = text;
    return s;
  }

  // The mascot is the only control for TINA MODE. Keep it a real button so
  // touch, mouse and keyboard activation all take the same path.
  const mascot = document.createElement("button");
  mascot.type = "button";
  mascot.id = "omen-mascot";
  mascot.className = "brand-mascot";
  mascot.setAttribute("aria-label", "Activate TINA MODE");
  mascot.setAttribute("aria-pressed", "false");
  mascot.title = "Activate TINA MODE";
  // Only the intact source frame is used. The damaged expression cutouts were
  // removed instead of trying to hide their missing pixels with more effects.
  const mascotImg = document.createElement("img");
  mascotImg.src = BASE + "assets/mascot-idle.png";
  mascotImg.alt = "";
  mascot.appendChild(mascotImg);

  const sub = document.getElementById("brand-sub");
  if (sub) {
    sub.hidden = false;
    sub.classList.add("brand-lockup");
    sub.removeAttribute("role");
    sub.tabIndex = -1;
    sub.textContent = "";
    sub.appendChild(word("omens"));
    sub.appendChild(mascot);
    sub.appendChild(word("plapinator"));
  }

  document.getElementById("tina-mode-indicator")?.remove();
  const tinaIndicator = document.createElement("div");
  tinaIndicator.id = "tina-mode-indicator";
  tinaIndicator.setAttribute("role", "status");
  tinaIndicator.setAttribute("aria-live", "polite");
  tinaIndicator.textContent = "TINA MODE";
  tinaIndicator.hidden = true;
  document.body.appendChild(tinaIndicator);
  on(theme, "error", () => {
    document.body.classList.remove("theme-cloudyplap", "smoke-on");
    if (brand) {
      brand.hidden = false;
      brand.textContent = "OMENS PLAPINATOR";
    }
    if (sub) {
      sub.hidden = true;
      sub.textContent = "";
    }
    mascot.remove();
  });
  const node = document.getElementById("node-label");
  if (node) node.textContent = TITLE;
  const kicker = document.getElementById("player-kicker");
  if (kicker) kicker.textContent = TITLE;

  const topbar = document.querySelector(".topbar-actions");
  if (topbar) {
    document.getElementById("theme-preview-link")?.remove();
    if (!document.getElementById("public-preview-link")) {
      const back = document.createElement("a");
      back.className = "link";
      back.id = "public-preview-link";
      back.href = "?theme=0";
      back.textContent = "Public";
      topbar.appendChild(back);
    }
  }

  document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((l) => {
    l.href = BASE + "assets/app-icon.png";
  });
  let apple = document.querySelector('link[rel="apple-touch-icon"]');
  if (!apple) {
    apple = document.createElement("link");
    apple.rel = "apple-touch-icon";
    document.head.appendChild(apple);
  }
  apple.href = BASE + "assets/app-icon.png";
  const og = document.querySelector('meta[property="og:image"]');
  if (og) og.setAttribute("content", BASE + "assets/share-card.jpg");
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute("content", TITLE);
  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) twitterTitle.setAttribute("content", TITLE);
  const appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appTitle) appTitle.setAttribute("content", TITLE);

  const oldIntro = document.getElementById("intro-glitch");
  if (oldIntro) oldIntro.remove();

  // TINA MODE always starts inactive. It can only be changed by activating the
  // mascot, which also makes the current state visible and accessible.
  document.body.classList.remove("smoke-on");
  let tinaActive = false;

  function bounceMascot() {
    mascot.classList.remove("acting");
    void mascot.offsetWidth;
    mascot.classList.add("acting");
    later(() => mascot.classList.remove("acting"), 420);
  }

  function setTinaMode(active) {
    tinaActive = Boolean(active);
    if (tinaActive) {
      // Defer the footage download until the user explicitly enables TINA,
      // then let the browser buffer enough to keep the real-smoke loop smooth.
      ambientVideos?.forEach?.((video) => {
        video.preload = "auto";
      });
      puffVideo && (puffVideo.preload = "auto");
    }
    document.body.classList.toggle("smoke-on", tinaActive);
    mascot.setAttribute("aria-pressed", String(tinaActive));
    mascot.setAttribute("aria-label", `${tinaActive ? "Deactivate" : "Activate"} TINA MODE`);
    mascot.title = `${tinaActive ? "Deactivate" : "Activate"} TINA MODE`;
    tinaIndicator.hidden = !tinaActive;
    bounceMascot();
    syncSmokePlayback();
  }

  on(mascot, "click", () => setTinaMode(!tinaActive));

  document.getElementById("void-glow")?.remove();
  const glow = document.createElement("div");
  glow.id = "void-glow";
  glow.setAttribute("aria-hidden", "true");
  document.body.appendChild(glow);

  // Real photographed smoke, manually circular-crossfaded into a 22-second
  // loop. There is exactly one active 360x540 decoder: the main-page copy is
  // paused when the fullscreen reel copy is playing, and vice versa.
  const player = document.getElementById("player");
  document.getElementById("theme-smoke-back")?.remove();
  document.getElementById("theme-smoke-puff")?.remove();
  document.getElementById("tina-pipe")?.remove();
  document.getElementById("reel-smoke")?.remove();

  function smokeVideo(src, loop) {
    const video = document.createElement("video");
    video.className = "smoke-wisp-video";
    video.src = src;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = Boolean(loop);
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "metadata";
    video.disablePictureInPicture = true;
    video.setAttribute("aria-hidden", "true");
    video.tabIndex = -1;
    return video;
  }

  const smokeSrc = BASE + "assets/smoke-wisp-loop.mp4";
  const themeSmokeBack = document.createElement("div");
  themeSmokeBack.id = "theme-smoke-back";
  themeSmokeBack.setAttribute("aria-hidden", "true");
  const mainSmokeVideo = smokeVideo(smokeSrc, true);
  themeSmokeBack.appendChild(mainSmokeVideo);
  document.body.appendChild(themeSmokeBack);

  const reelSmoke = document.createElement("div");
  reelSmoke.id = "reel-smoke";
  reelSmoke.setAttribute("aria-hidden", "true");
  const reelSmokeVideo = smokeVideo(smokeSrc, true);
  reelSmoke.appendChild(reelSmokeVideo);
  if (player) player.insertBefore(reelSmoke, player.firstChild);

  const puffLayer = document.createElement("div");
  puffLayer.id = "theme-smoke-puff";
  puffLayer.setAttribute("aria-hidden", "true");
  const puffVideo = smokeVideo(BASE + "assets/smoke-puff.mp4", false);
  puffLayer.appendChild(puffVideo);
  document.body.appendChild(puffLayer);

  const pipeButton = document.createElement("button");
  pipeButton.type = "button";
  pipeButton.id = "tina-pipe";
  pipeButton.setAttribute("aria-label", "Puff smoke");
  pipeButton.title = "Puff smoke";
  const pipeImg = document.createElement("img");
  pipeImg.src = BASE + "assets/pipe.png?v=2";
  pipeImg.alt = "";
  pipeButton.appendChild(pipeImg);
  document.body.appendChild(pipeButton);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ambientVideos = [mainSmokeVideo, reelSmokeVideo];
  let puffTimer = 0;

  function syncSmokePlayback() {
    // TINA is an explicit opt-in control, so iOS Reduce Motion does not silently
    // remove the requested smoke. It still disables the decorative pipe nudge.
    const canPlay = tinaActive && !document.hidden;
    const reelOpen = Boolean(player?.classList.contains("on"));
    const activeVideo = reelOpen ? reelSmokeVideo : mainSmokeVideo;
    const inactiveVideo = reelOpen ? mainSmokeVideo : reelSmokeVideo;
    if (canPlay && inactiveVideo.currentTime > 0 && activeVideo.readyState >= 1) {
      const duration = Number(activeVideo.duration) || 22;
      const target = inactiveVideo.currentTime % duration;
      if (Math.abs(activeVideo.currentTime - target) > 0.35) {
        try {
          activeVideo.currentTime = target;
        } catch {
          /* Safari can reject seeks until metadata finishes loading. */
        }
      }
    }
    ambientVideos.forEach((video) => {
      if (canPlay && video === activeVideo) video.play().catch(() => undefined);
      else video.pause();
    });
    if (!canPlay) {
      puffVideo.pause();
      puffLayer.classList.remove("puffing");
    }
  }

  function puffSmoke() {
    if (!tinaActive) return;
    if (puffTimer) {
      window.clearTimeout(puffTimer);
      timers.delete(puffTimer);
      puffTimer = 0;
    }
    pipeButton.classList.remove("puffing");
    puffLayer.classList.remove("puffing");
    void pipeButton.offsetWidth;
    pipeButton.classList.add("puffing");
    puffLayer.classList.add("puffing");
    try {
      puffVideo.currentTime = 0;
    } catch {
      /* metadata is allowed to finish loading */
    }
    puffVideo.play().catch(() => undefined);
    puffTimer = later(() => {
      puffTimer = 0;
      pipeButton.classList.remove("puffing");
      puffLayer.classList.remove("puffing");
      puffVideo.pause();
    }, 2850);
  }

  on(pipeButton, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    puffSmoke();
  });
  on(pipeButton, "pointerdown", (event) => event.stopPropagation());
  on(pipeButton, "pointerup", (event) => event.stopPropagation());
  watch(document.body, syncSmokePlayback, { attributes: true, attributeFilter: ["class"] });
  if (player) watch(player, syncSmokePlayback, { attributes: true, attributeFilter: ["class"] });
  on(document, "visibilitychange", syncSmokePlayback);
  if (reduceMotion.addEventListener) on(reduceMotion, "change", syncSmokePlayback);

  /* -------------------------------------------------------------- lifecycle */

  window.__hotRegister?.(NAME, () => {
    disposers.forEach((fn) => {
      try {
        fn();
      } catch {
        /* nothing to undo */
      }
    });
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    [...ambientVideos, puffVideo].forEach((v) => {
      try {
        v.pause();
        v.removeAttribute("src");
      } catch {
        /* already gone */
      }
    });
    reelSmoke.remove();
    themeSmokeBack.remove();
    puffLayer.remove();
    pipeButton.remove();
    tinaIndicator.remove();
    document.body.classList.remove("smoke-on");
    glow.remove();
    mascot.remove();
    window.__cloudyplap = false;
    // The stylesheets stay until the replacement's have loaded; the incoming
    // run tags and removes them.
  });
})();
