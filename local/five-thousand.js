/* "5000" — the chrome sub-lockup, its sparkles, and the CRT takeover.
   Hot-swappable: re-running this file tears the previous instance down first,
   so a live update can replace it without a page reload. */
(function fiveThousand() {
  const NAME = "five-thousand";
  window.__hotTeardown?.(NAME);

  const BASE = (document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : "local/five-thousand.js"
  ).replace(/[^/]+$/, "");

  const TEXT = "5000";
  const disposers = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    disposers.push(() => target.removeEventListener(type, fn, opts));
  };
  const timers = new Set();
  const later = (fn, ms) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // A phone cannot afford this loop at full rate and full resolution while it
  // is also decoding audio, and starving the decoder is what made playback
  // stutter. Half the pixels, half the frames, and none of the blur.
  const lean = Boolean(window.__perf?.lean);
  // Read live rather than captured: perf.js measures the first second of real
  // frames and revises the budget upward on a device that cannot keep up.
  const frameMs = () => (window.__perf ? window.__perf.budget : 17);

  /* ------------------------------------------------------------------ mount */

  function layer(cls, tag) {
    const el = document.createElement(tag || "span");
    el.className = `five-k-layer ${cls}`;
    el.textContent = TEXT;
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  const block = document.createElement("button");
  block.type = "button";
  block.id = "five-k";
  block.className = "five-k";
  block.setAttribute("aria-label", `${TEXT} — play the boot sound`);

  const shade = layer("five-k-shade stacked");
  shade.style.fontFamily = '"Bungee Shade", "Bungee", Impact, sans-serif';
  const face = layer("five-k-face");
  face.removeAttribute("aria-hidden");
  const inline = layer("five-k-inline stacked");
  inline.style.fontFamily = '"Bungee Inline", "Bungee", Impact, sans-serif';
  const gloss = layer("five-k-gloss stacked");

  const sparks = document.createElement("div");
  sparks.className = "five-k-sparks";
  sparks.setAttribute("aria-hidden", "true");

  const crt = document.createElement("canvas");
  crt.className = "five-k-crt";
  crt.setAttribute("aria-hidden", "true");

  block.append(shade, face, inline, gloss, sparks, crt);

  const hint = document.createElement("p");
  hint.className = "five-k-hint";
  hint.textContent = "tap to boot";

  // Button and hint travel together in one block so the header can drop them
  // onto their own line under the existing title.
  const wrap = document.createElement("div");
  wrap.className = "five-k-block";
  wrap.append(block, hint);

  function mount() {
    const header = document.querySelector(".sentinel-main-header");
    if (!header) return false;
    document.querySelectorAll(".five-k-block").forEach((el) => {
      if (el !== wrap) el.remove();
    });
    header.appendChild(wrap);
    return true;
  }

  if (!mount()) {
    // The themed header is built by cloudyplap.js; wait for it if we got here first.
    const mo = new MutationObserver(() => {
      if (mount()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    disposers.push(() => mo.disconnect());
  }

  /* ------------------------------------------------------- the glyph stencil */

  let stencilText = { size: 0, baseline: 0, cx: 0 };
  const stencil = document.createElement("canvas");
  const sctx = stencil.getContext("2d", { willReadFrequently: true });
  let stencilBox = { w: 0, h: 0, dpr: 1 };

  function buildStencil() {
    const rect = crt.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const dpr = window.__perf ? window.__perf.dpr(lean ? 1.4 : 2.5) : Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (!w || !h) return false;
    crt.width = w;
    crt.height = h;
    stencil.width = w;
    stencil.height = h;
    stencilBox = { w, h, dpr };

    // Fit "5000" into the box the DOM layers already occupy.
    let size = h;
    sctx.font = `400 ${size}px "Bungee", Impact, sans-serif`;
    let m = sctx.measureText(TEXT);
    const wide = m.width || 1;
    const tall = (m.actualBoundingBoxAscent || size * 0.72) + (m.actualBoundingBoxDescent || size * 0.1);
    size = Math.floor(Math.min((w * 0.94) / (wide / size), (h * 0.9) / (tall / size)));
    sctx.font = `400 ${size}px "Bungee", Impact, sans-serif`;
    m = sctx.measureText(TEXT);

    sctx.clearRect(0, 0, w, h);
    sctx.fillStyle = "#fff";
    sctx.textAlign = "center";
    sctx.textBaseline = "alphabetic";
    const ascent = m.actualBoundingBoxAscent || size * 0.72;
    const descent = m.actualBoundingBoxDescent || size * 0.08;
    const baseline = h / 2 + (ascent - descent) / 2;
    sctx.fillText(TEXT, w / 2, baseline);
    stencilText = { size, baseline, cx: w / 2 };
    return true;
  }

  let stencilPixels = null;

  function readStencilPixels() {
    try {
      stencilPixels = sctx.getImageData(0, 0, stencil.width, stencil.height);
    } catch {
      stencilPixels = null;
    }
  }

  function onGlyph(fx, fy) {
    if (!stencilPixels) return true;
    const x = Math.floor(fx * stencilPixels.width);
    const y = Math.floor(fy * stencilPixels.height);
    if (x < 0 || y < 0 || x >= stencilPixels.width || y >= stencilPixels.height) return false;
    return stencilPixels.data[(y * stencilPixels.width + x) * 4 + 3] > 40;
  }

  function refreshStencil() {
    if (buildStencil()) readStencilPixels();
  }

  const ro = new ResizeObserver(() => refreshStencil());
  ro.observe(block);
  disposers.push(() => ro.disconnect());
  on(window, "resize", refreshStencil);

  if (document.fonts && document.fonts.load) {
    document.fonts.load('400 80px "Bungee"').then(refreshStencil).catch(() => undefined);
    document.fonts.ready.then(refreshStencil).catch(() => undefined);
  }
  later(refreshStencil, 60);
  later(refreshStencil, 900);

  /* ------------------------------------------------------------- the sparkles */

  const SPARK_SRC = `${BASE}assets/sparkle/spark.svg`;
  const preload = new Image();
  preload.src = SPARK_SRC;

  let onScreen = true;
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
    }, { threshold: 0 });
    io.observe(block);
    disposers.push(() => io.disconnect());
  }

  function spawnSpark() {
    // Random spot, nudged onto the metal itself most of the time.
    let fx = Math.random();
    let fy = Math.random();
    for (let tries = 0; tries < 6 && !onGlyph(fx, fy); tries += 1) {
      fx = Math.random();
      fy = Math.random();
    }
    const img = document.createElement("img");
    img.className = "five-k-spark";
    img.src = SPARK_SRC;
    img.alt = "";
    const size = 12 + Math.random() * Math.max(18, block.clientHeight * 0.42);
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    img.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
    // The spark layer is inset past the text box, so map the glyph-space point
    // back onto it.
    img.style.left = `${8 + fx * 84}%`;
    img.style.top = `${10 + fy * 80}%`;
    img.style.setProperty("--spin", `${Math.floor(Math.random() * 360)}deg`);
    img.style.animationDuration = `${700 + Math.random() * 700}ms`;
    sparks.appendChild(img);
    img.addEventListener("animationend", () => img.remove(), { once: true });
    later(() => img.remove(), 2600);
  }

  function scheduleSpark() {
    const gap = 90 + Math.random() * 700;
    later(() => {
      if (!document.hidden && onScreen) {
        spawnSpark();
        if (Math.random() < 0.22) later(spawnSpark, 60 + Math.random() * 140);
      }
      scheduleSpark();
    }, gap);
  }
  scheduleSpark();

  /* ------------------------------------------------------------- the CRT boot */

  const ctx = crt.getContext("2d");
  const audio = new Audio(`${BASE}assets/beepboop.m4a`);
  audio.preload = "auto";

  let actx = null;
  let analyser = null;
  let freq = null;
  let wave = null;
  let frame = 0;
  let scanPos = 0;
  let gridPos = 0;
  let lastT = 0;
  let lastPaint = 0;
  let peak = 0;
  let rollUntil = 0;
  let rollAmount = 0;

  function ensureGraph() {
    if (actx || !(window.AudioContext || window.webkitAudioContext)) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      const src = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(analyser);
      analyser.connect(actx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
    } catch {
      actx = null;
      analyser = null;
    }
  }

  function levels() {
    if (!analyser) {
      // No analyser: fall back to a steady pulse off the playhead so the
      // animation still tracks the track.
      const t = audio.currentTime || 0;
      const p = 0.35 + 0.3 * Math.abs(Math.sin(t * 5.1));
      return { level: p, bass: p, treble: p * 0.6 };
    }
    analyser.getByteTimeDomainData(wave);
    analyser.getByteFrequencyData(freq);
    let sum = 0;
    for (let i = 0; i < wave.length; i += 1) {
      const v = (wave[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / wave.length);
    const bins = freq.length;
    let low = 0;
    for (let i = 0; i < Math.floor(bins * 0.12); i += 1) low += freq[i];
    low /= Math.max(1, Math.floor(bins * 0.12) * 255);
    let high = 0;
    const from = Math.floor(bins * 0.55);
    for (let i = from; i < bins; i += 1) high += freq[i];
    high /= Math.max(1, (bins - from) * 255);
    return {
      level: Math.min(1, rms * 3.4),
      bass: Math.min(1, low * 1.5),
      treble: Math.min(1, high * 2.2),
    };
  }

  function paint(now) {
    frame = requestAnimationFrame(paint);
    const w = crt.width;
    const h = crt.height;
    if (!w || !h) return;
    // Pace the loop instead of chasing the display. A decorative layer that
    // insists on 120fps takes the whole frame budget away from the audio.
    if (lastPaint && now - lastPaint < frameMs() - 1) return;
    const dpr = stencilBox.dpr || 1;
    const dt = lastT ? Math.min(0.06, (now - lastT) / 1000) : 0.016;
    lastT = now;
    lastPaint = now;

    const { level, bass, treble } = levels();
    const calm = reduceMotion.matches ? 0.35 : 1;

    // Everything below moves off the sound: the scan bar accelerates with the
    // level, the grid crawls with the bass, hits knock the picture sideways.
    scanPos = (scanPos + dt * (0.32 + level * 1.9)) % 1;
    gridPos = (gridPos + dt * (14 + bass * 90) * dpr) % (18 * dpr);
    if (bass > 0.62 && bass > peak + 0.06 && now > rollUntil) {
      rollUntil = now + 90 + Math.random() * 130;
      rollAmount = (Math.random() < 0.5 ? -1 : 1) * (0.12 + bass * 0.3);
    }
    peak = peak * 0.86 + bass * 0.14;
    const rolling = now < rollUntil;
    const jitterX = calm * (rolling ? rollAmount * 9 * dpr : (Math.random() - 0.5) * level * 3.2 * dpr);
    const jitterY = calm * (Math.sin(now / 90) * level * 2.2 * dpr);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);

    // 1 — the tube.
    const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    glow.addColorStop(0, `rgba(14, ${Math.round(70 + level * 70)}, 32, 1)`);
    glow.addColorStop(0.55, "rgba(6, 40, 18, 1)");
    glow.addColorStop(1, "rgba(2, 14, 7, 1)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // 2 — the grid, crawling upward.
    const cell = 18 * dpr;
    ctx.lineWidth = Math.max(1, dpr * 0.75);
    ctx.strokeStyle = `rgba(74, 255, 128, ${0.16 + level * 0.24})`;
    ctx.beginPath();
    for (let y = -gridPos; y < h; y += cell) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    const shift = (gridPos * 0.35) % cell;
    for (let x = -shift; x < w; x += cell) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    ctx.stroke();
    ctx.strokeStyle = `rgba(140, 255, 180, ${0.2 + treble * 0.35})`;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    for (let y = -gridPos; y < h; y += cell * 4) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();

    // 3 — the scan bar.
    const barY = scanPos * (h + h * 0.5) - h * 0.25;
    const barH = h * (0.16 + level * 0.2);
    const bar = ctx.createLinearGradient(0, barY - barH, 0, barY + barH);
    bar.addColorStop(0, "rgba(120, 255, 160, 0)");
    bar.addColorStop(0.45, `rgba(170, 255, 200, ${0.16 + level * 0.4})`);
    bar.addColorStop(0.5, `rgba(226, 255, 236, ${0.3 + level * 0.55})`);
    bar.addColorStop(0.55, `rgba(170, 255, 200, ${0.16 + level * 0.4})`);
    bar.addColorStop(1, "rgba(120, 255, 160, 0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = bar;
    ctx.fillRect(0, barY - barH, w, barH * 2);

    // 4 — the phosphor line at the head of the sweep.
    ctx.fillStyle = `rgba(232, 255, 240, ${0.5 + level * 0.5})`;
    ctx.fillRect(0, Math.round(barY), w, Math.max(1, dpr * 1.3));
    ctx.globalCompositeOperation = "source-over";

    // 5 — scanlines and speckle.
    ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
    const lineStep = Math.max(2, Math.round(3 * dpr));
    for (let y = 0; y < h; y += lineStep) ctx.fillRect(0, y, w, Math.max(1, lineStep / 2));
    const specks = Math.round(level * (lean ? 10 : 26) * calm);
    ctx.fillStyle = `rgba(190, 255, 210, ${0.25 + level * 0.3})`;
    for (let i = 0; i < specks; i += 1) {
      ctx.fillRect(Math.random() * w, Math.random() * h, dpr * (1 + Math.random() * 2), dpr);
    }
    if (rolling) {
      const ty = Math.random() * h;
      ctx.fillStyle = `rgba(220, 255, 230, ${0.25 + level * 0.35})`;
      ctx.fillRect(0, ty, w, dpr * (1 + Math.random() * 3));
    }

    // 6 — keep only what falls inside the glyphs. The stencil moves with the
    // hits, so the "5000" shape shudders while the picture slides inside it.
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(stencil, jitterX, jitterY);

    // 7 — phosphor edge and bloom. Canvas blur re-rasterises the whole layer
    // every frame, so on a lean device the bloom is faked with two offset
    // draws instead: a fraction of the cost, and at this alpha, the same read.
    ctx.globalCompositeOperation = "lighter";
    ctx.save();
    if (!lean && "filter" in ctx) {
      ctx.filter = `blur(${(2 + level * 4) * dpr}px)`;
      ctx.globalAlpha = 0.32 + level * 0.4;
      ctx.drawImage(stencil, jitterX, jitterY);
    } else {
      ctx.globalAlpha = (0.32 + level * 0.4) * 0.5;
      const s2 = (1 + level * 1.6) * dpr;
      ctx.drawImage(stencil, jitterX - s2, jitterY);
      ctx.drawImage(stencil, jitterX + s2, jitterY);
      ctx.drawImage(stencil, jitterX, jitterY - s2);
      ctx.drawImage(stencil, jitterX, jitterY + s2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = "source-over";
    if (stencilText.size) {
      ctx.save();
      ctx.translate(jitterX, jitterY);
      ctx.font = `400 ${stencilText.size}px "Bungee", Impact, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      if (!lean) {
        ctx.shadowColor = `rgba(90, 255, 140, ${0.5 + level * 0.5})`;
        ctx.shadowBlur = (6 + level * 16) * dpr;
      }
      ctx.strokeStyle = `rgba(178, 255, 200, ${0.6 + treble * 0.4})`;
      ctx.lineWidth = Math.max(1, dpr * 1.4);
      ctx.strokeText(TEXT, stencilText.cx, stencilText.baseline);
      ctx.restore();
    }
  }

  function startPaint() {
    if (frame) return;
    lastT = 0;
    lastPaint = 0;
    frame = requestAnimationFrame(paint);
  }
  function stopPaint() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, crt.width, crt.height);
  }

  function boot() {
    if (block.classList.contains("crt-on")) {
      audio.pause();
      audio.currentTime = 0;
      return;
    }
    refreshStencil();
    ensureGraph();
    if (actx && actx.state === "suspended") actx.resume().catch(() => undefined);
    audio.currentTime = 0;
    const played = audio.play();
    if (played && played.catch) played.catch(() => undefined);
    block.classList.add("crt-on");
    hint.textContent = "booting";
    hint.classList.add("live");
    scanPos = 0;
    startPaint();
  }

  function shutdown() {
    block.classList.remove("crt-on");
    hint.textContent = "tap to boot";
    hint.classList.remove("live");
    later(stopPaint, 220);
  }

  on(block, "click", (e) => {
    e.preventDefault();
    boot();
  });
  on(audio, "ended", shutdown);
  on(audio, "pause", () => {
    if (block.classList.contains("crt-on") && audio.currentTime === 0) shutdown();
  });
  on(document, "visibilitychange", () => {
    if (document.hidden && !audio.paused) {
      audio.pause();
      audio.currentTime = 0;
      shutdown();
    }
  });

  /* ---------------------------------------------------------------- lifecycle */

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
    stopPaint();
    try {
      audio.pause();
    } catch {
      /* already gone */
    }
    if (actx) actx.close().catch(() => undefined);
    wrap.remove();
  });
})();
