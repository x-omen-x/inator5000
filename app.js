/* FLASHREEL // MATRIX SENTINEL CORE ENGINE — local, offline, no uploads */
const PACES = {
  hyper: { label: "Hyper", hint: "15–60ms", min: 15, max: 60 },
  blitz: { label: "Blitz", hint: "40–200ms", min: 40, max: 200 },
  fast: { label: "Fast", hint: "150–800ms", min: 150, max: 800 },
  medium: { label: "Medium", hint: "0.9–2.2s", min: 900, max: 2200 },
  slow: { label: "Slow", hint: "2.8–4.5s", min: 2800, max: 4500 },
  linger: { label: "Linger", hint: "5–9s", min: 5000, max: 9000 },
};

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "flashreel-online-settings-v4";

function defaultAlbum() {
  return `Album ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

const LEGACY_SETTINGS_KEYS = ["flashreel-online-settings-v3", "flashreel-online-settings-v2"];

function withoutLanSettings(value) {
  const settings = value && typeof value === "object" ? value : {};
  const { lanShare, lanPass, lanReceive, ...clean } = settings;
  return clean;
}

function readSettings() {
  try {
    return withoutLanSettings(
      JSON.parse(
        localStorage.getItem(SETTINGS_KEY) ||
          localStorage.getItem("flashreel-online-settings-v3") ||
          localStorage.getItem("flashreel-online-settings-v2") ||
          "{}",
      ),
    );
  } catch {
    return {};
  }
}
function writeSettings(patch) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(withoutLanSettings({ ...readSettings(), ...patch })));
    LEGACY_SETTINGS_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* quota */
  }
}

const saved = readSettings();
try {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
  LEGACY_SETTINGS_KEYS.forEach((key) => localStorage.removeItem(key));
} catch {
  /* storage unavailable */
}
const state = {
  slides: [],
  speed: saved.speed || "fast",
  shuffle: saved.shuffle ?? true,
  noRepeat: saved.noRepeat ?? false,
  crossfade: Number(saved.crossfade ?? 0.2),
  fit: saved.fit || "contain",
  zoom: saved.zoom ?? 1,
  slowPan: saved.slowPan ?? false,
  overlayUrl: null,
  overlayPreviewUrl: null,
  overlayName: null,
  overlayFile: null,
  transparency: saved.overlayTransparency ?? 35,
  overlayVolume: saved.overlayVolume ?? 40,
  overlayLoop: saved.overlayLoop ?? true,
  blend: saved.overlayBlend || "screen",
  slideVideoVolume: saved.slideVideoVolume ?? 100,
  slideVideoMuted: saved.slideVideoMuted ?? false,
  soundtrackMode: saved.soundtrackMode || "off",
  soundtrackVolume: saved.soundtrackVolume ?? 80,
  audioSpeed: Number(saved.audioSpeed) || 1,
  soundcloudUrl: saved.soundcloudUrl || "",
  tracks: [],
  trackIndex: 0,
  audioRepeat: saved.audioRepeat || "all",
  audioShuffle: saved.audioShuffle ?? false,
  rememberMedia: true,
  playing: false,
  index: 0,
  recording: false,
  skipVideos: saved.skipVideos ?? false,
  thumbPage: 0,
  thumbsPerPage: 24,
};


function isImage(file) {
  return file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|svg)$/i.test(file.name);
}
function isVideo(file) {
  return file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name);
}
function isAudio(file) {
  return file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(file.name);
}
function albumFrom(file, fallback) {
  const path = file.webkitRelativePath;
  if (path) {
    const first = path.split("/").filter(Boolean)[0];
    if (first) return first;
  }
  return fallback || "Photos";
}
function isScUrl(value) {
  try {
    const host = new URL(value.trim()).hostname.replace(/^www\./, "");
    return host === "soundcloud.com" || host === "on.soundcloud.com" || host === "snd.sc";
  } catch {
    return false;
  }
}
function scEmbed(url) {
  const params = new URLSearchParams({
    url,
    color: "00ff41",
    auto_play: "false",
    hide_related: "true",
    show_comments: "false",
    show_user: "false",
    show_reposts: "false",
    show_teaser: "false",
    visual: "false",
    buying: "false",
    sharing: "false",
    download: "false",
  });
  return `https://w.soundcloud.com/player/?${params}`;
}
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "\u0026amp;")
    .replaceAll("<", "\u0026lt;")
    .replaceAll(">", "\u0026gt;")
    .replaceAll('"', "\u0026quot;");
}
function setStatus(text) {
  $("status").textContent = text || "";
}
function safeName(name) {
  return String(name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 80);
}

function nextOrder(items) {
  return (
    items.reduce((max, item) => {
      const order = Number(item.order);
      return Number.isFinite(order) ? Math.max(max, order) : max;
    }, -1) + 1
  );
}

const DB_NAME = "flashreel-online";
const PHOTO_STORE = "photos";
const MEDIA_STORE = "media";
const HANDLE_STORE = "handles";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, rows) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    for (const row of rows) tx.objectStore(store).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function idbAll(store) {
  const db = await openDb();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows;
}
async function idbDel(store, ids) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const id of ids) os.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function idbClear(store) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function renderAlbums() {
  const counts = new Map();
  for (const slide of state.slides) {
    const rec = counts.get(slide.album) || { n: 0, pics: 0, vids: 0 };
    rec.n += 1;
    if (slide.kind === "video") rec.vids += 1;
    else rec.pics += 1;
    counts.set(slide.album, rec);
  }
  $("album-list").innerHTML = [...counts.entries()]
    .map(([name, rec]) => {
      const bits = [];
      if (rec.pics) bits.push(`${rec.pics} photo${rec.pics === 1 ? "" : "s"}`);
      if (rec.vids) bits.push(`${rec.vids} video${rec.vids === 1 ? "" : "s"}`);
      return `<li><div><p>${escapeHtml(name)}</p><small>${bits.join(" · ")}</small></div>
        <div class="row" style="margin:0">
          <button type="button" class="btn ghost sm" data-zip-album="${escapeHtml(name)}" title="Download this album">⬇</button>
          <button type="button" class="btn ghost sm" data-remove-album="${escapeHtml(name)}">Remove</button>
        </div></li>`;
    })
    .join("");
}

function renderThumbs() {
  const sec = $("reel-sec");
  if (!state.slides.length) {
    sec.classList.add("hid");
    return;
  }
  if ($("player").classList.contains("on")) return;
  sec.classList.remove("hid");
  const total = state.slides.length;
  const per = state.thumbsPerPage || 24;
  const pages = Math.max(1, Math.ceil(total / per));
  if (state.thumbPage >= pages) state.thumbPage = pages - 1;
  if (state.thumbPage < 0) state.thumbPage = 0;
  const start = state.thumbPage * per;
  const pageSlides = state.slides.slice(start, start + per);
  $("reel-title").textContent = `Reel · ${total}`;
  $("thumbs").innerHTML = pageSlides
    .map((s) =>
      s.kind === "video"
        ? `<div class="thumb vid"><span>▶</span><span class="vid-badge">VID</span><button type="button" data-remove="${s.id}" aria-label="Remove">✕</button></div>`
        : `<div class="thumb"><img src="${s.url}" alt=""><button type="button" data-remove="${s.id}" aria-label="Remove">✕</button></div>`,
    )
    .join("");
  let pager = $("thumb-pager");
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "thumb-pager";
    pager.className = "row";
    pager.style.cssText = "margin-top:10px;display:flex;gap:10px;align-items:center;justify-content:center;";
    const thumbsEl = $("thumbs");
    if (thumbsEl && thumbsEl.parentNode) thumbsEl.parentNode.appendChild(pager);
  }
  if (pager) {
    pager.innerHTML = `
      <button type="button" class="btn sm outline" id="thumb-prev" ${state.thumbPage <= 0 ? "disabled" : ""}>Prev</button>
      <span style="color:var(--muted);font-size:0.9rem;min-width:80px;text-align:center">Page ${state.thumbPage + 1} / ${pages}</span>
      <button type="button" class="btn sm outline" id="thumb-next" ${state.thumbPage >= pages - 1 ? "disabled" : ""}>Next</button>
    `;
    const prev = $("thumb-prev");
    const next = $("thumb-next");
    if (prev) prev.onclick = () => { state.thumbPage--; renderThumbs(); };
    if (next) next.onclick = () => { state.thumbPage++; renderThumbs(); };
  }
}



function repeatSymbol() {
  return state.audioRepeat === "one" ? "🔂" : state.audioRepeat === "off" ? "⇥" : "🔁";
}

function repeatLabel(prefix = "Playlist") {
  const mode = state.audioRepeat === "one" ? "one track" : state.audioRepeat === "off" ? "off" : "all tracks";
  return `${prefix} repeat: ${mode}`;
}

function renderTracks() {
  $("track-list").innerHTML = state.tracks
    .map(
      (t, i) =>
        `<li class="${i === state.trackIndex ? "on" : ""}"><span class="t-name">${i === state.trackIndex ? "▶ " : ""}${escapeHtml(t.name)}</span><button type="button" class="btn ghost sm" data-remove-track="${t.id}">✕</button></li>`,
    )
    .join("");
}

function renderSetup() {
  $("photo-count").textContent = String(state.slides.length);
  $("overlay-flag").textContent = state.overlayUrl ? "ON" : "OFF";
  $("sound-flag").textContent =
    state.soundtrackMode === "off" ? "OFF" : state.soundtrackMode === "local" ? `${state.tracks.length} TRK` : "SC";

  const hasSlides = state.slides.length > 0;
  $("play-btn").disabled = !hasSlides;
  $("record-btn").disabled = !hasSlides;
  $("hud-record").disabled = !hasSlides;
  $("dock-copy").textContent = state.slides.length
    ? `${state.slides.length} item${state.slides.length === 1 ? "" : "s"} ready`
    : "Add photos or videos to start";

  $("clear-video").classList.toggle("hid", !state.overlayUrl);
  $("video-drop").classList.toggle("hid", !!state.overlayUrl);
  $("video-preview-wrap").classList.toggle("hid", !state.overlayUrl);
  if (state.overlayUrl) {
    const v = $("video-preview");
    if (v.src !== state.overlayPreviewUrl) {
      v.src = state.overlayPreviewUrl;
      v.load();
    }
    v.loop = true;
    v.muted = true;
    const playPreview = () => v.play().catch(() => undefined);
    if (v.readyState >= 2) playPreview();
    else v.addEventListener("canplay", playPreview, { once: true });
    v.style.opacity = String(1 - state.transparency / 100);
    v.style.mixBlendMode = state.blend;
    $("video-name").textContent = state.overlayName || "";
  }

  $("sound-modes").classList.toggle("hid", !state.soundcloudUrl && !state.tracks.length);
  $("use-sc").classList.toggle("hid", !state.soundcloudUrl);
  $("use-local").classList.toggle("hid", !state.tracks.length);
  $("use-sc").className = `btn sm ${state.soundtrackMode === "soundcloud" ? "" : "outline"}`;
  $("use-local").className = `btn sm ${state.soundtrackMode === "local" ? "" : "outline"}`;
  $("sc-label").textContent = state.soundcloudUrl || "";

  $("tr-val").textContent = String(state.transparency);
  $("ov-val").textContent = String(state.overlayVolume);
  $("st-val").textContent = String(state.soundtrackVolume);
  $("audio-speed-val").textContent = `${Number(state.audioSpeed).toFixed(2)}×`;
  $("zoom-val").textContent = Number(state.zoom).toFixed(1);
  $("fade-val").textContent = Number(state.crossfade).toFixed(2);
  $("main-slide-video-volume-value").textContent = String(Math.round(state.slideVideoVolume));

  $("shuffle").checked = state.shuffle;
  $("no-repeat").checked = state.noRepeat;
  $("overlay-loop").checked = state.overlayLoop;
  $("transparency").value = state.transparency;
  $("overlay-vol").value = state.overlayVolume;
  $("sound-vol").value = state.soundtrackVolume;
  $("audio-speed").value = state.audioSpeed;
  $("zoom").value = state.zoom;
  $("crossfade").value = state.crossfade;
  $("main-slide-video-volume").value = state.slideVideoVolume;

  applyCrossfade();

  const repeatButton = $("audio-repeat-btn");
  repeatButton.textContent = repeatSymbol();
  repeatButton.className = `btn sm icon-mark ${state.audioRepeat === "off" ? "outline" : ""}`;
  repeatButton.setAttribute("aria-label", repeatLabel());
  repeatButton.setAttribute("aria-pressed", String(state.audioRepeat !== "off"));
  $("audio-shuffle-btn").className = `btn sm icon-mark ${state.audioShuffle ? "" : "outline"}`;
  $("audio-shuffle-btn").setAttribute("aria-pressed", String(state.audioShuffle));
  $("hud-photo-shuffle").classList.toggle("outline", !state.shuffle);
  $("hud-photo-shuffle").setAttribute("aria-pressed", String(state.shuffle));
  const skipVid = $("skip-video-btn");
  if (skipVid) {
    const onVid = state.playing && state.slides[state.index]?.kind === "video";
    skipVid.disabled = !onVid;
    skipVid.classList.toggle("outline", !onVid);
  }
  const noRepHud = $("hud-no-repeat");
  if (noRepHud) {
    noRepHud.classList.toggle("outline", !state.noRepeat);
    noRepHud.setAttribute("aria-pressed", String(state.noRepeat));
  }
  const hudAudioRepeat = $("hud-audio-repeat");
  if (hudAudioRepeat) {
    hudAudioRepeat.textContent = "Repeat";
    hudAudioRepeat.classList.toggle("outline", state.audioRepeat === "off");
    hudAudioRepeat.setAttribute("aria-label", repeatLabel("Soundtrack"));
    hudAudioRepeat.setAttribute("aria-pressed", String(state.audioRepeat !== "off"));
  }
  const hudAudioShuffle = $("hud-audio-shuffle");
  if (hudAudioShuffle) {
    hudAudioShuffle.textContent = "Audio shuffle";
    hudAudioShuffle.classList.toggle("outline", !state.audioShuffle);
    hudAudioShuffle.setAttribute("aria-pressed", String(state.audioShuffle));
  }

  $("fit-contain").className = `btn sm ${state.fit === "contain" ? "" : "outline"}`;
  $("fit-contain").setAttribute("aria-pressed", String(state.fit === "contain"));
  $("fit-cover").className = `btn sm ${state.fit === "cover" ? "" : "outline"}`;
  $("fit-cover").setAttribute("aria-pressed", String(state.fit === "cover"));
  if ($("slow-pan")) $("slow-pan").checked = !!state.slowPan;
  if ($("hud-slow-pan")) {
    $("hud-slow-pan").classList.toggle("outline", !state.slowPan);
    $("hud-slow-pan").setAttribute("aria-pressed", String(state.slowPan));
  }

  document.querySelectorAll("#audio-speed-presets [data-aspeed]").forEach((btn) => {
    const selected = Math.abs(Number(btn.dataset.aspeed) - Number(state.audioSpeed)) < 0.01;
    btn.className = `btn sm ${selected ? "" : "outline"}`;
    btn.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("#blends [data-blend]").forEach((btn) => {
    const selected = btn.dataset.blend === state.blend;
    btn.className = `btn sm ${selected ? "" : "outline"}`;
    btn.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("#paces .pace").forEach((btn) => {
    const selected = btn.dataset.speed === state.speed;
    btn.classList.toggle("on", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });

  renderAlbums();
  renderThumbs();
  renderTracks();
}

// iOS has a much tighter hardware-decoder budget than desktop browsers. The
// setup preview and slideshow overlay used to decode the same local Blob in
// parallel even though the preview was hidden. Releasing the hidden preview is
// important: merely pausing it can leave its decoder allocated in WebKit.
function releaseOverlayPreview() {
  const preview = $("video-preview");
  if (!preview) return;
  preview.pause();
  preview.removeAttribute("src");
  preview.load();
}

async function persistSlide(row) {
  try {
    await idbPut(PHOTO_STORE, [row]);
  } catch {
    setStatus("Browser storage full — some files may not stay after reload.");
  }
}

function tagRelativePath(file, rel) {
  if (!rel) return file;
  try {
    Object.defineProperty(file, "webkitRelativePath", { value: rel, configurable: true });
  } catch {
    try {
      file.webkitRelativePath = rel;
    } catch {
      /* ignore */
    }
  }
  return file;
}

async function readAllDirectoryEntries(dirEntry) {
  const reader = dirEntry.createReader();
  const out = [];
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    out.push(...batch);
  }
  return out;
}

async function collectEntry(entry, pathPrefix, files) {
  if (!entry) return;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const rel = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
    tagRelativePath(file, rel);
    if (isImage(file) || isVideo(file)) files.push(file);
    return;
  }
  if (entry.isDirectory) {
    const prefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
    const kids = await readAllDirectoryEntries(entry);
    for (const kid of kids) await collectEntry(kid, prefix, files);
  }
}

async function filesFromDataTransfer(dt) {
  const files = [];
  const items = dt?.items;
  if (items && items.length) {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const entry = item.webkitGetAsEntry?.() || item.getAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length) {
      for (const entry of entries) await collectEntry(entry, "", files);
      if (files.length) return files;
    }
  }
  return [...(dt?.files || [])].filter((f) => isImage(f) || isVideo(f));
}

async function walkDirectoryHandle(handle, pathPrefix, files) {
  for await (const entry of handle.values()) {
    if (entry.kind === "file") {
      const file = await entry.getFile();
      const rel = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
      tagRelativePath(file, rel);
      if (isImage(file) || isVideo(file)) files.push(file);
    } else if (entry.kind === "directory") {
      const next = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      await walkDirectoryHandle(entry, next, files);
    }
  }
}

async function importFiles(files, namedAlbum) {
  const media = [...files].filter((f) => isImage(f) || isVideo(f));
  if (!media.length) {
    setStatus("No images or videos in that selection.");
    return;
  }
  const pending = [];
  const total = media.length;
  setStatus(`Adding ${total}…`);
  for (let i = 0; i < media.length; i++) {
    const file = media[i];
    const id = crypto.randomUUID();
    const album = albumFrom(file, namedAlbum || defaultAlbum());
    const kind = isVideo(file) ? "video" : "image";
    const url = URL.createObjectURL(file);
    const order = nextOrder(state.slides);
    const row = {
      id,
      name: file.name,
      type: file.type || (kind === "video" ? "video/mp4" : "image/jpeg"),
      blob: file,
      album,
      kind,
      order,
      createdAt: Date.now(),
    };
    pending.push(row);
    state.slides.push({ id, url, album, alt: file.name, kind, file, order });
    if (i === 0 || (i + 1) % 24 === 0 || i === media.length - 1) {
      setStatus(`Adding ${i + 1} / ${total}…`);
      renderSetup();
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  resetShuffleBag();
  $("album-name").value = defaultAlbum();
  renderSetup();
  prefetchAround(state.index);
  setStatus(`Added ${total} item${total === 1 ? "" : "s"} · saving in this browser…`);
  try {
    for (let i = 0; i < pending.length; i += 20) {
      await idbPut(PHOTO_STORE, pending.slice(i, i + 20));
    }
    setStatus(`Added ${total} item${total === 1 ? "" : "s"} · saved in this browser only (offline, private)`);
  } catch {
    setStatus(`Added ${total} · some may not stay after reload (storage full)`);
  }
}

async function importOverlay(file) {
  if (!file) return;
  if (!isVideo(file)) {
    setStatus("That file is not a video.");
    return;
  }
  try {
    await idbPut(MEDIA_STORE, [{ id: "overlay-video", name: file.name, type: file.type, blob: file }]);
  } catch {
    setStatus("Overlay will play this session only — storage full.");
  }
  if (state.overlayUrl) URL.revokeObjectURL(state.overlayUrl);
  if (state.overlayPreviewUrl) URL.revokeObjectURL(state.overlayPreviewUrl);
  state.overlayUrl = URL.createObjectURL(file);
  state.overlayPreviewUrl = URL.createObjectURL(file);
  state.overlayName = file.name;
  state.overlayFile = file;
  setStatus(`Overlay locked · ${file.name}`);
  renderSetup();
}

async function importAudioFiles(fileList) {
  const files = [...fileList].filter(isAudio);
  if (!files.length) {
    setStatus("That file is not audio.");
    return;
  }
  let storageFailures = 0;
  for (const file of files) {
    const id = crypto.randomUUID();
    const storageId = `local-audio-${id}`;
    const order = nextOrder(state.tracks);
    const url = URL.createObjectURL(file);
    state.tracks.push({ id, storageId, url, name: file.name, file, order });
    try {
      await idbPut(MEDIA_STORE, [
        {
          id: storageId,
          trackId: id,
          name: file.name,
          type: file.type,
          blob: file,
          order,
          createdAt: Date.now(),
        },
      ]);
    } catch {
      storageFailures += 1;
    }
  }
  if (state.tracks.length > 1) state.audioRepeat = "all";
  state.soundtrackMode = "local";
  writeSettings({ soundtrackMode: "local", audioRepeat: state.audioRepeat });
  if (storageFailures) {
    setStatus(
      `Added ${files.length} track${files.length === 1 ? "" : "s"}, but ${storageFailures} could not be saved for reload. Free browser storage and try again.`,
    );
  } else {
    setStatus(`${state.tracks.length} local track${state.tracks.length === 1 ? "" : "s"} · saved in this browser`);
  }
  renderSetup();
}

function applySoundCloud() {
  const url = $("sc-url").value.trim();
  if (!url) {
    state.soundcloudUrl = "";
    state.soundtrackMode = state.tracks.length ? "local" : "off";
    writeSettings({ soundcloudUrl: "", soundtrackMode: state.soundtrackMode });
    setStatus("SoundCloud link cleared.");
    renderSetup();
    return;
  }
  if (!isScUrl(url)) {
    setStatus("Paste a soundcloud.com track or playlist URL.");
    return;
  }
  state.soundcloudUrl = url;
  state.soundtrackMode = "soundcloud";
  writeSettings({ soundcloudUrl: url, soundtrackMode: "soundcloud" });
  setStatus("SoundCloud signal armed.");
  renderSetup();
}

function cycleAudioRepeat() {
  state.audioRepeat = state.audioRepeat === "all" ? "one" : state.audioRepeat === "one" ? "off" : "all";
  writeSettings({ audioRepeat: state.audioRepeat });
  const audio = $("local-audio");
  audio.loop = state.audioRepeat === "one" || (state.audioRepeat === "all" && state.tracks.length <= 1);
  renderSetup();
  bumpChrome();
}

function toggleAudioShuffle() {
  state.audioShuffle = !state.audioShuffle;
  writeSettings({ audioShuffle: state.audioShuffle });
  renderSetup();
  bumpChrome();
}

function togglePhotoShuffle() {
  state.shuffle = !state.shuffle;
  writeSettings({ shuffle: state.shuffle });
  if ($("shuffle")) $("shuffle").checked = state.shuffle;
  resetShuffleBag();
  renderSetup();
  bumpChrome();
}

function setSlowPan(on) {
  state.slowPan = Boolean(on);
  writeSettings({ slowPan: state.slowPan });
  applyFit(visibleStill());
  applyFit($("slide-vid"));
  renderSetup();
  bumpChrome();
}

let playRaf = 0;
let nextAt = 0;
let hideTimer = 0;
let scWidget = null;
let pipStream = null;
let pipFrame = 0;
let pipNativeTarget = null;
let videoHold = false;
let frontStill = "a";
const decoded = new Map();
let rainPaused = false;
let shuffleBag = [];
let shuffleBagLen = -1;
let prefetching = false;

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function applyCrossfade() {
  const ms = Math.max(0, Number(state.crossfade) || 0) * 1000;
  $("player").style.setProperty("--fade-ms", `${ms}ms`);
}

function resetShuffleBag() {
  shuffleBag = [];
  shuffleBagLen = -1;
}

// Bag holds slide *indices*, shuffled once per pass. Rebuilt whenever the
// library size changes, so picking the next slide stays O(1) instead of
// rescanning every slide on every advance.
function refillShuffleBag(excludeIndex) {
  const total = state.slides.length;
  const indices = [];
  for (let i = 0; i < total; i++) {
    if (i !== excludeIndex) indices.push(i);
  }
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  shuffleBag = indices;
  shuffleBagLen = total;
}

function pickShuffledIndex() {
  const total = state.slides.length;
  if (state.noRepeat && total > 1) {
    if (shuffleBagLen !== total) resetShuffleBag();
    if (!shuffleBag.length) refillShuffleBag(state.index);
    let next = shuffleBag.pop();
    if (next === state.index && shuffleBag.length) next = shuffleBag.pop();
    if (typeof next !== "number" || next < 0 || next >= total) {
      next = Math.floor(Math.random() * total);
    }
    return next;
  }
  let next = state.index;
  while (next === state.index) next = Math.floor(Math.random() * total);
  return next;
}

function rememberDecode(id) {
  decoded.set(id, true);
  if (decoded.size > 48) {
    const first = decoded.keys().next().value;
    decoded.delete(first);
  }
}

function randomPace() {
  const pace = PACES[state.speed] || PACES.fast;
  return pace.min + Math.random() * (pace.max - pace.min);
}

function visibleStill() {
  return frontStill === "a" ? $("still-a") : $("still-b");
}
function hiddenStill() {
  return frontStill === "a" ? $("still-b") : $("still-a");
}

// In shuffle + no-repeat mode the next slides are the tail of the bag, not the
// following array entries, so warm those instead of decoding images we will
// never show.
function upcomingIndices(index, count) {
  const total = state.slides.length;
  const out = [];
  if (!total) return out;
  if (state.shuffle && state.noRepeat && shuffleBag.length) {
    for (let i = shuffleBag.length - 1; i >= 0 && out.length < count; i--) {
      const next = shuffleBag[i];
      if (next >= 0 && next < total) out.push(next);
    }
    return out;
  }
  for (let i = 0; i < count && i < total; i++) out.push((index + i) % total);
  return out;
}

async function prefetchAround(index) {
  if (!state.slides.length || prefetching) return;
  prefetching = true;
  const fast = state.speed === "hyper" || state.speed === "blitz";
  // Mobile Safari decodes on the main thread and starves the audio graph when
  // too many decodes are in flight, so keep the queue short there.
  const ahead = IS_IOS ? (fast ? 2 : 4) : fast ? 3 : 8;
  const lane = IS_IOS ? 1 : 4;
  try {
    const targets = upcomingIndices(index, ahead)
      .map((i) => state.slides[i])
      .filter((slide) => slide && slide.kind === "image" && !decoded.has(slide.id));
    for (let i = 0; i < targets.length; i += lane) {
      await Promise.all(
        targets.slice(i, i + lane).map(async (slide) => {
          try {
            const img = new Image();
            img.src = slide.url;
            await img.decode();
            rememberDecode(slide.id);
          } catch {
            /* skip */
          }
        }),
      );
    }
  } finally {
    prefetching = false;
  }
}

function applyFit(el) {
  if (!el) return;
  el.style.objectFit = state.fit;
  el.style.transform = `scale(${state.zoom})`;
  const isStill = el.classList && el.classList.contains("slide-still");
  el.classList.remove("pan-1", "pan-2", "pan-3", "pan-4");
  if (state.slowPan && isStill && el.id !== "still") {
    const n = (state.index % 4) + 1;
    el.classList.add(`pan-${n}`);
  }
}

function hideSlideLayers() {
  $("still-a").classList.remove("on");
  $("still-b").classList.remove("on");
  unloadVideo();
}

function unloadVideo() {
  const vid = $("slide-vid");
  vid.onended = null;
  vid.pause();
  vid.classList.remove("on");
  if (vid.src) {
    vid.removeAttribute("src");
    vid.load();
  }
}

function showImageSlide(slide) {
  videoHold = false;
  unloadVideo();
  const back = hiddenStill();
  const front = visibleStill();
  applyFit(back);
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    back.classList.add("on");
    front.classList.remove("on");
    frontStill = back === $("still-a") ? "a" : "b";
  };
  if (back.src === slide.url) {
    swap();
    return;
  }
  back.onload = () => {
    back.onload = null;
    swap();
  };
  back.src = slide.url;
  back.decode?.().then(swap).catch(() => {});
}

function showVideoSlide(slide) {
  $("still-a").classList.remove("on");
  $("still-b").classList.remove("on");
  videoHold = true;
  const vid = $("slide-vid");
  vid.onended = null;
  applyFit(vid);
  if (vid.src !== slide.url) vid.src = slide.url;
  vid.loop = false;
  vid.playbackRate = 1;
  syncSlideVideoAudio();
  vid.classList.add("on");
  vid.onended = () => {
    videoHold = false;
    vid.onended = null;
    if (state.playing) {
      step(1);
      nextAt = performance.now() + 16;
    }
  };
  vid.play().catch(() => {
    videoHold = false;
  });
}

function showSlide() {
  const slide = state.slides[state.index];
  if (!slide) return;
  if (slide.kind === "video") showVideoSlide(slide);
  else showImageSlide(slide);
  prefetchAround(state.index);
  const skipVid = $("skip-video-btn");
  if (skipVid) {
    skipVid.disabled = slide.kind !== "video";
    skipVid.classList.toggle("outline", slide.kind !== "video");
  }
  // Only touch the video-audio controls when a video is (or just was) on screen.
  if (slide.kind === "video" || !$("slide-video-audio").classList.contains("hid")) syncSlideVideoAudio();
  // Re-parsing the meta line every advance is wasted work while the chrome is
  // hidden; bumpChrome refreshes it when the controls come back.
  if (!$("pctl").classList.contains("off")) updatePlayMeta();
}

function updatePlayMeta() {
  const slide = state.slides[state.index];
  if (!slide) return;
  const speedTag = state.audioSpeed !== 1 ? ` (${Number(state.audioSpeed).toFixed(2)}×)` : "";
  const now =
    state.soundtrackMode === "local"
      ? `${state.tracks[state.trackIndex]?.name || "Local Audio"}${speedTag}`
      : state.soundtrackMode === "soundcloud"
        ? "SoundCloud"
        : "";
  const kind = slide.kind === "video" ? "vid" : "still";
  $("play-meta").innerHTML = `<span>${state.index + 1} <span style="color:var(--subtle)">/ ${state.slides.length}</span></span> · ${escapeHtml(slide.album)} · ${kind}${now ? ` · <span style="color:#7cff7c">${escapeHtml(now)}</span>` : ""}`;
}

function step(delta) {
  if (!state.slides.length) return;
  let tries = 0;
  do {
    if (state.shuffle && delta === 1 && state.slides.length > 1) {
      state.index = pickShuffledIndex();
    } else {
      state.index = (state.index + delta + state.slides.length) % state.slides.length;
    }
    tries++;
  } while (state.skipVideos && state.slides[state.index]?.kind === "video" && tries < state.slides.length);
  showSlide();
}


function skipVideo() {
  const slide = state.slides[state.index];
  if (!slide || slide.kind !== "video") return;
  videoHold = false;
  unloadVideo();
  step(1);
  nextAt = performance.now() + randomPace();
  bumpChrome();
}

function bumpChrome() {
  updatePlayMeta();
  $("shade").classList.remove("off");
  $("phud").classList.remove("off");
  $("pctl").classList.remove("off");
  $("sc-frame").classList.toggle("hid", !(state.soundtrackMode === "soundcloud" && state.soundcloudUrl));
  $("sc-frame").classList.toggle("off", false);
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    $("shade").classList.add("off");
    $("phud").classList.add("off");
    $("pctl").classList.add("off");
    $("sc-frame").classList.add("off");
  }, 2200);
}

function currentTrack() {
  return state.tracks[state.trackIndex] || null;
}

// iOS ignores HTMLMediaElement.volume and does not reliably honour .muted on an
// element that is routed through a MediaElementAudioSourceNode, so the Web Audio
// gain node is the single source of truth for level once the graph exists.
function setMixVolume(el, level, muted) {
  if (!el) return;
  const wanted = muted ? 0 : Math.min(1, Math.max(0, Number(level) || 0));
  const gain = el._mixGain;
  if (gain && audioCtx) {
    const target = wanted * (el._mixBase ?? 1);
    try {
      const now = audioCtx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(target, now, 0.02);
    } catch {
      gain.gain.value = target;
    }
    // level lives in the graph; keep the element itself out of the equation
    try {
      el.volume = 1;
    } catch {
      /* read-only on iOS */
    }
  } else {
    try {
      el.volume = wanted;
    } catch {
      /* read-only on iOS */
    }
  }
  el.muted = muted || wanted === 0;
}

function applyMixVolumes() {
  setMixVolume($("overlay-vid"), state.overlayVolume / 100, state.overlayVolume === 0);
  setMixVolume($("local-audio"), state.soundtrackVolume / 100, state.soundtrackVolume === 0);
  syncSlideVideoAudio();
}

function syncSlideVideoAudio() {
  const video = $("slide-vid");
  const controls = $("slide-video-audio");
  const slider = $("slide-video-volume");
  const output = $("slide-video-volume-value");
  const muteButton = $("slide-video-mute");
  const onVideo = $("player").classList.contains("on") && state.slides[state.index]?.kind === "video";
  const musicOn = state.soundtrackMode !== "off" && (state.tracks.length || state.soundcloudUrl);
  const mixLevel = musicOn ? 0.32 : 1;
  const volume = Math.min(100, Math.max(0, Number(state.slideVideoVolume)));

  setMixVolume(video, (volume / 100) * mixLevel, state.slideVideoMuted || volume === 0);
  controls?.classList.toggle("hid", !onVideo);
  if (slider) slider.value = String(volume);
  if (output) output.textContent = `${Math.round(volume)}%`;
  if (muteButton) {
    muteButton.textContent = video.muted ? "Unmute" : "Mute";
    muteButton.setAttribute("aria-pressed", String(video.muted));
  }
}

function loadCurrentTrack() {
  const audio = $("local-audio");
  const t = currentTrack();
  if (!t) return;
  audio.preload = "auto";
  if (audio.src !== t.url) audio.src = t.url;
  audio.loop = state.audioRepeat === "one" || (state.audioRepeat === "all" && state.tracks.length <= 1);
  setMixVolume(audio, state.soundtrackVolume / 100, state.soundtrackVolume === 0);
  const rate = Number(state.audioSpeed || 1);
  if (audio.playbackRate !== rate) audio.playbackRate = rate;
}

function nextTrack() {
  if (!state.tracks.length) return;
  if (state.audioRepeat === "one") {
    $("local-audio").currentTime = 0;
    $("local-audio").play().catch(() => undefined);
    return;
  }
  if (state.audioRepeat === "off") return;
  if (state.audioShuffle && state.tracks.length > 1) {
    let n = state.trackIndex;
    while (n === state.trackIndex) n = Math.floor(Math.random() * state.tracks.length);
    state.trackIndex = n;
  } else {
    state.trackIndex = (state.trackIndex + 1) % state.tracks.length;
  }
  loadCurrentTrack();
  if (state.playing) $("local-audio").play().catch(() => undefined);
  renderTracks();
}

$("local-audio").addEventListener("ended", nextTrack);

let overlayPlayToken = 0;

function playOverlayWhenReady(video) {
  const token = ++overlayPlayToken;
  const attempt = () => {
    if (token !== overlayPlayToken || !overlayShouldPlay()) return;
    video.play().catch(() => undefined);
    // WebKit can reject or silently park a local-Blob overlay without emitting
    // `stalled`; the progress watcher provides the same bounded retry path.
    startOverlayWatchdog();
  };
  if (video.readyState >= 2) attempt();
  else video.addEventListener("canplay", attempt, { once: true });
}

function syncMedia() {
  const video = $("overlay-vid");
  if (state.overlayUrl) {
    if (video.src !== state.overlayUrl) {
      video.src = state.overlayUrl;
      video.load();
    }
    video.loop = state.overlayLoop;
    setMixVolume(video, state.overlayVolume / 100, state.overlayVolume === 0);
    video.style.opacity = String(1 - state.transparency / 100);
    video.style.mixBlendMode = state.blend;
    video.style.display = "block";
    if (state.playing) {
      if (video.ended && state.overlayLoop) {
        try { video.currentTime = 0; } catch { /* metadata is still loading */ }
      }
      playOverlayWhenReady(video);
    } else video.pause();
  } else {
    overlayPlayToken++;
    video.removeAttribute("src");
    video.load();
    video.style.display = "none";
  }

  const audio = $("local-audio");
  if (state.soundtrackMode === "local" && state.tracks.length) {
    loadCurrentTrack();
    if (state.playing) audio.play().catch(() => undefined);
    else audio.pause();
  } else {
    audio.pause();
  }

  const frame = $("sc-frame");
  if (state.soundtrackMode === "soundcloud" && state.soundcloudUrl) {
    const src = scEmbed(state.soundcloudUrl);
    if (frame.dataset.url !== state.soundcloudUrl) {
      frame.src = src;
      frame.dataset.url = state.soundcloudUrl;
      scWidget = null;
      loadSc()
        .then((api) => {
          scWidget = api.Widget(frame);
          scWidget.bind(api.Widget.Events.READY, () => {
            scWidget.setVolume(state.soundtrackVolume);
            if (state.playing) scWidget.play();
          });
        })
        .catch(() => undefined);
    } else {
      scWidget?.setVolume(state.soundtrackVolume);
      if (state.playing) scWidget?.play();
      else scWidget?.pause();
    }
  } else {
    scWidget?.pause();
    frame.classList.add("hid");
  }
  syncSlideVideoAudio();
}

let overlayRecoveryTimer = 0;
let overlayWatchTimer = 0;
let overlayWatchTime = -1;
let overlayWatchMisses = 0;

function overlayShouldPlay() {
  return Boolean(state.playing && state.overlayUrl && $("player").classList.contains("on") && !document.hidden);
}

function stopOverlayWatchdog() {
  window.clearTimeout(overlayWatchTimer);
  overlayWatchTimer = 0;
  overlayWatchTime = -1;
  overlayWatchMisses = 0;
}

function watchOverlayProgress() {
  overlayWatchTimer = 0;
  if (!overlayShouldPlay()) {
    stopOverlayWatchdog();
    return;
  }
  const video = $("overlay-vid");
  if (video.ended && !state.overlayLoop) {
    stopOverlayWatchdog();
    return;
  }
  const now = video.currentTime;
  const shouldHaveFrames = !video.ended || state.overlayLoop;
  const stopped = shouldHaveFrames && (video.paused ||
    (video.readyState >= 2 && overlayWatchTime >= 0 && Math.abs(now - overlayWatchTime) < 0.04));
  overlayWatchMisses = stopped ? overlayWatchMisses + 1 : 0;
  if (overlayWatchMisses >= 2) {
    video.pause();
    if (video.ended && state.overlayLoop) {
      try { video.currentTime = 0; } catch { /* metadata is still loading */ }
    } else if (video.readyState >= 2) {
      const duration = video.duration;
      const restartAt = Number.isFinite(duration) && now + 0.06 >= duration
        ? (state.overlayLoop ? 0 : Math.max(0, duration - 0.06))
        : now + 0.06;
      try { video.currentTime = restartAt; } catch { /* metadata is still loading */ }
    }
    video.play().catch(() => undefined);
    overlayWatchMisses = 0;
  }
  overlayWatchTime = video.currentTime;
  overlayWatchTimer = window.setTimeout(watchOverlayProgress, 1250);
}

function startOverlayWatchdog() {
  if (overlayWatchTimer || !overlayShouldPlay()) return;
  overlayWatchTime = $("overlay-vid").currentTime;
  overlayWatchMisses = 0;
  overlayWatchTimer = window.setTimeout(watchOverlayProgress, 1250);
}

function scheduleOverlayRecovery() {
  window.clearTimeout(overlayRecoveryTimer);
  const video = $("overlay-vid");
  const stalledAt = video.currentTime;
  overlayRecoveryTimer = window.setTimeout(() => {
    if (!overlayShouldPlay()) return;
    // Ignore normal buffering events that resolved on their own. If WebKit is
    // still parked on the same frame, retry playback without allocating a
    // second media element or Blob URL.
    if (!video.ended && Math.abs(video.currentTime - stalledAt) > 0.04) return;
    if (video.ended && state.overlayLoop) {
      try { video.currentTime = 0; } catch { /* metadata is still loading */ }
    }
    playOverlayWhenReady(video);
  }, 900);
}

const overlayVideo = $("overlay-vid");
overlayVideo.addEventListener("ended", () => {
  if (!state.overlayLoop || !overlayShouldPlay()) return;
  try { overlayVideo.currentTime = 0; } catch { /* metadata is still loading */ }
  playOverlayWhenReady(overlayVideo);
});
overlayVideo.addEventListener("stalled", scheduleOverlayRecovery);
overlayVideo.addEventListener("waiting", scheduleOverlayRecovery);
overlayVideo.addEventListener("playing", () => {
  window.clearTimeout(overlayRecoveryTimer);
  startOverlayWatchdog();
});
overlayVideo.addEventListener("pause", () => {
  if (!overlayShouldPlay()) stopOverlayWatchdog();
});

function loadSc() {
  if (window.SC?.Widget) return Promise.resolve(window.SC);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://w.soundcloud.com/player/api.js";
    s.onload = () => resolve(window.SC);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function startSlideLoop() {
  cancelAnimationFrame(playRaf);
  if (!state.playing) return;
  nextAt = performance.now() + randomPace();
  const tick = (ts) => {
    if (!state.playing) return;
    playRaf = requestAnimationFrame(tick);
    if (videoHold) return;
    if (ts >= nextAt) {
      step(1);
      nextAt = ts + randomPace();
    }
  };
  playRaf = requestAnimationFrame(tick);
}

function enterPlayer() {
  if (!state.slides.length) return;
  state.index = 0;
  state.playing = true;
  rainPaused = true;
  resetShuffleBag();
  applyCrossfade();
  $("setup").classList.add("hid");
  $("player").classList.add("on");
  setPipButtonLabel("Picture in Picture");
  $("toggle-btn").textContent = "Pause";
  $("toggle-btn").setAttribute("aria-label", "Pause");
  $("toggle-btn").setAttribute("aria-pressed", "true");
  releaseOverlayPreview();
  ensureAudioGraph();
  showSlide();
  syncMedia();
  startSlideLoop();
  bumpChrome();
}

function exitPlayer() {
  if (state.recording) stopRecording();
  document.exitPictureInPicture?.().catch?.(() => undefined);
  try {
    if (pipNativeTarget?.webkitPresentationMode === "picture-in-picture") {
      pipNativeTarget.webkitSetPresentationMode("inline");
    }
  } catch {
    /* PiP was already closed by the browser. */
  }
  pipNativeTarget = null;
  stopPipRenderer();
  state.playing = false;
  rainPaused = false;
  window.dispatchEvent(new Event("flashreel:rain"));
  videoHold = false;
  cancelAnimationFrame(playRaf);
  unloadVideo();
  $("overlay-vid").pause();
  $("local-audio").pause();
  scWidget?.pause();
  $("player").classList.remove("on");
  setPipButtonLabel("Picture in Picture");
  $("setup").classList.remove("hid");
  syncSlideVideoAudio();
  renderSetup();
}

function togglePlay() {
  state.playing = !state.playing;
  $("toggle-btn").textContent = state.playing ? "Pause" : "Play";
  $("toggle-btn").setAttribute("aria-label", state.playing ? "Pause" : "Play");
  $("toggle-btn").setAttribute("aria-pressed", String(state.playing));
  if (state.playing) ensureAudioGraph();
  syncMedia();
  if (state.playing) {
    if (state.slides[state.index]?.kind === "video") $("slide-vid").play().catch(() => undefined);
    startSlideLoop();
  }
  else {
    cancelAnimationFrame(playRaf);
    $("slide-vid").pause();
  }
  bumpChrome();
}

function drawPipSource(ctx, source, fit, zoom = 1) {
  const sourceWidth = source.videoWidth || source.naturalWidth;
  const sourceHeight = source.videoHeight || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) return;
  const canvas = ctx.canvas;
  const scale =
    fit === "cover"
      ? Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight)
      : Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const width = sourceWidth * scale * zoom;
  const height = sourceHeight * scale * zoom;
  ctx.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}

function currentVisual() {
  const vid = $("slide-vid");
  if (vid.classList.contains("on") && vid.readyState >= 2) return vid;
  return visibleStill();
}

const PIP_FRAME_MS = 1000 / 24;
let pipLastFrame = 0;

function renderPipFrame(ts) {
  pipFrame = requestAnimationFrame(renderPipFrame);
  const now = typeof ts === "number" ? ts : 0;
  if (now - pipLastFrame < PIP_FRAME_MS) return;
  pipLastFrame = now;
  const canvas = $("pip-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const vis = currentVisual();
  if (vis && (vis.complete || vis.readyState >= 2)) drawPipSource(ctx, vis, state.fit, state.zoom);
  const overlay = $("overlay-vid");
  if (state.overlayUrl && overlay.readyState >= 2) {
    ctx.save();
    ctx.globalAlpha = 1 - state.transparency / 100;
    ctx.globalCompositeOperation = state.blend === "plus-lighter" ? "lighter" : state.blend;
    drawPipSource(ctx, overlay, "cover");
    ctx.restore();
  }
  // TINA exposes the same local smoke frame to the compositor. This keeps the
  // native PiP window visually consistent without adding another decoder.
  window.__tinaSmokePip?.draw?.(ctx, canvas);
}
function startPipRenderer() {
  if (!pipFrame) {
    pipLastFrame = 0;
    renderPipFrame();
  }
}

function captureCanvasStream(canvas) {
  const capture = canvas?.captureStream || canvas?.webkitCaptureStream;
  if (typeof capture !== "function") return null;
  try {
    return capture.call(canvas, 24);
  } catch {
    try {
      return capture.call(canvas);
    } catch {
      return null;
    }
  }
}

function stopPipRenderer() {
  if (state.recording) return;
  cancelAnimationFrame(pipFrame);
  pipFrame = 0;
  pipStream?.getTracks?.().forEach((track) => track.stop());
  pipStream = null;
  const video = $("pip-video");
  video.pause();
  if (video.srcObject) video.srcObject = null;
}

function setPipButtonLabel(label) {
  const button = $("pip-btn");
  button.setAttribute("aria-label", label);
  button.title = label;
}

function supportsNativePip(video) {
  if (!video) return false;
  if (
    typeof video.requestPictureInPicture === "function" &&
    document.pictureInPictureEnabled !== false
  ) return true;
  try {
    // WebKit can report false until the video has a source and loaded metadata.
    // This function is deliberately an API-presence check; requestNativePip
    // performs the capability check after the composed stream is playable.
    return typeof video.webkitSetPresentationMode === "function";
  } catch {
    return false;
  }
}

function waitForPipVideo(video, timeout = 2500) {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => done(new Error("PiP video did not become ready")), timeout);
    const done = (error) => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => done();
    const onError = () => done(video.error || new Error("PiP video failed"));
    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function requestNativePip(video) {
  if (!video) throw new Error("PiP video unavailable");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  await video.play();
  if (
    typeof video.requestPictureInPicture === "function" &&
    document.pictureInPictureEnabled !== false
  ) {
    await video.requestPictureInPicture();
  } else if (
    typeof video.webkitSetPresentationMode === "function" &&
    (typeof video.webkitSupportsPresentationMode !== "function" ||
      video.webkitSupportsPresentationMode("picture-in-picture"))
  ) {
    video.webkitSetPresentationMode("picture-in-picture");
  } else {
    throw new Error("Native PiP unavailable");
  }
  pipNativeTarget = video;
}

async function openPip() {
  // Always use one composed video surface. This keeps image slides, video
  // slides, fit/zoom, and the local overlay in the same native PiP window on
  // every browser that supports canvas capture streams, including WebKit's
  // iOS presentation-mode API where available.
  const canvas = $("pip-canvas");
  const video = $("pip-video");
  if (supportsNativePip(video)) {
    startPipRenderer();
    pipStream = captureCanvasStream(canvas);
    if (!pipStream) {
      stopPipRenderer();
      setStatus("Native Picture in Picture is unavailable in this browser.");
      return;
    }
    video.srcObject = pipStream;
    try {
      await waitForPipVideo(video);
      await requestNativePip(video);
      setStatus("Native Picture in Picture is active.");
      return;
    } catch {
      pipNativeTarget = null;
      stopPipRenderer();
    }
  }
  setStatus("Native Picture in Picture is unavailable in this browser.");
}

function onNativePipClosed(event) {
  if (pipNativeTarget && event.currentTarget !== pipNativeTarget) return;
  pipNativeTarget = null;
  stopPipRenderer();
}

[$("pip-video"), $("slide-vid")].forEach((video) => {
  video.addEventListener("leavepictureinpicture", onNativePipClosed);
  video.addEventListener("webkitpresentationmodechanged", () => {
    if (video.webkitPresentationMode !== "picture-in-picture") onNativePipClosed({ currentTarget: video });
  });
});

let audioCtx = null;
let recDest = null;
const hookedGains = [];

// The recorder tap makes the graph render every node a second time, into a
// stream nothing is reading until someone actually presses record. On a phone
// that overhead lands squarely on the audio thread, so the tap is only built
// when it is about to be used.
function ensureRecTap() {
  if (recDest || !audioCtx) return recDest;
  try {
    recDest = audioCtx.createMediaStreamDestination();
    hookedGains.forEach((g) => {
      try {
        g.connect(recDest);
      } catch {
        /* a gain that is already gone needs no tap */
      }
    });
  } catch {
    recDest = null;
  }
  return recDest;
}
let mediaRecorder = null;
let recStream = null;
let recChunks = [];
const hooked = new WeakSet();

function resumeAudioCtx() {
  if (audioCtx && audioCtx.state !== "running") audioCtx.resume?.().catch(() => undefined);
}

function ensureAudioGraph() {
  if (audioCtx) {
    resumeAudioCtx();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    // A playback-sized buffer costs latency we do not need and removes the
    // dropouts mobile Safari produces at the default interactive buffer size.
    audioCtx = new AC({ latencyHint: "playback" });
  } catch {
    audioCtx = new AC();
  }
  const hook = (el, gainValue) => {
    if (hooked.has(el)) return;
    try {
      const src = audioCtx.createMediaElementSource(el);
      const g = audioCtx.createGain();
      // start silent so nothing leaks between hooking and the first volume sync
      g.gain.value = 0;
      src.connect(g);
      g.connect(audioCtx.destination);
      if (recDest) g.connect(recDest);
      el._mixGain = g;
      hookedGains.push(g);
      el._mixBase = gainValue;
      hooked.add(el);
    } catch {
      /* already connected or not allowed */
    }
  };
  hook($("local-audio"), 1);
  hook($("overlay-vid"), 0.5);
  hook($("slide-vid"), 0.35);
  applyMixVolumes();
  resumeAudioCtx();
}

// iOS suspends the context on interruptions (calls, route changes, backgrounding)
// and only lets it come back on a gesture or when the page is visible again.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    resumeAudioCtx();
    if (overlayShouldPlay()) playOverlayWhenReady($("overlay-vid"));
  }
});
for (const evt of ["pointerdown", "touchend", "keydown"]) {
  document.addEventListener(evt, resumeAudioCtx, { passive: true });
}

function pickRecorderMime() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  for (const t of types) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  }
  return "";
}

function setRecUi(on) {
  state.recording = on;
  $("rec-dot").classList.toggle("hid", !on);
  for (const button of [$("record-btn"), $("hud-record")]) {
    button.classList.toggle("live", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", on ? "Stop recording" : "Record reel");
    button.title = on ? "Stop recording" : "Record slideshow";
    if (button.id === "hud-record") button.textContent = on ? "Stop" : "Record";
  }
}

function waitForCurrentVisual(timeout = 2500) {
  const source = currentVisual();
  const ready =
    source &&
    ((source.tagName === "VIDEO" && source.readyState >= 2) ||
      (source.tagName !== "VIDEO" && source.complete && source.naturalWidth));
  if (ready) return Promise.resolve();
  return new Promise((resolve) => {
    if (!source) {
      resolve();
      return;
    }
    const eventName = source.tagName === "VIDEO" ? "loadeddata" : "load";
    const done = () => {
      source.removeEventListener(eventName, done);
      source.removeEventListener("error", done);
      resolve();
    };
    source.addEventListener(eventName, done, { once: true });
    source.addEventListener("error", done, { once: true });
    setTimeout(done, timeout);
  });
}

async function startRecording() {
  if (state.recording) {
    stopRecording();
    return;
  }
  if (!state.slides.length) {
    setStatus("Add at least one photo or video before recording.");
    return;
  }
  if (!window.MediaRecorder) {
    setStatus("This browser does not support reel recording.");
    return;
  }
  if (!state.playing) enterPlayer();
  await waitForCurrentVisual();
  ensureAudioGraph();
  await audioCtx?.resume?.().catch(() => undefined);
  startPipRenderer();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const canvas = $("pip-canvas");
  if (!canvas.captureStream) {
    stopPipRenderer();
    setStatus("This browser cannot record the player canvas.");
    return;
  }
  const vStream = canvas.captureStream(30);
  const mixed = new MediaStream();
  vStream.getVideoTracks().forEach((track) => mixed.addTrack(track));
  ensureRecTap()?.stream.getAudioTracks().forEach((track) => mixed.addTrack(track));
  recStream = mixed;
  const mime = pickRecorderMime();
  try {
    recChunks = [];
    mediaRecorder = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  } catch (err) {
    recStream.getTracks().forEach((track) => track.stop());
    recStream = null;
    stopPipRenderer();
    setStatus("Recorder failed: " + (err.message || err));
    return;
  }
  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size) recChunks.push(event.data);
  };
  mediaRecorder.onerror = (event) => {
    setStatus("Recording stopped because the browser reported an error.");
    console.error("Recorder error:", event.error || event);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || "video/webm" });
    if (blob.size) {
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      downloadBlob(blob, `reel-${Date.now()}.${ext}`);
      setStatus("Reel saved to your downloads / Files.");
    } else {
      setStatus("No video data was captured. Try recording again.");
    }
    recChunks = [];
    recStream?.getTracks().forEach((track) => track.stop());
    recStream = null;
    setRecUi(false);
    stopPipRenderer();
    mediaRecorder = null;
  };
  try {
    mediaRecorder.start(500);
    setRecUi(true);
    setStatus("Recording this window only — nothing leaves the device.");
  } catch (err) {
    recStream.getTracks().forEach((track) => track.stop());
    recStream = null;
    stopPipRenderer();
    setStatus("Recorder could not start: " + (err.message || err));
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try {
      mediaRecorder.stop();
    } catch (err) {
      recStream?.getTracks().forEach((track) => track.stop());
      recStream = null;
      setRecUi(false);
      stopPipRenderer();
      setStatus("Recording could not be finalized: " + (err.message || err));
    }
  } else {
    recStream?.getTracks().forEach((track) => track.stop());
    recStream = null;
    setRecUi(false);
    stopPipRenderer();
  }
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function blobForSlide(slide) {
  if (slide.file) return slide.file;
  const res = await fetch(slide.url);
  return res.blob();
}

async function zipSlides(slides, zipName) {
  if (!window.JSZip) {
    setStatus("Zip engine missing.");
    return;
  }
  if (!slides.length) {
    setStatus("There is no media in that selection to zip.");
    return;
  }
  setStatus(`Packing ${slides.length} media item${slides.length === 1 ? "" : "s"}…`);
  const zip = new JSZip();
  const folder = zip.folder(zipName) || zip;
  let packed = 0;
  let skipped = 0;
  for (const slide of slides) {
    try {
      const blob = await blobForSlide(slide);
      packed += 1;
      folder.file(
        `${String(packed).padStart(3, "0")}-${safeName(slide.alt || (slide.kind === "video" ? "video" : "image"))}`,
        blob,
      );
    } catch (err) {
      skipped += 1;
      console.error("Could not add media to zip:", slide.alt, err);
    }
  }
  if (!packed) {
    setStatus("None of the selected media could be read, so no zip was created.");
    return;
  }
  const out = await zip.generateAsync({ type: "blob", compression: "STORE" });
  downloadBlob(out, `${safeName(zipName)}.zip`);
  setStatus(
    skipped
      ? `Saved ${zipName}.zip with ${packed} item${packed === 1 ? "" : "s"}; ${skipped} unreadable item${skipped === 1 ? " was" : "s were"} skipped.`
      : `Saved ${zipName}.zip with ${packed} media item${packed === 1 ? "" : "s"}.`,
  );
}

$("paces").innerHTML = Object.entries(PACES)
  .map(
    ([id, pace]) =>
      `<button type="button" class="pace${id === state.speed ? " on" : ""}" data-speed="${id}" aria-pressed="${id === state.speed}"><strong>${pace.label}</strong><em>${pace.hint}</em></button>`,
  )
  .join("");

$("choose-album").onclick = () => $("album-input").click();
$("loose-photos").onclick = () => $("loose-input").click();
$("choose-video").onclick = () => $("video-input").click();
$("choose-audio").onclick = () => $("audio-input").click();

$("album-input").onchange = (e) => {
  importFiles(e.target.files, $("album-name").value.trim() || defaultAlbum());
  e.target.value = "";
};
$("loose-input").onchange = (e) => {
  importFiles(e.target.files, $("album-name").value.trim() || defaultAlbum());
  e.target.value = "";
};
$("folder-input").onchange = (e) => {
  const list = e.target.files;
  if (!list || !list.length) {
    setStatus("That folder pick came back empty. Try Add Files, or drop the folder onto the box.");
    e.target.value = "";
    return;
  }
  importFiles(list);
  e.target.value = "";
};
$("video-input").onchange = (e) => {
  importOverlay(e.target.files?.[0]);
  e.target.value = "";
};
$("audio-input").onchange = (e) => {
  importAudioFiles(e.target.files);
  e.target.value = "";
};

$("add-folder").onclick = () => $("folder-input").click();

function bindDrop(el, onFiles) {
  el.ondragover = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    el.classList.add("drag");
  };
  el.ondragleave = () => el.classList.remove("drag");
  el.ondrop = async (e) => {
    e.preventDefault();
    el.classList.remove("drag");
    try {
      const files = await filesFromDataTransfer(e.dataTransfer);
      await onFiles(files);
    } catch (err) {
      console.error(err);
      setStatus("Could not read dropped files.");
    }
  };
}
bindDrop($("photo-drop"), (files) => importFiles(files, $("album-name").value.trim() || undefined));
bindDrop($("video-drop"), async (files) => {
  const vid = (files || []).find((f) => isVideo(f));
  if (vid) await importOverlay(vid);
});

$("load-sc").onclick = applySoundCloud;
$("use-sc").onclick = () => {
  state.soundtrackMode = "soundcloud";
  writeSettings({ soundtrackMode: "soundcloud" });
  renderSetup();
};
$("use-local").onclick = () => {
  state.soundtrackMode = "local";
  writeSettings({ soundtrackMode: "local" });
  renderSetup();
};
$("clear-sound").onclick = async () => {
  state.soundcloudUrl = "";
  $("sc-url").value = "";
  state.tracks.forEach((t) => URL.revokeObjectURL(t.url));
  state.tracks = [];
  state.trackIndex = 0;
  state.soundtrackMode = "off";
  writeSettings({ soundcloudUrl: "", soundtrackMode: "off" });
  try {
    const media = await idbAll(MEDIA_STORE);
    await idbDel(
      MEDIA_STORE,
      media.filter((r) => String(r.id).startsWith("local-audio")).map((r) => r.id),
    );
  } catch {
    setStatus("The audio list was cleared for this session, but browser storage could not be updated. Some tracks may return after reload.");
  }
  renderSetup();
};
$("clear-video").onclick = async () => {
  if (state.overlayUrl) URL.revokeObjectURL(state.overlayUrl);
  if (state.overlayPreviewUrl) URL.revokeObjectURL(state.overlayPreviewUrl);
  state.overlayUrl = null;
  state.overlayPreviewUrl = null;
  state.overlayName = null;
  state.overlayFile = null;
  await idbDel(MEDIA_STORE, ["overlay-video"]);
  renderSetup();
};

$("audio-repeat-btn").onclick = cycleAudioRepeat;
$("audio-shuffle-btn").onclick = toggleAudioShuffle;
$("hud-audio-repeat").onclick = cycleAudioRepeat;
$("hud-audio-shuffle").onclick = toggleAudioShuffle;
$("hud-photo-shuffle").onclick = togglePhotoShuffle;
$("hud-slow-pan").onclick = () => setSlowPan(!state.slowPan);
$("hud-no-repeat").onclick = () => {
  state.noRepeat = !state.noRepeat;
  writeSettings({ noRepeat: state.noRepeat });
  resetShuffleBag();
  if ($("no-repeat")) $("no-repeat").checked = state.noRepeat;
  renderSetup();
  bumpChrome();
};
$("record-btn").onclick = () => startRecording();
$("hud-record").onclick = () => startRecording();

$("transparency").oninput = (e) => {
  state.transparency = Number(e.target.value);
  writeSettings({ overlayTransparency: state.transparency });
  $("tr-val").textContent = String(state.transparency);
  $("video-preview").style.opacity = String(1 - state.transparency / 100);
  $("overlay-vid").style.opacity = String(1 - state.transparency / 100);
};
$("overlay-vol").oninput = (e) => {
  state.overlayVolume = Number(e.target.value);
  writeSettings({ overlayVolume: state.overlayVolume });
  $("ov-val").textContent = String(state.overlayVolume);
  setMixVolume($("overlay-vid"), state.overlayVolume / 100, state.overlayVolume === 0);
};
$("sound-vol").oninput = (e) => {
  state.soundtrackVolume = Number(e.target.value);
  writeSettings({ soundtrackVolume: state.soundtrackVolume });
  setMixVolume($("local-audio"), state.soundtrackVolume / 100, state.soundtrackVolume === 0);
  scWidget?.setVolume(state.soundtrackVolume);
  $("st-val").textContent = String(state.soundtrackVolume);
  syncSlideVideoAudio();
};
$("audio-speed").oninput = (e) => {
  state.audioSpeed = Number(e.target.value);
  $("local-audio").playbackRate = state.audioSpeed;
  writeSettings({ audioSpeed: state.audioSpeed });
  $("audio-speed-val").textContent = `${Number(state.audioSpeed).toFixed(2)}×`;
};
$("audio-speed-presets").onclick = (e) => {
  const btn = e.target.closest("[data-aspeed]");
  if (!btn) return;
  state.audioSpeed = Number(btn.dataset.aspeed);
  $("local-audio").playbackRate = state.audioSpeed;
  writeSettings({ audioSpeed: state.audioSpeed });
  renderSetup();
};
$("zoom").oninput = (e) => {
  state.zoom = Number(e.target.value);
  writeSettings({ zoom: state.zoom });
  applyFit(visibleStill());
  applyFit($("slide-vid"));
  $("zoom-val").textContent = Number(state.zoom).toFixed(1);
};
$("overlay-loop").onchange = (e) => {
  state.overlayLoop = e.target.checked;
  writeSettings({ overlayLoop: state.overlayLoop });
  const video = $("overlay-vid");
  video.loop = state.overlayLoop;
  if (state.overlayLoop && overlayShouldPlay() && video.ended) {
    try { video.currentTime = 0; } catch { /* metadata is still loading */ }
    playOverlayWhenReady(video);
  }
};
$("shuffle").onchange = (e) => {
  state.shuffle = e.target.checked;
  writeSettings({ shuffle: state.shuffle });
  resetShuffleBag();
  renderSetup();
};
$("no-repeat").onchange = (e) => {
  state.noRepeat = e.target.checked;
  writeSettings({ noRepeat: state.noRepeat });
  resetShuffleBag();
  renderSetup();
};
$("slow-pan").onchange = (event) => setSlowPan(event.target.checked);
if ($("skip-videos")) {
  $("skip-videos").checked = !!state.skipVideos;
  $("skip-videos").onchange = (e) => {
    state.skipVideos = e.target.checked;
    writeSettings({ skipVideos: state.skipVideos });
    renderSetup();
  };
}
$("crossfade").oninput = (e) => {

  state.crossfade = Number(e.target.value);
  writeSettings({ crossfade: state.crossfade });
  applyCrossfade();
  $("fade-val").textContent = Number(state.crossfade).toFixed(2);
};
$("fit-contain").onclick = () => {
  state.fit = "contain";
  writeSettings({ fit: "contain" });
  applyFit(visibleStill());
  renderSetup();
};
$("fit-cover").onclick = () => {
  state.fit = "cover";
  writeSettings({ fit: "cover" });
  applyFit(visibleStill());
  renderSetup();
};
$("paces").onclick = (e) => {
  const btn = e.target.closest("[data-speed]");
  if (!btn) return;
  state.speed = btn.dataset.speed;
  writeSettings({ speed: state.speed });
  renderSetup();
};
$("blends").onclick = (e) => {
  const btn = e.target.closest("[data-blend]");
  if (!btn) return;
  state.blend = btn.dataset.blend;
  writeSettings({ overlayBlend: state.blend });
  renderSetup();
};

$("album-list").onclick = async (e) => {
  const zipBtn = e.target.closest("[data-zip-album]");
  if (zipBtn) {
    const name = zipBtn.dataset.zipAlbum;
    await zipSlides(
      state.slides.filter((s) => s.album === name),
      name,
    );
    return;
  }
  const btn = e.target.closest("[data-remove-album]");
  if (!btn) return;
  const name = btn.dataset.removeAlbum;
  const ids = state.slides.filter((s) => s.album === name).map((s) => s.id);
  state.slides.filter((s) => s.album === name).forEach((s) => URL.revokeObjectURL(s.url));
  state.slides = state.slides.filter((s) => s.album !== name);
  resetShuffleBag();
  await idbDel(PHOTO_STORE, ids);
  renderSetup();
};
$("thumbs").onclick = async (e) => {
  const btn = e.target.closest("[data-remove]");
  if (!btn) return;
  const id = btn.dataset.remove;
  const slide = state.slides.find((s) => s.id === id);
  if (slide) URL.revokeObjectURL(slide.url);
  state.slides = state.slides.filter((s) => s.id !== id);
  resetShuffleBag();
  await idbDel(PHOTO_STORE, [id]);
  renderSetup();
};
$("track-list").onclick = async (e) => {
  const btn = e.target.closest("[data-remove-track]");
  if (!btn) return;
  const id = btn.dataset.removeTrack;
  const track = state.tracks.find((item) => item.id === id);
  if (!track) return;
  try {
    await idbDel(MEDIA_STORE, [track.storageId || `local-audio-${track.id}`]);
  } catch {
    setStatus("That track could not be removed from browser storage. It is still listed so it will not unexpectedly return after reload.");
    return;
  }
  URL.revokeObjectURL(track.url);
  state.tracks = state.tracks.filter((item) => item.id !== id);
  if (state.trackIndex >= state.tracks.length) state.trackIndex = 0;
  if (!state.tracks.length && state.soundtrackMode === "local") {
    state.soundtrackMode = state.soundcloudUrl ? "soundcloud" : "off";
  }
  writeSettings({ soundtrackMode: state.soundtrackMode });
  setStatus(`Removed ${track.name} from this device.`);
  renderSetup();
};
$("clear-all").onclick = async () => {
  state.slides.forEach((s) => URL.revokeObjectURL(s.url));
  state.slides = [];
  resetShuffleBag();
  await idbClear(PHOTO_STORE);
  renderSetup();
};
$("zip-all").onclick = () => zipSlides(state.slides, "reel-all");
$("zip-albums").onclick = async () => {
  const names = [...new Set(state.slides.map((s) => s.album))];
  for (const name of names) {
    await zipSlides(
      state.slides.filter((s) => s.album === name),
      name,
    );
  }
};

$("play-btn").onclick = enterPlayer;
$("exit-btn").onclick = exitPlayer;
$("prev-btn").onclick = () => {
  step(-1);
  bumpChrome();
};
$("next-btn").onclick = () => {
  step(1);
  bumpChrome();
};
$("skip-video-btn").onclick = skipVideo;
$("toggle-btn").onclick = togglePlay;
$("slide-video-mute").onclick = () => {
  const currentlyMuted = state.slideVideoMuted || state.slideVideoVolume === 0;
  state.slideVideoMuted = !currentlyMuted;
  if (currentlyMuted && state.slideVideoVolume === 0) state.slideVideoVolume = 100;
  writeSettings({ slideVideoVolume: state.slideVideoVolume, slideVideoMuted: state.slideVideoMuted });
  syncSlideVideoAudio();
  bumpChrome();
};
$("slide-video-volume").oninput = (event) => {
  state.slideVideoVolume = Number(event.target.value);
  if (state.slideVideoVolume > 0) state.slideVideoMuted = false;
  writeSettings({ slideVideoVolume: state.slideVideoVolume, slideVideoMuted: state.slideVideoMuted });
  syncSlideVideoAudio();
  bumpChrome();
};
$("main-slide-video-volume").oninput = (event) => {
  state.slideVideoVolume = Number(event.target.value);
  if (state.slideVideoVolume > 0) state.slideVideoMuted = false;
  writeSettings({ slideVideoVolume: state.slideVideoVolume, slideVideoMuted: state.slideVideoMuted });
  $("main-slide-video-volume-value").textContent = String(Math.round(state.slideVideoVolume));
  syncSlideVideoAudio();
};
$("pip-btn").onclick = openPip;

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (!exit) throw new Error("Fullscreen exit is unavailable.");
      await exit.call(document);
      return;
    }
    const target = document.documentElement;
    const request = target.requestFullscreen || target.webkitRequestFullscreen;
    if (!request) {
      setStatus("Fullscreen is not supported by this browser. You can still install the app for a full-screen experience.");
      return;
    }
    await request.call(target);
  } catch (err) {
    setStatus("Fullscreen could not be opened: " + (err.message || err));
  }
}

$("full-btn").onclick = toggleFullscreen;
$("player").onpointerdown = bumpChrome;
let chromeMoveFrame = 0;
$("player").onpointermove = () => {
  if (chromeMoveFrame) return;
  chromeMoveFrame = requestAnimationFrame(() => {
    chromeMoveFrame = 0;
    bumpChrome();
  });
};

window.addEventListener("keydown", (event) => {
  if (!$("player").classList.contains("on")) return;
  if (event.key === " " || event.key === "k") {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "ArrowRight" || event.key === "l") {
    step(1);
    bumpChrome();
  } else if (event.key === "ArrowLeft" || event.key === "j") {
    step(-1);
    bumpChrome();
  } else if (event.key === "Escape") exitPlayer();
  else if (event.key === "p") openPip();
  else if (event.key === "f") toggleFullscreen();
  else if (event.key === "r") startRecording();
  else if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    triggerSplat();
  }
});

let deferredPrompt = null;
let installReturnFocus = null;
const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean(navigator.standalone);
if (standalone) $("install-btn").classList.add("hid");
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
});

function installFocusables() {
  return [...$("install-sheet").querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (element) => !element.disabled && !element.hidden,
  );
}

function openInstallSheet() {
  installReturnFocus = document.activeElement;
  $("install-sheet").classList.remove("hid");
  $("install-sheet").setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => $("sheet-close").focus());
}

function closeInstallSheet() {
  $("install-sheet").classList.add("hid");
  $("install-sheet").setAttribute("aria-hidden", "true");
  installReturnFocus?.focus?.();
  installReturnFocus = null;
}

$("install-btn").onclick = async () => {
  if (deferredPrompt) {
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === "accepted") {
        setStatus("Install accepted. The app will appear with your other installed apps.");
        return;
      }
    } catch {
      /* manual steps remain available */
    }
  }
  $("install-steps").innerHTML = `
    <li><strong>iPhone / iPad</strong>Open this page in Safari. Tap Share, choose Add to Home Screen, then tap Add.</li>
    <li><strong>Android</strong>Open the browser menu, choose Add to Home screen or Install app, and confirm.</li>
    <li><strong>Mac</strong>In Chrome or Edge, use the install icon in the address bar. In Safari, choose File → Add to Dock when available.</li>
    <li><strong>Windows PC</strong>In Chrome or Edge, use the install icon in the address bar or choose Install omens plapinator from the browser menu.</li>
  `;
  openInstallSheet();
};
$("sheet-close").onclick = $("sheet-ok").onclick = closeInstallSheet;
$("install-sheet").onclick = (event) => {
  if (event.target === $("install-sheet")) closeInstallSheet();
};
$("install-sheet").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeInstallSheet();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = installFocusables();
  if (!focusable.length) {
    event.preventDefault();
    document.querySelector("#install-sheet [role=dialog]")?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

(function themePreviewGate() {
  const link = $("theme-preview-link");
  const pub = $("public-preview-link");
  if (document.body.classList.contains("theme-cloudyplap")) {
    if (link) link.hidden = true;
    if (pub) pub.hidden = false;
    return;
  }
  if (!link) return;
  link.hidden = false;
  if (pub) pub.hidden = true;
  if (/\.netlify\.app$|\.netlify\.com$/i.test(location.hostname)) return;
  fetch("local/cloudyplap.js", { method: "GET", cache: "no-store" })
    .then((r) => {
      if (!r.ok) link.remove();
    })
    .catch(() => link.remove());
})();

(function offerUpdateZips() {
  if (/\.netlify\.app$|\.netlify\.com$/i.test(location.hostname)) return;
  if (location.protocol === "file:") return;
  const bar = document.createElement("div");
  bar.id = "update-dl";
  bar.innerHTML = `
    <p>Download the latest omens plapinator build.</p>
    <a class="btn" href="omens-plapinator-update.zip" download="omens-plapinator-update.zip">Public build (Netlify)</a>
    <a class="btn" href="omens-plapinator-local.zip" download="omens-plapinator-local.zip">Theme build (Mac / iOS, local only)</a>
    <button type="button" class="link" id="update-dl-x">hide this</button>`;
  document.body.appendChild(bar);
  document.getElementById("update-dl-x").onclick = () => bar.remove();
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js?v=34", { updateViaCache: "none" })
    .then((reg) => reg.update().catch(() => undefined))
    .catch(() => undefined);
}

(function initMatrixRain() {
  const canvas = $("matrix-rain");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const KATAKANA = "ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
  const MATRIX_CHARS = (KATAKANA + "0123456789+-*=<>:¦|").split("");
  let width = 0;
  let height = 0;
  let columns = [];
  const lean = Boolean(window.__perf?.lean);
  // Wider cells on a phone means proportionally fewer columns to draw.
  const fontSize = lean ? 22 : 16;
  // Canvas shadowBlur is re-rasterised per call. At roughly two hundred glow
  // calls a frame it was costing more than everything else on the page put
  // together, and over a black background a brighter fill reads the same.
  const glow = !lean;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    const colCount = Math.floor(width / fontSize);
    columns = [];
    for (let i = 0; i < colCount; i++) {
      columns.push({
        y: Math.random() * -100,
        speed: 0.65 + Math.random() * 0.9,
        length: 12 + Math.floor(Math.random() * 20),
        chars: [],
      });
    }
  }
  window.addEventListener("resize", resize);
  let rainFrame = 0;
  let lastRainDraw = 0;
  const rainIsVisible = () => {
    const style = getComputedStyle(canvas);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  };
  const scheduleRain = () => {
    if (!rainFrame && !rainPaused && !document.hidden && rainIsVisible()) {
      rainFrame = requestAnimationFrame(draw);
    }
  };
  document.addEventListener("visibilitychange", scheduleRain);
  resize();

  function draw(timestamp) {
    rainFrame = 0;
    if (rainPaused || document.hidden || !rainIsVisible()) return;
    if (timestamp - lastRainDraw < (lean ? 48 : 32)) {
      scheduleRain();
      return;
    }
    lastRainDraw = timestamp;
    ctx.fillStyle = "rgba(1, 6, 2, 0.12)";
    ctx.fillRect(0, 0, width, height);
    ctx.font = `bold ${fontSize}px "Matrix Code NFI", monospace, sans-serif`;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const x = i * fontSize;
      if (Math.random() < 0.15 || !col.chars.length) {
        col.chars.unshift(MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]);
        if (col.chars.length > col.length) col.chars.pop();
      }
      for (let j = 0; j < col.chars.length; j++) {
        const charY = (col.y - j) * fontSize;
        if (charY < -fontSize || charY > height + fontSize) continue;
        const char = col.chars[j];
        if (j === 0) {
          ctx.fillStyle = "#ffffff";
          if (glow) {
            ctx.shadowColor = "#ffffff";
            ctx.shadowBlur = 10;
          }
        } else if (j < 3) {
          ctx.fillStyle = "#7dffa4";
          if (glow) {
            ctx.shadowColor = "#00ff41";
            ctx.shadowBlur = 6;
          }
        } else {
          const alpha = Math.max(0.08, 1 - j / col.length);
          ctx.fillStyle = `rgba(0, ${Math.floor(180 * alpha + 40)}, ${Math.floor(60 * alpha)}, ${alpha})`;
          if (glow) ctx.shadowBlur = 0;
        }
        ctx.fillText(char, x, charY);
      }
      if (glow) ctx.shadowBlur = 0;
      col.y += col.speed;
      if (col.y - col.length > height / fontSize) {
        col.y = Math.random() * -30;
        col.speed = 0.65 + Math.random() * 0.9;
        col.length = 12 + Math.floor(Math.random() * 20);
        col.chars = [];
      }
    }
    scheduleRain();
  }
  window.addEventListener("flashreel:rain", scheduleRain);
  scheduleRain();
})();

(function runGlitchIntro() {
  const intro = $("intro-glitch");
  if (!intro) return;
  const finishIntro = () => {
    intro.classList.add("done");
    setTimeout(() => intro.remove(), 280);
  };
  setTimeout(finishIntro, 800);
  intro.onclick = finishIntro;
})();

(function initTitleGlitch() {
  const brandTitle = $("brand-title");
  if (!brandTitle) return;
  function triggerGlitch() {
    if (document.body.classList.contains("theme-cloudyplap")) return;
    brandTitle.classList.add("glitching");
    setTimeout(() => {
      brandTitle.classList.remove("glitching");
      setTimeout(triggerGlitch, 1800 + Math.random() * 3700);
    }, 220);
  }
  setTimeout(triggerGlitch, 1500);
})();

(function detectIOSLayout() {
  const ios =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) document.body.classList.add("layout-ios");
})();

(async function restore() {
  let migrationFailed = false;
  try {
    const photos = await idbAll(PHOTO_STORE);
    const orderedPhotos = photos
      .map((row, index) => ({
        row,
        order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
      }))
      .sort((a, b) => a.order - b.order);
    const photoMigrations = [];
    for (const item of orderedPhotos) {
      const { row, order } = item;
      if (!row.blob) continue;
      if (!Number.isFinite(Number(row.order))) photoMigrations.push({ ...row, order });
      state.slides.push({
        id: row.id,
        url: URL.createObjectURL(row.blob),
        album: row.album || "Photos",
        alt: row.name,
        kind: row.kind === "video" ? "video" : "image",
        file: row.blob,
        order,
      });
    }
    if (photoMigrations.length) {
      try {
        await idbPut(PHOTO_STORE, photoMigrations);
      } catch {
        migrationFailed = true;
      }
    }

    const media = await idbAll(MEDIA_STORE);
    const overlay = media.find((row) => row.id === "overlay-video" && row.blob);
    if (overlay) {
      state.overlayUrl = URL.createObjectURL(overlay.blob);
      state.overlayPreviewUrl = URL.createObjectURL(overlay.blob);
      state.overlayName = overlay.name;
      state.overlayFile = overlay.blob;
    }

    const orderedTracks = media
      .filter((row) => String(row.id).startsWith("local-audio") && row.blob)
      .map((row, index) => ({
        row,
        order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
      }))
      .sort((a, b) => a.order - b.order);
    const trackMigrations = [];
    for (const item of orderedTracks) {
      const { row, order } = item;
      const storageId = String(row.id);
      const id = row.trackId || storageId.replace(/^local-audio-?/, "");
      state.tracks.push({
        id,
        storageId,
        url: URL.createObjectURL(row.blob),
        name: row.name,
        file: row.blob,
        order,
      });
      if (!row.trackId || !Number.isFinite(Number(row.order))) {
        trackMigrations.push({ ...row, trackId: id, order });
      }
    }
    if (trackMigrations.length) {
      try {
        await idbPut(MEDIA_STORE, trackMigrations);
      } catch {
        migrationFailed = true;
      }
    }
    if (state.tracks.length && state.soundtrackMode === "off") state.soundtrackMode = "local";
    if (migrationFailed) {
      setStatus("Media loaded, but its saved order could not be upgraded. Browser storage may be full.");
    }
  } catch (err) {
    console.error("Storage restore error:", err);
    setStatus("Some saved media could not be restored from browser storage.");
  }
  // Persistent storage reduces the chance that the operating system evicts a
  // large local library. It is a device-only browser permission and performs
  // no upload or network transfer.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* Persistence is best-effort and unsupported on some Safari versions. */
  }
  renderSetup();
})();

function triggerSplat() {
  if (!$("player").classList.contains("on")) return;
  // The splat itself lives in local/splat.js: a hand-animated liquid drawn from
  // geometry, with no image behind it and nothing to download. It is a hot
  // module, so it can be absent for a moment during a live update.
  window.__splat?.fire({ host: $("player") });
}
