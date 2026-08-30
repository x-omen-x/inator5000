import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { createHash } from "node:crypto";

/**
 * Handshake-only rendezvous for LAN Share.
 *
 * This endpoint never sees a single byte of anyone's media. It carries small
 * WebRTC handshake envelopes (SDP + ICE candidates, optionally sealed by the
 * browsers before they get here) just long enough for two browsers sitting on
 * the same network to find each other. Once the peer connection is up the
 * files travel device-to-device over the LAN and this endpoint is idle.
 *
 * Peers are bucketed by the public IP their traffic egresses from, so only
 * devices that share a network are ever introduced to one another. When a
 * password is set the bucket is the password instead: on a dual-stack network
 * two devices on the same Wi-Fi egress from *different* public IPv6 addresses,
 * so an address bucket can never introduce them and a shared word can.
 */

const PEER_TTL_MS = 90_000;
const MSG_TTL_MS = 90_000;
const MAX_SEND = 24;
const MAX_ENVELOPE = 96 * 1024;
const STORE = "lan-rendezvous";

type Envelope = { to: string; data: string };
type Roster = Record<string, { label: string; ts: number }>;

function store() {
  return getStore({ name: STORE, consistency: "strong" });
}

function clientIp(req: Request, context: Context) {
  return (
    context.ip ||
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Reduce an address to the thing two devices on one network actually share.
 *
 * IPv4 behind a home router is shared outright. IPv6 is not: every device gets
 * its own global address out of the /64 the router was delegated, so bucketing
 * on the full address puts a phone and a laptop sitting on the same Wi-Fi into
 * two different rooms — which is exactly why pairing kept failing on any
 * dual-stack connection. The /64 prefix is the network, so that is the bucket.
 */
function network(ip: string) {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return `v4:${mapped[1]}`;
  if (!addr.includes(":")) return `v4:${addr}`;
  // Expand the :: gap just far enough to read the first four hextets.
  const [head, tail = ""] = addr.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const gap = Math.max(0, 8 - left.length - right.length);
  const full = [...left, ...Array(gap).fill("0"), ...right].slice(0, 4);
  while (full.length < 4) full.push("0");
  return `v6:${full.map((part) => part.replace(/^0+(?=.)/, "")).join(":")}`;
}

/**
 * Rooms rotate daily so a stale bucket can never be squatted forever.
 *
 * A password takes the address out of the equation completely. That is the
 * escape hatch for every network an address bucket gets wrong — carrier-grade
 * NAT that lumps strangers together, dual-stack that splits neighbours apart,
 * one device on Wi-Fi while the other is still on cellular.
 */
function roomFor(ip: string, tag: string) {
  const day = Math.floor(Date.now() / 86_400_000);
  const bucket = tag ? `word|${tag}` : `net|${network(ip)}`;
  return createHash("sha256").update(`gooninator-lan|${day}|${bucket}`).digest("hex").slice(0, 24);
}

function safeId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(value) ? value : "";
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const peerId = safeId(body.peer);
  if (!peerId) return new Response("Bad peer", { status: 400 });

  const tag = typeof body.tag === "string" ? body.tag.slice(0, 64) : "";
  const label = typeof body.label === "string" ? body.label.slice(0, 48) : "device";
  const room = roomFor(clientIp(req, context), tag);
  const blobs = store();
  const now = Date.now();

  if (body.leave) {
    const leaving =
      ((await blobs.get(`${room}/peers`, { type: "json" }).catch(() => null)) as Roster | null) || {};
    delete leaving[peerId];
    await blobs.setJSON(`${room}/peers`, leaving).catch(() => undefined);
    return Response.json({ room, peers: [], inbox: [] });
  }

  // Presence is one document for the whole room rather than a blob per peer.
  // The old shape cost a list plus a get for every peer on every poll, which
  // is the bulk of what this endpoint was billing for. A write lost to a race
  // costs nothing: each peer rewrites its own entry on its next heartbeat.
  const roster =
    ((await blobs.get(`${room}/peers`, { type: "json" }).catch(() => null)) as Roster | null) || {};
  roster[peerId] = { label, ts: now };
  const peers: { id: string; label: string }[] = [];
  for (const [id, rec] of Object.entries(roster)) {
    if (now - rec.ts > PEER_TTL_MS) delete roster[id];
    else if (id !== peerId) peers.push({ id, label: rec.label });
  }

  const writes: Promise<unknown>[] = [blobs.setJSON(`${room}/peers`, roster).catch(() => undefined)];

  const send = Array.isArray(body.send) ? (body.send as Envelope[]).slice(0, MAX_SEND) : [];
  for (let i = 0; i < send.length; i++) {
    const to = safeId(send[i]?.to);
    const data = send[i]?.data;
    if (!to || typeof data !== "string" || data.length > MAX_ENVELOPE) continue;
    writes.push(
      blobs
        .setJSON(`${room}/i/${to}/${now}-${i}-${peerId}`, { from: peerId, data, ts: now })
        .catch(() => undefined),
    );
  }
  await Promise.all(writes);

  const mail = await blobs
    .list({ prefix: `${room}/i/${peerId}/` })
    .catch(() => ({ blobs: [] as { key: string }[] }));

  // Keys are stamped with the send time, so sorting them hands the offer back
  // before the ICE candidates that were minted a moment after it. Slots are
  // filled by index rather than pushed, because the reads finish out of order.
  const ordered = [...mail.blobs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const slots: ({ from: string; data: string } | null)[] = new Array(ordered.length).fill(null);
  await Promise.all(
    ordered.map(async (entry, slot) => {
      const rec = (await blobs.get(entry.key, { type: "json" }).catch(() => null)) as
        | { from: string; data: string; ts: number }
        | null;
      // A read that failed transiently must not destroy the envelope — a lost
      // offer is a pair that never connects, and nothing retransmits it. Only
      // once the key's own timestamp puts it past its life is it swept.
      if (!rec) {
        const stamped = Number(entry.key.split("/").pop()?.split("-")[0]);
        if (Number.isFinite(stamped) && now - stamped > MSG_TTL_MS) {
          await blobs.delete(entry.key).catch(() => undefined);
        }
        return;
      }
      await blobs.delete(entry.key).catch(() => undefined);
      if (now - rec.ts < MSG_TTL_MS) slots[slot] = { from: rec.from, data: rec.data };
    }),
  );
  const inbox = slots.filter(Boolean);

  return new Response(JSON.stringify({ room, peers, inbox }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const config: Config = {
  path: "/api/lan-rendezvous",
  method: "POST",
};
