/* Manual title animation pass.
   The supplied After Effects project's effect stack was inspected directly:
   Noise -> Tritone -> Curves -> Glow -> Compound Blur -> Camera Lens Blur ->
   4-Color Gradient. This browser treatment translates that stack into manual
   DOM/CSS layers and irregularly-timed distortion bursts. It does not alter or
   regenerate the supplied Brutal Tooth font or the AEP source. */
(function manualTitlePass() {
  const NAME = "manual-title-pass";
  window.__hotTeardown?.(NAME);

  const timers = new Set();
  const observers = [];
  let destroyed = false;
  let words = [];
  let five = null;
  let crtNoiseTimer = 0;

  function later(fn, ms) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  }

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (items) => items[Math.floor(Math.random() * items.length)];

  function buildWord(word) {
    if (!word || word.dataset.manualTitleReady === "1") return;
    word.dataset.manualTitleReady = "1";
    const text = word.textContent || "";
    word.dataset.manualText = text;

    // Three independently clipped duplicates are the manual equivalent of
    // displaced/compound-blurred slices in the supplied AE treatment.
    for (let i = 0; i < 3; i += 1) {
      const slice = document.createElement("span");
      slice.className = `manual-grunge-slice manual-grunge-slice-${i + 1}`;
      slice.textContent = text;
      slice.setAttribute("aria-hidden", "true");
      word.appendChild(slice);
    }
  }

  function moveGhosts(word) {
    if (!word || destroyed) return;
    const positions = [
      `${rand(-10, 28).toFixed(1)}% ${rand(36, 98).toFixed(1)}%`,
      `${rand(28, 76).toFixed(1)}% ${rand(-8, 58).toFixed(1)}%`,
      `${rand(70, 112).toFixed(1)}% ${rand(38, 102).toFixed(1)}%`,
      "0 0",
    ];
    word.style.backgroundPosition = positions.join(", ");
    word.style.setProperty("--ghost-halo", rand(0.42, 0.72).toFixed(2));
    later(() => moveGhosts(word), rand(1900, 5200));
  }

  function setSlice(slice, band) {
    const top = Math.max(0, Math.min(94, band));
    const height = rand(4, 18);
    const bottom = Math.max(0, 100 - Math.min(99, top + height));
    slice.style.setProperty("--slice-top", `${top.toFixed(1)}%`);
    slice.style.setProperty("--slice-bottom", `${bottom.toFixed(1)}%`);
    slice.style.setProperty("--slice-x", `${rand(-9, 9).toFixed(1)}px`);
    slice.style.setProperty("--slice-y", `${rand(-2.2, 2.2).toFixed(1)}px`);
    slice.style.setProperty("--slice-skew", `${rand(-7, 7).toFixed(2)}deg`);
    slice.style.setProperty("--slice-scale", rand(0.94, 1.08).toFixed(3));
    slice.style.setProperty("--slice-blur", `${rand(0, 0.75).toFixed(2)}px`);
    slice.style.setProperty("--slice-contrast", rand(1.05, 1.55).toFixed(2));
    slice.style.setProperty("--slice-opacity", rand(0.62, 0.98).toFixed(2));
  }

  function oneHit(word, intensity = 1) {
    if (!word || destroyed) return;
    const slices = [...word.querySelectorAll(".manual-grunge-slice")];
    slices.forEach((slice, i) => setSlice(slice, rand(4 + i * 12, 82 - i * 4)));
    word.style.setProperty("--title-shift-x", `${rand(-2.8, 2.8) * intensity}px`);
    word.style.setProperty("--title-shift-y", `${rand(-1.3, 1.3) * intensity}px`);
    word.style.setProperty("--title-skew", `${rand(-1.8, 1.8) * intensity}deg`);
    word.style.setProperty("--title-scale-x", rand(1.035, 1.12).toFixed(3));
    word.classList.add("grunge-hit");

    const hold = rand(48, 118);
    later(() => {
      word.classList.remove("grunge-hit");
      word.style.setProperty("--title-shift-x", "0px");
      word.style.setProperty("--title-shift-y", "0px");
      word.style.setProperty("--title-skew", "0deg");
      word.style.setProperty("--title-scale-x", matchMedia("(max-width: 680px)").matches ? "1.04" : "1.08");
    }, hold);
  }

  function burst(word) {
    if (!word || destroyed || document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const pulses = Math.random() < 0.22 ? 3 : Math.random() < 0.55 ? 2 : 1;
    for (let i = 0; i < pulses; i += 1) {
      later(() => oneHit(word, 0.78 + i * 0.12), i * rand(42, 96));
    }
  }

  function scheduleDistortion() {
    if (destroyed) return;
    later(() => {
      if (words.length && !document.hidden) {
        const target = pick(words);
        burst(target);
        // Rarely make the other word twitch a fraction later, never in a fixed
        // pattern, so the effect reads as unstable footage instead of a loop.
        if (Math.random() < 0.26 && words.length > 1) {
          const other = words.find((w) => w !== target);
          if (other) later(() => burst(other), rand(35, 170));
        }
      }
      scheduleDistortion();
    }, rand(620, 3650));
  }

  function addFiveKLayers(block) {
    if (!block || block.dataset.manualBootReady === "1") return;
    block.dataset.manualBootReady = "1";
    const text = "5000";
    for (const side of ["top", "bottom"]) {
      const plate = document.createElement("span");
      plate.className = `five-k-mech five-k-mech-${side}`;
      plate.textContent = text;
      plate.setAttribute("aria-hidden", "true");
      block.appendChild(plate);
    }
    const grille = document.createElement("span");
    grille.className = "five-k-crt-grille";
    grille.textContent = text;
    grille.setAttribute("aria-hidden", "true");
    block.appendChild(grille);

    const line = document.createElement("span");
    line.className = "five-k-power-line";
    line.setAttribute("aria-hidden", "true");
    block.appendChild(line);

    let wasOn = block.classList.contains("crt-on");
    const mo = new MutationObserver(() => {
      const on = block.classList.contains("crt-on");
      if (on === wasOn) return;
      wasOn = on;
      if (on) {
        block.classList.remove("manual-returning");
        block.classList.add("manual-booting");
        later(() => block.classList.remove("manual-booting"), 620);
        startCrtNoise(grille, block);
      } else {
        stopCrtNoise();
        block.classList.remove("manual-booting");
        block.classList.add("manual-returning");
        later(() => block.classList.remove("manual-returning"), 680);
      }
    });
    mo.observe(block, { attributes: true, attributeFilter: ["class"] });
    observers.push(mo);
  }

  function startCrtNoise(grille, block) {
    stopCrtNoise();
    const tick = () => {
      if (destroyed || !block.classList.contains("crt-on")) return;
      grille.style.setProperty("--crt-roll", `${Math.floor(rand(-9, 10))}px`);
      grille.style.setProperty("--crt-jitter", `${Math.floor(rand(-2, 3))}px`);
      grille.style.setProperty("--crt-opacity", rand(0.33, 0.61).toFixed(2));
      if (Math.random() < 0.12) {
        grille.style.filter = `contrast(${rand(1.25, 1.7).toFixed(2)}) brightness(${rand(0.9, 1.32).toFixed(2)}) drop-shadow(0 0 8px rgba(92,255,127,.8))`;
      } else {
        grille.style.filter = "contrast(1.35) drop-shadow(0 0 7px rgba(92,255,127,.8))";
      }
      crtNoiseTimer = window.setTimeout(tick, rand(42, 115));
    };
    tick();
  }

  function stopCrtNoise() {
    if (crtNoiseTimer) window.clearTimeout(crtNoiseTimer);
    crtNoiseTimer = 0;
  }

  function mount() {
    words = [...document.querySelectorAll("body.theme-cloudyplap .brand-lockup .brand-word")];
    if (!words.length) return false;
    words.forEach((word) => {
      buildWord(word);
      moveGhosts(word);
    });
    five = document.getElementById("five-k");
    if (five) addFiveKLayers(five);
    scheduleDistortion();
    return true;
  }

  if (!mount()) {
    const mo = new MutationObserver(() => {
      if (mount()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    observers.push(mo);
  }

  window.__hotRegister?.(NAME, () => {
    destroyed = true;
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    stopCrtNoise();
    observers.forEach((mo) => mo.disconnect());
    document.querySelectorAll(".manual-grunge-slice,.five-k-mech,.five-k-crt-grille,.five-k-power-line").forEach((el) => el.remove());
    document.querySelectorAll(".brand-word[data-manual-title-ready]").forEach((word) => {
      delete word.dataset.manualTitleReady;
      delete word.dataset.manualText;
      word.classList.remove("grunge-hit");
      word.removeAttribute("style");
    });
    five?.classList.remove("manual-booting", "manual-returning");
  });
})();
