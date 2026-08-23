/* One shared read of what this device can actually afford.
 *
 * The page runs several continuous full-screen effects at once — matrix rain,
 * the CRT block, drifting smoke — and on a phone their combined main-thread
 * cost is enough to starve the audio decoder, which is what the choppy
 * playback was. Every effect asks this module how hard to work instead of
 * each one guessing separately.
 *
 * Loaded before everything else and deliberately not hot-swappable: the
 * modules that read it are. */
(function perf() {
  if (window.__perf) return;

  const mm = (q) => {
    try {
      return window.matchMedia(q);
    } catch {
      return { matches: false, addEventListener() {} };
    }
  };

  const reduce = mm("(prefers-reduced-motion: reduce)");
  const coarse = mm("(pointer: coarse)").matches;
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 820;
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const saver = navigator.connection && navigator.connection.saveData;

  // "lean" is not really about the screen. It is about whether there is spare
  // main thread to burn while audio is decoding, and on any touch device the
  // answer is no.
  const lean = Boolean(coarse || narrow || cores <= 4 || mem <= 4 || saver);

  // Measured rather than assumed: a phone that cannot hold 60 gets told to
  // stop trying, which looks far better than a stutter at a nominal 60.
  let budget = lean ? 34 : 17; // ms per frame the decorative layers may target
  let samples = 0;
  let last = 0;
  let slow = 0;
  function sample(now) {
    if (last) {
      const dt = now - last;
      if (dt > 0 && dt < 400) {
        samples += 1;
        if (dt > 26) slow += 1;
        if (samples === 45) {
          // More than half the early frames missed 60fps: settle at 30 and
          // stop asking the device for something it is not going to give.
          if (slow > 22) budget = Math.max(budget, 33);
          return;
        }
      }
    }
    last = now;
    if (samples < 45) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);

  window.__perf = {
    get lean() {
      return lean;
    },
    get reduce() {
      return reduce.matches;
    },
    // Canvas backing scale. Full device pixel ratio on a phone means drawing
    // three times the pixels for a decoration nobody is looking closely at.
    dpr(cap) {
      const want = window.devicePixelRatio || 1;
      return Math.min(want, cap || (lean ? 1.5 : 2));
    },
    // Minimum milliseconds between frames for a decorative layer.
    get budget() {
      return budget;
    },
    // Decorative layers only: true when it is worth drawing at all.
    get decorate() {
      return !reduce.matches && !document.hidden;
    },
  };
})();
