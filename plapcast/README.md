# PlapCast

PlapCast is a private local-network slideshow synchronizer made specifically for **Omen's Plapinator**.

It is **not screen mirroring** and it is **not a video stream**. The actual image slides are prepared on the Mac, sent only across the local network, preloaded by the Roku receivers, and displayed natively by each Roku.

## Hard separation from Gooninator

PlapCast is intentionally private-build-only:

- The Chrome extension matches only `https://omenplaps.netlify.app/*`.
- Its page bridge refuses `?theme=0` and requires the Omen theme to be active.
- The extension worker rejects messages from every other website.
- The Mac helper requires the `omens-plapinator` product header for control/upload endpoints.
- `gooninatorx.netlify.app` is not in the extension manifest and receives no PlapCast code.
- No existing Plapinator or Gooninator source file is modified by this prototype.

## Architecture

```text
Omen's Plapinator in Chrome on the Mac
               |
        private extension
               |
      actual image blobs
               v
        PlapCast.app
      127.0.0.1:43123
               |
     high-quality local JPEGs
        /                 \
       v                   v
 Roku PlapCast          Roku PlapCast
 receiver #1            receiver #2
       |                   |
   projector           second screen
```

The receiver uses three Roku `Poster` nodes: one visible slide, one preloaded next slide, and one spare. This keeps the next image warm before a transition instead of repeatedly compressing a moving desktop into video frames.

## Image quality

- Image-only synchronization. Videos are skipped while PlapCast is active.
- Phone/HEIC/GIF/etc. images are converted locally by the Mac helper to Roku-safe JPEG.
- Maximum decoded dimension is 1920 px and JPEG quality is 0.96.
- No H.264/HLS/Chromecast-style screen compression is involved.
- Fit/Fill, Zoom, and Crossfade are sent with each slide change.
- Shuffle uses a deterministic image-only queue while PlapCast is active so the next slide can be preloaded.

## Privacy

Media is never uploaded to Netlify, GitHub, Roku's cloud, or a PlapCast cloud service.

The Chrome extension reads the already-local Blob URLs from Omen's Plapinator, sends image bytes to the helper on `127.0.0.1`, and the helper exposes randomized-session media URLs only on the Mac's LAN. Session files live in the macOS temporary directory and are deleted when the session stops or a new session begins.

## Requirements

- macOS 13 or newer
- Chrome 111 or newer on the Mac
- Both Rokus and the Mac on the same local network
- Roku Developer Mode enabled on each Roku
- Roku **Control by mobile apps → Network access** enabled

## Build the Mac app

```bash
cd plapcast/mac
chmod +x build-app.sh
./build-app.sh
```

The result is:

```text
plapcast/mac/dist/PlapCast.app
```

The local prototype is ad-hoc signed rather than notarized, so macOS may require **right-click → Open** the first time.

## Build the Roku receiver

```bash
cd plapcast/roku
chmod +x make-zip.sh
./make-zip.sh
```

The result is:

```text
plapcast/roku/dist/PlapCast-Roku.zip
```

Sideload that same ZIP onto both Rokus using their Development Application Installer.

## Install the Chrome bridge

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `plapcast/chrome` folder.

Because the manifest only matches the private Plapinator hostname, the extension will not inject into Gooninator.

## Use it

1. On each Roku, go to **Settings → Network → About** and copy its IP address.
2. Open `PlapCast.app` on the Mac and enter both Roku IP addresses.
3. Open Omen's Plapinator in Chrome.
4. Add/import the slideshow media normally.
5. Press the new **PlapCast** control before starting the reel.
6. Wait for the images to be prepared. The button shows upload progress.
7. When it reads **PlapCast ON**, start the slideshow.

PlapCast automatically forces video skipping for the active sync session and restores the previous setting when sync is turned off.

## Current prototype boundaries

- Images only. Slideshow video clips are intentionally excluded.
- Plapinator's local soundtrack remains on the Mac; audio is not sent to the Rokus yet.
- TINA MODE's moving smoke is not reproduced on the Roku receiver in this image-sync prototype.
- Roku addresses are entered manually in v0.1. SSDP auto-discovery can be added after the first two-device test.
- The receiver is sideloaded for testing rather than published in the Roku Channel Store.
