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

function readSettings() {
  try {
    return JSON.parse(
      localStorage.getItem(SETTINGS_KEY) ||
        localStorage.getItem("flashreel-online-settings-v3") ||
        localStorage.getItem("flashreel-online-settings-v2") ||
        "{}",
    );
  } catch {
    return {};
  }
}
function writeSettings(patch) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), ...patch }));
  } catch {
    /* quota */
  }
}

const saved = readSettings();
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
  lanShare: saved.lanShare ?? false,
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

  $("play-btn").disabled = state.slides.length === 0;
  $("dock-copy").textContent = state.slides.length
    ? `${state.slides.length} item${state.slides.length === 1 ? "" : "s"} ready`
    : "Add photos or videos to start";

  $("clear-video").classList.toggle("hid", !state.overlayUrl);
  $("video-drop").classList.toggle("hid", !!state.overlayUrl);
  $("video-preview-wrap").classList.toggle("hid", !state.overlayUrl);
  if (state.overlayUrl) {
    const v = $("video-preview");
    if (v.src !== state.overlayUrl) v.src = state.overlayUrl;
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

  $("shuffle").checked = state.shuffle;
  $("no-repeat").checked = state.noRepeat;
  $("overlay-loop").checked = state.overlayLoop;
  $("transparency").value = state.transparency;
  $("overlay-vol").value = state.overlayVolume;
  $("sound-vol").value = state.soundtrackVolume;
  $("audio-speed").value = state.audioSpeed;
  $("zoom").value = state.zoom;
  $("crossfade").value = state.crossfade;

  applyCrossfade();

  $("audio-repeat-btn").textContent = repeatSymbol();
  $("audio-repeat-btn").className = `btn sm icon-mark ${state.audioRepeat === "off" ? "outline" : ""}`;
  $("audio-shuffle-btn").className = `btn sm icon-mark ${state.audioShuffle ? "" : "outline"}`;
  $("hud-photo-shuffle").classList.toggle("outline", !state.shuffle);
  const skipVid = $("skip-video-btn");
  if (skipVid) {
    const onVid = state.playing && state.slides[state.index]?.kind === "video";
    skipVid.disabled = !onVid;
    skipVid.classList.toggle("outline", !onVid);
  }
  const noRepHud = $("hud-no-repeat");
  if (noRepHud) noRepHud.classList.toggle("outline", !state.noRepeat);
  const hudAudioRepeat = $("hud-audio-repeat");
  if (hudAudioRepeat) {
    hudAudioRepeat.textContent = `♪${repeatSymbol()}`;
    hudAudioRepeat.classList.toggle("outline", state.audioRepeat === "off");
  }
  const hudAudioShuffle = $("hud-audio-shuffle");
  if (hudAudioShuffle) hudAudioShuffle.classList.toggle("outline", !state.audioShuffle);

  $("fit-contain").className = `btn sm ${state.fit === "contain" ? "" : "outline"}`;
  $("fit-cover").className = `btn sm ${state.fit === "cover" ? "" : "outline"}`;
  if ($("slow-pan")) $("slow-pan").checked = !!state.slowPan;
  if ($("hud-slow-pan")) $("hud-slow-pan").classList.toggle("outline", !state.slowPan);

  document.querySelectorAll("#audio-speed-presets [data-aspeed]").forEach((btn) => {
    btn.className = `btn sm ${Math.abs(Number(btn.dataset.aspeed) - Number(state.audioSpeed)) < 0.01 ? "" : "outline"}`;
  });
  document.querySelectorAll("#blends [data-blend]").forEach((btn) => {
    btn.className = `btn sm ${btn.dataset.blend === state.blend ? "" : "outline"}`;
  });
  document.querySelectorAll("#paces .pace").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.speed === state.speed);
  });

  renderAlbums();
  renderThumbs();
  renderTracks();
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
    const row = { id, name: file.name, type: file.type || (kind === "video" ? "video/mp4" : "image/jpeg"), blob: file, album, kind };
    pending.push(row);
    state.slides.push({ id, url, album, alt: file.name, kind, file });
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
  globalThis.lanShare?.announce();
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
  state.overlayUrl = URL.createObjectURL(file);
  state.overlayName = file.name;
  state.overlayFile = file;
  setStatus(`Overlay locked · ${file.name}`);
  globalThis.lanShare?.announce();
  renderSetup();
}

async function importAudioFiles(fileList) {
  const files = [...fileList].filter(isAudio);
  if (!files.length) {
    setStatus("That file is not audio.");
    return;
  }
  for (const file of files) {
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    state.tracks.push({ id, url, name: file.name, file });
    try {
      await idbPut(MEDIA_STORE, [{ id: `local-audio-${id}`, name: file.name, type: file.type, blob: file }]);
    } catch {
      /* storage full */
    }
  }
  if (state.tracks.length > 1) state.audioRepeat = "all";
  state.soundtrackMode = "local";
  writeSettings({ soundtrackMode: "local", audioRepeat: state.audioRepeat });
  setStatus(`${state.tracks.length} local track${state.tracks.length === 1 ? "" : "s"} · repeat ${state.audioRepeat}`);
  globalThis.lanShare?.announce();
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

let playRaf = 0;
let nextAt = 0;
let hideTimer = 0;
let scWidget = null;
let pipStream = null;
let pipFrame = 0;
let pipWindow = null;
let pipFallbackCanvas = null;
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

function syncMedia() {
  const video = $("overlay-vid");
  if (state.overlayUrl) {
    if (video.src !== state.overlayUrl) video.src = state.overlayUrl;
    video.loop = state.overlayLoop;
    setMixVolume(video, state.overlayVolume / 100, state.overlayVolume === 0);
    video.style.opacity = String(1 - state.transparency / 100);
    video.style.mixBlendMode = state.blend;
    video.style.display = "block";
    if (state.playing) video.play().catch(() => undefined);
    else video.pause();
  } else {
    video.removeAttribute("src");
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
  $("toggle-btn").textContent = "❚❚";
  ensureAudioGraph();
  showSlide();
  syncMedia();
  startSlideLoop();
  bumpChrome();
}

function exitPlayer() {
  if (state.recording) stopRecording();
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
  $("setup").classList.remove("hid");
  syncSlideVideoAudio();
  renderSetup();
}

function togglePlay() {
  state.playing = !state.playing;
  $("toggle-btn").textContent = state.playing ? "❚❚" : "▶";
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

const PIP_FRAME_MS = 1000 / 30;
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
  if (pipFallbackCanvas) {
    const fallbackCtx = pipFallbackCanvas.getContext("2d");
    fallbackCtx.clearRect(0, 0, pipFallbackCanvas.width, pipFallbackCanvas.height);
    fallbackCtx.drawImage(canvas, 0, 0, pipFallbackCanvas.width, pipFallbackCanvas.height);
  }
}
function startPipRenderer() {
  if (!pipFrame) {
    pipLastFrame = 0;
    renderPipFrame();
  }
}
function stopPipRenderer() {
  if (state.recording) return;
  cancelAnimationFrame(pipFrame);
  pipFrame = 0;
}

async function openPip() {
  const canvas = $("pip-canvas");
  const video = $("pip-video");
  startPipRenderer();
  if (!pipStream && canvas.captureStream) pipStream = canvas.captureStream(30);
  if (pipStream && video.srcObject !== pipStream) video.srcObject = pipStream;
  try {
    await video.play();
    if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
      await video.requestPictureInPicture();
      return;
    }
    if (video.webkitSupportsPresentationMode?.("picture-in-picture")) {
      video.webkitSetPresentationMode("picture-in-picture");
      return;
    }
  } catch {
    /* fallback */
  }
  pipWindow = window.open("", "gooninator-pip", "popup=yes,width=480,height=300,resizable=yes");
  if (!pipWindow) {
    stopPipRenderer();
    setStatus("Picture in Picture was blocked.");
    return;
  }
  pipWindow.document.title = "Picture in Picture";
  pipWindow.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
  let detachedVideo = null;
  if (pipStream) {
    detachedVideo = pipWindow.document.createElement("video");
    detachedVideo.autoplay = true;
    detachedVideo.muted = true;
    detachedVideo.controls = true;
    detachedVideo.style.cssText = "display:block;width:100vw;height:100vh;object-fit:contain;background:#000";
    detachedVideo.srcObject = pipStream;
    pipWindow.document.body.appendChild(detachedVideo);
  } else {
    pipFallbackCanvas = pipWindow.document.createElement("canvas");
    pipFallbackCanvas.width = canvas.width;
    pipFallbackCanvas.height = canvas.height;
    pipFallbackCanvas.style.cssText = "display:block;width:100vw;height:100vh;object-fit:contain;background:#000";
    pipWindow.document.body.appendChild(pipFallbackCanvas);
  }
  pipWindow.addEventListener("beforeunload", () => {
    pipWindow = null;
    pipFallbackCanvas = null;
    stopPipRenderer();
  });
  await detachedVideo?.play().catch(() => undefined);
}

$("pip-video").addEventListener("leavepictureinpicture", stopPipRenderer);
$("pip-video").addEventListener("webkitpresentationmodechanged", () => {
  if ($("pip-video").webkitPresentationMode !== "picture-in-picture") stopPipRenderer();
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
  if (!document.hidden) resumeAudioCtx();
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
  $("record-btn").classList.toggle("live", on);
  $("hud-record").classList.toggle("live", on);
}

async function startRecording() {
  if (state.recording) {
    stopRecording();
    return;
  }
  ensureAudioGraph();
  audioCtx?.resume?.();
  startPipRenderer();
  const canvas = $("pip-canvas");
  if (!canvas.captureStream) {
    setStatus("This browser cannot record the player canvas.");
    return;
  }
  const vStream = canvas.captureStream(30);
  const mixed = new MediaStream();
  vStream.getVideoTracks().forEach((t) => mixed.addTrack(t));
  ensureRecTap()?.stream.getAudioTracks().forEach((t) => mixed.addTrack(t));
  const mime = pickRecorderMime();
  try {
    recChunks = [];
    mediaRecorder = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  } catch (err) {
    setStatus("Recorder failed: " + (err.message || err));
    return;
  }
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size) recChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || "video/webm" });
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    downloadBlob(blob, `reel-${Date.now()}.${ext}`);
    setStatus("Reel saved to your downloads / Files.");
    recChunks = [];
    setRecUi(false);
    stopPipRenderer();
  };
  mediaRecorder.start(500);
  setRecUi(true);
  if (!state.playing) enterPlayer();
  setStatus("Recording this window only — nothing leaves the device.");
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try {
      mediaRecorder.stop();
    } catch {
      setRecUi(false);
    }
  } else setRecUi(false);
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
  const images = slides.filter((s) => s.kind !== "video");
  if (!images.length) {
    setStatus("No still images to zip.");
    return;
  }
  setStatus(`Packing ${images.length} images…`);
  const zip = new JSZip();
  const folder = zip.folder(zipName) || zip;
  let i = 0;
  for (const s of images) {
    try {
      const blob = await blobForSlide(s);
      folder.file(`${String(++i).padStart(3, "0")}-${safeName(s.alt || "image")}`, blob);
    } catch {
      /* skip one */
    }
  }
  const out = await zip.generateAsync({ type: "blob", compression: "STORE" });
  downloadBlob(out, `${safeName(zipName)}.zip`);
  setStatus(`Saved ${zipName}.zip`);
}

$("paces").innerHTML = Object.entries(PACES)
  .map(
    ([id, pace]) =>
      `<button type="button" class="pace${id === state.speed ? " on" : ""}" data-speed="${id}"><strong>${pace.label}</strong><em>${pace.hint}</em></button>`,
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

$("add-folder").onclick = (e) => {
  /* label[for=folder-input] already opens the picker; don't intercept */
  if (e.currentTarget && e.currentTarget.tagName === "LABEL") return;
};

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
    /* empty */
  }
  renderSetup();
};
$("clear-video").onclick = async () => {
  if (state.overlayUrl) URL.revokeObjectURL(state.overlayUrl);
  state.overlayUrl = null;
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
$("track-list").onclick = (e) => {
  const btn = e.target.closest("[data-remove-track]");
  if (!btn) return;
  const id = btn.dataset.removeTrack;
  const t = state.tracks.find((x) => x.id === id);
  if (t) URL.revokeObjectURL(t.url);
  state.tracks = state.tracks.filter((x) => x.id !== id);
  if (state.trackIndex >= state.tracks.length) state.trackIndex = 0;
  if (!state.tracks.length && state.soundtrackMode === "local") {
    state.soundtrackMode = state.soundcloudUrl ? "soundcloud" : "off";
  }
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
$("pip-btn").onclick = openPip;
$("full-btn").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
};
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
  else if (event.key === "f") document.documentElement.requestFullscreen?.();
  else if (event.key === "r") startRecording();
  else if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    triggerSplat();
  }
});

let deferredPrompt = null;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean(navigator.standalone);
if (standalone) $("install-btn").classList.add("hid");
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
});
$("install-btn").onclick = async () => {
  if (deferredPrompt) {
    try {
      await deferredPrompt.prompt();
    } catch {
      /* they can still follow the steps */
    }
    deferredPrompt = null;
  }
  const title = document.querySelector("#install-sheet h2");
  if (title) title.textContent = "Install the app";
  $("install-steps").innerHTML = `
    <li><strong>iPhone / iPad</strong>Gotta use Safari for this. Tap the share button (square with the arrow). Scroll a bit and tap Add to Home Screen, then Add.</li>
    <li><strong>Android</strong>Tap the three dots up in the corner. Hit Add to Home screen or Install app and confirm.</li>
    <li><strong>Mac</strong>Chrome or Edge: look on the right side of the address bar for a little install icon and click it. Safari doesn’t really do app installs — Chrome’s the easy one here.</li>
    <li><strong>Windows PC</strong>Chrome or Edge again. Same install icon in the address bar, or open the menu and click Install Gooninator Reloaded.</li>
  `;
  $("install-sheet").classList.remove("hid");
};
$("sheet-close").onclick = $("sheet-ok").onclick = () => $("install-sheet").classList.add("hid");

(function offerUpdateZips() {
  if (/\.netlify\.app$|\.netlify\.com$/i.test(location.hostname)) return;
  if (location.protocol === "file:") return;
  const bar = document.createElement("div");
  bar.id = "update-dl";
  bar.innerHTML = `
    <p>The files are here. Tap one — it should download.</p>
    <a class="btn" href="gooninator-update.zip" download="gooninator-update.zip">Public update (Netlify)</a>
    <button type="button" class="link" id="update-dl-x">hide this</button>`;
  document.body.appendChild(bar);
  document.getElementById("update-dl-x").onclick = () => bar.remove();
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js?v=25").then((reg) => {
    reg.update();
  }).catch(() => undefined);
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
  const scheduleRain = () => {
    if (!rainFrame && !rainPaused && !document.hidden) rainFrame = requestAnimationFrame(draw);
  };
  document.addEventListener("visibilitychange", scheduleRain);
  resize();

  function draw(timestamp) {
    rainFrame = 0;
    if (rainPaused || document.hidden) return;
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
  try {
    const photos = await idbAll(PHOTO_STORE);
    for (const row of photos) {
      if (!row.blob) continue;
      state.slides.push({
        id: row.id,
        url: URL.createObjectURL(row.blob),
        album: row.album || "Photos",
        alt: row.name,
        kind: row.kind === "video" ? "video" : "image",
        file: row.blob,
      });
    }
    const media = await idbAll(MEDIA_STORE);
    for (const row of media) {
      if (row.id === "overlay-video" && row.blob) {
        state.overlayUrl = URL.createObjectURL(row.blob);
        state.overlayName = row.name;
        state.overlayFile = row.blob;
      }
      if (String(row.id).startsWith("local-audio") && row.blob) {
        state.tracks.push({
          id: row.id,
          url: URL.createObjectURL(row.blob),
          name: row.name,
          file: row.blob,
        });
      }
    }
    if (state.tracks.length && state.soundtrackMode === "off") state.soundtrackMode = "local";
  } catch (err) {
    console.error("Storage restore error:", err);
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
