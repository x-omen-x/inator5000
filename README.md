# Plapinator 9000 — personal web edition

Rebuild based on `Plapinator9000-ACTOR-FIX-CLEAN-20261009` (the latest saved reference kit). Its 35 settings fields and six exact pace ranges are retained. The reference kit itself says its Mac UI was reconstructed and not verified against the installed app; this web rebuild cannot certify identical native behavior.

## Behavior

- Same vortex and droplet assets, glass panels and controls; user-supplied photo for home-screen and browser icons.
- Albums, filename search, All/Pictures/Videos filters, selection, link removal, mixed file/folder/drop import, album/filter/selection ZIP export.
- Bounded shuffle bags/history, no-repeat cycles, previous/next, independent photo/video/audio/overlay transport, pause/exit/fill-screen.
- Fit/fill, photo crossfades, zoom/pan, main and concurrent video, independent audio levels and video frequency.
- Dedicated overlay with transparency, loop and Normal/Screen/Lighten/Overlay/Add composition.
- Ordered audio playlist with reorder/removal, speed/shuffle/repeat/volume.
- Independently timed looping text, font/size/color/transparency/fade/blank gaps, voice selection and narration even when visible text is off.
- Composed canvas recording with soundtrack/main/concurrent/overlay audio where browser APIs support it.
- Offline application shell, web update check and settings JSON export/import. No media uploads. No media bytes written to IndexedDB, localStorage, Cache API or OPFS.
- File references only. Browsers with File System Access can persist handles; Safari/iPhone requires reselecting originals after a reload. Metadata matching reconnects saved items. The iOS picker itself can make temporary materializations outside app control.
- Low-power 1600px/30fps and normal 2560px/60fps tiers; 64MiB image-cache target, lazy two-at-a-time thumbnails, cancellation tokens, one-slide scheduling, no runaway frame queue.

## Explicit platform differences

Native security-scoped bookmarks, arbitrary macOS fonts/voices, native app ZIP installation, same-desktop macOS window manipulation and AVFoundation codec coverage cannot be duplicated by an iPhone website. Web equivalents use browser file permissions, supported fonts/system speech, service-worker updates and standalone/fullscreen presentation.

Browser speech audio cannot be captured into the recorder's Web Audio mix. iPhone recording format/support depends on MediaRecorder/canvas capture support. Memory-safe in-memory recording stops at 200MiB; iPhone ZIP export has a 300MiB budget. Export/downloads are intentionally created files and use storage only when requested. The website caches approximately 1.3MiB of app assets; it cannot use literally zero device space or prevent iOS picker-level temporary copies.

Offline works after a successful online installation; media must be locally downloaded, reselected and accessible. Remote iCloud placeholders require downloading through Files first. Local installed voices may work offline; network voices require connectivity. Playback pauses when the page is backgrounded to keep media and cue timers aligned.

## Validation

JavaScript syntax checks; shuffle/no-repeat/history and cue timing tests; mocked DOM integration covering mixed imports, metadata-only persistence, deduplication, playback navigation/pause, concurrent filtering, overlay/text and cleanup; static comparison to all 35 Mac settings; service-worker offline/cache-isolation tests. Browser/device playback, visual comparison, iOS permission persistence and recording are not verified in this environment. No browser preview was available.

Deploy as static files from the repository root. Both Cloudflare Pages `_headers` and Netlify `netlify.toml` limit network requests to same-origin app assets. Prior app source/assets are removed from this branch; Git history retains the previous version. Existing device-local old website copies are not silently deleted; Library → Remove old website’s stored copies deletes only the old `flashreel-online` database on explicit confirmation.
