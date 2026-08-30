"use strict";

const PRIVATE_ORIGIN = "https://omenplaps.netlify.app";
const HELPER = "http://127.0.0.1:43123";
const PRODUCT = "omens-plapinator";
let sessionToken = "";

function allowedSender(sender) {
  try {
    return new URL(sender?.tab?.url || "").origin === PRIVATE_ORIGIN;
  } catch {
    return false;
  }
}

function base64Bytes(value) {
  const raw = atob(value || "");
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function helper(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-PlapCast-Product", PRODUCT);
  const response = await fetch(`${HELPER}${path}`, { ...options, headers });
  const text = await response.text();
  let payload = {};
  if (text) {
    try { payload = JSON.parse(text); }
    catch { payload = { message: text }; }
  }
  if (!response.ok) throw new Error(payload.error || payload.message || `Helper returned ${response.status}`);
  return payload;
}

async function handle(message) {
  switch (message.type) {
    case "START_SESSION": {
      const health = await helper("/v1/health");
      if (health.product !== PRODUCT) throw new Error("Wrong PlapCast helper is running.");
      const started = await helper("/v1/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageCount: Number(message.imageCount) || 0 }),
      });
      sessionToken = started.token || "";
      if (!sessionToken) throw new Error("Helper did not create a session.");
      return {
        ok: true,
        rokuCount: Number(started.rokuCount) || 0,
        server: started.server || "",
      };
    }

    case "UPLOAD_BEGIN": {
      if (!sessionToken) throw new Error("Start PlapCast before uploading.");
      await helper(`/v1/session/${encodeURIComponent(sessionToken)}/media/${encodeURIComponent(message.id)}/begin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(message.name || "image"),
          mime: String(message.mime || "application/octet-stream"),
          size: Number(message.size) || 0,
        }),
      });
      return { ok: true };
    }

    case "UPLOAD_CHUNK": {
      if (!sessionToken) throw new Error("No active PlapCast session.");
      const bytes = base64Bytes(message.data);
      await helper(
        `/v1/session/${encodeURIComponent(sessionToken)}/media/${encodeURIComponent(message.id)}/chunk?offset=${Number(message.offset) || 0}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: bytes,
        },
      );
      return { ok: true };
    }

    case "UPLOAD_END": {
      if (!sessionToken) throw new Error("No active PlapCast session.");
      await helper(`/v1/session/${encodeURIComponent(sessionToken)}/media/${encodeURIComponent(message.id)}/finish`, {
        method: "POST",
      });
      return { ok: true };
    }

    case "SHOW": {
      if (!sessionToken) throw new Error("No active PlapCast session.");
      await helper(`/v1/session/${encodeURIComponent(sessionToken)}/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seq: Number(message.seq) || 0,
          current: String(message.current || ""),
          next: String(message.next || ""),
          fit: message.fit === "cover" ? "cover" : "contain",
          zoom: Math.min(2.4, Math.max(1, Number(message.zoom) || 1)),
          crossfade: Math.min(2, Math.max(0, Number(message.crossfade) || 0)),
        }),
      });
      return { ok: true };
    }

    case "BLANK": {
      if (sessionToken) {
        await helper(`/v1/session/${encodeURIComponent(sessionToken)}/blank`, { method: "POST" });
      }
      return { ok: true };
    }

    case "STOP": {
      if (sessionToken) {
        await helper(`/v1/session/${encodeURIComponent(sessionToken)}/stop`, { method: "POST" });
      }
      sessionToken = "";
      return { ok: true };
    }

    default:
      throw new Error("Unknown PlapCast command.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!allowedSender(sender)) {
    sendResponse({ ok: false, error: "PlapCast only accepts Omen's Plapinator." });
    return false;
  }

  handle(message)
    .then((value) => sendResponse(value || { ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
