#!/usr/bin/env node
import https from "node:https";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CERT_DIR = path.join(ROOT, ".plap-lan");
const CA_KEY = path.join(CERT_DIR, "ca-key.pem");
const CA_CERT = path.join(CERT_DIR, "ca-cert.pem");
const CA_DER = path.join(CERT_DIR, "plapinator-ca.cer");
const CA_CONF = path.join(CERT_DIR, "ca-openssl.cnf");
const SERVER_KEY = path.join(CERT_DIR, "server-key.pem");
const SERVER_CERT = path.join(CERT_DIR, "server-cert.pem");
const SERVER_CSR = path.join(CERT_DIR, "server.csr");
const SERVER_CONF = path.join(CERT_DIR, "server-openssl.cnf");
const CA_SERIAL = path.join(CERT_DIR, "ca-cert.srl");
const PORT = Number(process.env.PLAP_LAN_PORT || 8787);
const SETUP_PORT = Number(process.env.PLAP_LAN_SETUP_PORT || 8788);
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

function runOpenSSL(args) {
  execFileSync("openssl", args, { stdio: "ignore" });
}

function ensureCertificates(ips) {
  fs.mkdirSync(CERT_DIR, { recursive: true, mode: 0o700 });

  if (!fs.existsSync(CA_KEY) || !fs.existsSync(CA_CERT)) {
    const caConf = `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3_ca\n[dn]\nCN=Omen Plapinator Local CA\n[v3_ca]\nbasicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always,issuer\n`;
    fs.writeFileSync(CA_CONF, caConf, { mode: 0o600 });
    runOpenSSL([
      "req", "-x509", "-nodes", "-newkey", "rsa:2048",
      "-keyout", CA_KEY, "-out", CA_CERT, "-days", "3650",
      "-config", CA_CONF, "-extensions", "v3_ca",
    ]);
    fs.chmodSync(CA_KEY, 0o600);
  }

  runOpenSSL(["x509", "-in", CA_CERT, "-outform", "der", "-out", CA_DER]);

  const wanted = new Set(["127.0.0.1", ...ips]);
  let regenerate = !fs.existsSync(SERVER_KEY) || !fs.existsSync(SERVER_CERT) || !fs.existsSync(SERVER_CONF);
  if (!regenerate) {
    const old = fs.readFileSync(SERVER_CONF, "utf8");
    for (const ip of wanted) if (!old.includes(`=${ip}`)) regenerate = true;
  }
  if (!regenerate) return;

  const alt = ["DNS.1=localhost"];
  let n = 1;
  for (const ip of wanted) alt.push(`IP.${n++}=${ip}`);
  const serverConf = `[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=v3_req\n[dn]\nCN=Omen Plapinator LAN\n[v3_req]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=@alt_names\n[alt_names]\n${alt.join("\n")}\n`;
  fs.writeFileSync(SERVER_CONF, serverConf, { mode: 0o600 });
  runOpenSSL([
    "req", "-new", "-nodes", "-newkey", "rsa:2048",
    "-keyout", SERVER_KEY, "-out", SERVER_CSR,
    "-config", SERVER_CONF,
  ]);
  fs.chmodSync(SERVER_KEY, 0o600);

  const signArgs = [
    "x509", "-req", "-in", SERVER_CSR,
    "-CA", CA_CERT, "-CAkey", CA_KEY,
    "-out", SERVER_CERT, "-days", "365", "-sha256",
    "-extfile", SERVER_CONF, "-extensions", "v3_req",
  ];
  if (fs.existsSync(CA_SERIAL)) signArgs.push("-CAserial", CA_SERIAL);
  else signArgs.push("-CAcreateserial");
  runOpenSSL(signArgs);
}

function mobileConfig() {
  const der = fs.readFileSync(CA_DER).toString("base64");
  const rootUUID = crypto.randomUUID().toUpperCase();
  const profileUUID = crypto.randomUUID().toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>PayloadContent</key>\n  <array>\n    <dict>\n      <key>PayloadCertificateFileName</key><string>Omen Plapinator Local CA.cer</string>\n      <key>PayloadContent</key><data>${der}</data>\n      <key>PayloadDescription</key><string>Trusts only the local certificate authority created by your Plapinator Mac helper.</string>\n      <key>PayloadDisplayName</key><string>Omen Plapinator Local CA</string>\n      <key>PayloadIdentifier</key><string>local.omen.plapinator.ca</string>\n      <key>PayloadType</key><string>com.apple.security.root</string>\n      <key>PayloadUUID</key><string>${rootUUID}</string>\n      <key>PayloadVersion</key><integer>1</integer>\n    </dict>\n  </array>\n  <key>PayloadDescription</key><string>Local-only certificate for Omen's Plapinator Receiver Mode.</string>\n  <key>PayloadDisplayName</key><string>Omen Plapinator Local Trust</string>\n  <key>PayloadIdentifier</key><string>local.omen.plapinator.profile</string>\n  <key>PayloadOrganization</key><string>Omen's Plapinator</string>\n  <key>PayloadRemovalDisallowed</key><false/>\n  <key>PayloadType</key><string>Configuration</string>\n  <key>PayloadUUID</key><string>${profileUUID}</string>\n  <key>PayloadVersion</key><integer>1</integer>\n</dict>\n</plist>\n`;
}

function sendHeaders(res, type, extra = {}) {
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  });
}

function setupPage(ip) {
  const httpsUrl = `https://${ip}:${PORT}`;
  return `<!doctype html>\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Plapinator Private LAN Setup</title>\n<style>\nbody{font:17px system-ui;background:#050805;color:#d9ffe2;padding:2rem;max-width:48rem;margin:auto;line-height:1.45}\nh1,h2,a{color:#7cff7c} code{color:#b9ffbf;background:#101710;padding:.15rem .3rem;border-radius:.3rem}\n.card{border:1px solid #24452a;border-radius:14px;padding:1rem 1.2rem;margin:1rem 0;background:#091009}\n</style>\n<h1>Plapinator Private LAN setup</h1>\n<p>This page is coming directly from your Mac over your private LAN. It makes no outbound requests.</p>\n<div class="card">\n<h2>iPhone / iPad</h2>\n<p><a href="/plapinator-ca.mobileconfig">Install Omen Plapinator Local Trust</a></p>\n<p>After downloading: Settings → General → VPN & Device Management → install the profile. Then Settings → General → About → Certificate Trust Settings → enable full trust for <b>Omen Plapinator Local CA</b>.</p>\n</div>\n<div class="card">\n<h2>Sony / Android device</h2>\n<p><a href="/plapinator-ca.cer">Download CA certificate (.cer)</a></p>\n<p>If the device supports user CA certificates, install this certificate in its security / credentials settings.</p>\n</div>\n<div class="card">\n<h2>Test after trusting</h2>\n<p>Open <code>${httpsUrl}</code>. You should see <b>Plapinator Private LAN ✓</b> with no certificate warning.</p>\n</div>`;
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
try {
  ensureCertificates(ips);
} catch {
  console.error("Could not create the local CA/server certificate. macOS needs the built-in openssl command available.");
  process.exit(1);
}

const httpsServer = https.createServer({
  key: fs.readFileSync(SERVER_KEY),
  cert: fs.readFileSync(SERVER_CERT),
}, (req, res) => {
  if (!isPrivate(req.socket.remoteAddress)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Private LAN only.\n");
  }
  sendHeaders(res, "text/html; charset=utf-8");
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plapinator Private LAN</title><style>body{font:18px system-ui;background:#050805;color:#d9ffe2;padding:2rem;max-width:46rem;margin:auto}h1{color:#7cff7c}</style><h1>Plapinator Private LAN ✓</h1><p>The trusted encrypted helper is running. No cloud rendezvous, STUN, TURN, media storage, analytics, or outbound helper requests.</p>`);
});

httpsServer.on("upgrade", (req, socket) => {
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

const setupServer = http.createServer((req, res) => {
  if (!isPrivate(req.socket.remoteAddress)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Private LAN only.\n");
  }
  const ip = stripMapped(req.headers.host?.split(":")[0] || ips[0] || "127.0.0.1");

  if (req.url === "/plapinator-ca.mobileconfig") {
    sendHeaders(res, "application/x-apple-aspen-config", {
      "content-disposition": 'attachment; filename="Omen-Plapinator-Local-Trust.mobileconfig"',
    });
    return res.end(mobileConfig());
  }
  if (req.url === "/plapinator-ca.cer") {
    sendHeaders(res, "application/x-x509-ca-cert", {
      "content-disposition": 'attachment; filename="Omen-Plapinator-Local-CA.cer"',
    });
    return res.end(fs.readFileSync(CA_DER));
  }
  if (req.url === "/plapinator-ca.pem") {
    sendHeaders(res, "application/x-pem-file", {
      "content-disposition": 'attachment; filename="Omen-Plapinator-Local-CA.pem"',
    });
    return res.end(fs.readFileSync(CA_CERT));
  }
  sendHeaders(res, "text/html; charset=utf-8");
  res.end(setupPage(ip));
});

httpsServer.listen(PORT, "0.0.0.0", () => {
  console.log("\nOMEN'S PLAPINATOR — PRIVATE LAN HOST");
  console.log("No cloud, no STUN/TURN, no media storage, no outbound helper requests.\n");
  for (const ip of ips) {
    console.log(`Setup / certificate installer: http://${ip}:${SETUP_PORT}`);
    console.log(`Trusted helper address:       https://${ip}:${PORT}`);
  }
  console.log("\nFIRST TIME on each device:");
  console.log("1. Open the HTTP setup/certificate-installer address.");
  console.log("2. Install/trust the Omen Plapinator Local CA using the on-screen steps.");
  console.log("3. Test the HTTPS helper address. It should load without a certificate warning.");
  console.log("4. Keep this Terminal window open while using Receiver Mode.\n");
});

setupServer.listen(SETUP_PORT, "0.0.0.0");
