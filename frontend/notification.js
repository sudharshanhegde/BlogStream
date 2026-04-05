/**
 * notification.js
 * Shared across index.html and library.html.
 * Polls a background generation job and shows a floating banner.
 * Job state is stored in localStorage so it survives page navigation.
 *
 * localStorage key: "bsJob" → JSON {doc_id, title, startedAt}
 */

const JOB_KEY = "bsJob";
const _API = "https://blogstream-0ae1.onrender.com";
let _pollTimer = null;
let _bannerEl  = null;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Call this right after POST /generate returns {status:"processing"}.
 */
function jobStarted(docId, title) {
  localStorage.setItem(JOB_KEY, JSON.stringify({ doc_id: docId, title, startedAt: Date.now() }));
  showBanner("generating", title, docId);
  startPolling(docId, title);
}

/**
 * Call on every page load to resume polling if a job is pending.
 */
function resumePendingJob() {
  const raw = localStorage.getItem(JOB_KEY);
  if (!raw) return;
  try {
    const { doc_id, title, startedAt } = JSON.parse(raw);
    // Abandon jobs older than 10 minutes (something went wrong)
    if (Date.now() - startedAt > 10 * 60 * 1000) {
      localStorage.removeItem(JOB_KEY);
      return;
    }
    showBanner("generating", title, doc_id);
    startPolling(doc_id, title);
  } catch {
    localStorage.removeItem(JOB_KEY);
  }
}

// ── Internal ──────────────────────────────────────────────────────────────

function startPolling(docId, title) {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(async () => {
    try {
      const { data } = await axios.get(`${_API}/jobs/${docId}`);
      if (data.status === "done") {
        clearInterval(_pollTimer);
        _pollTimer = null;
        localStorage.removeItem(JOB_KEY);
        showBanner("done", data.title || title, docId);
        // If we're on the player page and no audio is loaded yet, auto-load it
        if (typeof loadPost === "function" && !window._audioLoaded) {
          loadPost(data.doc_id, data.audio_url, data.title, 0, data.sentence_cues || []);
          window._audioLoaded = true;
        }
        // Auto-hide banner after 8 seconds
        setTimeout(hideBanner, 8000);
      } else if (data.status === "error") {
        clearInterval(_pollTimer);
        _pollTimer = null;
        localStorage.removeItem(JOB_KEY);
        showBanner("error", title, docId);
        setTimeout(hideBanner, 6000);
      }
    } catch {
      // Network blip — keep polling
    }
  }, 2000);
}

function showBanner(state, title, docId) {
  if (!_bannerEl) {
    _bannerEl = document.createElement("div");
    _bannerEl.id = "jobBanner";
    document.body.appendChild(_bannerEl);
  }

  const short = title.length > 40 ? title.slice(0, 40) + "…" : title;

  if (state === "generating") {
    _bannerEl.className = "job-banner generating";
    _bannerEl.innerHTML = `
      <span class="job-banner-spinner"></span>
      <span>Generating "<strong>${escapeForBanner(short)}</strong>"…</span>
      <button onclick="hideBanner()">✕</button>
    `;
  } else if (state === "done") {
    _bannerEl.className = "job-banner done";
    _bannerEl.innerHTML = `
      <span>🎵</span>
      <span>Ready: "<strong>${escapeForBanner(short)}</strong>"</span>
      <a href="index.html?doc_id=${docId}">▶ Play</a>
      <button onclick="hideBanner()">✕</button>
    `;
  } else {
    _bannerEl.className = "job-banner error";
    _bannerEl.innerHTML = `
      <span>⚠</span>
      <span>Generation failed for "<strong>${escapeForBanner(short)}</strong>"</span>
      <button onclick="hideBanner()">✕</button>
    `;
  }

  _bannerEl.style.display = "flex";
}

function hideBanner() {
  if (_bannerEl) _bannerEl.style.display = "none";
}

function escapeForBanner(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Auto-resume on load ───────────────────────────────────────────────────
window.addEventListener("load", resumePendingJob);
