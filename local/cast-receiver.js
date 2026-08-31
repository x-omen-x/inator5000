/* Receiver for the Chrome Presentation API cast bridge. */
(function castReceiver() {
  const still = document.getElementById("cast-still");
  const video = document.getElementById("cast-video");
  const overlay = document.getElementById("cast-overlay");
  const audio = document.getElementById("cast-audio");
  const soundcloud = document.getElementById("cast-soundcloud");
  const smoke = document.getElementById("cast-smoke");
  const status = document.getElementById("cast-status");
  const stage = document.getElementById("cast-stage");

  const urls = { slide: null, overlay: null, audio: null };
  let pendingBlob = null;
  let state = {
    playing: false,
    fit: "contain",
    zoom: 1,
    slowPan: false,
    slideVideoVolume: 1,
    slideVideoMuted: false,
    overlayOpacity: 0.65,
    overlayVolume: 0.4,
    overlayLoop: true,
    blend: "screen",
    audioVolume: 0.8,
    audioRate: 1,
    tina: false,
  };

  function revoke(role) {
    if (urls[role]) URL.revokeObjectURL(urls[role]);
    urls[role] = null;
  }

  function showStatus(text) {
    status.textContent = text || "";
    status.classList.toggle("on", Boolean(text));
  }

  function safePlay(media) {
    const promise = media?.play?.();
    promise?.catch?.(() => undefined);
  }

  function applyState(next) {
    state = { ...state, ...next };
    const fit = state.fit === "cover" ? "cover" : "contain";
    still.style.objectFit = fit;
    video.style.objectFit = fit;
    stage.style.setProperty("--cast-zoom", String(Math.max(1, Number(state.zoom) || 1)));
    stage.classList.toggle("slow-pan", Boolean(state.slowPan));

    video.volume = Math.max(0, Math.min(1, Number(state.slideVideoVolume) || 0));
    video.muted = Boolean(state.slideVideoMuted);
    overlay.style.opacity = String(Math.max(0, Math.min(1, Number(state.overlayOpacity) || 0)));
    overlay.volume = Math.max(0, Math.min(1, Number(state.overlayVolume) || 0));
    overlay.loop = Boolean(state.overlayLoop);
    overlay.style.mixBlendMode = String(state.blend || "screen");
    audio.volume = Math.max(0, Math.min(1, Number(state.audioVolume) || 0));
    audio.playbackRate = Math.max(0.25, Math.min(2.5, Number(state.audioRate) || 1));
    smoke.classList.toggle("on", Boolean(state.tina));
    if (state.tina) safePlay(smoke);
    else smoke.pause();

    if (Number.isFinite(Number(state.slideVideoTime)) && video.readyState >= 1) {
      const target = Number(state.slideVideoTime);
      if (Math.abs(video.currentTime - target) > 1.1) {
        try { video.currentTime = target; } catch {}
      }
    }
    if (Number.isFinite(Number(state.overlayTime)) && overlay.readyState >= 1) {
      const target = Number(state.overlayTime);
      if (Math.abs(overlay.currentTime - target) > 1.5) {
        try { overlay.currentTime = target; } catch {}
      }
    }
    if (Number.isFinite(Number(state.audioTime)) && audio.readyState >= 1) {
      const target = Number(state.audioTime);
      if (Math.abs(audio.currentTime - target) > 1.5) {
        try { audio.currentTime = target; } catch {}
      }
    }

    if (state.playing && !state.slideVideoPaused && video.src) safePlay(video);
    else if (video.src) video.pause();
    if (!state.overlayPaused && overlay.src) safePlay(overlay);
    else if (overlay.src) overlay.pause();
    if (!state.audioPaused && audio.src) safePlay(audio);
    else if (audio.src) audio.pause();
  }

  function clearRole(role) {
    revoke(role);
    if (role === "slide") {
      still.removeAttribute("src");
      video.pause();
      video.removeAttribute("src");
      video.load();
      still.classList.remove("on");
      video.classList.remove("on");
    } else if (role === "overlay") {
      overlay.pause();
      overlay.removeAttribute("src");
      overlay.load();
      overlay.classList.remove("on");
    } else if (role === "audio") {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }

  function receiveBlob(meta, blob) {
    const role = meta?.role;
    if (!role || !["slide", "overlay", "audio"].includes(role)) return;
    revoke(role);
    const typed = blob instanceof Blob && blob.type ? blob : new Blob([blob], { type: meta.mime || "application/octet-stream" });
    urls[role] = URL.createObjectURL(typed);

    if (role === "slide") {
      if (meta.kind === "video") {
        still.classList.remove("on");
        video.src = urls.slide;
        video.classList.add("on");
        video.load();
        video.addEventListener("loadedmetadata", () => applyState(state), { once: true });
        if (state.playing) safePlay(video);
      } else {
        video.pause();
        video.classList.remove("on");
        still.src = urls.slide;
        still.classList.add("on");
      }
      showStatus("");
    } else if (role === "overlay") {
      overlay.src = urls.overlay;
      overlay.classList.add("on");
      overlay.load();
      overlay.addEventListener("loadedmetadata", () => applyState(state), { once: true });
      if (!state.overlayPaused) safePlay(overlay);
    } else if (role === "audio") {
      audio.src = urls.audio;
      audio.load();
      audio.addEventListener("loadedmetadata", () => applyState(state), { once: true });
      if (!state.audioPaused) safePlay(audio);
    }
  }

  function setSoundcloud(url) {
    const value = String(url || "").trim();
    if (!value) {
      soundcloud.removeAttribute("src");
      soundcloud.classList.remove("on");
      return;
    }
    const params = new URLSearchParams({
      url: value,
      auto_play: "true",
      hide_related: "true",
      show_comments: "false",
      show_user: "false",
      show_reposts: "false",
      show_teaser: "false",
      visual: "false",
      buying: "false",
      sharing: "false",
      download: "false",
    });
    soundcloud.src = `https://w.soundcloud.com/player/?${params}`;
    soundcloud.classList.add("on");
  }

  function handleString(connection, raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message !== "object") return;
    if (message.type === "blob") {
      pendingBlob = message;
      showStatus(message.role === "slide" ? `Receiving ${message.name || "media"}…` : "");
      return;
    }
    if (message.type === "state") {
      applyState(message);
      return;
    }
    if (message.type === "clear") {
      clearRole(message.role);
      return;
    }
    if (message.type === "soundcloud") {
      setSoundcloud(message.url);
      return;
    }
    if (message.type === "hello") {
      try { connection.send(JSON.stringify({ type: "ready" })); } catch {}
    }
  }

  function addConnection(connection) {
    try { connection.binaryType = "blob"; } catch {}
    showStatus("Connected. Waiting for media…");
    connection.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        handleString(connection, event.data);
        return;
      }
      if (!pendingBlob) return;
      const meta = pendingBlob;
      pendingBlob = null;
      if (event.data instanceof Blob) receiveBlob(meta, event.data);
      else if (event.data instanceof ArrayBuffer) receiveBlob(meta, new Blob([event.data], { type: meta.mime || "application/octet-stream" }));
    });
    connection.addEventListener("close", () => showStatus("Cast connection closed."));
    connection.addEventListener("terminate", () => showStatus("Cast ended."));
    try { connection.send(JSON.stringify({ type: "ready" })); } catch {}
  }

  if (!navigator.presentation?.receiver) {
    showStatus("This page is a Cast receiver. Start casting from omens plapinator in Chrome.");
    return;
  }

  navigator.presentation.receiver.connectionList
    .then((list) => {
      list.connections.forEach(addConnection);
      list.addEventListener("connectionavailable", (event) => addConnection(event.connection));
    })
    .catch(() => showStatus("Could not open the presentation receiver."));
})();
