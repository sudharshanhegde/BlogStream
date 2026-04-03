// ── Config ────────────────────────────────────────────────────────────────
const API_BASE_URL = "https://blogstream-0ae1.onrender.com";

// ── Init ──────────────────────────────────────────────────────────────────
(async function init() {
  await loadLibrary();
})();

// ── Load all posts ────────────────────────────────────────────────────────
async function loadLibrary() {
  const grid = document.getElementById("libraryGrid");
  const statusEl = document.getElementById("status");

  try {
    const { data: posts } = await axios.get(`${API_BASE_URL}/posts`);

    if (posts.length === 0) {
      grid.innerHTML = '<div class="empty-state">Your library is empty.<br>Generate some audio on the player page.</div>';
      return;
    }

    grid.innerHTML = posts.map(post => renderCard(post)).join("");
    attachCardListeners();
  } catch (e) {
    grid.innerHTML = '<div class="empty-state">Could not load library.</div>';
    setStatus("Error: " + e.message, "error");
  }
}

// ── Render a post card ────────────────────────────────────────────────────
function renderCard(post) {
  const dur = post.duration_seconds || 0;
  const pos = post.position || 0;
  const created = new Date(post.created_at).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric"
  });

  let posLabel, posClass;
  if (pos === 0 || dur === 0) {
    posLabel = "Not started";
    posClass = "not-started";
  } else if (pos >= dur - 5) {
    posLabel = "Completed ✓";
    posClass = "completed";
  } else {
    posLabel = `Paused at ${formatTime(pos)}`;
    posClass = "";
  }

  return `
    <div class="post-card" data-doc-id="${post.doc_id}">
      <div class="post-card-title">${escapeHtml(post.title)}</div>
      <div class="post-card-meta">
        <span>${dur > 0 ? formatTime(dur) : "—"} &nbsp;·&nbsp; ${created}</span>
        <span class="post-card-position ${posClass}">${posLabel}</span>
      </div>
      <div class="post-card-actions">
        <button
          class="btn btn-danger"
          data-doc-id="${post.doc_id}"
          onclick="deletePost(event, '${post.doc_id}')"
        >Delete</button>
      </div>
    </div>
  `;
}

// ── Card click → player ───────────────────────────────────────────────────
function attachCardListeners() {
  document.querySelectorAll(".post-card").forEach(card => {
    card.addEventListener("click", (e) => {
      // Don't navigate if the delete button was clicked
      if (e.target.closest(".btn-danger")) return;
      const docId = card.dataset.docId;
      window.location.href = `index.html?doc_id=${docId}`;
    });
  });
}

// ── Delete a post ─────────────────────────────────────────────────────────
async function deletePost(event, docId) {
  event.stopPropagation();
  if (!confirm("Delete this post? This cannot be undone.")) return;

  try {
    await axios.delete(`${API_BASE_URL}/posts/${docId}`);
    // Remove from DOM
    const card = document.querySelector(`.post-card[data-doc-id="${docId}"]`);
    if (card) card.remove();
    // Show empty state if grid is now empty
    const grid = document.getElementById("libraryGrid");
    if (!grid.querySelector(".post-card")) {
      grid.innerHTML = '<div class="empty-state">Your library is empty.<br>Generate some audio on the player page.</div>';
    }
  } catch (e) {
    setStatus("Error: " + e.message, "error");
  }
}

// ── Cleanup storage ───────────────────────────────────────────────────────
async function runCleanup() {
  setStatus("Running storage cleanup…");
  try {
    const { data } = await axios.post(`${API_BASE_URL}/cleanup`);
    if (data.deleted_count > 0) {
      alert(`Cleanup complete.\nDeleted: ${data.deleted_count} posts\nFreed: ${data.storage_freed_mb} MB`);
      await loadLibrary();
    } else {
      alert(data.message || "Storage is within limits. Nothing to clean up.");
    }
    setStatus("");
  } catch (e) {
    setStatus("Cleanup error: " + e.message, "error");
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
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function setStatus(text, type = "") {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = "status" + (type ? ` ${type}` : "");
}
