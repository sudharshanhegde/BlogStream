// ── Config ────────────────────────────────────────────────────────────────
const API_BASE_URL = "http://localhost:8000"; // Change to Render URL in production

// ── State ─────────────────────────────────────────────────────────────────
let currentDocId = null;
let positionInterval = null;
let isDragging = false;

// ── Elements ──────────────────────────────────────────────────────────────
const mainAudio    = document.getElementById("mainAudio");
const ambientAudio = document.getElementById("ambientAudio");
const generateBtn  = document.getElementById("generateBtn");
const textInput    = document.getElementById("textInput");
const voiceSelect  = document.getElementById("voiceSelect");
const statusEl     = document.getElementById("status");
const playerTitle  = document.getElementById("playerTitle");
const playPauseBtn = document.getElementById("playPauseBtn");
const progressBar  = document.getElementById("progressBar");
const currentTimeEl = document.getElementById("currentTime");
const totalTimeEl  = document.getElementById("totalTime");

// ── Init ──────────────────────────────────────────────────────────────────
(async function init() {
  await loadVoices();
  checkUrlParam();
  setupMediaSession();
  registerServiceWorker();
  setupInstallPrompt();
})();

// ── Voice loading ─────────────────────────────────────────────────────────
async function loadVoices() {
  try {
    const { data: voices } = await axios.get(`${API_BASE_URL}/voices`);
    voiceSelect.innerHTML = voices
      .map(v => `<option value="${v.id}">${v.label}</option>`)
      .join("");
  } catch {
    voiceSelect.innerHTML = '<option value="en-US-JennyNeural">Jenny (US) — calm, clear</option>';
  }
}

// ── URL param → load existing post ───────────────────────────────────────
async function checkUrlParam() {
  const params = new URLSearchParams(window.location.search);
  const docId = params.get("doc_id");
  if (!docId) return;

  setStatus("Loading post…");
  try {
    const { data: post } = await axios.get(`${API_BASE_URL}/posts/${docId}`);
    loadPost(post.doc_id, post.cloudinary_url, post.title, post.position);
    setStatus("");
  } catch (e) {
    setStatus("Could not load post: " + (e.response?.data?.detail || e.message), "error");
  }
}

// ── Generate ──────────────────────────────────────────────────────────────
async function handleGenerate() {
  const raw = textInput.value.trim();
  const voice = voiceSelect.value;

  if (!raw) { setStatus("Please enter some text.", "error"); return; }
  if (!voice) { setStatus("Please select a voice.", "error"); return; }

  // Clean text before sending to TTS — strips code, special chars, markdown
  const text = cleanTextForTTS(raw);
  if (!text) { setStatus("Nothing left to read after cleaning.", "error"); return; }

  generateBtn.disabled = true;
  setStatus('<span class="spinner"></span>Generating audio…');

  try {
    const { data } = await axios.post(`${API_BASE_URL}/generate`, { text, voice });
    setStatus(data.cached ? "Loaded from cache." : "Audio ready!", "success");
    loadPost(data.doc_id, data.audio_url, data.title, 0);
  } catch (e) {
    setStatus("Error: " + (e.response?.data?.detail || e.message), "error");
  } finally {
    generateBtn.disabled = false;
  }
}

// ── Preview cleaned text ──────────────────────────────────────────────────
function togglePreview() {
  const wrap = document.getElementById("previewWrap");
  if (!wrap.classList.contains("hidden")) {
    closePreview();
    return;
  }
  const raw = textInput.value.trim();
  if (!raw) { setStatus("Paste some text first.", "error"); return; }
  document.getElementById("previewText").textContent = cleanTextForTTS(raw);
  wrap.classList.remove("hidden");
}

function closePreview() {
  document.getElementById("previewWrap").classList.add("hidden");
}

// ── Load a post into the player ───────────────────────────────────────────
function loadPost(docId, audioUrl, title, savedPosition) {
  currentDocId = docId;
  playerTitle.textContent = title;
  mainAudio.src = audioUrl;

  // IMPORTANT: restore position inside loadedmetadata event
  mainAudio.addEventListener("loadedmetadata", function onLoaded() {
    mainAudio.removeEventListener("loadedmetadata", onLoaded);
    if (savedPosition > 0) {
      mainAudio.currentTime = savedPosition;
    }
    progressBar.max = mainAudio.duration || 100;
    totalTimeEl.textContent = formatTime(mainAudio.duration);
    // Persist duration to backend
    patchPosition(mainAudio.currentTime, mainAudio.duration);
    mainAudio.play().catch(() => {});
  }, { once: false });

  updateMediaSession(title);
  startPositionTracking();
}

// ── Playback controls ─────────────────────────────────────────────────────
function togglePlay() {
  if (!mainAudio.src) return;
  if (mainAudio.paused) {
    mainAudio.play();
  } else {
    mainAudio.pause();
  }
}

function skip(seconds) {
  if (!mainAudio.src) return;
  mainAudio.currentTime = Math.max(0, Math.min(mainAudio.duration || 0, mainAudio.currentTime + seconds));
}

function seekTo(value) {
  if (!mainAudio.src) return;
  mainAudio.currentTime = parseFloat(value);
}

// ── Audio event listeners ─────────────────────────────────────────────────
mainAudio.addEventListener("play", () => {
  playPauseBtn.textContent = "⏸";
});
mainAudio.addEventListener("pause", () => {
  playPauseBtn.textContent = "▶";
});

mainAudio.addEventListener("timeupdate", () => {
  if (isDragging) return;
  const t = mainAudio.currentTime;
  const d = mainAudio.duration || 0;
  progressBar.value = t;
  currentTimeEl.textContent = formatTime(t);

  // Update Media Session position state
  if (navigator.mediaSession && d > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: mainAudio.playbackRate,
        position: t,
      });
    } catch {}
  }
});

mainAudio.addEventListener("ended", () => {
  playPauseBtn.textContent = "▶";
  if (currentDocId) patchPosition(mainAudio.duration, mainAudio.duration);
});

progressBar.addEventListener("mousedown", () => { isDragging = true; });
progressBar.addEventListener("touchstart", () => { isDragging = true; });
progressBar.addEventListener("mouseup", () => { isDragging = false; });
progressBar.addEventListener("touchend", () => { isDragging = false; });

// ── Position persistence ──────────────────────────────────────────────────
function startPositionTracking() {
  if (positionInterval) clearInterval(positionInterval);
  positionInterval = setInterval(() => {
    if (!currentDocId || mainAudio.paused || !mainAudio.duration) return;
    patchPosition(mainAudio.currentTime, mainAudio.duration);
  }, 5000);
}

async function patchPosition(position, duration) {
  if (!currentDocId) return;
  try {
    await axios.patch(`${API_BASE_URL}/posts/${currentDocId}/position`, {
      position,
      duration_seconds: duration,
    });
  } catch {}
}

// ── Media Session API ─────────────────────────────────────────────────────
function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.setActionHandler("play",          () => mainAudio.play());
  navigator.mediaSession.setActionHandler("pause",         () => mainAudio.pause());
  navigator.mediaSession.setActionHandler("seekbackward",  () => skip(-15));
  navigator.mediaSession.setActionHandler("seekforward",   () => skip(15));
}

function updateMediaSession(title) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title,
    artist: "BlogStream",
    album: "My Library",
  });
}

// ── Ambient audio ─────────────────────────────────────────────────────────
function setAmbient(btn) {
  document.querySelectorAll(".ambient-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const src = btn.dataset.src;
  if (!src) {
    ambientAudio.pause();
    ambientAudio.src = "";
    return;
  }
  ambientAudio.src = src;
  ambientAudio.loop = true;
  ambientAudio.volume = parseFloat(document.getElementById("ambientVolume").value);
  ambientAudio.play().catch(() => {});
}

function setAmbientVolume(value) {
  ambientAudio.volume = parseFloat(value);
}

// ── PWA Install ───────────────────────────────────────────────────────────
let deferredPrompt = null;

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById("installBanner").classList.add("show");
  });

  document.getElementById("installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === "accepted") {
      document.getElementById("installBanner").classList.remove("show");
    }
  });
}

// ── Service Worker ────────────────────────────────────────────────────────
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function setStatus(html, type = "") {
  statusEl.innerHTML = html;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}
