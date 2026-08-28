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
      [smokeBackLayer, smokeFrontLayer].forEach((layer) => layer?.classList.remove("fading"));
      try {
        ambientVideo.currentTime = 0;
      } catch {
        /* metadata can finish loading after the activation gesture */
      }
      document.body.classList.add("smoke-on");
      startSmokeDrift();
      // Let the pipe settle into its dock, then emit the first milky cloud from
      // the photographed bowl as part of the same mascot activation.
      later(puffSmoke, 260);
    } else {
      document.body.classList.remove("smoke-on");
      document.body.classList.add("smoke-fading");
      [smokeBackLayer, smokeFrontLayer].forEach((layer) => layer?.classList.remove("fading"));
      void smokeBackLayer?.offsetWidth;
      [smokeBackLayer, smokeFrontLayer].forEach((layer) => layer?.classList.add("fading"));
      stopSmokeDrift();
      if (smokeFadeTimer) window.clearTimeout(smokeFadeTimer);
      smokeFadeTimer = later(() => {
        smokeFadeTimer = 0;
        document.body.classList.remove("smoke-fading");
        [smokeBackLayer, smokeFrontLayer].forEach((layer) => layer?.classList.remove("fading"));
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

  // Real photographed smoke, manually circular-crossfaded, slowed and rebuilt
  // as a 49-second 60 fps loop with three time-offset plumes. One ambient
  // decoder is moved between the main and slideshow surfaces so the interface
  // changes without keeping two copies alive.
  const player = document.getElementById("player");
  document.getElementById("tina-smoke-main")?.remove();
  document.getElementById("tina-smoke-player")?.remove();
  document.getElementById("tina-smoke-main-back")?.remove();
  document.getElementById("tina-smoke-main-front")?.remove();
  document.getElementById("tina-smoke-player-back")?.remove();
  document.getElementById("tina-smoke-player-front")?.remove();
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

  // Keep the photographed motion as the back layer, then add transparent
  // generated wisps in front. Versioned URLs prevent installed copies from
  // retaining an older, much fainter smoke encode after a shell refresh.
  const smokeSrc = BASE + "assets/smoke-wisp-loop.mp4?v=2";
  const smokeAiSrc = BASE + "assets/smoke-wisps-ai.png?v=1";
  const puffSrc = BASE + "assets/smoke-puff.mp4?v=2";
  const puffAiSrc = BASE + "assets/smoke-puff-ai.png?v=1";

  function smokeImage(src, className) {
    const image = document.createElement("img");
    image.className = className;
    image.src = src;
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    image.setAttribute("aria-hidden", "true");
    return image;
  }
  function smokeSurface(id) {
    const surface = document.createElement("div");
    surface.id = id;
    surface.setAttribute("aria-hidden", "true");
    return surface;
  }

  const mainSmokeBackSurface = smokeSurface("tina-smoke-main-back");
  const mainSmokeFrontSurface = smokeSurface("tina-smoke-main-front");
  const playerSmokeBackSurface = smokeSurface("tina-smoke-player-back");
  const playerSmokeFrontSurface = smokeSurface("tina-smoke-player-front");

  const smokeBackLayer = document.createElement("div");
  smokeBackLayer.id = "tina-smoke-back-layer";
  const ambientVideo = smokeVideo(smokeSrc, true);
  ambientVideo.setAttribute("fetchpriority", "low");
  smokeBackLayer.appendChild(ambientVideo);
  mainSmokeBackSurface.appendChild(smokeBackLayer);

  const smokeFrontLayer = document.createElement("div");
  smokeFrontLayer.id = "tina-smoke-front-layer";
  const smokeAiWisps = [smokeAiSrc, puffAiSrc, smokeAiSrc].map((src, index) =>
    smokeImage(src, `smoke-ai-wisp smoke-ai-wisp-${"abc"[index]}`),
  );
  smokeFrontLayer.append(...smokeAiWisps);
  mainSmokeFrontSurface.appendChild(smokeFrontLayer);

  const puffLayer = document.createElement("div");
  puffLayer.id = "tina-smoke-puff";
  puffLayer.setAttribute("aria-hidden", "true");
  const puffVideo = smokeVideo(puffSrc, false);
  const puffAiImage = smokeImage(puffAiSrc, "smoke-ai-puff");
  puffLayer.append(puffVideo, puffAiImage);

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
  setup?.append(mainSmokeBackSurface, mainSmokeFrontSurface, mainPipeSlot);
  if (player) {
    player.insertBefore(playerSmokeBackSurface, player.firstChild);
    player.insertBefore(playerSmokeFrontSurface, player.firstChild);
    player.appendChild(playerPipeSlot);
  }

  // Recording can include the same real smoke frame without creating another
  // decoder or sending local media anywhere.
  window.__tinaSmokeRecord = {
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
  let smokeDriftTimer = 0;
  let smokeWatchTimer = 0;
  let smokeWatchTime = -1;
  let smokeWatchMisses = 0;
  let puffTimer = 0;

  function smokeCanPlay() {
    return (tinaActive || document.body.classList.contains("smoke-fading")) && !document.hidden;
  }

  function stopSmokeWatchdog() {
    if (smokeWatchTimer) {
      window.clearTimeout(smokeWatchTimer);
      timers.delete(smokeWatchTimer);
      smokeWatchTimer = 0;
    }
    smokeWatchTime = -1;
    smokeWatchMisses = 0;
  }

  function watchSmokePlayback() {
    smokeWatchTimer = 0;
    if (!smokeCanPlay()) {
      stopSmokeWatchdog();
      return;
    }
    const now = ambientVideo.currentTime;
    const stopped = ambientVideo.paused || ambientVideo.ended ||
      (smokeWatchTime >= 0 && Math.abs(now - smokeWatchTime) < 0.03);
    smokeWatchMisses = stopped ? smokeWatchMisses + 1 : 0;
    if (smokeWatchMisses >= 2) {
      // Chromium and WebKit can leave a decorative video in a false-playing
      // state (paused=false, readyState=4) while its decoder is parked. A tiny
      // forward seek restarts that decoder without a visible jump in this slow
      // footage; crossing the end restarts the circularly matched loop.
      ambientVideo.pause();
      if (Number.isFinite(ambientVideo.duration)) {
        const restartAt = now + 0.06 < ambientVideo.duration ? now + 0.06 : 0;
        try { ambientVideo.currentTime = restartAt; } catch { /* metadata can still be settling */ }
      }
      ambientVideo.play().catch(() => undefined);
      smokeWatchMisses = 0;
    }
    smokeWatchTime = ambientVideo.currentTime;
    smokeWatchTimer = later(watchSmokePlayback, 1500);
  }

  function startSmokeWatchdog() {
    if (smokeWatchTimer) return;
    smokeWatchTime = ambientVideo.currentTime;
    smokeWatchMisses = 0;
    smokeWatchTimer = later(watchSmokePlayback, 1500);
  }

  function setRandomDrift(element, front) {
    const spread = front ? 9 : 6;
    const seconds = front ? 6 + Math.random() * 5 : 8 + Math.random() * 6;
    element.style.setProperty("--smoke-drift-x", `${(Math.random() * 2 - 1) * spread}vw`);
    element.style.setProperty("--smoke-drift-y", `${(Math.random() * 2 - 1) * (front ? 3.5 : 2.5)}vh`);
    element.style.setProperty("--smoke-drift-rot", `${(Math.random() * 2 - 1) * (front ? 3.2 : 2.1)}deg`);
    element.style.setProperty("--smoke-drift-scale", String(0.96 + Math.random() * (front ? 0.13 : 0.09)));
    element.style.setProperty("--smoke-drift-time", `${seconds.toFixed(2)}s`);
    return seconds;
  }

  function driftSmoke() {
    if (!tinaActive || reduceMotion.matches) return;
    const driftSeconds = [
      setRandomDrift(ambientVideo, false),
      ...smokeAiWisps.map((wisp) => setRandomDrift(wisp, true)),
    ];
    smokeDriftTimer = later(driftSmoke, Math.min(...driftSeconds) * 1000);
  }

  function startSmokeDrift() {
    if (smokeDriftTimer) {
      window.clearTimeout(smokeDriftTimer);
      timers.delete(smokeDriftTimer);
    }
    if (reduceMotion.matches) return;
    smokeDriftTimer = later(driftSmoke, 120);
  }

  function stopSmokeDrift() {
    if (!smokeDriftTimer) return;
    window.clearTimeout(smokeDriftTimer);
    timers.delete(smokeDriftTimer);
    smokeDriftTimer = 0;
  }

  function syncSmokePlayback() {
    const canPlay = smokeCanPlay();
    const reelOpen = Boolean(player?.classList.contains("on"));
    const backTarget = reelOpen ? playerSmokeBackSurface : mainSmokeBackSurface;
    const frontTarget = reelOpen ? playerSmokeFrontSurface : mainSmokeFrontSurface;
    if (smokeBackLayer.parentNode !== backTarget) backTarget.appendChild(smokeBackLayer);
    if (smokeFrontLayer.parentNode !== frontTarget) frontTarget.appendChild(smokeFrontLayer);
    if (puffLayer.parentNode !== frontTarget) frontTarget.appendChild(puffLayer);
    if (canPlay) {
      ambientVideo.play().catch(() => undefined);
      startSmokeWatchdog();
    } else {
      ambientVideo.pause();
      stopSmokeWatchdog();
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
    }, 3200);
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
  on(ambientVideo, "waiting", () => {
    if (!smokeCanPlay()) return;
    ambientVideo.play().catch(() => undefined);
  });
  on(ambientVideo, "stalled", () => {
    if (!smokeCanPlay()) return;
    ambientVideo.play().catch(() => undefined);
  });
  if (reduceMotion.addEventListener) {
    on(reduceMotion, "change", () => {
      if (tinaActive) startSmokeDrift();
      syncSmokePlayback();
    });
  }

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
    stopSmokeWatchdog();
    playerSmokeBackSurface.remove();
    playerSmokeFrontSurface.remove();
    mainSmokeBackSurface.remove();
    mainSmokeFrontSurface.remove();
    puffLayer.remove();
    mainPipeSlot.remove();
    playerPipeSlot.remove();
    tinaIndicator.remove();
    document.body.classList.remove("smoke-on");
    glow.remove();
    mascot.remove();
    window.__tinaSmokeRecord = null;
    window.__cloudyplap = false;
    // The stylesheets stay until the replacement's have loaded; the incoming
    // run tags and removes them.
  });
})();
