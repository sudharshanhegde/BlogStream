import io
import edge_tts


async def generate_mp3_bytes(text: str, voice: str) -> tuple[bytes, list[dict]]:
    """
    Generate MP3 audio bytes from text using edge-tts. Fully in-memory.
    Also collects word boundary timestamps (offset in 100-nanosecond ticks).
    Returns (mp3_bytes, word_boundaries) where each boundary is:
        {"t": seconds_float, "w": "word_text"}
    """
    communicate = edge_tts.Communicate(text, voice)
    buffer = io.BytesIO()
    word_boundaries = []

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buffer.write(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            # offset is in 100-nanosecond ticks → convert to seconds
            seconds = round(chunk["offset"] / 10_000_000, 3)
            word_boundaries.append({"t": seconds, "w": chunk["text"]})

    buffer.seek(0)
    return buffer.read(), word_boundaries
