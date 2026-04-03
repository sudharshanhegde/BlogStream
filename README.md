# BlogStream

A Spotify-like text-to-audio PWA. Paste text or a blog post → get a permanent MP3 hosted on Cloudinary → playable from anywhere, with lock screen controls and resume from exact position.

---

## What is this project

BlogStream is a text-to-audio progressive web app that lets you listen to your notes, blog posts, and articles like podcasts. It uses a centralized backend (FastAPI) that converts text to MP3 using edge-tts, uploads the audio permanently to Cloudinary, and saves metadata and playback position to MongoDB Atlas. The frontend plays the Cloudinary URL exactly like a podcast episode — seekable, pausable, resumable from any position, even on the lock screen. Since it is a PWA, it can be installed on your phone and audio continues playing in the background when you switch apps.

---

## Architecture

```
User pastes text
      ↓
FastAPI backend calls edge-tts → MP3 generated in memory
      ↓
MP3 uploaded to Cloudinary → permanent URL returned
      ↓
Metadata (title, voice, URL, duration, position) saved to MongoDB Atlas
      ↓
Frontend receives Cloudinary URL + doc_id
      ↓
HTML5 audio element plays the Cloudinary URL
      ↓
currentTime saved to MongoDB every 5 seconds (keyed by doc_id)
      ↓
On resume → fetch position from MongoDB → seek → continue
      ↓
Media Session API → lock screen controls (play/pause/seek)
      ↓
PWA manifest + service worker → installable on mobile, audio survives app switch
      ↓
Library page → lists all saved posts from MongoDB → tap any to resume
```

---

## Backend — `main.py` (FastAPI, port 8000)

The central API server. It does not store audio files itself — it only orchestrates generation, upload, and metadata tracking.

**API Endpoints**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/generate` | Generate MP3, upload to Cloudinary, save to MongoDB |
| GET | `/posts` | Return all saved posts sorted newest first |
| GET | `/posts/{doc_id}` | Return single post metadata including saved position |
| PATCH | `/posts/{doc_id}/position` | Update playback position (called every 5s during playback) |
| DELETE | `/posts/{doc_id}` | Delete post from MongoDB and Cloudinary |
| GET | `/voices` | Return list of available English neural voices |
| POST | `/cleanup` | Delete oldest posts when Cloudinary storage exceeds 80% |
| GET | `/health` | Health check for self-ping keep-alive |

**Cache layer**

`doc_id` is computed as `sha256(text + voice)[:12]`. Before calling edge-tts, `/generate` checks MongoDB for an existing post with that `doc_id`. If found, it returns the existing audio URL immediately — no re-generation. This means the same text+voice combination is only ever converted once.

**CORS**

CORS middleware is added before any routes. It allows the origin set in `FRONTEND_URL` env var. When `FRONTEND_URL` is not set (local dev), it allows all origins.

---

## TTS — `tts.py`

Wraps `edge_tts.Communicate` and collects all audio chunks into a `BytesIO` buffer in memory. No files are ever written to disk — the Render filesystem is ephemeral so disk writes would not survive a restart.

```python
communicate = edge_tts.Communicate(text, voice)
buffer = io.BytesIO()
async for chunk in communicate.stream():
    if chunk["type"] == "audio":
        buffer.write(chunk["data"])
```

---

## Cloudinary — `cloudinary_client.py`

Uploads the in-memory MP3 buffer to Cloudinary using `resource_type="raw"` (required for MP3, not "video" or "image"). Each file is stored under `folder="notecast"` with `public_id=doc_id`.

```python
cloudinary.uploader.upload(
    buffer,
    resource_type="raw",
    public_id=doc_id,
    folder="notecast",
)
```

---

## MongoDB — `mongo_client.py`

Stores post metadata in a `posts` collection. Two indexes are created on startup:

- `doc_id` — unique index, prevents duplicate generation if Generate is clicked twice
- `created_at` — ascending index, used by cleanup to find the oldest posts

**Document shape**

```json
{
  "doc_id": "a3f9c1d2ef12",
  "title": "First 60 chars of the text...",
  "full_text": "...",
  "voice": "en-US-JennyNeural",
  "cloudinary_url": "https://res.cloudinary.com/.../a3f9c1d2ef12",
  "cloudinary_public_id": "notecast/a3f9c1d2ef12",
  "duration_seconds": 342,
  "position": 142.5,
  "size_bytes": 5480000,
  "created_at": "2026-04-03T10:22:00Z"
}
```

---

## Scheduler — `scheduler.py`

On app startup, if `RENDER_EXTERNAL_URL` env var is present, APScheduler starts a job that pings `/health` every 10 minutes. This keeps the Render free-tier instance awake. If the env var is not set (local dev), the scheduler is silently skipped.

---

## Cleanup — `cleanup.py`

Called via `POST /cleanup`. Checks Cloudinary storage usage. If usage exceeds 80% of the 25GB free tier (20GB), it deletes the oldest posts one by one until usage drops below 60%. For each deleted post it removes the file from Cloudinary and the document from MongoDB.

---

## Frontend

**Two pages**

- `index.html` + `app.js` — the player. Textarea to paste text, voice selector, generate button, audio controls, ambient sound mixer.
- `library.html` + `library.js` — lists all saved posts as cards. Each card shows title, duration, and playback status (Not started / Paused at mm:ss / Completed).

**Text parser — `parser.js`**

Before sending text to the backend, `cleanTextForTTS()` is called. It keeps all content including code, but strips characters that sound bad when read aloud. `#include <stdio.h>` becomes `include stdio.h`. Fenced code block markers, HTML tags, markdown syntax, and symbols like `# < > { } [ ] ( ) ; = + *` are all stripped. Plain prose and code keywords are preserved.

**Position persistence**

Every 5 seconds during playback, the frontend calls `PATCH /posts/{doc_id}/position` with the current `audio.currentTime`. On load, the saved position is restored inside the `loadedmetadata` event (not before setting `audio.src` — seeking before metadata loads has no effect).

```js
audio.addEventListener('loadedmetadata', () => {
    audio.currentTime = savedPosition;
});
```

**Media Session API**

Sets lock screen metadata (title, artist, album) and registers handlers for play, pause, seekbackward (−15s), and seekforward (+15s). `setPositionState` is called on every `timeupdate` event so the lock screen scrubber stays accurate.

**Ambient audio**

A separate `<audio>` element with `loop = true`. Has its own volume slider. Completely independent from the main player — does not affect position tracking.

**PWA**

`manifest.json` sets `display: standalone` so the app opens without browser chrome. `sw.js` caches all frontend assets (HTML, CSS, JS, ambient MP3s) on install using a cache-first strategy. Cloudinary audio URLs are served network-only (files are large, no point caching). Backend API calls are also network-only.

---

## Available voices

| ID | Label |
|----|-------|
| en-US-JennyNeural | Jenny (US) — calm, clear |
| en-US-AriaNeural | Aria (US) — warm, natural |
| en-US-SaraNeural | Sara (US) — soft, gentle |
| en-GB-SoniaNeural | Sonia (UK) — refined |
| en-AU-NatashaNeural | Natasha (AU) — smooth |

---

## How to build and run locally

**Clone and set up backend**

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Fill in Cloudinary and MongoDB Atlas credentials in .env
```

**Run the backend**

```bash
uvicorn main:app --reload --port 8000
```

Open `http://localhost:8000/docs` to verify all endpoints are live.

**Run the frontend**

```bash
cd frontend
python3 -m http.server 3000
```

Open `http://localhost:3000`

**CLI test order**

```
1. http://localhost:8000/health          → {"status":"ok"}
2. http://localhost:8000/voices          → list of 5 voices
3. Paste text → Generate → audio plays
4. Same text again → loads from cache instantly
5. Refresh page → resumes from saved position
6. http://localhost:3000/library.html    → post appears with position label
```

---

## Dependencies

**Backend**

| Package | Purpose |
|---------|---------|
| fastapi | API framework |
| uvicorn | ASGI server |
| edge-tts | Microsoft neural TTS |
| cloudinary | MP3 storage |
| pymongo | MongoDB driver |
| apscheduler | Self-ping scheduler |
| httpx | Async HTTP client |
| python-dotenv | .env loading |

**Frontend**

| Library | Version | Purpose |
|---------|---------|---------|
| axios | 1.7.9 | HTTP requests to backend |

---

## Deployment

**Backend → Render (free tier)**

- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Set these env vars in Render dashboard: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `MONGODB_URI`, `FRONTEND_URL`
- `RENDER_EXTERNAL_URL` is set automatically by Render — self-ping activates on deploy

**Frontend → Vercel (free tier)**

- Root directory: `frontend/`
- Before deploying, change `API_BASE_URL` in `app.js` and `library.js` to your Render URL
- Set `FRONTEND_URL` in Render dashboard to your Vercel URL so CORS allows it

---

## Environment variables

```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
RENDER_EXTERNAL_URL=                  # leave blank for local dev
FRONTEND_URL=                         # leave blank for local dev
```

---

Yes this is long, but I hope you understood. Thank you.
