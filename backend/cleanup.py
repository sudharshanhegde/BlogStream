import cloudinary_client
import mongo_client

STORAGE_LIMIT_GB = 25.0
HIGH_THRESHOLD = 0.80  # 80% of 25GB → 20GB
LOW_THRESHOLD = 0.60   # stop when below 60% → 15GB


def run_cleanup() -> dict:
    usage = cloudinary_client.get_usage()
    used_bytes = usage.get("storage", {}).get("usage", 0)
    limit_bytes = STORAGE_LIMIT_GB * 1024 ** 3

    if used_bytes < limit_bytes * HIGH_THRESHOLD:
        return {"deleted_count": 0, "storage_freed_mb": 0.0, "message": "Storage within limits"}

    deleted_count = 0
    freed_bytes = 0

    posts = mongo_client.get_oldest_posts(limit=500)
    for post in posts:
        # Re-check usage periodically (every 10 deletes) to avoid over-deleting
        if deleted_count > 0 and deleted_count % 10 == 0:
            usage = cloudinary_client.get_usage()
            used_bytes = usage.get("storage", {}).get("usage", 0)
            if used_bytes < limit_bytes * LOW_THRESHOLD:
                break

        size = post.get("size_bytes", 0)
        try:
            cloudinary_client.delete_asset(post["cloudinary_public_id"])
        except Exception:
            pass
        mongo_client.delete_post(post["doc_id"])
        freed_bytes += size
        deleted_count += 1

    return {
        "deleted_count": deleted_count,
        "storage_freed_mb": round(freed_bytes / (1024 ** 2), 2),
    }
