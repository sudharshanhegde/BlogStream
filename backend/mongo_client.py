import os
from datetime import datetime, timezone
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.collection import Collection
from dotenv import load_dotenv

load_dotenv()

_client: MongoClient | None = None
_collection: Collection | None = None


def get_collection() -> Collection:
    global _client, _collection
    if _collection is None:
        uri = os.getenv("MONGODB_URI")
        _client = MongoClient(uri)
        db = _client.get_database("notecast")
        _collection = db["posts"]
        # Ensure indexes
        _collection.create_index("doc_id", unique=True)
        _collection.create_index([("created_at", ASCENDING)])
    return _collection


def get_post(doc_id: str) -> dict | None:
    col = get_collection()
    return col.find_one({"doc_id": doc_id}, {"_id": 0})


def get_all_posts() -> list[dict]:
    col = get_collection()
    return list(col.find({}, {"_id": 0}).sort("created_at", DESCENDING))


def save_post(post: dict) -> None:
    col = get_collection()
    col.insert_one(post)


def update_position(doc_id: str, position: float) -> None:
    col = get_collection()
    col.update_one({"doc_id": doc_id}, {"$set": {"position": position}})


def update_duration(doc_id: str, duration_seconds: float) -> None:
    col = get_collection()
    col.update_one({"doc_id": doc_id}, {"$set": {"duration_seconds": duration_seconds}})


def delete_post(doc_id: str) -> dict | None:
    col = get_collection()
    return col.find_one_and_delete({"doc_id": doc_id}, {"_id": 0})


def get_oldest_posts(limit: int = 100) -> list[dict]:
    col = get_collection()
    return list(col.find({}, {"_id": 0}).sort("created_at", ASCENDING).limit(limit))
