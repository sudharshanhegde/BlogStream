import io
import os
import cloudinary
import cloudinary.uploader
import cloudinary.api
from dotenv import load_dotenv

load_dotenv()

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
)


def upload_mp3(mp3_bytes: bytes, doc_id: str) -> dict:
    """Upload MP3 bytes to Cloudinary. Returns url and public_id."""
    buffer = io.BytesIO(mp3_bytes)
    result = cloudinary.uploader.upload(
        buffer,
        resource_type="raw",
        public_id=doc_id,
        folder="notecast",
        overwrite=True,
    )
    return {
        "url": result["secure_url"],
        "public_id": result["public_id"],
        "size_bytes": result.get("bytes", len(mp3_bytes)),
    }


def delete_asset(public_id: str) -> None:
    """Delete a Cloudinary asset by public_id."""
    cloudinary.uploader.destroy(public_id, resource_type="raw")


def get_usage() -> dict:
    """Return current Cloudinary storage usage."""
    return cloudinary.api.usage()
