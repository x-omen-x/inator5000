/* Chrome Presentation / Cast bridge for omens plapinator.
   Local photos, videos and audio stay device-local until the user explicitly
   chooses a presentation display. Media is sent over the browser-managed
   PresentationConnection; this file does not upload media to a server. */
(function plapinatorCastBridge() {
  const NAME = "plapinator-cast";
  window.__hotTeardown?.(NAME);

  const disposers = [];
  const timers = new Set();
  let connection = null;
  let pollTimer = 0;
  let sendQueue = Promise.resolve();
  let lastSlideId = null;
  let lastOverlayKey = null;
  let lastTrackId = null;
  let lastSoundcloud = null;
  let lastStateKey = "";
  let destroyed = false;

  const src = document.currentScript?.src || new URL("local/cast.js", location.href).href;
  const receiverUrl = new URL("../cast-receiver.html?v=1", src).href;
  const request = "PresentationRequest" in window ? new PresentationRequest(receiverUrl) : null;

  function on(target, type, fn, opts) {
    target?.addEventListener?.(type, fn, opts);
    if (target?.removeEventListener) disposers.push(() => target.removeEventListener(type, fn, opts));
  }

  function later(fn, ms) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function status(text) {
    try {
      if (typeof setStatus === "function") setStatus(text);
      else console.info(text);
    } catch {
      console.info(text);
    }
  }

  function castButtons() {
    return [document.getElementById("cast-btn"), document.getElementById("hud-cast")].filter(Boolean);
  }

  function syncButtons() {
    const active = connection && connection.state === "connected";
    castButtons().forEach((button) => {
      button.textContent = active ? "Stop Cast" : "Cast";
      button.setAttribute("aria-pressed", String(Boolean(active)));
      button.title = active ? "Stop casting" : request ? "Cast slideshow" : "Casting is unavailable in this browser";
      button.disabled = !request;
    });
  }

  function installButtons() {
    let setupButton = document.getElementById("cast-btn");
    if (!setupButton) {
      setupButton = document.createElement("button");
      setupButton.type = "button";
      setupButton.id = "cast-btn";
      setupButton.className = "link";
      setupButton.textContent = "Cast";
      setupButton.setAttribute("aria-pressed", "false");
      document.querySelector(".topbar-actions")?.appendChild(setupButton);
    }

    let hudButton = document.getElementById("hud-cast");
    if (!hudButton) {
      hudButton = document.createElement("button");
      hudButton.type = "button";
      hudButton.id = "hud-cast";
      hudButton.className = "btn sm outline";
      hudButton.textContent = "Cast";
      hudButton.setAttribute("aria-pressed", "false");
      document.querySelector(".pctl-options")?.appendChild(hudButton);
    }

    [setupButton, hudButton].forEach((button) => on(button, "click", toggleCast));
    syncButtons();
  }

  function sendJson(value) {
    if (!connection || connection.state !== "connected") return false;
    try {
      connection.send(JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function asBlob(value, fallbackUrl) {
    if (value instanceof Blob) return Promise.resolve(value);
    if (!fallbackUrl) return Promise.resolve(null);
    return fetch(fallbackUrl).then((response) => (response.ok ? response.blob() : null)).catch(() => null);
  }

  function sendBlob(role, blob, meta = {}) {
    if (!(blob instanceof Blob)) return Promise.resolve(false);
    sendQueue = sendQueue.then(async () => {
      if (!connection || connection.state !== "connected") return false;
      const header = {
        type: "blob",
        role,
        mime: blob.type || meta.mime || "application/octet-stream",
        size: blob.size,
        ...meta,
      };
      try {
        connection.send(JSON.stringify(header));
        connection.send(blob);
        return true;
      } catch (error) {
        status(`Cast transfer failed${meta.name ? ` for ${meta.name}` : ""}.`);
        console.warn("Cast transfer failed", error);
        return false;
      }
    });
    return sendQueue;
  }

  async function syncSlide(force = false) {
    if (typeof state === "undefined") return;
    const slide = state.slides?.[state.index];
    if (!slide) {
      if (force || lastSlideId !== null) sendJson({ type: "clear", role: "slide" });
      lastSlideId = null;
      return;
    }
    if (!force && slide.id === lastSlideId) return;
    lastSlideId = slide.id;
    const blob = await asBlob(slide.file, slide.url);
    if (!blob || slide.id !== lastSlideId) return;
    await sendBlob("slide", blob, {
      id: String(slide.id),
      kind: slide.kind === "video" ? "video" : "image",
      name: slide.alt || blob.name || "media",
    });
  }

  async function syncOverlay(force = false) {
    if (typeof state === "undefined") return;
    const file = state.overlayFile;
    const key = file ? `${state.overlayName || "overlay"}:${file.size || 0}:${file.lastModified || 0}` : null;
    if (!file) {
      if (force || lastOverlayKey !== null) sendJson({ type: "clear", role: "overlay" });
      lastOverlayKey = null;
      return;
    }
    if (!force && key === lastOverlayKey) return;
    lastOverlayKey = key;
    const blob = await asBlob(file, state.overlayUrl);
    if (!blob || key !== lastOverlayKey) return;
    await sendBlob("overlay", blob, {
      id: key,
      kind: "video",
      name: state.overlayName || "overlay",
    });
  }

  async function syncTrack(force = false) {
    if (typeof state === "undefined") return;
    if (state.soundtrackMode !== "local") {
      if (force || lastTrackId !== null) sendJson({ type: "clear", role: "audio" });
      lastTrackId = null;
      return;
    }
    const track = state.tracks?.[state.trackIndex];
    if (!track) {
      if (force || lastTrackId !== null) sendJson({ type: "clear", role: "audio" });
      lastTrackId = null;
      return;
    }
    if (!force && track.id === lastTrackId) return;
    lastTrackId = track.id;
    const blob = await asBlob(track.file, track.url);
    if (!blob || track.id !== lastTrackId) return;
    await sendBlob("audio", blob, {
      id: String(track.id),
      kind: "audio",
      name: track.name || "soundtrack",
    });
  }

  function syncSoundcloud(force = false) {
    if (typeof state === "undefined") return;
    const url = state.soundtrackMode === "soundcloud" ? String(state.soundcloudUrl || "") : "";
    if (!force && url === lastSoundcloud) return;
    lastSoundcloud = url;
    sendJson({ type: "soundcloud", url });
  }

  function currentPlaybackState() {
    if (typeof state === "undefined") return null;
    const slideVideo = document.getElementById("slide-vid");
    const overlayVideo = document.getElementById("overlay-vid");
    const localAudio = document.getElementById("local-audio");
    return {
      type: "state",
      playing: Boolean(state.playing),
      index: Number(state.index) || 0,
      fit: state.fit === "cover" ? "cover" : "contain",
      zoom: Math.max(1, Math.min(2.4, Number(state.zoom) || 1)),
      slowPan: Boolean(state.slowPan),
      slideVideoTime: Number(slideVideo?.currentTime) || 0,
      slideVideoPaused: Boolean(slideVideo?.paused),
      slideVideoVolume: Math.max(0, Math.min(1, (Number(state.slideVideoVolume) || 0) / 100)),
      slideVideoMuted: Boolean(state.slideVideoMuted),
      overlayTime: Number(overlayVideo?.currentTime) || 0,
      overlayPaused: Boolean(overlayVideo?.paused),
      overlayOpacity: Math.max(0, Math.min(1, 1 - (Number(state.transparency) || 0) / 100)),
      overlayVolume: Math.max(0, Math.min(1, (Number(state.overlayVolume) || 0) / 100)),
      overlayLoop: Boolean(state.overlayLoop),
      blend: String(state.blend || "screen"),
      audioTime: Number(localAudio?.currentTime) || 0,
      audioPaused: Boolean(localAudio?.paused),
      audioVolume: Math.max(0, Math.min(1, (Number(state.soundtrackVolume) || 0) / 100)),
      audioRate: Math.max(0.25, Math.min(2.5, Number(state.audioSpeed) || 1)),
      tina: document.body.classList.contains("smoke-on"),
    };
  }

  function syncState(force = false) {
    const payload = currentPlaybackState();
    if (!payload) return;
    const coarse = {
      ...payload,
      slideVideoTime: Math.round(payload.slideVideoTime * 2) / 2,
      overlayTime: Math.round(payload.overlayTime * 2) / 2,
      audioTime: Math.round(payload.audioTime * 2) / 2,
    };
    const key = JSON.stringify(coarse);
    if (force || key !== lastStateKey) {
      lastStateKey = key;
      sendJson(payload);
    }
  }

  function syncAll(force = false) {
    if (!connection || connection.state !== "connected") return;
    syncSlide(force);
    syncOverlay(force);
    syncTrack(force);
    syncSoundcloud(force);
    syncState(force);
  }

  function startPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => syncAll(false), 350);
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = 0;
  }

  function resetSentState() {
    lastSlideId = null;
    lastOverlayKey = null;
    lastTrackId = null;
    lastSoundcloud = null;
    lastStateKey = "";
  }

  function detachConnection(message) {
    stopPolling();
    connection = null;
    resetSentState();
    syncButtons();
    if (message) status(message);
  }

  function attachConnection(next) {
    if (!next) return;
    if (connection && connection !== next) {
      try { connection.close(); } catch {}
    }
    connection = next;
    try { connection.binaryType = "blob"; } catch {}
    on(connection, "connect", () => {
      syncButtons();
      status("Cast connected.");
      resetSentState();
      syncAll(true);
      startPolling();
    });
    on(connection, "message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data);
        if (message?.type === "ready") syncAll(true);
      } catch {}
    });
    on(connection, "close", () => detachConnection("Cast disconnected."));
    on(connection, "terminate", () => detachConnection("Cast stopped."));

    if (connection.state === "connected") {
      syncButtons();
      status("Cast connected.");
      resetSentState();
      syncAll(true);
      startPolling();
    } else {
      syncButtons();
    }
  }

  async function toggleCast() {
    if (!request) {
      status("Casting needs desktop Chrome/Chromium with Presentation API support.");
      return;
    }
    if (connection && connection.state === "connected") {
      try {
        connection.terminate();
      } catch {
        try { connection.close(); } catch {}
      }
      detachConnection("Cast stopped.");
      return;
    }
    try {
      const next = await request.start();
      attachConnection(next);
    } catch (error) {
      if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") {
        status(`Cast could not start${error?.message ? `: ${error.message}` : "."}`);
      }
    }
  }

  if (request) {
    try {
      navigator.presentation.defaultRequest = request;
    } catch {}
    on(request, "connectionavailable", (event) => attachConnection(event.connection));
  }

  installButtons();
  later(installButtons, 500);
  later(installButtons, 1600);

  window.__plapinatorCast = {
    start: toggleCast,
    get connection() { return connection; },
    sync: () => syncAll(true),
  };

  window.__hotRegister?.(NAME, () => {
    destroyed = true;
    stopPolling();
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    disposers.splice(0).forEach((fn) => {
      try { fn(); } catch {}
    });
    if (connection) {
      try { connection.close(); } catch {}
    }
    connection = null;
    document.getElementById("cast-btn")?.remove();
    document.getElementById("hud-cast")?.remove();
    try {
      if (navigator.presentation?.defaultRequest === request) navigator.presentation.defaultRequest = null;
    } catch {}
    delete window.__plapinatorCast;
  });
})();
