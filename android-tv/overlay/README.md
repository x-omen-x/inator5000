# Omen's Plapinator TV

Standalone Android TV edition of Plapinator for Sony BRAVIA / Google TV.

## Privacy model

- The player and every UI asset are bundled in the APK.
- There are no analytics, advertisements, remote fonts, SoundCloud requests,
  update checks, STUN/TURN services, or cloud media endpoints.
- USB and system-picker imports are copied into Android app-private storage.
- Wi-Fi receiving is off by default and only listens on private LAN addresses
  while the receive sheet is open. It offers a per-session TLS certificate and
  fresh six-digit PIN, chooses Android's active network first, and shows other
  valid private addresses when the TV has more than one interface.
- A clearly labeled plain-HTTP compatibility address is available for Safari
  versions that refuse the TV's self-signed certificate. It never contacts a
  cloud service, expires with the receiver, rate-limits wrong PINs, and must be
  used only on a trusted WPA2/WPA3 home network because browser-level TLS is
  not present on that fallback address.
- The app never initiates an outbound network connection.

## Supported inputs

- Images and videos for the slideshow
- One video overlay with opacity, volume, looping, and blend controls
- Local audio playlists
- USB drives through Android's system document picker
- Local upload from Safari/Chrome on an iPhone or Mac (TLS preferred; trusted-
  home-network compatibility link available)

Bluetooth file receiving is intentionally not implemented because iPhone does
not expose generic Bluetooth file transfer and Android TV support varies by
manufacturer. Files already received by another TV app remain selectable from
the system picker.

## TV remote controls

- D-pad: move focus through the setup UI; left/right changes slides in player
- Center/OK: activate the focused control
- Play, pause, play/pause, stop, previous, next, rewind, fast-forward: native
  transport controls
- Number pad in player: 1 previous, 2 play/pause, 3 next, 4 media shuffle,
  5 audio shuffle, 7/9 video volume, 8 mute, 0 exit
- Number pad in setup: 1 private receiver, 2 slideshow files, 3 overlay video,
  4 audio files, 9 start reel
