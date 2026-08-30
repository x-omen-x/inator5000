(() => {
  "use strict";

  const PRIVATE_HOST = "omenplaps.netlify.app";
  const PAGE_CHANNEL = "omens-plapinator-plapcast-page";
  const BRIDGE_CHANNEL = "omens-plapinator-plapcast-bridge";
  const CHUNK_BYTES = 256 * 1024;

  if (location.hostname !== PRIVATE_HOST) return;

  const tellPage = (type, payload = {}) => {
    window.postMessage({ channel: BRIDGE_CHANNEL, type, ...payload }, location.origin);
  };

  const askWorker = async (message) => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || "PlapCast helper request failed");
    return result;
  };

  function bytesToBase64(bytes) {
    let out = "";
    const lane = 0x8000;
    for (let i = 0; i < bytes.length; i += lane) {
      out += String.fromCharCode(...bytes.subarray(i, i + lane));
    }
    return btoa(out);
  }

  async function uploadSlide(slide, index, total) {
    const response = await fetch(slide.url);
    if (!response.ok) throw new Error(`Could not read ${slide.name || "image"}`);
    const blob = await response.blob();
    const buffer = new Uint8Array(await blob.arrayBuffer());

    await askWorker({
      type: "UPLOAD_BEGIN",
      id: slide.id,
      name: slide.name || "image",
      mime: slide.type || blob.type || "application/octet-stream",
      size: buffer.byteLength,
    });

    for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_BYTES) {
      const part = buffer.subarray(offset, Math.min(buffer.byteLength, offset + CHUNK_BYTES));
      await askWorker({
        type: "UPLOAD_CHUNK",
        id: slide.id,
        offset,
        data: bytesToBase64(part),
      });
    }

    await askWorker({ type: "UPLOAD_END", id: slide.id });
    tellPage("UPLOAD_PROGRESS", { done: index + 1, total, name: slide.name || "image" });
  }

  async function start(slides) {
    const images = Array.isArray(slides) ? slides.filter((s) => s?.id && s?.url) : [];
    if (!images.length) throw new Error("No image slides are available to sync.");

    const session = await askWorker({ type: "START_SESSION", imageCount: images.length });
    tellPage("SESSION_STARTED", {
      rokuCount: session.rokuCount || 0,
      server: session.server || "",
    });

    for (let i = 0; i < images.length; i += 1) {
      await uploadSlide(images[i], i, images.length);
    }

    tellPage("READY", { count: images.length, rokuCount: session.rokuCount || 0 });
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.channel !== PAGE_CHANNEL) return;

    try {
      if (msg.type === "START") {
        await start(msg.slides);
      } else if (msg.type === "SHOW") {
        await askWorker({
          type: "SHOW",
          seq: msg.seq,
          current: msg.current,
          next: msg.next || "",
          fit: msg.fit || "contain",
          zoom: Number(msg.zoom) || 1,
          crossfade: Math.max(0, Number(msg.crossfade) || 0),
        });
      } else if (msg.type === "BLANK") {
        await askWorker({ type: "BLANK" });
      } else if (msg.type === "STOP") {
        await askWorker({ type: "STOP" });
        tellPage("STOPPED");
      }
    } catch (error) {
      tellPage("ERROR", { message: error?.message || String(error) });
    }
  });
})();
