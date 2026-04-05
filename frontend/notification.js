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
let _pollTimer  = null;
let _bannerEl   = null;
let _onDoneCb   = null; // optional callback set by the player page

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Call after POST /generate returns {status:"processing"}.
 * onDone(result) is called on the same page when the job finishes.
 */
function jobStarted(docId, title, onDone = null) {
  _onDoneCb = onDone;
  localStorage.setItem(JOB_KEY, JSON.stringify({ doc_id: docId, title, startedAt: Date.now() }));
  showBanner("generating", title, docId);
  startPolling(docId, title);
}

/**
 * Called on every page load — resumes polling if a job is still pending.
 */
function resumePendingJob() {
  const raw = localStorage.getItem(JOB_KEY);
  if (!raw) return;
  try {
    const { doc_id, title, startedAt } = JSON.parse(raw);
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
        setTimeout(hideBanner, 8000);

        // If caller gave us a callback (player page), use it
        if (typeof _onDoneCb === "function") {
          _onDoneCb(data);
          _onDoneCb = null;
        }

      } else if (data.status === "error") {
        clearInterval(_pollTimer);
        _pollTimer = null;
        localStorage.removeItem(JOB_KEY);
        showBanner("error", title, docId);
        setTimeout(hideBanner, 6000);
      }
      // "processing" or "not_found" → keep polling
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
