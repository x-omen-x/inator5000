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
  const mascotFrames = {
    idle: BASE + "assets/mascot-idle.png",
    half: BASE + "assets/mascot-wink-half.png",
    wink: BASE + "assets/mascot-wink.png",
    tongue: BASE + "assets/mascot-tongue.png",
  };
  const mascotImgs = {};
  Object.entries(mascotFrames).forEach(([key, src]) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.dataset.face = key;
    if (key === "idle") img.classList.add("show");
    mascot.appendChild(img);
    mascotImgs[key] = img;
  });

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

  function showFace(key) {
    Object.keys(mascotImgs).forEach((k) => {
      mascotImgs[k].classList.toggle("show", k === key);
    });
  }
  function playCartoon(seq, hold) {
    mascot.classList.remove("acting");
    void mascot.offsetWidth;
    mascot.classList.add("acting");
    let i = 0;
    const tick = () => {
      showFace(seq[i]);
      i += 1;
      if (i < seq.length) later(tick, hold);
      else later(() => mascot.classList.remove("acting"), 80);
    };
    tick();
  }

  function setTinaMode(active) {
    tinaActive = Boolean(active);
    document.body.classList.toggle("smoke-on", tinaActive);
    mascot.setAttribute("aria-pressed", String(tinaActive));
    mascot.setAttribute("aria-label", `${tinaActive ? "Deactivate" : "Activate"} TINA MODE`);
    mascot.title = `${tinaActive ? "Deactivate" : "Activate"} TINA MODE`;
    tinaIndicator.hidden = !tinaActive;
    if (tinaActive) playCartoon(["half", "wink", "tongue", "idle"], 125);
    else playCartoon(["tongue", "half", "idle"], 110);
  }

  on(mascot, "click", () => setTinaMode(!tinaActive));

  function randomFace() {
    playCartoon(["tongue", "tongue", "tongue", "idle"], 220);
    later(randomFace, 4800 + Math.random() * 5000);
  }
  later(randomFace, 2200);

  document.getElementById("void-glow")?.remove();
  const glow = document.createElement("div");
  glow.id = "void-glow";
  glow.setAttribute("aria-hidden", "true");
  document.body.appendChild(glow);

  // Three copies of the same clip decoding at once is three video decoders
  // running through the whole reel, which is the point at which the soundtrack
  // has the least headroom to spare. A phone gets one, crossfaded against the
  // stills instead of against itself.
  const lean = Boolean(window.__perf?.lean);
  const smokeVids = lean
    ? `
    <video class="smoke-vid a" muted loop playsinline preload="metadata" src="${BASE}assets/smoke-loop.mp4"></video>
    <div class="smoke-still" style="background-image:url(${BASE}assets/smoke-ref.jpg)"></div>
    <div class="smoke-still two" style="background-image:url(${BASE}assets/smoke-wisps.jpg)"></div>
  `
    : `
    <video class="smoke-vid a" muted loop playsinline preload="metadata" src="${BASE}assets/smoke-loop.mp4"></video>
    <video class="smoke-vid b" muted loop playsinline preload="metadata" src="${BASE}assets/smoke-loop.mp4"></video>
    <video class="smoke-vid c" muted loop playsinline preload="metadata" src="${BASE}assets/smoke-loop.mp4"></video>
    <div class="smoke-still" style="background-image:url(${BASE}assets/smoke-ref.jpg)"></div>
    <div class="smoke-still two" style="background-image:url(${BASE}assets/smoke-wisps.jpg)"></div>
  `;

  // A low-cost still layer goes behind the main interface and another drifts
  // in front. The fullscreen player gets its own pair below so the effect
  // surrounds both layouts without competing with audio decoding on phones.
  const stillSmoke = `
    <div class="smoke-still" style="background-image:url(${BASE}assets/smoke-ref.jpg)"></div>
    <div class="smoke-still two" style="background-image:url(${BASE}assets/smoke-wisps.jpg)"></div>
    <div class="haze"></div>`;
  ["theme-smoke-back", "theme-smoke-front"].forEach((id) => document.getElementById(id)?.remove());
  const themeSmokeBack = document.createElement("div");
  themeSmokeBack.id = "theme-smoke-back";
  themeSmokeBack.setAttribute("aria-hidden", "true");
  themeSmokeBack.innerHTML = stillSmoke;
  document.body.appendChild(themeSmokeBack);
  const themeSmokeFront = document.createElement("div");
  themeSmokeFront.id = "theme-smoke-front";
  themeSmokeFront.setAttribute("aria-hidden", "true");
  themeSmokeFront.innerHTML = stillSmoke;
  document.body.appendChild(themeSmokeFront);

  const player = document.getElementById("player");
  document.getElementById("reel-smoke-back")?.remove();
  document.getElementById("reel-smoke")?.remove();
  const reelSmokeBack = document.createElement("div");
  reelSmokeBack.id = "reel-smoke-back";
  reelSmokeBack.setAttribute("aria-hidden", "true");
  reelSmokeBack.innerHTML = stillSmoke;
  const reelSmoke = document.createElement("div");
  reelSmoke.id = "reel-smoke";
  reelSmoke.setAttribute("aria-hidden", "true");
  reelSmoke.innerHTML =
    smokeVids + `<div class="haze"></div>` + (lean ? "" : `<canvas id="smoke-particles"></canvas>`);
  if (player) {
    player.insertBefore(reelSmokeBack, player.firstChild);
    player.insertBefore(reelSmoke, player.firstChild);
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const smokeVideos = [...reelSmoke.querySelectorAll(".smoke-vid")];
  const smokeActive = () =>
    !document.hidden &&
    !reduceMotion.matches &&
    document.body.classList.contains("smoke-on") &&
    player?.classList.contains("on");
  const syncSmokePlayback = () => {
    smokeVideos.forEach((video) => {
      if (smokeActive()) video.play().catch(() => undefined);
      else video.pause();
    });
  };
  watch(document.body, syncSmokePlayback, { attributes: true, attributeFilter: ["class"] });
  if (player) watch(player, syncSmokePlayback, { attributes: true, attributeFilter: ["class"] });
  on(document, "visibilitychange", syncSmokePlayback);
  if (reduceMotion.addEventListener) on(reduceMotion, "change", syncSmokePlayback);

  function crossfadePair(scope) {
    const va = scope.querySelector(".smoke-vid.a");
    const vb = scope.querySelector(".smoke-vid.b");
    // One video means nothing to crossfade against: it simply loops.
    if (!va || !vb) return;
    try {
      vb.currentTime = 2.4;
    } catch {
      /* metadata not ready */
    }
    const vc = scope.querySelector(".smoke-vid.c");
    if (vc) {
      try {
        vc.currentTime = 4.1;
      } catch {
        /* metadata not ready */
      }
    }
    let showingA = true;
    const cross = () => {
      const fade = showingA ? va : vb;
      const rise = showingA ? vb : va;
      fade.style.transition = "opacity 1.4s linear";
      rise.style.transition = "opacity 1.4s linear";
      fade.style.opacity = "0.22";
      rise.style.opacity = "";
      showingA = !showingA;
    };
    on(va, "timeupdate", () => {
      if (va.duration && va.currentTime > va.duration - 1.35 && showingA) cross();
    });
    on(vb, "timeupdate", () => {
      if (vb.duration && vb.currentTime > vb.duration - 1.35 && !showingA) cross();
    });
  }
  crossfadePair(reelSmoke);

  const spriteA = new Image();
  spriteA.src = BASE + "assets/smoke-wisps.jpg";
  const spriteB = new Image();
  spriteB.src = BASE + "assets/smoke-ref.jpg";

  function engine(canvas, opts) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    let w = 0;
    let h = 0;
    const parts = [];
    const max = opts.max;
    const originY = opts.originY;
    let animationFrame = 0;
    let lastDraw = 0;
    let dead = false;

    function resize() {
      const scale = window.__perf ? window.__perf.dpr(1.25) : window.devicePixelRatio > 1.5 ? 1.25 : 1;
      w = canvas.width = Math.floor(window.innerWidth * scale);
      h = canvas.height = Math.floor(window.innerHeight * scale);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    }
    on(window, "resize", resize);
    resize();

    function spawn(n) {
      for (let i = 0; i < n; i++) {
        const side = Math.random();
        parts.push({
          x: w * (0.18 + Math.random() * 0.64),
          y: h * originY + (Math.random() - 0.3) * h * 0.08,
          r: (opts.sizeMin + Math.random() * opts.sizeMax) * (w / 1280),
          vx: (Math.random() - 0.5) * 0.42,
          vy: -0.18 - Math.random() * 0.55,
          life: 0,
          max: 280 + Math.random() * 420,
          swirl: Math.random() * Math.PI * 2,
          rot: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 0.006,
          img: side > 0.45 ? spriteA : spriteB,
          flip: Math.random() < 0.5 ? -1 : 1,
        });
      }
    }
    spawn(opts.seed);

    function schedule() {
      if (!dead && !animationFrame && smokeActive()) animationFrame = requestAnimationFrame(frame);
    }

    function frame(t) {
      animationFrame = 0;
      if (dead || !smokeActive()) return;
      if (t - lastDraw < (window.__perf ? Math.max(32, window.__perf.budget * 2) : 32)) {
        schedule();
        return;
      }
      lastDraw = t;
      ctx.clearRect(0, 0, w, h);
      if (parts.length < max) spawn(opts.rate);
      ctx.globalCompositeOperation = "screen";
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.swirl += 0.008;
        p.x += p.vx + Math.sin(p.swirl + t * 0.00035) * 0.55;
        p.y += p.vy;
        p.r *= 1.0018;
        p.rot += p.spin;
        p.life += 1;
        const fade = Math.max(0, 1 - p.life / p.max);
        const birth = Math.min(1, p.life / 36);
        const a = fade * birth * opts.alpha;
        if (a <= 0.01 || p.y < -p.r) {
          parts.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(p.flip, 1);
        ctx.globalAlpha = a;
        const img = p.img.complete && p.img.naturalWidth ? p.img : null;
        if (img) {
          ctx.drawImage(img, -p.r, -p.r * 0.72, p.r * 2, p.r * 1.44);
        } else {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.r);
          g.addColorStop(0, "rgba(220,228,224,0.85)");
          g.addColorStop(0.4, "rgba(170,180,176,0.35)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      schedule();
    }
    watch(document.body, schedule, { attributes: true, attributeFilter: ["class"] });
    if (player) watch(player, schedule, { attributes: true, attributeFilter: ["class"] });
    on(document, "visibilitychange", schedule);
    if (reduceMotion.addEventListener) on(reduceMotion, "change", schedule);
    disposers.push(() => {
      dead = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
    });
    schedule();
  }

  engine(document.getElementById("smoke-particles"), {
    max: 88,
    seed: 36,
    rate: 2,
    sizeMin: 110,
    sizeMax: 260,
    alpha: 0.38,
    originY: 0.88,
  });

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
    smokeVideos.forEach((v) => {
      try {
        v.pause();
        v.removeAttribute("src");
      } catch {
        /* already gone */
      }
    });
    reelSmoke.remove();
    reelSmokeBack.remove();
    themeSmokeBack.remove();
    themeSmokeFront.remove();
    tinaIndicator.remove();
    document.body.classList.remove("smoke-on");
    glow.remove();
    mascot.remove();
    window.__cloudyplap = false;
    // The stylesheets stay until the replacement's have loaded; the incoming
    // run tags and removes them.
  });
})();
