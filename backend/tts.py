import asyncio
import io
import edge_tts


async def generate_mp3_bytes(text: str, voice: str) -> bytes:
    """Generate MP3 audio bytes from text using edge-tts. Fully in-memory."""
    communicate = edge_tts.Communicate(text, voice)
    buffer = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buffer.write(chunk["data"])
    buffer.seek(0)
    return buffer.read()
