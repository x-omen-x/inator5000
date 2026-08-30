# PlapCast

PlapCast is a local-network screen broadcaster for showing the same Mac screen on multiple Roku devices at once.

## What it does

- Captures the Mac display with FFmpeg.
- Encodes a low-latency HLS stream using Apple VideoToolbox hardware H.264.
- Serves the stream only on the Mac's local network.
- Launches a tiny sideloaded Roku receiver channel on two Roku devices with the same stream URL.
- Does not upload the captured screen or media to any cloud service.

This is intentionally separate from the live Plapinator site. The prototype lives on the `plapcast-multiroku` branch.

## Architecture

```text
Safari / Omen's Plapinator on Mac
            |
            v
      PlapCast sender
      (screen capture)
            |
       local Wi-Fi HLS
       /            \
      v              v
 Roku receiver 1   Roku receiver 2
      |              |
  projector       second screen
```

## Requirements

- macOS 13 or newer
- FFmpeg installed (`brew install ffmpeg`)
- Mac and both Rokus on the same local network
- Developer mode enabled on each Roku so the receiver channel can be sideloaded

## Build the Mac app

```bash
cd plapcast/mac
chmod +x build-app.sh
./build-app.sh
```

The script creates `PlapCast.app` in `plapcast/mac/dist/`.

On first launch macOS may ask for screen-recording/network permission. Allow it, then relaunch PlapCast if necessary.

## Build the Roku receiver ZIP

```bash
cd plapcast/roku
chmod +x make-zip.sh
./make-zip.sh
```

This creates `dist/PlapCast-Roku.zip`. Sideload that same ZIP onto both Roku devices in developer mode.

## Using it

1. On each Roku, open **Settings > Network > About** and note its IP address.
2. Launch PlapCast on the Mac.
3. Enter the two Roku IP addresses.
4. Put Safari/Plapinator on the Mac display you want to broadcast.
5. Press **Start on both Rokus**.

The Roku app is launched through Roku ECP using the sideloaded development channel (`dev`).

## Current prototype limitations

- Video-only in v0.1. System audio is not captured yet.
- Captures one whole Mac display. Window-only capture is planned.
- The Roku receiver must be sideloaded once on each Roku.
- FFmpeg is an external dependency in this prototype so we can validate the multi-screen path before packaging a heavier all-in-one build.
