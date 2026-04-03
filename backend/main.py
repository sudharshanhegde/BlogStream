import hashlib
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
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
frontend_url = os.getenv("FRONTEND_URL")
origins = [frontend_url] if frontend_url else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

# ── Startup / Shutdown ───────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    scheduler.start_keep_alive()


@app.on_event("shutdown")
async def shutdown():
    scheduler.stop_keep_alive()


# ── Available voices ─────────────────────────────────────────────────────────
VOICES = [
    {"id": "en-US-JennyNeural",   "label": "Jenny (US) — calm, clear"},
    {"id": "en-US-AriaNeural",    "label": "Aria (US) — warm, natural"},
    {"id": "en-US-SaraNeural",    "label": "Sara (US) — soft, gentle"},
    {"id": "en-GB-SoniaNeural",   "label": "Sonia (UK) — refined"},
    {"id": "en-AU-NatashaNeural", "label": "Natasha (AU) — smooth"},
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


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/voices")
def get_voices():
    return VOICES


@app.post("/generate")
async def generate(req: GenerateRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")
    if req.voice not in VOICE_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown voice: {req.voice}")

    doc_id = compute_doc_id(req.text, req.voice)

    # Cache hit — return existing post
    existing = mongo_client.get_post(doc_id)
    if existing:
        return {
            "doc_id": existing["doc_id"],
            "audio_url": existing["cloudinary_url"],
            "title": existing["title"],
            "cached": True,
        }

    # Generate MP3 in memory
    mp3_bytes = await generate_mp3_bytes(req.text, req.voice)

    # Upload to Cloudinary
    upload = cloudinary_client.upload_mp3(mp3_bytes, doc_id)

    title = req.text.strip()[:60]
    post = {
        "doc_id": doc_id,
        "title": title,
        "full_text": req.text,
        "voice": req.voice,
        "cloudinary_url": upload["url"],
        "cloudinary_public_id": upload["public_id"],
        "duration_seconds": 0,
        "position": 0.0,
        "size_bytes": upload["size_bytes"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    mongo_client.save_post(post)

    return {
        "doc_id": doc_id,
        "audio_url": upload["url"],
        "title": title,
        "cached": False,
    }


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
