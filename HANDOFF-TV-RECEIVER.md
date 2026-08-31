# Omen’s Plap TV / Receiver Mode — Handoff

## Read this first

This handoff is for the **TV / multi-screen receiver project only**. Do **not** merge or overwrite `main` until the receiver work is verified. The live/restored Plapinator app was intentionally reset away from this experiment. Continue work from branch:

`backup/receiver-experiment-2026-08-31`

Repository:

`x-omen-x/inator5000`

The public Gooninator build is separate and must not be changed by this work.

## Goal

Allow Omen’s private Plapinator app to send its slideshow to one or more screens, especially a Sony BRAVIA browser, while keeping media private and preserving the existing Plapinator app behavior.

The receiver path should eventually synchronize the **actual slideshow state**, not stream a video and not use browser casting/compression. The current transfer scope is **images only**. Videos, local audio, and overlay video must not be transferred to TV receivers.

## Absolute privacy requirements

1. Media bytes must never be uploaded to, stored on, proxied through, or made accessible by a remote server.
2. Receiver Mode connection metadata must not leave the LAN. No public STUN. No TURN. No cloud rendezvous. No public signaling fallback.
3. No analytics or remote logs carrying pairing/session/network metadata.
4. Pairing must be explicit and authenticated.
5. Receiver copies are session-only/temp by default. Do not persist them to IndexedDB unless Omen explicitly changes this requirement.
6. Fail closed. If the local path cannot work, show an error rather than falling back to an external service.
7. The source Plapinator media library must remain untouched.
8. Public Gooninator must remain untouched.

## Device context

Primary sender: iPhone 12 Pro Max using Plapinator, often installed from Safari as a PWA.

Receiver target: Sony BRAVIA 4K VH2 using a third-party Android/Google TV browser app. The browser successfully opens Plapinator.

MacBook is available as an optional local helper/relay.

Surfshark VPN may be active. `Invisible on LAN` needs to be OFF for local device communication. Internet traffic may still stay routed through Surfshark.

## Work already done on this branch

### `local/private-lan.js`

Encrypted browser-to-browser image transport using a user-owned local WebSocket helper.

Important properties:

- Accepts only private/local helper addresses.
- 10-character pairing codes.
- Room ID is a SHA-256-derived hash of the pairing code.
- AES-GCM browser-side encryption.
- Key derived using PBKDF2/SHA-256, 250,000 iterations.
- Metadata and image chunks are encrypted before relay.
- The helper should see only ciphertext and room hash.
- Image chunks are about 96 KiB.
- Receiver reconstructs blobs in memory and creates object URLs.
- Receiver pushes session-only image slides into `state.slides`.
- No IndexedDB persistence in this path.
- Multiple receivers were intended to work by each receiver announcing an encrypted receiver ID and sender targeting transfers individually.
- No STUN, TURN, ICE, WebRTC or Netlify rendezvous in this private path.

### `local/receiver-mode.js`

Receiver UI wrapper.

Expected behavior:

- Shows `Screens · Private LAN`.
- User enters Mac helper URL.
- TV Receiver Mode creates a 10-character pairing code.
- Sender enters same helper URL + TV code.
- Sender filters media to images only: `slide.kind === "image" && slide.file`.
- Videos/audio/overlay are excluded.
- Errors must say that no cloud fallback was attempted.
- Helper address stored only in localStorage.
- Receiver pairing code should remain session-only.

### `tools/plap-lan-host.mjs`

Node local relay helper.

Original helper behavior:

- HTTPS/WSS on port 8787.
- Binds to `0.0.0.0`.
- Rejects non-private source IPs.
- `/plap` WebSocket relay.
- First text message is a room join message.
- Relays frames only inside the same in-memory room.
- No payload persistence.
- No outbound network requests.

A one-click launcher was also added:

`START-PRIVATE-LAN.command`

A standalone helper ZIP was generated for the user outside the repo as well.

### Certificate experiment

The helper initially used a self-signed HTTPS certificate. The user could reach the helper from the Mac itself, but the iPhone got stuck on the certificate warning.

An attempted follow-up changed the helper toward a local CA installer served from an HTTP setup port and added certificate-install logic. This was the last active direction before the user asked to abandon the experiment and restore main.

**Do not assume this certificate approach is the best final design. Re-evaluate it.**

## Known blockers / things to solve next

### 1. HTTPS page → local WebSocket security

The hosted Plapinator page runs over HTTPS. It cannot simply connect to insecure `ws://` on the LAN because browsers will block mixed content.

Therefore the receiver connection needs one of these kinds of solutions:

- trusted local `wss://`,
- a same-origin local shell,
- a browser/PWA architecture that permits a secure local channel without remote signaling,
- or another local-only secure transport that the Sony browser and iOS Safari/PWA both support.

Do not replace this with insecure HTTP merely to make it easier.

### 2. CSP

The hosted app’s CSP previously had:

`connect-src 'self' https://w.soundcloud.com`

That blocks arbitrary local `wss://` endpoints.

A later experimental commit loosened this to allow WebSockets, but because the branch was an experiment, inspect the current branch state carefully before assuming what is deployed.

Important privacy nuance: a CSP permission like `wss:` allows capability broadly even if app code restricts helper hosts. Prefer a design that can remain narrow if possible.

### 3. Self-signed certificate UX

The Sony browser and iOS installed PWA may not make trusting a custom local certificate pleasant or reliable.

The user does not want a cumbersome certificate ritual every time.

A good final design should make daily use closer to:

- start one local helper on Mac,
- open Plapinator,
- enter/remember helper address,
- pair TV,
- done.

Or ideally even simpler.

### 4. WebSocket implementation robustness

The raw helper WebSocket implementation assumed complete FIN frames. Browser `WebSocket.send()` will usually map to a complete message, but continuation-frame support may be needed for robustness.

Also add backpressure using `ws.bufferedAmount` or equivalent if large image libraries can flood memory.

### 5. Slideshow synchronization is not implemented yet

After encrypted image transfer is reliable, implement **state synchronization**, not video streaming.

Recommended state messages:

- current image/item ID or index
- next / previous
- play / pause
- shuffle / no-repeat state
- pace
- crossfade
- fit / zoom if desired
- target transition timestamp
- ping/pong clock offset
- periodic drift correction

Receivers should schedule transitions locally so multiple screens stay synchronized.

## Important distinction about Netlify

The private receiver transport was designed to avoid Netlify/STUN/TURN/cloud signaling.

However the Plapinator app shell was still loaded from Netlify. That means ordinary hosted-page requests can expose normal request metadata such as the user’s VPN exit IP, time, user agent/device/browser, and requested app files.

That is separate from Receiver Mode transport.

The user’s core concern is that **media and receiver-network metadata must not be accessible to anyone else**. If making the entire app local is considered, explain the tradeoff clearly because the existing IndexedDB media library is origin-scoped and would not automatically appear on a different local origin.

## History / checkpoints

Receiver-related commits include:

- `1029c7deafb465a971d5e18a1821ad80c6fd021b` — Add image-only receiver mode UI
- `15f5a9529292898a01f978da0d9815d075dbe953` — Restore LAN receiver transport for image-only screens
- `464ba1e46c4ea58097b938dfa8d9997b3c719462` — Fix receiver state access and sender refresh
- `b3e5ac63a9fd86d28c024a5eb9de3dd197effdb5` — Publish image-only receiver build
- `d833f0ad5d82fce8c77a1410ca6049a06314ee32` — Use pairing codes for receiver discovery
- `088f112d6ffa32790819fa8f135d5101c31ea967` — Add encrypted LAN-only screen transport
- `5286b2c75300b11f8216ecd9f74e835adacca703` — Add private LAN-only encrypted relay helper
- `b01159a5a8f45dd9ed14a62324c0faa39926fca5` — Switch receiver mode to encrypted private LAN helper
- `2479b238640e8de83c985861d885258e7fb2d92e` — Load private LAN core in receiver mode
- `856ef208c1f2a82b8d583c67bac03b28ed3c3434` — Cache private LAN transport and retire receiver cloud transport
- `03d8caf71e438b6c94b25d80ab3e101d6cab8053` — Publish private LAN-only receiver build
- `58a0181e512bf9b26955eb7e6ed8ce6619900757` — Ignore local private LAN certificates
- `efd9bca547672dad87df88d80fce246fdefab4f4` — Add one-command private LAN launcher
- `1b7a366d23ef250329f8fbf95ac41c568dd1bba9` — Allow private LAN WebSocket receiver transport
- `c0a879ce63ef63238da19c817395ef9b7b71286f` — Bump private LAN receiver build
- `054ead3802aa92fda95250e870b60ed03234fe69` — Add local CA installer for private LAN helper

The active experimental state was preserved on branch:

`backup/receiver-experiment-2026-08-31`

The main branch was later restored to the pre-receiver Plapinator checkpoint before unrelated UI work continued.

## What NOT to touch

Do not modify unrelated Plapinator UI, title art, TINA smoke, pipe, mascot, slideshow visuals, audio system, or public Gooninator while working on the TV receiver project.

Do not reintroduce PIP. The user explicitly removed it.

Do not turn the slideshow into a livestream/video stream.

Do not transfer videos to TV receivers unless Omen explicitly changes the requirement.

Do not upload media to any cloud or signaling service.

## Suggested first action for the next AI

1. Checkout/read `backup/receiver-experiment-2026-08-31`.
2. Inspect current versions of:
   - `local/private-lan.js`
   - `local/receiver-mode.js`
   - `tools/plap-lan-host.mjs`
   - `netlify.toml`
   - `sw.js`
3. Verify the branch state against the commit history above.
4. Decide on the least-friction secure transport compatible with:
   - iOS Safari / installed PWA
   - Sony Android/Google TV browser
   - optional Mac helper
   - LAN-only privacy invariants
5. Do not implement until the architecture is internally consistent about TLS, CSP, and origin restrictions.
6. Once transport works, add slideshow synchronization messages and drift correction.

## User-facing style

Keep explanations simple and concrete. The user does not want networking jargon dumped on them. When testing, give one step at a time and ask for the exact observed result before changing multiple system settings.
