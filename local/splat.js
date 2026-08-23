/* PLAP — a hand-animated liquid splat.
 *
 * There is no image file and no generated art here. Every shape is drawn from
 * geometry written by hand, and every piece of timing below is a hand-authored
 * chart: a list of (millisecond, value) keys whose *spacing* carries the ease,
 * the same way a timing chart drawn down the side of an exposure sheet does.
 * Nothing uses a canned CSS easing curve.
 *
 * The beats follow real drop-impact footage rather than the usual cartoon
 * shorthand:
 *   -90ms  the mass falls in, stretched along its path (one smear, no more)
 *     0ms  contact. Extreme squash, volume held: scaleY = 1 / scaleX
 *   40ms   the crown (coronet) throws up first, on uneven spikes
 *  120ms   spike tips thin, bead, and pinch off into flying droplets
 *  250ms   the crown collapses — and only *then* the Worthington jet fires,
 *          which is the beat most splash animation gets backwards
 *  420ms   jet peaks, its tip beads off in a decreasing chain
 *  130ms+  the body overshoots its spread and surface tension pulls it back,
 *          twice, softly, never settling into a dead hold
 *  900ms+  drips start to run, staggered, each on its own chart
 *
 * Fluidity comes from three things, in the Baxter sense of spacing being the
 * whole game: charts with deliberately uneven key spacing; a spring per rim
 * node so the outline lags the body and overlaps its own action; and a fixed
 * 1/240s integrator so the motion is identical at 30, 60 or 120fps.
 *
 * Cost: no network, no assets, one small canvas, and the loop stops dead the
 * moment the animation ends. Idle cost is zero. */
(function splatModule() {
  const NAME = "splat";
  window.__hotTeardown?.(NAME);

  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const TAU = Math.PI * 2;

  /* ------------------------------------------------------------- timing charts
     Read these as drawings. The gaps between keys are the ease. */

  // How far the mass has spread, as a multiple of its resting radius.
  // 0 -> 26ms is the smear: one enormous step, then the spacing tightens fast.
  const SPREAD = [
    [0, 0.10], [26, 0.62], [52, 1.02], [84, 1.24],
    [130, 1.35], [200, 1.26], [290, 1.325], [420, 1.288],
    [650, 1.306], [1100, 1.298], [2000, 1.288], [3400, 1.27],
  ];

  // Horizontal scale. Vertical is 1/this, so the volume never changes.
  // The -90 key is the anticipation: thin and tall on the way down.
  const SQUASH = [
    [-90, 0.62], [-30, 0.70], [0, 0.88], [22, 1.47],
    [48, 1.30], [90, 1.10], [150, 0.982], [240, 1.038],
    [380, 0.988], [600, 1.008], [1000, 0.998], [3400, 1.0],
  ];

  // Crown height. Up hard, hang for a beat, then fold back down.
  const CROWN = [
    [8, 0], [40, 0.56], [70, 0.93], [105, 1.0],
    [150, 0.87], [220, 0.51], [310, 0.17], [400, 0],
  ];

  // The rebound column, deliberately starting after the crown has folded.
  const JET = [
    [250, 0], [300, 0.31], [360, 0.79], [420, 1.0],
    [470, 0.9], [560, 0.53], [680, 0.15], [790, 0],
  ];

  // Overall opacity — a long, flat hold so it reads, then a soft dissolve.
  const ALPHA = [
    [-90, 0], [-70, 1], [2400, 1], [2900, 0.72], [3400, 0],
  ];

  const LIFE_MS = 3400;

  /* One hand-drawn silhouette, as 24 radii around the rim. Uneven on purpose:
     three big lobes that do not sit opposite each other, a couple of tucks
     between them, and no repeated value anywhere. A circle reads as CG. */
  const LOBES = [
    1.00, 0.90, 1.16, 1.34, 1.05, 0.86, 0.97, 1.24,
    1.46, 1.11, 0.88, 0.81, 1.03, 1.29, 1.07, 0.84,
    0.94, 1.19, 1.38, 1.04, 0.87, 0.99, 1.22, 1.08,
  ];
  const RIM = LOBES.length;

  /* How far behind the body each rim node drags, in ms. Hand-set so the lag
     sweeps around the shape instead of pulsing symmetrically — this is the
     overlapping action, and it is what stops the outline feeling rigid. */
  const LAG = [
    0, 6, 13, 19, 24, 27, 28, 26, 22, 17, 11, 5,
    2, 7, 14, 21, 26, 29, 30, 27, 21, 15, 8, 3,
  ];

  /* Crown spikes: angle in turns (0 = right, going clockwise on screen), how
     long, and how wide at the base. Drawn by hand — the clustering matters
     more than the count, so there are two crowded pairs and one lonely one. */
  const SPIKES = [
    [0.505, 1.00, 0.055], [0.545, 0.72, 0.040], [0.575, 0.94, 0.050],
    [0.620, 0.55, 0.034], [0.665, 0.86, 0.046], [0.700, 0.63, 0.038],
    [0.760, 1.06, 0.058], [0.800, 0.44, 0.030], [0.845, 0.90, 0.048],
    [0.885, 0.68, 0.040], [0.925, 0.98, 0.052], [0.960, 0.52, 0.034],
    [0.995, 0.80, 0.044],
  ];
  // Staggered pinch-off, so the tips do not all let go on the same frame.
  const PINCH = [188, 214, 176, 246, 202, 232, 168, 258, 196, 226, 182, 250, 208];

  // Drips: rim angle in turns, when it starts, how heavy. Three, uneven.
  const DRIPS = [
    [0.14, 900, 1.00],
    [0.29, 1250, 0.66],
    [0.02, 1700, 0.82],
  ];

  /* ------------------------------------------------------------------ maths */

  // Non-uniform Catmull-Rom through the chart keys: the interpolation respects
  // how far apart the keys are, so uneven spacing actually reads as uneven.
  function chart(keys, t) {
    const n = keys.length;
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (i < n - 2 && keys[i + 1][0] <= t) i += 1;
    const [t1, v1] = keys[i];
    const [t2, v2] = keys[i + 1];
    const [t0, v0] = keys[i > 0 ? i - 1 : i];
    const [t3, v3] = keys[i + 2 < n ? i + 2 : n - 1];
    const h = t2 - t1;
    const u = (t - t1) / h;
    const m1 = t2 - t0 > 0 ? ((v2 - v0) / (t2 - t0)) * h : 0;
    const m2 = t3 - t1 > 0 ? ((v3 - v1) / (t3 - t1)) * h : 0;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * v1 +
      (u3 - 2 * u2 + u) * m1 +
      (-2 * u3 + 3 * u2) * v2 +
      (u3 - u2) * m2
    );
  }

  // A closed Catmull-Rom outline emitted as cubics. C1 continuous, so the
  // silhouette never shows a corner — which is the whole difference between
  // reading as liquid and reading as a polygon.
  function outline(ctx, pts) {
    const n = pts.length;
    if (n < 3) return;
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n; i += 1) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const d = pts[(i + 2) % n];
      ctx.bezierCurveTo(
        b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6,
        c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6,
        c[0], c[1],
      );
    }
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ device */

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const lean =
    coarse ||
    (navigator.hardwareConcurrency || 8) <= 4 ||
    (navigator.deviceMemory || 8) <= 4;

  // Design space. Impact sits high in the box so the crown and jet have air
  // above them and the drips have room to run below.
  const BOX_W = 1000;
  const BOX_H = 840;
  const CX = 500;
  const CY = 300;
  const R0 = 118; // resting radius of the mass, in design units

  /* --------------------------------------------------------------- the splat */

  function makeSplat(host, px, py, scale, audio) {
    const cw = Math.round(BOX_W * scale);
    const ch = Math.round(BOX_H * scale);
    const dpr = Math.min(window.devicePixelRatio || 1, lean ? 1.75 : 2.25);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      `position:absolute;left:${px - cw * (CX / BOX_W)}px;top:${py - ch * (CY / BOX_H)}px;` +
      `width:${cw}px;height:${ch}px;pointer-events:none;z-index:40;` +
      `contain:strict;will-change:transform;`;
    host.appendChild(canvas);

    const ctx = canvas.getContext("2d", { alpha: true });
    const unit = (cw / BOX_W) * dpr;
    ctx.setTransform(unit, 0, 0, unit, 0, 0);

    const body = { fill: "#f7fbf8", deep: "#bcd8c8", gloss: "rgba(255,255,255,0.92)" };

    // Rim springs. x is the node's own radius, chasing the charted spread.
    const rim = [];
    for (let i = 0; i < RIM; i += 1) rim.push({ x: R0 * 0.1 * LOBES[i], v: 0 });
    // Squash spring: the charted value is the target, the spring gives it the
    // extra half-frame of give that keeps a hard snap from looking brittle.
    const sq = { x: 0.62, v: 0 };

    const drops = [];
    const sats = [];
    const dripState = DRIPS.map(() => ({ len: 0, v: 0, bead: 0, gone: false }));
    const pinched = new Array(SPIKES.length).fill(false);
    const recoil = SPIKES.map(() => ({ x: 0, v: 0 }));
    let jetShed = 0;

    // Deterministic per-instance jitter. Seeded so a given splat is internally
    // consistent frame to frame rather than boiling.
    let seed = (Math.random() * 1e9) | 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    function addDrop(x, y, vx, vy, r, flight) {
      drops.push({ x, y, vx, vy, r, age: 0, flight, rot: rnd() * TAU, spin: (rnd() - 0.5) * 6 });
    }

    // Ejecta thrown on contact: a wide, flat spray plus a little fine mist.
    // Low, fast ones read as skid; the high slow ones give the eye something
    // to follow while the body is settling.
    const ejecta = lean ? 16 : 26;
    for (let i = 0; i < ejecta; i += 1) {
      const a = Math.PI + rnd() * Math.PI; // upper half, in screen coords
      const sp = 260 + rnd() * 620;
      addDrop(
        CX + Math.cos(a) * R0 * 0.5, CY + Math.sin(a) * R0 * 0.3,
        Math.cos(a) * sp * (1.5 + rnd()), Math.sin(a) * sp * 0.9,
        4 + rnd() * 13, 240 + rnd() * 520,
      );
    }
    const mist = lean ? 14 : 34;
    for (let i = 0; i < mist; i += 1) {
      const a = Math.PI + rnd() * Math.PI;
      const sp = 700 + rnd() * 1100;
      addDrop(
        CX, CY, Math.cos(a) * sp, Math.sin(a) * sp * 0.7,
        1.2 + rnd() * 2.8, 90 + rnd() * 260,
      );
    }

    function land(d) {
      // A landed droplet does not just stop — it becomes its own little splat,
      // with its own crown and its own dots. Smaller means faster: the satellites
      // finish their whole cycle inside the main body's settle.
      if (sats.length > (lean ? 14 : 26)) return;
      sats.push({
        x: d.x, y: d.y, r: d.r * (1.25 + rnd() * 0.5),
        t0: d.age, off: (rnd() * RIM) | 0, rot: rnd() * TAU,
        pips: Math.min(4, 1 + ((rnd() * 4) | 0)),
        pipa: [rnd() * TAU, rnd() * TAU, rnd() * TAU, rnd() * TAU],
        pipd: [1.5 + rnd(), 1.5 + rnd(), 1.5 + rnd(), 1.5 + rnd()],
      });
    }

    /* ------------------------------------------------------------- simulation */

    // Fixed step. Springs integrated at 240Hz regardless of display rate, so a
    // 30fps phone and a 120fps tablet produce the exact same motion.
    const STEP = 1 / 240;
    function step(t, h) {
      const spread = chart(SPREAD, t);
      for (let i = 0; i < RIM; i += 1) {
        // Each node reads the chart slightly in the past: the rim drags.
        const target = R0 * chart(SPREAD, t - LAG[i]) * LOBES[i];
        // A capillary ripple travelling round the rim, dying away by ~1.2s.
        const wave =
          Math.sin((i / RIM) * TAU * 3 + t * 0.019) *
          R0 * 0.085 * Math.exp(-t / 620) +
          Math.sin((i / RIM) * TAU * 5 - t * 0.011) *
          R0 * 0.045 * Math.exp(-t / 1150);
        const n = rim[i];
        n.v += (target + wave - n.x) * 260 * h;
        n.v *= Math.exp(-13 * h);
        n.x += n.v * h;
      }
      sq.v += (chart(SQUASH, t) - sq.x) * 420 * h;
      sq.v *= Math.exp(-17 * h);
      sq.x += sq.v * h;

      const g = 1700; // design units / s^2

      for (let i = drops.length - 1; i >= 0; i -= 1) {
        const d = drops[i];
        d.age += h * 1000;
        d.vy += g * h;
        d.vx *= Math.exp(-0.9 * h); // air drag, so the arcs curl instead of shooting
        d.x += d.vx * h;
        d.y += d.vy * h;
        d.rot += d.spin * h;
        if (d.age >= d.flight) {
          land(d);
          drops.splice(i, 1);
        } else if (d.y > BOX_H + 40 || d.x < -60 || d.x > BOX_W + 60) {
          drops.splice(i, 1);
        }
      }

      // Spike tips let go one at a time and the stub snaps back — fast out of
      // the break, then slow, which is what sells the surface tension.
      for (let i = 0; i < SPIKES.length; i += 1) {
        if (!pinched[i] && t >= PINCH[i]) {
          pinched[i] = true;
          const a = SPIKES[i][0] * TAU;
          const len = R0 * 1.45 * SPIKES[i][1] * chart(CROWN, t);
          addDrop(
            CX + Math.cos(a) * R0 * 0.8, CY + Math.sin(a) * R0 * 0.7 - len,
            Math.cos(a) * (140 + rnd() * 180), -260 - rnd() * 220,
            SPIKES[i][2] * R0 * 0.9, 380 + rnd() * 420,
          );
          recoil[i].v = -9;
        }
        const rc = recoil[i];
        rc.v += (0 - rc.x) * 190 * h;
        rc.v *= Math.exp(-11 * h);
        rc.x += rc.v * h;
      }

      // The jet tip beads off in a decreasing chain, once, near the peak.
      if (!jetShed && t > 430) {
        jetShed = 1;
        const top = CY - R0 * 2.05 * chart(JET, t);
        for (let i = 0; i < 3; i += 1) {
          addDrop(
            CX + (rnd() - 0.5) * 10, top - i * R0 * 0.26,
            (rnd() - 0.5) * 70, -180 + i * 55,
            R0 * (0.115 - i * 0.028), 420 + i * 90,
          );
        }
      }

      // Drips: the head fattens and the neck thins, and the run is not linear —
      // it hesitates as surface tension resists, then gives way.
      for (let i = 0; i < DRIPS.length; i += 1) {
        const [, t0, mass] = DRIPS[i];
        const s = dripState[i];
        if (t < t0) continue;
        const age = t - t0;
        const want = mass * R0 * (0.28 + 1.55 * (1 - Math.exp(-age / 780)));
        s.v += (want - s.len) * 34 * h;
        s.v *= Math.exp(-7.5 * h);
        s.len += s.v * h;
        s.bead = mass * R0 * (0.16 + 0.13 * (1 - Math.exp(-age / 520)));
      }
      return spread;
    }

    /* ---------------------------------------------------------------- drawing */

    function bodyPoints(spread) {
      const pts = new Array(RIM);
      const sx = sq.x;
      const sy = 1 / sx;
      for (let i = 0; i < RIM; i += 1) {
        const a = (i / RIM) * TAU;
        pts[i] = [
          CX + Math.cos(a) * rim[i].x * sx,
          // The mass sits down into the surface as it spreads rather than
          // hovering: a small downward bias that grows with the spread.
          CY + Math.sin(a) * rim[i].x * sy * 0.86 + (spread - 1) * 9,
        ];
      }
      return pts;
    }

    function paintBody(pts) {
      if (!lean) {
        // Underside shadow, offset only — no blur filter, which is the single
        // most expensive thing you can ask a mobile canvas to do.
        ctx.globalAlpha *= 0.34;
        ctx.fillStyle = "#0d1a12";
        ctx.beginPath();
        ctx.save();
        ctx.translate(0, 11);
        outline(ctx, pts);
        ctx.restore();
        ctx.fill();
        ctx.globalAlpha /= 0.34;
      }
      const grad = ctx.createLinearGradient(0, CY - R0 * 1.3, 0, CY + R0 * 1.5);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.55, body.fill);
      grad.addColorStop(1, body.deep);
      ctx.fillStyle = grad;
      ctx.beginPath();
      outline(ctx, pts);
      ctx.fill();
    }

    function paintGloss(pts) {
      if (lean) return;
      // A wet highlight: the same outline pulled in and lifted, so it tracks
      // every wobble of the silhouette instead of sitting on top of it.
      const inner = pts.map(([x, y]) => [
        CX + (x - CX) * 0.62 - R0 * 0.1,
        CY + (y - CY) * 0.5 - R0 * 0.26,
      ]);
      ctx.globalAlpha *= 0.5;
      ctx.fillStyle = body.gloss;
      ctx.beginPath();
      outline(ctx, inner);
      ctx.fill();
      ctx.globalAlpha /= 0.5;
    }

    function paintCrown(t) {
      const h = chart(CROWN, t);
      if (h <= 0.001) return;
      ctx.fillStyle = "#fdfffe";
      for (let i = 0; i < SPIKES.length; i += 1) {
        const [turn, lenMul, wide] = SPIKES[i];
        const a = turn * TAU;
        const bx = CX + Math.cos(a) * rim[(Math.round(turn * RIM) % RIM + RIM) % RIM].x * 0.94;
        const by = CY + Math.sin(a) * R0 * 0.42;
        let len = R0 * 1.5 * lenMul * h + recoil[i].x * R0 * 0.1;
        if (pinched[i]) len *= 0.55;
        if (len < 2) continue;
        const w = R0 * wide * (0.5 + 0.5 * h);
        // Spikes lean outward as they rise — nothing travels in a straight line.
        const lean2 = Math.cos(a) * len * 0.34;
        const tipR = pinched[i] ? w * 0.55 : w * (0.42 + 0.9 * Math.min(1, t / 210));
        const tx = bx + lean2;
        const ty = by - len;
        ctx.beginPath();
        ctx.moveTo(bx - w, by);
        ctx.quadraticCurveTo(bx - w * 0.42 + lean2 * 0.5, by - len * 0.62, tx - tipR, ty);
        ctx.arc(tx, ty, tipR, Math.PI, 0);
        ctx.quadraticCurveTo(bx + w * 0.42 + lean2 * 0.5, by - len * 0.62, bx + w, by);
        ctx.closePath();
        ctx.fill();
      }
    }

    function paintJet(t) {
      const j = chart(JET, t);
      if (j <= 0.001) return;
      const len = R0 * 2.1 * j;
      const base = R0 * 0.36 * (0.6 + 0.4 * j);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      // Fat accelerating base, near-constant ballistic middle, beaded tip.
      ctx.moveTo(CX - base, CY - R0 * 0.1);
      ctx.bezierCurveTo(
        CX - base * 0.5, CY - len * 0.45,
        CX - base * 0.26, CY - len * 0.8,
        CX - base * 0.22, CY - len,
      );
      ctx.arc(CX, CY - len, base * 0.22, Math.PI, 0);
      ctx.bezierCurveTo(
        CX + base * 0.26, CY - len * 0.8,
        CX + base * 0.5, CY - len * 0.45,
        CX + base, CY - R0 * 0.1,
      );
      ctx.closePath();
      ctx.fill();
      // One bead riding the column, the Rayleigh–Plateau tell.
      const bead = base * 0.36;
      ctx.beginPath();
      ctx.arc(CX, CY - len * 0.72, bead, 0, TAU);
      ctx.fill();
    }

    function paintDrips(t) {
      ctx.fillStyle = body.fill;
      for (let i = 0; i < DRIPS.length; i += 1) {
        const s = dripState[i];
        if (s.len < 3) continue;
        const a = DRIPS[i][0] * TAU;
        const bx = CX + Math.cos(a) * R0 * 0.86;
        const by = CY + Math.abs(Math.sin(a)) * R0 * 0.62 + R0 * 0.34;
        const neck = Math.max(1.6, s.bead * (0.62 - 0.34 * Math.min(1, s.len / (R0 * 1.6))));
        const tipY = by + s.len;
        ctx.beginPath();
        ctx.moveTo(bx - s.bead * 1.5, by - R0 * 0.1);
        ctx.bezierCurveTo(
          bx - neck * 1.4, by + s.len * 0.42,
          bx - neck, tipY - s.bead * 1.1,
          bx - s.bead * 0.82, tipY - s.bead * 0.2,
        );
        ctx.arc(bx, tipY - s.bead * 0.2, s.bead * 0.82, Math.PI, 0);
        ctx.bezierCurveTo(
          bx + neck, tipY - s.bead * 1.1,
          bx + neck * 1.4, by + s.len * 0.42,
          bx + s.bead * 1.5, by - R0 * 0.1,
        );
        ctx.closePath();
        ctx.fill();
      }
    }

    function paintDrops() {
      ctx.fillStyle = "#fbfffd";
      for (let i = 0; i < drops.length; i += 1) {
        const d = drops[i];
        const sp = Math.hypot(d.vx, d.vy);
        // Smear: only while genuinely fast, and capped, so it lasts a frame or
        // two the way a drawn smear does rather than becoming the pose.
        const stretch = Math.min(3.1, 1 + sp / 620);
        const ang = Math.atan2(d.vy, d.vx);
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.ellipse(0, 0, d.r * stretch, d.r / Math.sqrt(stretch), 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    function paintSats(t) {
      ctx.fillStyle = "#f9fdfb";
      for (let i = 0; i < sats.length; i += 1) {
        const s = sats[i];
        const age = t - s.t0;
        if (age < 0) continue;
        // Small means fast: the satellite runs the same chart on a short clock.
        const k = age / 0.42;
        const sp = chart(SPREAD, k) * s.r;
        const sx = chart(SQUASH, k);
        const sy = 1 / sx;
        const pts = new Array(10);
        for (let n = 0; n < 10; n += 1) {
          const a = (n / 10) * TAU + s.rot;
          const lob = LOBES[(n * 2 + s.off) % RIM];
          pts[n] = [s.x + Math.cos(a) * sp * lob * sx, s.y + Math.sin(a) * sp * lob * sy * 0.9];
        }
        ctx.beginPath();
        outline(ctx, pts);
        ctx.fill();
        // Its own handful of dots, thrown a touch further as it spreads.
        const ch = chart(CROWN, k);
        for (let p = 0; p < s.pips; p += 1) {
          const a = s.pipa[p];
          const dd = sp * (1.5 + s.pipd[p] * (0.4 + ch));
          ctx.beginPath();
          ctx.arc(s.x + Math.cos(a) * dd, s.y + Math.sin(a) * dd * 0.7, s.r * 0.26, 0, TAU);
          ctx.fill();
        }
      }
    }

    function paintFall(t) {
      // Pre-impact: the mass streaks in, stretched along its path. One beat.
      const k = Math.min(1, (t + 90) / 90);
      const y = CY - R0 * 5.4 * (1 - k * k);
      const stretch = 1 + (1 - k) * 2.6;
      ctx.fillStyle = "#ffffff";
      ctx.save();
      ctx.translate(CX, y);
      ctx.beginPath();
      ctx.ellipse(0, 0, (R0 * 0.42) / Math.sqrt(stretch), R0 * 0.42 * stretch, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    /* --------------------------------------------------------------- the loop */

    let frame = 0;
    let t = -90;
    let last = 0;
    let carry = 0;
    let done = false;
    let struck = false;

    function tick(now) {
      frame = 0;
      if (done) return;
      const dtMs = last ? Math.min(64, now - last) : 16.7;
      last = now;

      // Fixed-step integration with the remainder carried over. This is why the
      // motion is identical on a 30fps phone and a 120fps display.
      carry += dtMs / 1000;
      let guard = 0;
      while (carry >= STEP && guard < 40) {
        if (t >= 0) step(t, STEP);
        t += STEP * 1000;
        carry -= STEP;
        guard += 1;
      }
      if (guard >= 40) carry = 0;

      if (!struck && t >= 0) {
        struck = true;
        if (audio) {
          try {
            audio.currentTime = 0;
            audio.play().catch(() => undefined);
          } catch {
            /* a blocked autoplay is not worth a broken animation */
          }
        }
      }

      ctx.clearRect(0, 0, BOX_W, BOX_H);
      const alpha = chart(ALPHA, t);
      if (alpha <= 0.002 && t > 0) {
        destroy();
        return;
      }
      ctx.globalAlpha = alpha;

      if (t < 0) {
        paintFall(t);
      } else {
        const spread = chart(SPREAD, t);
        const pts = bodyPoints(spread);
        paintDrips(t);
        paintJet(t);
        paintCrown(t);
        paintBody(pts);
        paintGloss(pts);
        paintSats(t);
        paintDrops();
      }
      ctx.globalAlpha = 1;

      if (t > LIFE_MS) destroy();
      else frame = raf(tick);
    }

    function destroy() {
      if (done) return;
      done = true;
      if (frame) caf(frame);
      frame = 0;
      canvas.remove();
    }

    frame = raf(tick);
    return destroy;
  }

  /* -------------------------------------------------------------- public api */

  const live = new Set();
  let audioEl = null;

  function ensureAudio() {
    if (audioEl) return audioEl;
    audioEl = document.getElementById("spurr-audio");
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.id = "spurr-audio";
      audioEl.src = "spurr.m4a";
      audioEl.preload = "auto";
      document.body.appendChild(audioEl);
    }
    return audioEl;
  }

  function fire(opts) {
    const host = (opts && opts.host) || document.getElementById("player") || document.body;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const rect = host.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;

    // Keep at most three in flight. A fourth would cost more than it reads.
    while (live.size >= 3) {
      const first = live.values().next().value;
      live.delete(first);
      first();
    }

    const scale = Math.min(w * 0.86, h * 0.78, 620) / BOX_W;
    const px = opts && opts.x != null ? opts.x : w * (0.24 + Math.random() * 0.52);
    const py = opts && opts.y != null ? opts.y : h * (0.22 + Math.random() * 0.4);

    if (reduce.matches) {
      // Reduced motion still gets the sound and a still drawing, no movement.
      const a = ensureAudio();
      try {
        a.currentTime = 0;
        a.play().catch(() => undefined);
      } catch {
        /* nothing to do */
      }
      return;
    }

    const kill = makeSplat(host, px, py, scale, ensureAudio());
    const wrapped = () => {
      live.delete(wrapped);
      kill();
    };
    live.add(wrapped);
  }

  window.__splat = { fire };

  window.__hotRegister?.(NAME, () => {
    [...live].forEach((kill) => kill());
    live.clear();
    if (window.__splat && window.__splat.fire === fire) delete window.__splat;
  });
})();
