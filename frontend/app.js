// ── Config ────────────────────────────────────────────────────────────────
const API_BASE_URL = "https://blogstream-0ae1.onrender.com";

// ── State ─────────────────────────────────────────────────────────────────
let currentDocId = null;
let positionInterval = null;
let isDragging = false;
let sentenceCues = [];       // [{t: seconds, s: "sentence text"}, ...]
let activeSentenceIdx = -1;
let readAlongOpen = false;

// ── Elements ──────────────────────────────────────────────────────────────
const mainAudio     = document.getElementById("mainAudio");
const ambientAudio  = document.getElementById("ambientAudio");
const generateBtn   = document.getElementById("generateBtn");
const textInput     = document.getElementById("textInput");
const voiceSelect   = document.getElementById("voiceSelect");
const statusEl      = document.getElementById("status");
const playerTitle   = document.getElementById("playerTitle");
const playPauseBtn  = document.getElementById("playPauseBtn");
const progressBar   = document.getElementById("progressBar");
const currentTimeEl = document.getElementById("currentTime");
const totalTimeEl   = document.getElementById("totalTime");

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
    const female = voices.filter(v => v.gender === "female");
    const male   = voices.filter(v => v.gender === "male");
    voiceSelect.innerHTML =
      `<optgroup label="Female">` +
      female.map(v => `<option value="${v.id}">${v.label}</option>`).join("") +
      `</optgroup>` +
      `<optgroup label="Male">` +
      male.map(v => `<option value="${v.id}" ${v.id === "en-IN-PrabhatNeural" ? "selected" : ""}>${v.label}</option>`).join("") +
      `</optgroup>`;
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
    loadPost(post.doc_id, post.cloudinary_url, post.title, post.position, post.sentence_cues || []);
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

  const text = cleanTextForTTS(raw);
  if (!text) { setStatus("Nothing left to read after cleaning.", "error"); return; }

  generateBtn.disabled = true;
  setStatus('<span class="spinner"></span>Starting…');

  try {
    const { data } = await axios.post(`${API_BASE_URL}/generate`, { text, voice });

    if (data.status === "done") {
      // Cache hit — load immediately
      setStatus(data.cached ? "Loaded from cache." : "Audio ready!", "success");
      loadPost(data.doc_id, data.audio_url, data.title, 0, data.sentence_cues || []);
    } else {
      // Background job started — hand off to notification system
      setStatus("Generating in background — you can navigate freely.", "success");
      window._audioLoaded = false;
      jobStarted(data.doc_id, data.title);
    }
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
function loadPost(docId, audioUrl, title, savedPosition, cues = []) {
  currentDocId = docId;
  playerTitle.textContent = title;
  mainAudio.src = audioUrl;

  // Store sentence cues and re-render read-along if it's open
  sentenceCues = cues;
  activeSentenceIdx = -1;
  if (readAlongOpen) renderSentences();

  // IMPORTANT: restore position inside loadedmetadata event
  mainAudio.addEventListener("loadedmetadata", function onLoaded() {
    mainAudio.removeEventListener("loadedmetadata", onLoaded);
    if (savedPosition > 0) {
      mainAudio.currentTime = savedPosition;
    }
    progressBar.max = mainAudio.duration || 100;
    totalTimeEl.textContent = formatTime(mainAudio.duration);
    patchPosition(mainAudio.currentTime, mainAudio.duration);
    mainAudio.play().catch(() => {});
  }, { once: false });

  updateMediaSession(title);
  startPositionTracking();
}

// ── Playback controls ─────────────────────────────────────────────────────
function togglePlay() {
  if (!mainAudio.src) return;
  mainAudio.paused ? mainAudio.play() : mainAudio.pause();
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
mainAudio.addEventListener("play",  () => { playPauseBtn.textContent = "⏸"; });
mainAudio.addEventListener("pause", () => { playPauseBtn.textContent = "▶"; });

mainAudio.addEventListener("timeupdate", () => {
  if (isDragging) return;
  const t = mainAudio.currentTime;
  const d = mainAudio.duration || 0;
  progressBar.value = t;
  currentTimeEl.textContent = formatTime(t);

  if (navigator.mediaSession && d > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: mainAudio.playbackRate,
        position: t,
      });
    } catch {}
  }

  // Read-along highlight
  if (readAlongOpen && sentenceCues.length > 0) {
    syncSentenceHighlight(t);
  }
});

mainAudio.addEventListener("ended", () => {
  playPauseBtn.textContent = "▶";
  if (currentDocId) patchPosition(mainAudio.duration, mainAudio.duration);
});

progressBar.addEventListener("mousedown",  () => { isDragging = true; });
progressBar.addEventListener("touchstart", () => { isDragging = true; });
progressBar.addEventListener("mouseup",    () => { isDragging = false; });
progressBar.addEventListener("touchend",   () => { isDragging = false; });

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

// ── Read Along ────────────────────────────────────────────────────────────
function toggleReadAlong() {
  readAlongOpen = !readAlongOpen;
  const card = document.getElementById("readAlongCard");
  const btn  = document.getElementById("readAlongBtn");

  if (readAlongOpen) {
    card.classList.remove("hidden");
    btn.classList.add("active");
    renderSentences();
    // Immediately sync to current position
    if (sentenceCues.length > 0) syncSentenceHighlight(mainAudio.currentTime);
  } else {
    closeReadAlong();
  }
}

function closeReadAlong() {
  readAlongOpen = false;
  document.getElementById("readAlongCard").classList.add("hidden");
  document.getElementById("readAlongBtn").classList.remove("active");
}

function renderSentences() {
  const container = document.getElementById("sentenceContainer");
  if (sentenceCues.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No sentence data. Generate new audio to enable Read Along.</p>';
    return;
  }
  container.innerHTML = sentenceCues
    .map((cue, i) => `<p class="sentence" data-index="${i}" onclick="seekToSentence(${i})">${escapeHtml(cue.s)}</p>`)
    .join("");
  activeSentenceIdx = -1;
}

function syncSentenceHighlight(currentTime) {
  // Find the last sentence whose start time is <= currentTime
  let idx = 0;
  for (let i = 0; i < sentenceCues.length; i++) {
    if (sentenceCues[i].t <= currentTime) idx = i;
    else break;
  }

  if (idx === activeSentenceIdx) return;
  activeSentenceIdx = idx;

  const container = document.getElementById("sentenceContainer");
  container.querySelectorAll(".sentence").forEach((el, i) => {
    el.classList.toggle("active", i === idx);
    el.classList.toggle("past",   i < idx);
  });

  // Scroll active sentence into view
  const activeEl = container.querySelector(".sentence.active");
  if (activeEl) {
    activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function seekToSentence(idx) {
  if (!mainAudio.src || !sentenceCues[idx]) return;
  mainAudio.currentTime = sentenceCues[idx].t;
  if (mainAudio.paused) mainAudio.play();
}

// ── Media Session API ─────────────────────────────────────────────────────
function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.setActionHandler("play",         () => mainAudio.play());
  navigator.mediaSession.setActionHandler("pause",        () => mainAudio.pause());
  navigator.mediaSession.setActionHandler("seekbackward", () => skip(-15));
  navigator.mediaSession.setActionHandler("seekforward",  () => skip(15));
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

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(html, type = "") {
  statusEl.innerHTML = html;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}
