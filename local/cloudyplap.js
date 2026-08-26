/* omens plapinator theme

   Theme module: loaded once per app launch or manual refresh. Every node, timer,
   observer and listener it creates is registered for teardown. */
(function cloudyplap() {
  const NAME = "cloudyplap";
  window.__hotTeardown?.(NAME);
  if (new URLSearchParams(location.search).get("theme") === "0") return;
  window.__cloudyplap = true;

  const SRC = document.currentScript?.src || "local/cloudyplap.js";
  const BASE = SRC.replace(/[^/]+$/, "");
  // Carry this script's own cache-buster onto the stylesheet it injects, so a
  // refreshed launch picks up the matching theme.css instead of a stale copy.
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
  // The outgoing copy only goes once the replacement has painted, so a reload
  // never flashes unstyled during stylesheet replacement.
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
    document.body.classList.remove("theme-cloudyplap", "smoke-on", "smoke-fading");
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
  document.body.classList.remove("smoke-on", "smoke-fading");
  let tinaActive = false;
  let smokeFadeTimer = 0;

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
      if (ambientVideo) ambientVideo.preload = "auto";
      puffVideo && (puffVideo.preload = "auto");
      if (smokeFadeTimer) {
        window.clearTimeout(smokeFadeTimer);
        timers.delete(smokeFadeTimer);
        smokeFadeTimer = 0;
      }
      document.body.classList.remove("smoke-fading");
      smokeLayer?.classList.remove("fading");
      document.body.classList.add("smoke-on");
    } else {
      document.body.classList.remove("smoke-on");
      document.body.classList.add("smoke-fading");
      smokeLayer?.classList.remove("fading");
      void smokeLayer?.offsetWidth;
      smokeLayer?.classList.add("fading");
      if (smokeFadeTimer) window.clearTimeout(smokeFadeTimer);
      smokeFadeTimer = later(() => {
        smokeFadeTimer = 0;
        document.body.classList.remove("smoke-fading");
        smokeLayer?.classList.remove("fading");
        ambientVideo?.pause?.();
      }, 980);
    }
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
  // loop. One ambient decoder is moved between the main and slideshow surfaces
  // so the interface changes without keeping two copies alive.
  const player = document.getElementById("player");
  document.getElementById("tina-smoke-main")?.remove();
  document.getElementById("tina-smoke-player")?.remove();
  document.getElementById("tina-smoke-puff")?.remove();
  document.getElementById("tina-pipe-main-slot")?.remove();
  document.getElementById("tina-pipe-player-slot")?.remove();

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
  const mainSmokeSurface = document.createElement("div");
  mainSmokeSurface.id = "tina-smoke-main";
  mainSmokeSurface.setAttribute("aria-hidden", "true");
  const playerSmokeSurface = document.createElement("div");
  playerSmokeSurface.id = "tina-smoke-player";
  playerSmokeSurface.setAttribute("aria-hidden", "true");

  const smokeLayer = document.createElement("div");
  smokeLayer.id = "tina-smoke-layer";
  const ambientVideo = smokeVideo(smokeSrc, true);
  smokeLayer.appendChild(ambientVideo);
  mainSmokeSurface.appendChild(smokeLayer);

  const puffLayer = document.createElement("div");
  puffLayer.id = "tina-smoke-puff";
  puffLayer.setAttribute("aria-hidden", "true");
  const puffVideo = smokeVideo(BASE + "assets/smoke-puff.mp4", false);
  puffLayer.appendChild(puffVideo);

  function makePipeButton(id) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = "tina-pipe-button";
    button.setAttribute("aria-label", "Puff smoke");
    button.title = "Puff smoke";
    const image = document.createElement("img");
    image.src = BASE + "assets/pipe.png?v=2";
    image.alt = "";
    button.appendChild(image);
    return button;
  }

  const mainPipe = makePipeButton("tina-pipe-main");
  const playerPipe = makePipeButton("tina-pipe-player");
  const pipeButtons = [mainPipe, playerPipe];

  function makePipeSlot(id, pipeButton) {
    const slot = document.createElement("div");
    slot.id = id;
    const rest = document.createElement("div");
    rest.className = "tina-pipe-rest";
    slot.append(rest, pipeButton);
    return slot;
  }

  const mainPipeSlot = makePipeSlot("tina-pipe-main-slot", mainPipe);
  const playerPipeSlot = makePipeSlot("tina-pipe-player-slot", playerPipe);
  const setup = document.getElementById("setup");
  setup?.append(mainSmokeSurface, mainPipeSlot);
  if (player) {
    player.insertBefore(playerSmokeSurface, player.firstChild);
    player.appendChild(playerPipeSlot);
  }

  // The compositor in app.js can include the same real smoke footage in the
  // native PiP stream without creating another decoder or sending local media
  // anywhere.
  window.__tinaSmokePip = {
    draw(ctx, canvas) {
      if (!tinaActive || ambientVideo.readyState < 2) return;
      const sw = ambientVideo.videoWidth || 360;
      const sh = ambientVideo.videoHeight || 540;
      const height = canvas.height * 1.25;
      const width = height * (sw / sh);
      ctx.save();
      ctx.globalAlpha = 0.86;
      ctx.globalCompositeOperation = "screen";
      ctx.filter = "contrast(1.28) brightness(1.36)";
      ctx.drawImage(ambientVideo, canvas.width - width - canvas.width * 0.02, canvas.height - height + canvas.height * 0.08, width, height);
      ctx.restore();
    },
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let puffTimer = 0;

  function syncSmokePlayback() {
    const canPlay = (tinaActive || document.body.classList.contains("smoke-fading")) && !document.hidden;
    const reelOpen = Boolean(player?.classList.contains("on"));
    const target = reelOpen ? playerSmokeSurface : mainSmokeSurface;
    if (smokeLayer.parentNode !== target) target.appendChild(smokeLayer);
    if (puffLayer.parentNode !== target) target.appendChild(puffLayer);
    if (canPlay) {
      ambientVideo.play().catch(() => undefined);
    } else {
      ambientVideo.pause();
    }
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
    pipeButtons.forEach((button) => button.classList.remove("puffing"));
    puffLayer.classList.remove("puffing");
    const visiblePipe = player?.classList.contains("on") ? playerPipe : mainPipe;
    void visiblePipe.offsetWidth;
    visiblePipe.classList.add("puffing");
    puffLayer.classList.add("puffing");
    try {
      puffVideo.currentTime = 0;
    } catch {
      /* metadata is allowed to finish loading */
    }
    puffVideo.play().catch(() => undefined);
    puffTimer = later(() => {
      puffTimer = 0;
      pipeButtons.forEach((button) => button.classList.remove("puffing"));
      puffLayer.classList.remove("puffing");
      puffVideo.pause();
    }, 2850);
  }

  pipeButtons.forEach((pipeButton) => {
    on(pipeButton, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      puffSmoke();
    });
    on(pipeButton, "pointerdown", (event) => event.stopPropagation());
    on(pipeButton, "pointerup", (event) => event.stopPropagation());
  });
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
    [ambientVideo, puffVideo].forEach((v) => {
      try {
        v.pause();
        v.removeAttribute("src");
      } catch {
        /* already gone */
      }
    });
    playerSmokeSurface.remove();
    mainSmokeSurface.remove();
    puffLayer.remove();
    mainPipeSlot.remove();
    playerPipeSlot.remove();
    tinaIndicator.remove();
    document.body.classList.remove("smoke-on");
    glow.remove();
    mascot.remove();
    window.__tinaSmokePip = null;
    window.__cloudyplap = false;
    // The stylesheets stay until the replacement's have loaded; the incoming
    // run tags and removes them.
  });
})();
