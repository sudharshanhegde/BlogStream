import hashlib
import os
import re
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import cleanup
import cloudinary_client
import mongo_client
import scheduler
from tts import generate_mp3_bytes

load_dotenv()

app = FastAPI(title="BlogStream")

# ── CORS ────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

# ── In-memory job store ───────────────────────────────────────────────────
# doc_id → {"status": "processing"|"done"|"error", ...result fields}
jobs: dict[str, dict] = {}

# ── Startup / Shutdown ───────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    scheduler.start_keep_alive()


@app.on_event("shutdown")
async def shutdown():
    scheduler.stop_keep_alive()


# ── Available voices ─────────────────────────────────────────────────────────
VOICES = [
    # ── Female ──────────────────────────────────────────────────────────────
    {"id": "en-US-JennyNeural",            "label": "Jenny (US) — calm, clear",         "gender": "female"},
    {"id": "en-US-AriaNeural",             "label": "Aria (US) — warm, natural",         "gender": "female"},
    {"id": "en-US-SaraNeural",             "label": "Sara (US) — soft, gentle",          "gender": "female"},
    {"id": "en-US-EmmaNeural",             "label": "Emma (US) — expressive",            "gender": "female"},
    {"id": "en-GB-SoniaNeural",            "label": "Sonia (UK) — refined",              "gender": "female"},
    {"id": "en-AU-NatashaNeural",          "label": "Natasha (AU) — smooth",             "gender": "female"},
    {"id": "en-IN-NeerjaNeural",           "label": "Neerja (IN) — Indian English",      "gender": "female"},
    {"id": "en-IN-NeerjaExpressiveNeural", "label": "Neerja Expressive (IN) — lively",   "gender": "female"},
    # ── Male ────────────────────────────────────────────────────────────────
    {"id": "en-US-AndrewNeural",           "label": "Andrew (US) — confident",           "gender": "male"},
    {"id": "en-US-BrianNeural",            "label": "Brian (US) — deep, steady",         "gender": "male"},
    {"id": "en-US-ChristopherNeural",      "label": "Christopher (US) — clear, formal",  "gender": "male"},
    {"id": "en-US-EricNeural",             "label": "Eric (US) — friendly",              "gender": "male"},
    {"id": "en-GB-RyanNeural",             "label": "Ryan (UK) — British male",          "gender": "male"},
    {"id": "en-GB-ThomasNeural",           "label": "Thomas (UK) — crisp, British",      "gender": "male"},
    {"id": "en-IN-PrabhatNeural",          "label": "Prabhat (IN) — Indian English male","gender": "male"},
]
VOICE_IDS = {v["id"] for v in VOICES}


# ── Request / Response models ─────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    text: str
    voice: str


class PositionUpdate(BaseModel):
    position: float
    duration_seconds: float | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def compute_doc_id(text: str, voice: str) -> str:
    raw = (text + voice).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:12]


def build_sentence_cues(text: str, word_boundaries: list[dict]) -> list[dict]:
    raw = re.split(r'(?<=[.!?])\s+', text.strip())
    sentences = [s.strip() for s in raw if s.strip()]
    cues = []
    wb_idx = 0
    for sentence in sentences:
        word_count = len(sentence.split())
        start_t = word_boundaries[wb_idx]["t"] if wb_idx < len(word_boundaries) else 0.0
        cues.append({"t": start_t, "s": sentence})
        wb_idx = min(wb_idx + word_count, len(word_boundaries) - 1)
    return cues


# ── Background generation task ────────────────────────────────────────────

async def run_generation(doc_id: str, text: str, voice: str):
    """Runs after response is sent. Generates MP3, uploads, saves to MongoDB."""
    try:
        mp3_bytes, word_boundaries = await generate_mp3_bytes(text, voice)
        sentence_cues = build_sentence_cues(text, word_boundaries) if word_boundaries else []
        upload = cloudinary_client.upload_mp3(mp3_bytes, doc_id)
        title = text.strip()[:60]
        post = {
            "doc_id": doc_id,
            "title": title,
            "full_text": text,
            "voice": voice,
            "cloudinary_url": upload["url"],
            "cloudinary_public_id": upload["public_id"],
            "duration_seconds": 0,
            "position": 0.0,
            "size_bytes": upload["size_bytes"],
            "sentence_cues": sentence_cues,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        mongo_client.save_post(post)
        jobs[doc_id] = {
            "status": "done",
            "doc_id": doc_id,
            "audio_url": upload["url"],
            "title": title,
            "sentence_cues": sentence_cues,
        }
    except Exception as e:
        jobs[doc_id] = {"status": "error", "detail": str(e)}


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/voices")
def get_voices():
    return VOICES


@app.post("/generate")
async def generate(req: GenerateRequest, background_tasks: BackgroundTasks):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")
    if req.voice not in VOICE_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown voice: {req.voice}")

    doc_id = compute_doc_id(req.text, req.voice)

    # Cache hit in MongoDB — return immediately
    existing = mongo_client.get_post(doc_id)
    if existing:
        return {
            "doc_id": existing["doc_id"],
            "audio_url": existing["cloudinary_url"],
            "title": existing["title"],
            "sentence_cues": existing.get("sentence_cues", []),
            "status": "done",
            "cached": True,
        }

    # Already processing in this server session
    if doc_id in jobs:
        return {"doc_id": doc_id, "status": jobs[doc_id]["status"], **jobs[doc_id]}

    # Start background generation — return immediately
    jobs[doc_id] = {"status": "processing"}
    background_tasks.add_task(run_generation, doc_id, req.text, req.voice)

    return {
        "doc_id": doc_id,
        "status": "processing",
        "title": req.text.strip()[:60],
    }


@app.get("/jobs/{doc_id}")
def get_job(doc_id: str):
    """Poll this to check if a background generation job is done."""
    # Check in-memory jobs first (fast path)
    if doc_id in jobs:
        return jobs[doc_id]
    # Fall back to MongoDB (handles server restarts)
    existing = mongo_client.get_post(doc_id)
    if existing:
        return {
            "status": "done",
            "doc_id": existing["doc_id"],
            "audio_url": existing["cloudinary_url"],
            "title": existing["title"],
            "sentence_cues": existing.get("sentence_cues", []),
        }
    return {"status": "not_found"}


@app.get("/posts")
def list_posts():
    return mongo_client.get_all_posts()


@app.get("/posts/{doc_id}")
def get_post(doc_id: str):
    post = mongo_client.get_post(doc_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


@app.patch("/posts/{doc_id}/position")
def update_position(doc_id: str, body: PositionUpdate):
    post = mongo_client.get_post(doc_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    mongo_client.update_position(doc_id, body.position)
    if body.duration_seconds is not None and body.duration_seconds > 0:
        mongo_client.update_duration(doc_id, body.duration_seconds)
    return {"ok": True}


@app.delete("/posts/{doc_id}")
def delete_post(doc_id: str):
    post = mongo_client.delete_post(doc_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    try:
        cloudinary_client.delete_asset(post["cloudinary_public_id"])
    except Exception:
        pass
    return {"ok": True, "doc_id": doc_id}


@app.post("/cleanup")
def run_cleanup():
    result = cleanup.run_cleanup()
    return result
