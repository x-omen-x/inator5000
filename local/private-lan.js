/* OMENS PLAPINATOR — private LAN-only image transport.
 *
 * Privacy invariants:
 *   - no cloud rendezvous, STUN, TURN, analytics, or remote fallback
 *   - helper address must resolve from a private/local hostname or RFC1918/ULA address
 *   - filenames, metadata, and media bytes are AES-GCM encrypted in the browser
 *   - the local helper only relays ciphertext in memory and never persists it
 *   - received images are session-only object URLs and are never written to IndexedDB here
 */
(() => {
  "use strict";
  if (window.privateLan) return;

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const CHUNK = 96 * 1024;
  const PBKDF2_ITERS = 250000;
  const session = {
    ws: null,
    key: null,
    code: "",
    id: "",
    role: "",
    active: false,
    incoming: new Map(),
    received: new Set(),
    sentTo: new Set(),
    images: [],
    status: () => {},
    helloTimer: 0,
  };

  function b64(u8) {
    let out = "";
    for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(out);
  }

  function unb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function hex(buf) {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256(text) {
    return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  }

  function localHostOnly(host) {
    const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "localhost" || h.endsWith(".local")) return true;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
    const m = h.match(/^172\.(\d{1,3})\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
    if (h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
    return false;
  }

  function normalizeHelper(value) {
    let raw = String(value || "").trim();
    if (!raw) throw new Error("Enter the Mac LAN address shown by the private helper.");
    if (!/^wss?:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const u = new URL(raw);
    if (!localHostOnly(u.hostname)) throw new Error("Private mode only accepts a local/private LAN address.");
    const port = u.port || "8787";
    return `wss://${u.hostname.includes(":") ? `[${u.hostname}]` : u.hostname}:${port}/plap`;
  }

  async function derive(code) {
    if (!crypto?.subtle) throw new Error("This browser does not provide the encryption needed for Private LAN mode.");
    const material = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: enc.encode("omens-plapinator-private-lan-v1"),
        iterations: PBKDF2_ITERS,
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  function packPlain(meta, bytes) {
    const head = enc.encode(JSON.stringify(meta));
    const body = bytes ? new Uint8Array(bytes) : new Uint8Array(0);
    const out = new Uint8Array(4 + head.length + body.length);
    new DataView(out.buffer).setUint32(0, head.length);
    out.set(head, 4);
    out.set(body, 4 + head.length);
    return out;
  }

  function unpackPlain(u8) {
    if (u8.byteLength < 4) throw new Error("bad private LAN frame");
    const n = new DataView(u8.buffer, u8.byteOffset, 4).getUint32(0);
    if (n > u8.byteLength - 4) throw new Error("bad private LAN header");
    const meta = JSON.parse(dec.decode(u8.subarray(4, 4 + n)));
    return { meta, bytes: u8.subarray(4 + n) };
  }

  async function seal(meta, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = packPlain(meta, bytes);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, session.key, plain));
    const out = new Uint8Array(13 + ct.length);
    out[0] = 1;
    out.set(iv, 1);
    out.set(ct, 13);
    return out.buffer;
  }

  async function openFrame(data) {
    const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(await data.arrayBuffer());
    if (u8[0] !== 1 || u8.length < 30) throw new Error("bad private LAN frame");
    const iv = u8.subarray(1, 13);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, session.key, u8.subarray(13)));
    return unpackPlain(plain);
  }

  async function send(meta, bytes) {
    if (session.ws?.readyState !== WebSocket.OPEN) return false;
    session.ws.send(await seal(meta, bytes));
    return true;
  }

  function refreshSlideshow() {
    try {
      if (typeof resetShuffleBag === "function") resetShuffleBag();
    } catch {}
    try {
      if (typeof renderSetup === "function") renderSetup();
      else if (typeof renderReel === "function") renderReel();
    } catch {}
    try {
      if (typeof updateButtons === "function") updateButtons();
    } catch {}
  }

  async function ingest(meta, parts) {
    if (session.received.has(meta.id)) return;
    session.received.add(meta.id);
    const blob = new Blob(parts, { type: meta.type || "image/jpeg" });
    const slide = {
      id: crypto.randomUUID(),
      url: URL.createObjectURL(blob),
      album: meta.album || "Private LAN",
      alt: meta.name || "photo",
      kind: "image",
      file: blob,
    };
    if (typeof state !== "undefined" && Array.isArray(state.slides)) state.slides.push(slide);
    refreshSlideshow();
  }

  async function transferTo(target) {
    if (session.role !== "sender" || session.sentTo.has(target)) return;
    session.sentTo.add(target);
    let sent = 0;
    session.status(`Private LAN connected · sending ${session.images.length} image${session.images.length === 1 ? "" : "s"}`);
    for (const image of session.images) {
      if (!session.active || session.ws?.readyState !== WebSocket.OPEN) return;
      const file = image.file;
      if (!file) continue;
      const fid = `${session.id}:${image.id || crypto.randomUUID()}`;
      await send({
        t: "file-start",
        target,
        id: fid,
        name: image.alt || file.name || "photo",
        type: file.type || "image/jpeg",
        album: image.album || "Photos",
        size: file.size,
      });
      for (let off = 0, n = 0; off < file.size; off += CHUNK, n += 1) {
        const buf = await file.slice(off, Math.min(file.size, off + CHUNK)).arrayBuffer();
        await send({ t: "file-chunk", target, id: fid, n }, buf);
        if ((n & 7) === 7) await new Promise((r) => setTimeout(r, 0));
      }
      await send({ t: "file-end", target, id: fid });
      sent += 1;
      session.status(`Private LAN · ${sent}/${session.images.length} image${session.images.length === 1 ? "" : "s"} sent`);
    }
    session.status(`Private LAN · ${sent} image${sent === 1 ? "" : "s"} sent · encrypted · local only`);
  }

  async function handle(meta, bytes) {
    if (!meta || meta.from === session.id) return;
    if (meta.target && meta.target !== session.id) return;
    if (meta.t === "hello") {
      if (meta.role === "receiver" && session.role === "sender") transferTo(meta.from).catch(() => session.status("Private LAN transfer stopped."));
      if (meta.role === "sender" && session.role === "receiver") send({ t: "hello", role: "receiver", from: session.id, target: meta.from });
      return;
    }
    if (session.role !== "receiver") return;
    if (meta.t === "file-start") {
      session.incoming.set(meta.id, { meta, parts: [] });
      session.status(`Private LAN connected · receiving ${meta.name || "image"}`);
      return;
    }
    if (meta.t === "file-chunk") {
      const rec = session.incoming.get(meta.id);
      if (rec) rec.parts.push(bytes.slice());
      return;
    }
    if (meta.t === "file-end") {
      const rec = session.incoming.get(meta.id);
      session.incoming.delete(meta.id);
      if (rec) await ingest(rec.meta, rec.parts);
      session.status(`Private LAN · ${session.received.size} image${session.received.size === 1 ? "" : "s"} received · session only`);
    }
  }

  function stop() {
    session.active = false;
    clearInterval(session.helloTimer);
    session.helloTimer = 0;
    try { session.ws?.close(); } catch {}
    session.ws = null;
    session.incoming.clear();
    session.sentTo.clear();
    session.images = [];
  }

  async function start({ helper, code, role, images = [], onStatus = () => {} }) {
    stop();
    const cleanCode = String(code || "").trim().toUpperCase();
    if (!/^[A-Z2-9]{10}$/.test(cleanCode)) throw new Error("Pairing code must be 10 characters.");
    const url = normalizeHelper(helper);
    session.status = onStatus;
    session.code = cleanCode;
    session.role = role;
    session.images = images;
    session.id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    session.key = await derive(cleanCode);
    const room = (await sha256(`room|${cleanCode}`)).slice(0, 24);

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      session.ws = ws;
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch {}
          reject(new Error("Could not reach the private LAN helper."));
        }
      }, 7000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ t: "join", room }));
      };
      ws.onmessage = async (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            if (msg.t === "joined") {
              session.active = true;
              clearTimeout(timer);
              if (!settled) {
                settled = true;
                resolve();
              }
              session.status(role === "receiver" ? "Private LAN receiver on · waiting for sender" : "Private LAN sender on · looking for receiver");
              send({ t: "hello", role, from: session.id }).catch(() => {});
              clearInterval(session.helloTimer);
              session.helloTimer = setInterval(() => send({ t: "hello", role, from: session.id }).catch(() => {}), 2000);
            }
          } catch {}
          return;
        }
        try {
          const frame = await openFrame(event.data);
          await handle(frame.meta, frame.bytes);
        } catch {
          // Wrong pairing code, malformed ciphertext, or foreign room traffic is ignored.
        }
      };
      ws.onerror = () => {
        if (!settled) {
          clearTimeout(timer);
          settled = true;
          reject(new Error("Private helper connection failed. Open its HTTPS trust page on this device first."));
        }
      };
      ws.onclose = () => {
        session.active = false;
        clearInterval(session.helloTimer);
        session.helloTimer = 0;
        if (settled) session.status("Private LAN disconnected · no cloud fallback");
      };
    });
  }

  window.privateLan = {
    startReceiver: (opts) => start({ ...opts, role: "receiver" }),
    startSender: (opts) => start({ ...opts, role: "sender" }),
    stop,
    get active() { return session.active; },
  };
})();
