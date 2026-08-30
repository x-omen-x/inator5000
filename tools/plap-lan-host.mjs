#!/usr/bin/env node
import https from "node:https";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CERT_DIR = path.join(ROOT, ".plap-lan");
const KEY = path.join(CERT_DIR, "key.pem");
const CERT = path.join(CERT_DIR, "cert.pem");
const CONF = path.join(CERT_DIR, "openssl.cnf");
const PORT = Number(process.env.PLAP_LAN_PORT || 8787);
const MAX_FRAME = 2 * 1024 * 1024;
const clients = new Set();

function lanAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries || []) {
      if (e.internal) continue;
      if (e.family === "IPv4" && isPrivate(e.address)) out.push(e.address);
    }
  }
  return [...new Set(out)];
}

function stripMapped(addr) {
  return String(addr || "").replace(/^::ffff:/, "");
}

function isPrivate(addr) {
  const a = stripMapped(addr).toLowerCase();
  if (a === "127.0.0.1" || a === "::1") return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = a.match(/^172\.(\d{1,3})\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)) return true;
  return false;
}

function ensureCertificate(ips) {
  fs.mkdirSync(CERT_DIR, { recursive: true, mode: 0o700 });
  const wanted = new Set(["127.0.0.1", ...ips]);
  let regenerate = !fs.existsSync(KEY) || !fs.existsSync(CERT) || !fs.existsSync(CONF);
  if (!regenerate) {
    const old = fs.readFileSync(CONF, "utf8");
    for (const ip of wanted) if (!old.includes(`=${ip}`)) regenerate = true;
  }
  if (!regenerate) return;

  const alt = ["DNS.1=localhost"];
  let n = 1;
  for (const ip of wanted) alt.push(`IP.${n++}=${ip}`);
  const conf = `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3_req\n[dn]\nCN=Omen Plapinator LAN\n[v3_req]\nsubjectAltName=@alt_names\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n[alt_names]\n${alt.join("\n")}\n`;
  fs.writeFileSync(CONF, conf, { mode: 0o600 });
  try {
    execFileSync("openssl", [
      "req", "-x509", "-nodes", "-newkey", "rsa:2048",
      "-keyout", KEY, "-out", CERT, "-days", "3650",
      "-config", CONF, "-extensions", "v3_req",
    ], { stdio: "ignore" });
    fs.chmodSync(KEY, 0o600);
  } catch {
    console.error("Could not create the local HTTPS certificate. macOS needs the built-in openssl command available.");
    process.exit(1);
  }
}

function acceptKey(key) {
  return crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

function frame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let head;
  if (data.length < 126) {
    head = Buffer.alloc(2);
    head[1] = data.length;
  } else if (data.length <= 0xffff) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(data.length), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, data]);
}

function send(client, opcode, payload) {
  if (!client.socket.destroyed) client.socket.write(frame(opcode, payload));
}

function closeClient(client) {
  clients.delete(client);
  try { client.socket.destroy(); } catch {}
}

function relay(client, opcode, payload) {
  if (!client.room) return;
  for (const peer of clients) {
    if (peer !== client && peer.room === client.room) send(peer, opcode, payload);
  }
}

function consume(client) {
  let buf = client.buffer;
  while (buf.length >= 2) {
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = Boolean(b0 & 0x80);
    const opcode = b0 & 0x0f;
    const masked = Boolean(b1 & 0x80);
    let len = b1 & 0x7f;
    let off = 2;
    if (!fin || !masked) return closeClient(client);
    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) break;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(MAX_FRAME)) return closeClient(client);
      len = Number(big);
      off = 10;
    }
    if (len > MAX_FRAME) return closeClient(client);
    if (buf.length < off + 4 + len) break;
    const mask = buf.subarray(off, off + 4);
    off += 4;
    const payload = Buffer.from(buf.subarray(off, off + len));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    buf = buf.subarray(off + len);

    if (opcode === 0x8) return closeClient(client);
    if (opcode === 0x9) {
      send(client, 0xA, payload);
      continue;
    }
    if (opcode !== 0x1 && opcode !== 0x2) continue;

    if (!client.room) {
      if (opcode !== 0x1 || payload.length > 1024) return closeClient(client);
      try {
        const msg = JSON.parse(payload.toString("utf8"));
        if (msg.t !== "join" || !/^[a-f0-9]{24}$/.test(msg.room || "")) return closeClient(client);
        client.room = msg.room;
        send(client, 0x1, JSON.stringify({ t: "joined" }));
      } catch {
        return closeClient(client);
      }
      continue;
    }
    relay(client, opcode, payload);
  }
  client.buffer = buf;
}

const ips = lanAddresses();
ensureCertificate(ips);

const server = https.createServer({
  key: fs.readFileSync(KEY),
  cert: fs.readFileSync(CERT),
}, (req, res) => {
  const remote = req.socket.remoteAddress;
  if (!isPrivate(remote)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Private LAN only.\n");
  }
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plapinator Private LAN</title><style>body{font:18px system-ui;background:#050805;color:#d9ffe2;padding:2rem;max-width:46rem;margin:auto}code{color:#7cff7c}h1{color:#7cff7c}</style><h1>Plapinator Private LAN ✓</h1><p>This local Mac helper is running. Nothing here connects to the internet, stores media, or logs media contents.</p><p>You can return to Omen’s Plapinator now.</p>`);
});

server.on("upgrade", (req, socket) => {
  if (!isPrivate(socket.remoteAddress) || req.url !== "/plap") return socket.destroy();
  const key = req.headers["sec-websocket-key"];
  const version = req.headers["sec-websocket-version"];
  if (!key || version !== "13") return socket.destroy();
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  const client = { socket, room: null, buffer: Buffer.alloc(0) };
  clients.add(client);
  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    consume(client);
  });
  socket.on("close", () => clients.delete(client));
  socket.on("error", () => clients.delete(client));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\nOMEN'S PLAPINATOR — PRIVATE LAN HOST");
  console.log("No cloud, no STUN/TURN, no media storage, no outbound network requests.\n");
  if (!ips.length) console.log(`Trust page: https://127.0.0.1:${PORT}`);
  for (const ip of ips) console.log(`Trust/helper address: https://${ip}:${PORT}`);
  console.log("\n1. Keep this window open while using Receiver Mode.");
  console.log("2. On EACH device, open the trust/helper address once and accept the local certificate warning.");
  console.log("3. Enter that same Mac address in Plapinator's PRIVATE LAN HOST field.\n");
});
