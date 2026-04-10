import os
import sys
from datetime import datetime, timezone

from pymongo import MongoClient


def main():
    source_uri = os.environ.get("SOURCE_MONGO_URL", "").strip()
    source_db_name = os.environ.get("SOURCE_DB_NAME", "").strip()
    target_uri = os.environ.get("TARGET_MONGO_URL", "").strip()
    target_db_name = os.environ.get("TARGET_DB_NAME", "").strip()

    if not source_uri or not source_db_name or not target_uri or not target_db_name:
        print(
            "Missing required env vars. Need SOURCE_MONGO_URL, SOURCE_DB_NAME, TARGET_MONGO_URL, TARGET_DB_NAME.",
            file=sys.stderr,
        )
        return 1

    print(f"[{datetime.now(timezone.utc).isoformat()}] Connecting to source database '{source_db_name}'...")
    source_client = MongoClient(source_uri, serverSelectionTimeoutMS=30000)
    source_client.admin.command("ping")
    source_db = source_client[source_db_name]

    print(f"[{datetime.now(timezone.utc).isoformat()}] Connecting to target database '{target_db_name}'...")
    target_client = MongoClient(target_uri, serverSelectionTimeoutMS=30000)
    target_client.admin.command("ping")
    target_db = target_client[target_db_name]

    collections = sorted(source_db.list_collection_names())
    print(f"[{datetime.now(timezone.utc).isoformat()}] Found {len(collections)} collections.")
    if not collections:
        print("No collections found. Nothing to migrate.")
        return 0

    for collection_name in collections:
        source_collection = source_db[collection_name]
        target_collection = target_db[collection_name]
        count = source_collection.count_documents({})
        print(f"-> {collection_name}: {count} documents")

        target_collection.drop()

        if count == 0:
            continue

        batch = []
        inserted = 0
        cursor = source_collection.find({})
        for document in cursor:
            batch.append(document)
            if len(batch) >= 500:
                target_collection.insert_many(batch, ordered=False)
                inserted += len(batch)
                print(f"   inserted {inserted}/{count}")
                batch = []
        if batch:
            target_collection.insert_many(batch, ordered=False)
            inserted += len(batch)
            print(f"   inserted {inserted}/{count}")

    print(f"[{datetime.now(timezone.utc).isoformat()}] Migration complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
