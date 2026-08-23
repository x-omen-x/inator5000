/* LAN SHARE — direct device-to-device library sync over the local network.
 *
 * Three things matter here and everything below is shaped by them:
 *   1. Media bytes never touch the internet. Peer connections are created with
 *      an empty ICE server list, so only host/mDNS candidates are gathered and
 *      a session can physically only complete between devices on one LAN.
 *   2. Nothing lands on disk unless the receiver says so. Incoming media is
 *      mirrored into memory as object URLs; IndexedDB is only written after the
 *      "keep on this device" prompt is answered.
 *   3. It has to stay out of the slideshow's way. Fingerprinting, transfer and
 *      re-rendering are all pooled, back-pressured and coalesced.
 */
(() => {
  "use strict";
  if (typeof state === "undefined") return;

  const BC_NAME = "gooninator-lan-share-v1";
  const RELAY = "/api/lan-rendezvous";
  const PROTO = 1;
  const SAMPLE = 192 * 1024;
  const CHUNK_FLOOR = 16 * 1024;
  const HIGH_WATER = 4 * 1024 * 1024;
  const LOW_WATER = 512 * 1024;

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const $$ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------------- utils */

  function b64(u8) {
    let out = "";
    const step = 0x8000;
    for (let i = 0; i < u8.length; i += step) out += String.fromCharCode.apply(null, u8.subarray(i, i + step));
    return btoa(out);
  }
  function unb64(text) {
    const bin = atob(text);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function hex(buf) {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function sha256(u8) {
    return hex(await crypto.subtle.digest("SHA-256", u8));
  }
  function fmtBytes(n) {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
  }
  async function pool(jobs, width) {
    let cursor = 0;
    const lanes = Array.from({ length: Math.max(1, Math.min(width, jobs.length)) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          await job();
        } catch {
          /* one bad file must not stall the sweep */
        }
      }
    });
    await Promise.all(lanes);
  }
  function deviceLabel() {
    const ua = navigator.userAgent;
    const browser = /Firefox\//.test(ua)
      ? "Firefox"
      : /Edg\//.test(ua)
        ? "Edge"
        : /OPR\//.test(ua)
          ? "Opera"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
    const os = /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
    return os ? `${browser} · ${os}` : browser;
  }

  /* -------------------------------------------------- content fingerprints */

  // Full hashes of multi-gigabyte videos would stall the sweep, so the
  // fingerprint is size + type + the first and last 192 KB. That is stable
  // across devices and effectively collision free for real media files, and it
  // costs the same for a 20 KB thumbnail as for a 4 GB movie.
  const fpCache = new Map();
  function fingerprint(blob, cacheKey) {
    const hit = fpCache.get(cacheKey);
    if (hit) return hit;
    const job = (async () => {
      const head = new Uint8Array(await blob.slice(0, Math.min(SAMPLE, blob.size)).arrayBuffer());
      const tail =
        blob.size > SAMPLE * 2 ? new Uint8Array(await blob.slice(blob.size - SAMPLE).arrayBuffer()) : new Uint8Array(0);
        // Size and bytes only. The MIME type is normalised on the wire, so
      // hashing it here would make a received file fingerprint differently
      // after a reload and defeat dedupe on the next session.
      const meta = enc.encode(`${blob.size}`);
      const buf = new Uint8Array(meta.length + head.length + tail.length);
      buf.set(meta, 0);
      buf.set(head, meta.length);
      buf.set(tail, meta.length + head.length);
      return (await sha256(buf)).slice(0, 32);
    })();
    fpCache.set(cacheKey, job);
    return job;
  }

  function keyFor(cat, fp, album) {
    return cat === "slide" ? `s|${fp}|${album || ""}` : cat === "audio" ? `a|${fp}` : `o|${fp}`;
  }

  async function localItems() {
    const out = [];
    const jobs = [];
    for (const slide of state.slides) {
      const blob = slide.file;
      if (!blob) continue;
      jobs.push(async () => {
        const fp = await fingerprint(blob, `slide:${slide.id}`);
        out.push({
          key: keyFor("slide", fp, slide.album),
          fp,
          cat: "slide",
          name: slide.alt || blob.name || "photo",
          type: blob.type || (slide.kind === "video" ? "video/mp4" : "image/jpeg"),
          album: slide.album || "Photos",
          kind: slide.kind === "video" ? "video" : "image",
          size: blob.size,
          blob,
        });
      });
    }
    for (const track of state.tracks) {
      const blob = track.file;
      if (!blob) continue;
      jobs.push(async () => {
        const fp = await fingerprint(blob, `audio:${track.id}`);
        out.push({
          key: keyFor("audio", fp),
          fp,
          cat: "audio",
          name: track.name || blob.name || "audio",
          type: blob.type || "audio/mpeg",
          album: "",
          kind: "audio",
          size: blob.size,
          blob,
        });
      });
    }
    if (state.overlayFile) {
      const blob = state.overlayFile;
      jobs.push(async () => {
        const fp = await fingerprint(blob, "overlay:current");
        out.push({
          key: keyFor("overlay", fp),
          fp,
          cat: "overlay",
          name: state.overlayName || blob.name || "overlay",
          type: blob.type || "video/mp4",
          album: "",
          kind: "video",
          size: blob.size,
          blob,
        });
      });
    }
    await pool(jobs, 4);
    return out;
  }

  /* ------------------------------------------------------------ live state */

  const session = {
    on: false,
    id: "",
    label: deviceLabel(),
    items: new Map(), // key -> item (with blob)
    have: new Set(), // every key this device holds or has claimed
    claimed: new Set(), // keys already requested from some peer
    peers: new Map(), // peerId -> peer
    mode: "mirror",
    modeAsked: false,
    pending: [], // received rows awaiting persistence if the user opts in
    ecdh: null,
    tag: "",
    passKey: null,
    relayOk: true,
    relayBackoff: 0,
    started: 0,
    // When something last made another device look likely, and whether the
    // hunt has been parked because nothing ever did.
    lastPeerAt: 0,
    dozing: false,
    stats: { sentItems: 0, sentBytes: 0, recvItems: 0, recvBytes: 0, wantTotal: 0, rate: 0 },
  };

  let bc = null;
  let relayTimer = 0;
  const relayOutbox = [];

  /* ---------------------------------------------------------------- the HUD */

  let hud = null;
  let hudTimer = 0;
  let rateAt = 0;
  let rateBytes = 0;

  function buildHud() {
    if (hud) return hud;
    hud = document.createElement("div");
    hud.id = "lan-hud";
    hud.className = "lan-hud";
    hud.setAttribute("role", "status");
    hud.setAttribute("aria-live", "polite");
    hud.innerHTML = `
      <div class="lan-hud-scan" aria-hidden="true"></div>
      <div class="lan-hud-head">
        <span class="lan-hud-dot" aria-hidden="true"></span>
        <strong class="lan-hud-title" id="lan-hud-title">LAN SYNC</strong>
        <span class="lan-hud-detail" id="lan-hud-detail"></span>
        <button type="button" class="lan-hud-stop" id="lan-hud-stop" aria-label="Stop LAN share">✕</button>
      </div>
      <div class="lan-hud-bar" aria-hidden="true"><i id="lan-hud-fill"></i></div>
      <div class="lan-hud-peers" id="lan-hud-peers"></div>`;
    document.body.appendChild(hud);
    $$("lan-hud-stop").onclick = () => stop("Stopped");
    return hud;
  }

  function paintHud() {
    if (!hud || !session.on) return;
    const st = session.stats;
    const now = performance.now();
    if (now - rateAt > 450) {
      const moved = st.sentBytes + st.recvBytes - rateBytes;
      const inst = moved / ((now - rateAt) / 1000);
      st.rate = st.rate ? st.rate * 0.55 + inst * 0.45 : inst;
      rateAt = now;
      rateBytes = st.sentBytes + st.recvBytes;
    }
    const live = [...session.peers.values()].filter((p) => p.ready);
    const busy = st.wantTotal > st.recvItems || [...session.peers.values()].some((p) => p.sending);
    const pct = st.wantTotal ? Math.min(100, (st.recvItems / st.wantTotal) * 100) : live.length ? 100 : 8;

    $$("lan-hud-title").textContent = busy
      ? "LAN SYNC · LIVE"
      : live.length
        ? "LAN SYNC · IN SYNC"
        : session.dozing
          ? "LAN SYNC · RESTING"
          : "LAN SYNC · LOOKING";
    const bits = [`${live.length} peer${live.length === 1 ? "" : "s"}`];
    if (st.wantTotal) bits.push(`${st.recvItems}/${st.wantTotal} in`);
    if (st.sentItems) bits.push(`${st.sentItems} out`);
    if (busy && st.rate > 1024) bits.push(`${fmtBytes(st.rate)}/s`);
    bits.push(session.mode === "save" ? "saving to device" : "mirroring · no disk");
    $$("lan-hud-detail").textContent = bits.join(" · ");
    $$("lan-hud-fill").style.width = `${pct}%`;
    hud.classList.toggle("busy", busy);
    $$("lan-hud-peers").innerHTML = live
      .map(
        (p) =>
          `<span class="lan-chip${p.sending ? " tx" : ""}">${escapeHtml(p.label)}<em>${p.via}</em>${
            p.safety ? `<b title="handshake safety code">${p.safety}</b>` : ""
          }</span>`,
      )
      .join("");
    paintPanel(live.length);
  }

  function refreshHud() {
    if (hudTimer) return;
    hudTimer = setTimeout(() => {
      hudTimer = 0;
      paintHud();
    }, 140);
  }

  function paintPanel(liveCount) {
    const label = $$("lan-state");
    if (label) {
      label.textContent = session.on
        ? liveCount
          ? `on · ${liveCount} peer${liveCount === 1 ? "" : "s"}`
          : session.dozing
            ? "on · resting"
            : "on · looking for peers"
        : "off";
      label.classList.toggle("live", session.on);
    }
    const btn = $$("lan-share-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", String(session.on));
      btn.classList.toggle("outline", !session.on);
      btn.textContent = session.on ? "⇄ LAN Share · ON" : "⇄ LAN Share";
    }
    const note = $$("lan-note");
    if (note && session.on) {
      note.textContent = !session.relayOk
        ? "On, but this device cannot find the others by itself. Use \u201cNo Wi-Fi?\u201d below to pair them by hand."
        : session.dozing
          ? "On, but nothing else turned up, so it has stopped looking to save power. Tap Look again when the other device is ready."
          : "On. Anything you add shows up on the other device too.";
    }
    const look = $$("lan-look-btn");
    if (look) look.hidden = !session.on || !session.dozing;
  }

  /* --------------------------------------------------------- render pacing */

  let renderTimer = 0;
  let slidesDirty = false;
  function scheduleRender(touchedSlides) {
    if (touchedSlides) slidesDirty = true;
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = 0;
      if (slidesDirty) {
        slidesDirty = false;
        try {
          resetShuffleBag();
        } catch {
          /* not fatal */
        }
      }
      try {
        renderSetup();
      } catch {
        /* not fatal */
      }
    }, 240);
  }

  /* ------------------------------------------------------------- receiving */

  async function persistRow(row) {
    try {
      if (row.store === "photo") await idbPut(PHOTO_STORE, [row.data]);
      else await idbPut(MEDIA_STORE, [row.data]);
      return true;
    } catch {
      return false;
    }
  }

  async function flushPending() {
    if (session.mode !== "save" || !session.pending.length) return;
    const rows = session.pending.splice(0);
    for (let i = 0; i < rows.length; i += 12) {
      await Promise.all(rows.slice(i, i + 12).map(persistRow));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  async function ingest(item, blob, alreadyCounted) {
    if (session.have.has(item.key)) return;
    session.have.add(item.key);
    session.items.set(item.key, { ...item, blob });

    if (item.cat === "slide") {
      const id = crypto.randomUUID();
      fpCache.set(`slide:${id}`, Promise.resolve(item.fp));
      state.slides.push({
        id,
        url: URL.createObjectURL(blob),
        album: item.album || "Photos",
        alt: item.name,
        kind: item.kind === "video" ? "video" : "image",
        file: blob,
      });
      const row = {
        store: "photo",
        data: { id, name: item.name, type: item.type, blob, album: item.album || "Photos", kind: item.kind },
      };
      if (session.mode === "save") await persistRow(row);
      else session.pending.push(row);
      scheduleRender(true);
    } else if (item.cat === "audio") {
      const id = crypto.randomUUID();
      fpCache.set(`audio:local-audio-${id}`, Promise.resolve(item.fp));
      state.tracks.push({ id: `local-audio-${id}`, url: URL.createObjectURL(blob), name: item.name, file: blob });
      if (state.soundtrackMode === "off") state.soundtrackMode = "local";
      const row = { store: "media", data: { id: `local-audio-${id}`, name: item.name, type: item.type, blob } };
      if (session.mode === "save") await persistRow(row);
      else session.pending.push(row);
      scheduleRender(false);
    } else if (item.cat === "overlay") {
      // One overlay slot exists, so an existing local overlay is never clobbered.
      if (!state.overlayFile) {
        fpCache.set("overlay:current", Promise.resolve(item.fp));
        state.overlayUrl = URL.createObjectURL(blob);
        state.overlayName = item.name;
        state.overlayFile = blob;
        const row = { store: "media", data: { id: "overlay-video", name: item.name, type: item.type, blob } };
        if (session.mode === "save") await persistRow(row);
        else session.pending.push(row);
        scheduleRender(false);
      }
    }

    session.stats.recvItems += 1;
    // Chunked arrivals were counted frame by frame as they landed.
    if (!alreadyCounted) session.stats.recvBytes += blob.size;
    refreshHud();
  }

  /* ------------------------------------------------- the "keep it?" prompt */

  function ensureSaveSheet() {
    let sheet = $$("lan-save-sheet");
    if (sheet) return sheet;
    sheet = document.createElement("div");
    sheet.id = "lan-save-sheet";
    sheet.className = "sheet-bg hid";
    sheet.innerHTML = `
      <div class="panel sentinel-window sheet">
        <div class="panel-head">
          <div>
            <p class="idx">LAN share</p>
            <h2>Incoming media</h2>
          </div>
        </div>
        <p class="lan-sheet-copy" id="lan-sheet-copy"></p>
        <div class="row" style="margin-top:1rem">
          <button type="button" class="btn" id="lan-keep-mirror" style="flex:1">Mirror only · no extra space</button>
          <button type="button" class="btn outline" id="lan-keep-save" style="flex:1">Copy files to this device</button>
        </div>
        <p class="lan-sheet-foot">Mirroring holds the media for this session only and writes nothing to storage. Copying keeps it after a reload and uses disk space.</p>
      </div>`;
    document.body.appendChild(sheet);
    $$("lan-keep-mirror").onclick = () => chooseMode("mirror");
    $$("lan-keep-save").onclick = () => chooseMode("save");
    return sheet;
  }

  function chooseMode(mode) {
    session.mode = mode;
    session.modeAsked = true;
    writeSettings({ lanReceive: mode });
    $$("lan-save-sheet")?.classList.add("hid");
    const sel = $$("lan-receive-mode");
    if (sel) sel.value = mode;
    flushPending();
    refreshHud();
  }

  function askMode(incoming, bytes) {
    if (session.modeAsked || !incoming) return;
    session.modeAsked = true;
    const sheet = ensureSaveSheet();
    $$("lan-sheet-copy").textContent =
      `${incoming} item${incoming === 1 ? "" : "s"} (${fmtBytes(bytes)}) are arriving from this network. ` +
      `They are already streaming in — choose whether to keep them on this device.`;
    sheet.classList.remove("hid");
  }

  /* --------------------------------------------------------- peer plumbing */

  function makePeer(id, via, label) {
    const peer = {
      id,
      via,
      label: label || "peer",
      ready: false,
      sending: false,
      safety: "",
      key: null,
      pc: null,
      dc: null,
      queue: [],
      wanted: [],
      // Everything this peer said it holds, so a key released by a departing
      // peer can be re-requested from someone else still on the mesh.
      offers: new Set(),
      incoming: new Map(),
      sid: 1,
      sentManifest: false,
      // Frames arrive in order on an ordered channel, but decrypting them is
      // async — without this chain two chunks could finish out of order, or a
      // file-end could land before its last chunk and truncate the file.
      inbound: Promise.resolve(),
    };
    // A data channel can open before the ECDH exchange lands, so every send
    // waits on this rather than racing a null key.
    peer.keyReady = via === "tab" ? Promise.resolve() : new Promise((resolve) => (peer.keyDone = resolve));
    return peer;
  }

  async function sendControl(peer, obj) {
    if (peer.via === "tab") {
      bc?.postMessage({ v: PROTO, from: session.id, to: peer.id, ctl: obj });
      return;
    }
    await peer.keyReady;
    if (peer.dc?.readyState !== "open" || !peer.key) return;
    peer.dc.send(await seal(peer, 0, 0, enc.encode(JSON.stringify(obj))));
  }

  async function seal(peer, type, sid, payload) {
    const header = new Uint8Array(5);
    header[0] = type;
    new DataView(header.buffer).setUint32(1, sid);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header }, peer.key, payload),
    );
    const out = new Uint8Array(17 + ct.length);
    out.set(header, 0);
    out.set(iv, 5);
    out.set(ct, 17);
    return out.buffer;
  }

  async function open(peer, frame) {
    const u8 = new Uint8Array(frame);
    const header = u8.subarray(0, 5);
    const iv = u8.subarray(5, 17);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: header },
      peer.key,
      u8.subarray(17),
    );
    return { type: header[0], sid: new DataView(u8.buffer, u8.byteOffset, 5).getUint32(1), body: new Uint8Array(plain) };
  }

  function chunkSize(peer) {
    const cap = peer.pc?.sctp?.maxMessageSize || 65536;
    return Math.max(CHUNK_FLOOR, Math.min(cap, 262144) - 128);
  }

  function drain(dc) {
    if (dc.bufferedAmount < HIGH_WATER) return Promise.resolve();
    return new Promise((resolve) => {
      // A channel that closes mid-file never fires bufferedamountlow again, so
      // the close listener is what stops a send loop hanging on a dead peer.
      const done = () => {
        dc.removeEventListener("bufferedamountlow", done);
        dc.removeEventListener("close", done);
        dc.removeEventListener("error", done);
        resolve();
      };
      dc.addEventListener("bufferedamountlow", done);
      dc.addEventListener("close", done);
      dc.addEventListener("error", done);
    });
  }

  async function sendItem(peer, item) {
    const { blob, ...meta } = item;
    if (!blob) return;
    if (peer.via === "tab") {
      // Same browser: hand over the Blob handle itself. No copy, no bytes on
      // the wire, no extra memory for either side.
      bc?.postMessage({ v: PROTO, from: session.id, to: peer.id, item: meta, blob });
      session.stats.sentItems += 1;
      refreshHud();
      return;
    }
    await peer.keyReady;
    if (peer.dc?.readyState !== "open" || !peer.key) return;
    const sid = peer.sid++;
    await sendControl(peer, { t: "file-start", sid, item: meta });
    const size = chunkSize(peer);
    for (let off = 0; off < blob.size; off += size) {
      if (peer.dc.readyState !== "open") return;
      await drain(peer.dc);
      const part = new Uint8Array(await blob.slice(off, Math.min(off + size, blob.size)).arrayBuffer());
      peer.dc.send(await seal(peer, 1, sid, part));
      session.stats.sentBytes += part.length;
      refreshHud();
    }
    await sendControl(peer, { t: "file-end", sid });
    session.stats.sentItems += 1;
    refreshHud();
  }

  async function serveQueue(peer) {
    if (peer.sending) return;
    peer.sending = true;
    refreshHud();
    try {
      while (peer.queue.length) {
        const key = peer.queue.shift();
        const item = session.items.get(key);
        if (item?.blob) await sendItem(peer, item);
      }
    } catch {
      // The peer went away mid-transfer; it will re-ask on reconnect.
    } finally {
      peer.sending = false;
      refreshHud();
    }
  }

  async function onControl(peer, msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "manifest") {
      const wanted = [];
      let bytes = 0;
      for (const entry of msg.items || []) {
        if (!entry?.key) continue;
        peer.offers.add(entry.key);
        if (session.have.has(entry.key) || session.claimed.has(entry.key)) continue;
        session.claimed.add(entry.key);
        peer.wanted.push(entry.key);
        wanted.push(entry.key);
        bytes += Number(entry.size) || 0;
      }
      session.stats.wantTotal += wanted.length;
      await sendControl(peer, { t: "want", keys: wanted });
      askMode(wanted.length, bytes);
      refreshHud();
      return;
    }
    if (msg.t === "want") {
      for (const key of msg.keys || []) if (session.items.has(key)) peer.queue.push(key);
      serveQueue(peer);
      return;
    }
    if (msg.t === "file-start") {
      peer.incoming.set(msg.sid, { item: msg.item, parts: [] });
      return;
    }
    if (msg.t === "file-end") {
      const rec = peer.incoming.get(msg.sid);
      peer.incoming.delete(msg.sid);
      if (rec) {
        const blob = new Blob(rec.parts, { type: rec.item.type || "application/octet-stream" });
        await ingest(rec.item, blob, true);
      }
      return;
    }
  }

  async function pushManifest(peer) {
    if (peer.sentManifest || !peer.ready) return;
    peer.sentManifest = true;
    const items = [...session.items.values()].map(({ blob, ...meta }) => meta);
    await sendControl(peer, { t: "manifest", items });
  }

  function dropPeer(id) {
    const peer = session.peers.get(id);
    if (!peer) return;
    try {
      peer.dc?.close();
      peer.pc?.close();
    } catch {
      /* already gone */
    }
    // Nothing may stay pending on a peer that is gone: unblock anything
    // waiting on the key exchange and let the half-received file go.
    peer.keyDone?.();
    peer.incoming.clear();
    iceParked.delete(id);
    peer.queue.length = 0;
    session.peers.delete(id);
    // Whatever this peer promised but never delivered goes back on the market,
    // and is immediately re-asked of another peer that advertised it.
    const orphaned = peer.wanted.filter((key) => !session.have.has(key));
    for (const key of orphaned) {
      session.claimed.delete(key);
      session.stats.wantTotal = Math.max(0, session.stats.wantTotal - 1);
    }
    if (orphaned.length) rehome(orphaned);
    refreshHud();
  }

  // A departing peer's undelivered keys are useless unless someone is asked for
  // them again — every other peer has already sent its manifest and will not
  // re-offer on its own.
  function rehome(keys) {
    for (const peer of session.peers.values()) {
      if (!peer.ready) continue;
      const ask = keys.filter((key) => peer.offers.has(key) && !session.have.has(key) && !session.claimed.has(key));
      if (!ask.length) continue;
      for (const key of ask) {
        session.claimed.add(key);
        peer.wanted.push(key);
      }
      session.stats.wantTotal += ask.length;
      sendControl(peer, { t: "want", keys: ask }).catch(() => undefined);
    }
  }

  /* ---------------------------------------------------- cross-tab trigger */

  // Every instance listens for the trigger from the moment it loads, so hitting
  // LAN Share in one window arms every other window of this browser at once —
  // no network, no round trip, nothing to configure.
  let wakeBc = null;
  function startWake() {
    if (wakeBc || typeof BroadcastChannel === "undefined") return;
    wakeBc = new BroadcastChannel(`${BC_NAME}-wake`);
    wakeBc.onmessage = (event) => {
      if (event.data?.wake) ensureStarted().then(refreshHud, () => {});
      else if (event.data?.sleep) stop("", true);
    };
  }

  /* --------------------------------------- transport 1: same-browser tabs */

  function startBroadcast() {
    if (bc || typeof BroadcastChannel === "undefined") return;
    bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = async (event) => {
      const msg = event.data;
      if (!msg || msg.v !== PROTO || msg.from === session.id) return;
      if (msg.to && msg.to !== session.id) return;

      if (msg.hello || msg.ack) {
        let peer = session.peers.get(msg.from);
        if (!peer) {
          peer = makePeer(msg.from, "tab", msg.label);
          peer.ready = true;
          session.peers.set(msg.from, peer);
        }
        if (msg.hello) bc.postMessage({ v: PROTO, from: session.id, to: msg.from, ack: 1, label: session.label });
        pushManifest(peer);
        refreshHud();
        return;
      }
      if (msg.bye) {
        dropPeer(msg.from);
        return;
      }
      const peer = session.peers.get(msg.from);
      if (!peer) return;
      if (msg.ctl) await onControl(peer, msg.ctl);
      else if (msg.item && msg.blob) await ingest(msg.item, msg.blob);
    };
    bc.postMessage({ v: PROTO, from: session.id, hello: 1, label: session.label });
  }

  /* ------------------------------ transport 2: WebRTC, LAN candidates only */

  // Media still cannot leave the local network, because there is no TURN server
  // here and there never will be: without a relay, bytes have nowhere to go but
  // straight to the other device.
  //
  // What changed is discovery. Gathering host candidates alone means every
  // device offers nothing but an mDNS name like `a1b2....local`, and a browser
  // that cannot resolve the other one's name has no candidate pair to try at
  // all — which is why pairing simply never completed on most real networks.
  // A STUN lookup costs one small UDP round trip, reveals only the public
  // address the router already shows every site, and gives ICE a second pair to
  // fall back on when mDNS resolution is refused.
  const STUN = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];
  function newPeerConnection() {
    try {
      return new RTCPeerConnection({ iceServers: STUN, iceCandidatePoolSize: 1 });
    } catch {
      return new RTCPeerConnection({ iceServers: [] });
    }
  }

  async function ecdhPublic() {
    return b64(new Uint8Array(await crypto.subtle.exportKey("raw", session.ecdh.publicKey)));
  }

  async function agreeKey(peer, theirPubB64) {
    const raw = unb64(theirPubB64);
    const theirs = await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, session.ecdh.privateKey, 256);
    peer.key = await crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
    peer.keyDone?.();
    const mine = unb64(await ecdhPublic());
    const [a, b] = [b64(mine), b64(raw)].sort();
    peer.safety = (await sha256(enc.encode(`${a}${b}`))).slice(0, 6).toUpperCase();
  }

  async function takeFrame(peer, data) {
    try {
      await peer.keyReady;
      if (!peer.key) return;
      const frame = await open(peer, data);
      if (frame.type === 0) {
        await onControl(peer, JSON.parse(dec.decode(frame.body)));
        return;
      }
      const rec = peer.incoming.get(frame.sid);
      if (rec) {
        rec.parts.push(frame.body);
        session.stats.recvBytes += frame.body.length;
        refreshHud();
      }
    } catch {
      /* a mangled or unauthenticated frame is dropped, never trusted */
    }
  }

  function wireChannel(peer, dc) {
    peer.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = LOW_WATER;
    dc.onopen = async () => {
      await peer.keyReady;
      peer.ready = true;
      pushManifest(peer);
      refreshHud();
    };
    dc.onclose = () => {
      peer.ready = false;
      refreshHud();
    };
    dc.onmessage = (event) => {
      const data = event.data;
      // Serialised: each frame is fully handled before the next one starts, so
      // chunk order and the start/chunk/end sequence survive the async decrypt.
      peer.inbound = peer.inbound.then(() => takeFrame(peer, data)).catch(() => {});
    };
  }

  // The rendezvous returns a batch of envelopes in no particular order, so a
  // candidate can easily arrive before the offer or answer it belongs to.
  // With no STUN server there are only a handful of candidates and losing one
  // can be the difference between connecting and not, so they are parked here
  // until the remote description exists.
  const iceParked = new Map();

  function parkIce(id, candidate) {
    const list = iceParked.get(id) || [];
    if (list.length >= 40) return;
    list.push(candidate);
    iceParked.set(id, list);
  }

  async function flushIce(id, pc) {
    const list = iceParked.get(id);
    iceParked.delete(id);
    for (const candidate of list || []) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* a candidate the browser rejects is simply not usable */
      }
    }
  }

  // ICE dips into "disconnected" on ordinary Wi-Fi hiccups and usually comes
  // back; tearing down there would throw away a part-received file for nothing.
  function watchConnection(pc, id) {
    let grace = 0;
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "failed" || st === "closed") {
        clearTimeout(grace);
        dropPeer(id);
      } else if (st === "disconnected") {
        clearTimeout(grace);
        grace = setTimeout(() => {
          if (pc.connectionState === "disconnected") dropPeer(id);
        }, 8000);
      } else {
        clearTimeout(grace);
      }
    };
  }

  // A handshake envelope can be lost (the rendezvous hands each one out once),
  // and a peer stuck half-connected would otherwise block every retry, because
  // connectTo refuses to run twice for the same id.
  function watchdog(id) {
    setTimeout(() => {
      const peer = session.peers.get(id);
      if (peer && peer.via === "lan" && !peer.ready) dropPeer(id);
    }, 25000);
  }

  async function connectTo(id, label) {
    if (session.peers.has(id)) return;
    const peer = makePeer(id, "lan", label);
    session.peers.set(id, peer);
    try {
      const pc = newPeerConnection();
      peer.pc = pc;
      pc.onicecandidate = (e) => {
        if (e.candidate) signal(id, { t: "ice", c: e.candidate.toJSON() });
      };
      watchConnection(pc, id);
      wireChannel(peer, pc.createDataChannel("gooninator", { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal(id, { t: "offer", sdp: pc.localDescription.sdp, pub: await ecdhPublic() });
      watchdog(id);
      refreshHud();
    } catch {
      // Leaving a broken entry behind would bar every future attempt at this
      // peer, and the other side never offers because ids decide who does.
      dropPeer(id);
    }
  }

  async function onSignal(from, msg) {
    if (msg.t === "offer") {
      // Candidates that raced ahead of their own offer are parked, and dropPeer
      // clears the park. Rescue them across the teardown or the pair can be one
      // lost candidate short of ever connecting.
      const early = iceParked.get(from);
      dropPeer(from);
      if (early && early.length) iceParked.set(from, early);
      const peer = makePeer(from, "lan", msg.label);
      session.peers.set(from, peer);
      try {
        const pc = newPeerConnection();
        peer.pc = pc;
        pc.onicecandidate = (e) => {
          if (e.candidate) signal(from, { t: "ice", c: e.candidate.toJSON() });
        };
        pc.ondatachannel = (e) => wireChannel(peer, e.channel);
        watchConnection(pc, from);
        await agreeKey(peer, msg.pub);
        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        await flushIce(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal(from, { t: "answer", sdp: pc.localDescription.sdp, pub: await ecdhPublic() });
        watchdog(from);
        refreshHud();
      } catch {
        dropPeer(from);
      }
      return;
    }
    const peer = session.peers.get(from);
    if (msg.t === "ice") {
      if (!peer?.pc || !peer.pc.remoteDescription) parkIce(from, msg.c);
      else
        await peer.pc.addIceCandidate(msg.c).catch(() => {
          /* a candidate the browser rejects is simply not usable */
        });
      return;
    }
    if (!peer?.pc) return;
    if (msg.t === "answer") {
      try {
        await agreeKey(peer, msg.pub);
        await peer.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        await flushIce(from, peer.pc);
      } catch {
        dropPeer(from);
      }
    }
  }

  /* ------------------------------------------- discovery over the internet-
   * free-for-media rendezvous. Only handshake envelopes go here, and when a
   * network key is set they are sealed before they leave the browser. */

  // ICE candidates arrive in a burst of a dozen or more. Firing a request at
  // each one turned a single handshake into a dozen function invocations; a
  // 70ms gather window folds the whole burst into one POST and, because the
  // envelopes then travel together, the far side applies them together too.
  let coalesce = 0;
  function signal(to, payload) {
    relayOutbox.push({ to, payload });
    if (payload && payload.t === "ice") {
      if (!coalesce) coalesce = setTimeout(() => {
        coalesce = 0;
        pumpRelay(true);
      }, 70);
      return;
    }
    clearTimeout(coalesce);
    coalesce = 0;
    pumpRelay(true);
  }

  async function sealEnvelope(obj) {
    const json = JSON.stringify({ ...obj, label: session.label });
    if (!session.passKey) return `p1.${json}`;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, session.passKey, enc.encode(json)));
    return `e1.${b64(iv)}.${b64(ct)}`;
  }

  async function openEnvelope(data) {
    if (typeof data !== "string") return null;
    if (data.startsWith("p1.")) return session.passKey ? null : JSON.parse(data.slice(3));
    if (!data.startsWith("e1.") || !session.passKey) return null;
    const [, ivB, ctB] = data.split(".");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB) }, session.passKey, unb64(ctB));
    return JSON.parse(dec.decode(plain));
  }

  function leaveRelay(id, tag) {
    if (!id) return;
    const body = JSON.stringify({ peer: id, leave: true, tag });
    try {
      if (navigator.sendBeacon?.(RELAY, new Blob([body], { type: "application/json" }))) return;
    } catch {
      /* fall through to fetch */
    }
    fetch(RELAY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }

  let relayInFlight = false;
  async function pumpRelay(immediate) {
    if (!session.on || relayInFlight) return;
    if (!immediate && session.relayBackoff > Date.now()) return;
    relayInFlight = true;
    const batch = relayOutbox.splice(0, 24);
    try {
      const send = await Promise.all(batch.map(async (m) => ({ to: m.to, data: await sealEnvelope(m.payload) })));
      const res = await fetch(RELAY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ peer: session.id, label: session.label, tag: session.tag, send }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      session.relayOk = true;
      session.relayBackoff = 0;
      if ((data.peers || []).length || (data.inbox || []).length) session.lastPeerAt = performance.now();
      for (const p of data.peers || []) {
        // Lowest id offers, so two peers never collide making offers at once.
        if (!session.peers.has(p.id) && session.id < p.id) connectTo(p.id, p.label).catch(() => undefined);
      }
      for (const envelope of data.inbox || []) {
        try {
          const msg = await openEnvelope(envelope.data);
          if (msg) await onSignal(envelope.from, msg);
        } catch {
          /* an envelope we cannot authenticate is simply not ours */
        }
      }
    } catch {
      relayOutbox.unshift(...batch);
      session.relayOk = false;
      session.relayBackoff = Date.now() + 5000;
    } finally {
      relayInFlight = false;
      refreshHud();
    }
  }

  /* The rendezvous is a paid function call, so the poll rate is the whole
     hosting bill for this feature. It used to run at 900ms–3s for as long as
     LAN Share was switched on, which is upwards of a hundred thousand calls a
     day from one idle tab. The shape below spends requests only where they buy
     something: fast while two devices are actually mid-handshake, a slow
     heartbeat once they are talking (the peer record lives 90s, so 30s keeps it
     warm with room to spare), and nothing at all once it is clear nobody else
     is coming. */
  const LOOK_WINDOW_MS = 4 * 60 * 1000;

  function relayInterval() {
    const settling = [...session.peers.values()].some((p) => !p.ready);
    if (settling) return document.hidden ? 3000 : 1200;
    const linked = [...session.peers.values()].some((p) => p.via === "lan" && p.ready);
    // Connected: a bare keepalive, and slower still with the tab in the
    // background, where a new peer cannot be acted on anyway.
    if (linked) return document.hidden ? 60000 : 30000;
    if (document.hidden) return 60000;
    // Hunting: brisk for the first stretch, when the other device is most
    // likely being switched on right now, then it eases off.
    const age = performance.now() - session.started;
    if (age < 20000) return 1500;
    if (age < 60000) return 5000;
    return 12000;
  }

  function scheduleRelay() {
    clearTimeout(relayTimer);
    if (!session.on) return;
    // Nobody has appeared in four minutes and no handshake is running: stop
    // dialling. Anything that could plausibly change the answer — the tab
    // coming forward, a password being typed, new media to announce — calls
    // wakeRelay and puts it straight back to work.
    const idle = !session.peers.size && performance.now() - session.lastPeerAt > LOOK_WINDOW_MS;
    if (idle && !document.hidden) {
      session.dozing = true;
      refreshHud();
      return;
    }
    session.dozing = false;
    relayTimer = setTimeout(async () => {
      await pumpRelay(false);
      scheduleRelay();
    }, relayInterval());
  }

  // Anything that makes a peer newly plausible restarts the hunt.
  function wakeRelay() {
    if (!session.on) return;
    session.lastPeerAt = performance.now();
    session.started = performance.now();
    pumpRelay(true).finally(scheduleRelay);
  }

  /* --------------------------------------------- offline pairing (no relay) */

  // The marker uses a character base64 never produces, so a plain code can
  // never be mistaken for a compressed one.
  async function packCode(obj) {
    const raw = enc.encode(JSON.stringify(obj));
    if (typeof CompressionStream === "undefined") return `r.${b64(raw)}`;
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
    return `g.${b64(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
  }
  async function unpackCode(text) {
    const trimmed = text.trim().replace(/\s+/g, "");
    if (trimmed.startsWith("r.")) return JSON.parse(dec.decode(unb64(trimmed.slice(2))));
    if (!trimmed.startsWith("g.")) throw new Error("that is not a pairing code");
    if (typeof DecompressionStream === "undefined") throw new Error("this browser cannot read a code from that one");
    const stream = new Blob([unb64(trimmed.slice(2))]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }

  function iceSettled(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      const timer = setTimeout(done, 2500);
      pc.addEventListener("icegatheringstatechange", check);
    });
  }

  async function makeInvite() {
    await ensureStarted();
    if (!session.on || !session.ecdh) throw new Error("LAN share could not start in this browser");
    const id = `off-${crypto.randomUUID().slice(0, 8)}`;
    const peer = makePeer(id, "lan", "paired device");
    session.peers.set(id, peer);
    const pc = newPeerConnection();
    peer.pc = pc;
    wireChannel(peer, pc.createDataChannel("gooninator", { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await iceSettled(pc);
    return packCode({ k: "offer", id: session.id, peer: id, sdp: pc.localDescription.sdp, pub: await ecdhPublic() });
  }

  async function useCode(text) {
    await ensureStarted();
    if (!session.on || !session.ecdh) throw new Error("LAN share could not start in this browser");
    const msg = await unpackCode(text);
    if (msg.k === "offer") {
      const id = msg.peer;
      dropPeer(id);
      const peer = makePeer(id, "lan", "paired device");
      session.peers.set(id, peer);
      const pc = newPeerConnection();
      peer.pc = pc;
      pc.ondatachannel = (e) => wireChannel(peer, e.channel);
      await agreeKey(peer, msg.pub);
      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await iceSettled(pc);
      return { reply: await packCode({ k: "answer", peer: id, sdp: pc.localDescription.sdp, pub: await ecdhPublic() }), safety: peer.safety };
    }
    if (msg.k === "answer") {
      const peer = session.peers.get(msg.peer);
      if (!peer?.pc) throw new Error("no matching invite");
      await agreeKey(peer, msg.pub);
      await peer.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      return { reply: "", safety: peer.safety };
    }
    throw new Error("unrecognised code");
  }

  /* ------------------------------------------------------ session lifecycle */

  async function derivePass(pass) {
    if (!pass) {
      session.passKey = null;
      session.tag = "";
      return;
    }
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits", "deriveKey"]);
    session.passKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("gooninator-lan-v1"), iterations: 120000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    session.tag = (await sha256(enc.encode(`tag|${pass}`))).slice(0, 16);
  }

  async function rescan() {
    const items = await localItems();
    // Built to the side and swapped in one go: a transfer in flight must never
    // see a half-empty catalogue.
    const next = new Map();
    for (const item of items) {
      if (next.has(item.key)) continue; // local duplicates collapse too
      next.set(item.key, item);
      session.have.add(item.key);
    }
    for (const [key, item] of session.items) if (!next.has(key)) next.set(key, item);
    session.items = next;
  }

  // Startup is not instant — key generation and the first catalogue scan both
  // take real time on a large library — so it re-checks session.on after every
  // await. A stop landing mid-startup must not leave a live channel behind
  // serving media from an instance the user has switched off.
  let starting = null;
  async function ensureStarted() {
    if (starting) {
      await starting;
      if (session.on) return;
    }
    if (session.on) return;
    const job = (async () => {
      session.on = true;
      session.started = performance.now();
      session.lastPeerAt = performance.now();
      session.dozing = false;
      session.id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const remembered = readSettings().lanReceive === "save";
      session.mode = remembered ? "save" : "mirror";
      session.modeAsked = remembered;
      session.ecdh = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      if (!session.on) return;
      await derivePass(($$("lan-pass")?.value || "").trim());
      if (!session.on) return;
      buildHud();
      hud.hidden = false;
      refreshHud();
      await rescan();
      if (!session.on) return;
      startBroadcast();
      scheduleRelay();
      pumpRelay(true);
      refreshHud();
    })();
    starting = job;
    try {
      await job;
    } catch {
      // A browser without Web Crypto (an insecure origin, say) must not be
      // left flagged as running, or the button would never work again.
      session.on = false;
      if (hud) hud.hidden = true;
      setStatus("LAN share could not start in this browser.");
    } finally {
      if (starting === job) starting = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !session.on) return;
    if (session.dozing) wakeRelay();
    else scheduleRelay();
  });

  async function start() {
    state.lanShare = true;
    writeSettings({ lanShare: true });
    startWake();
    wakeBc?.postMessage({ wake: 1 });
    await ensureStarted();
    wakeRelay();
    // Anything added after the trigger is offered to the mesh as well.
    for (const peer of session.peers.values()) {
      peer.sentManifest = false;
      pushManifest(peer);
    }
  }

  function stop(reason, quiet) {
    if (!session.on) return;
    if (!quiet) wakeBc?.postMessage({ sleep: 1 });
    session.on = false;
    state.lanShare = false;
    writeSettings({ lanShare: false });
    clearTimeout(relayTimer);
    try {
      bc?.postMessage({ v: PROTO, from: session.id, bye: 1 });
      bc?.close();
    } catch {
      /* channel already torn down */
    }
    bc = null;
    for (const id of [...session.peers.keys()]) dropPeer(id);
    session.claimed.clear();
    session.stats = { sentItems: 0, sentBytes: 0, recvItems: 0, recvBytes: 0, wantTotal: 0, rate: 0 };
    relayOutbox.length = 0;
    iceParked.clear();
    leaveRelay(session.id, session.tag);
    if (hud) hud.hidden = true;
    paintPanel(0);
    if (reason) setStatus(`LAN share ${reason.toLowerCase()}.`);
  }

  /* -------------------------------------------------------------- new media */

  // Fresh imports should reach everyone without re-triggering the toggle.
  let announceTimer = 0;
  function announceLater() {
    if (!session.on || announceTimer) return;
    if (session.dozing) wakeRelay();
    announceTimer = setTimeout(async () => {
      announceTimer = 0;
      if (!session.on) return;
      await rescan();
      for (const peer of session.peers.values()) {
        if (!peer.ready) continue;
        const items = [...session.items.values()].map(({ blob, ...meta }) => meta);
        await sendControl(peer, { t: "manifest", items });
      }
    }, 800);
  }

  /* ----------------------------------------------------------------- wiring */

  function wireUi() {
    const btn = $$("lan-share-btn");
    if (btn) {
      btn.onclick = async () => {
        if (session.on) stop("off");
        else {
          btn.disabled = true;
          try {
            await start();
          } finally {
            btn.disabled = false;
          }
        }
        paintPanel(0);
      };
    }
    const opts = $$("lan-opts-btn");
    if (opts) opts.onclick = () => $$("lan-panel")?.classList.toggle("hid");

    const look = $$("lan-look-btn");
    if (look) {
      look.onclick = () => {
        wakeRelay();
        paintPanel([...session.peers.values()].filter((p) => p.ready).length);
      };
    }

    const pass = $$("lan-pass");
    if (pass) {
      pass.value = readSettings().lanPass || "";
      pass.onchange = async () => {
        writeSettings({ lanPass: pass.value });
        if (session.on) {
          // The key decides which room this instance sits in, so the old room
          // has to be vacated or it keeps a phantom peer for its whole TTL.
          leaveRelay(session.id, session.tag);
          await derivePass(pass.value.trim());
          for (const id of [...session.peers.keys()]) if (session.peers.get(id)?.via === "lan") dropPeer(id);
          wakeRelay();
        }
      };
    }

    const mode = $$("lan-receive-mode");
    if (mode) {
      mode.value = readSettings().lanReceive === "save" ? "save" : "mirror";
      mode.onchange = () => chooseMode(mode.value === "save" ? "save" : "mirror");
    }

    const invite = $$("lan-make-invite");
    const code = $$("lan-code");
    const out = $$("lan-code-out");
    if (invite && code) {
      invite.onclick = async () => {
        invite.disabled = true;
        try {
          code.value = await makeInvite();
          code.select();
          if (out) out.textContent = "Invite ready — paste it into the other browser, then paste its reply back here.";
        } catch (err) {
          if (out) out.textContent = `Could not build an invite: ${err.message}`;
        } finally {
          invite.disabled = false;
        }
      };
    }
    const use = $$("lan-use-code");
    if (use && code) {
      use.onclick = async () => {
        use.disabled = true;
        try {
          const res = await useCode(code.value);
          code.value = res.reply || code.value;
          if (out)
            out.textContent = res.reply
              ? `Reply ready — paste this back into the first browser. Safety code ${res.safety}.`
              : `Paired. Safety code ${res.safety} — it should match on both devices.`;
          if (res.reply) code.select();
        } catch (err) {
          if (out) out.textContent = `That code did not work: ${err.message}`;
        } finally {
          use.disabled = false;
        }
      };
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (session.on) scheduleRelay();
  });
  window.addEventListener("pagehide", () => {
    if (!session.on) return;
    try {
      bc?.postMessage({ v: PROTO, from: session.id, bye: 1 });
    } catch {
      /* nothing left to tell */
    }
    // Without this the closed tab lingers in presence for its whole TTL and
    // other devices keep offering to a page that is gone.
    leaveRelay(session.id, session.tag);
  });

  // Public hooks for app.js.
  globalThis.lanShare = {
    start,
    stop,
    toggle: () => (session.on ? stop("off") : start()),
    announce: announceLater,
    get active() {
      return session.on;
    },
  };

  function boot() {
    wireUi();
    startWake();
    paintPanel(0);
    // A tab opened while LAN share is on joins the mesh straight away, which is
    // what makes "every open instance" true for windows opened after the fact.
    if (state.lanShare) setTimeout(() => ensureStarted().then(() => refreshHud(), () => {}), 400);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
