import os
import sys
import types
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _stub_optional_dependencies():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "cognivio_test")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
    if "boto3" not in sys.modules:
        boto3_stub = types.ModuleType("boto3")

        class _Session:
            def client(self, *args, **kwargs):
                return object()

        boto3_stub.session = types.SimpleNamespace(Session=_Session)
        sys.modules["boto3"] = boto3_stub
    if "botocore.exceptions" not in sys.modules:
        botocore_stub = types.ModuleType("botocore")
        botocore_exceptions_stub = types.ModuleType("botocore.exceptions")

        class _BotoCoreError(Exception):
            pass

        class _ClientError(Exception):
            pass

        botocore_exceptions_stub.BotoCoreError = _BotoCoreError
        botocore_exceptions_stub.ClientError = _ClientError
        sys.modules["botocore"] = botocore_stub
        sys.modules["botocore.exceptions"] = botocore_exceptions_stub


_stub_optional_dependencies()

import server  # noqa: E402


class _FakeCollection:
    def __init__(self, docs):
        self.docs = list(docs)
        self.inserted = []
        self.dropped = False

    def count_documents(self, query):
        return len(self.docs)

    def find(self, query):
        return list(self.docs)

    def drop(self):
        self.dropped = True
        self.inserted = []

    def insert_many(self, docs, ordered=False):
        self.inserted.extend(docs)


class _FakeDatabase:
    def __init__(self, collections):
        self.collections = collections

    def list_collection_names(self):
        return list(self.collections.keys())

    def __getitem__(self, name):
        return self.collections[name]


class _FakeClient:
    def __init__(self, dbs):
        self.dbs = dbs
        self.admin = types.SimpleNamespace(command=lambda _: {"ok": 1})

    def __getitem__(self, name):
        return self.dbs[name]


def test_copy_database_to_target(monkeypatch):
    source_collections = {
        "users": _FakeCollection([{"id": "1"}, {"id": "2"}]),
        "videos": _FakeCollection([{"id": "v1"}]),
    }
    target_collections = {
        "users": _FakeCollection([]),
        "videos": _FakeCollection([]),
    }
    source_db = _FakeDatabase(source_collections)
    target_db = _FakeDatabase(target_collections)

    def _fake_client(uri, serverSelectionTimeoutMS=None):
        if uri == "source-uri":
            return _FakeClient({"cognivio": source_db})
        if uri == "target-uri":
            return _FakeClient({"cognivio": target_db})
        raise AssertionError(f"Unexpected URI {uri}")

    monkeypatch.setattr(server, "SyncMongoClient", _fake_client)

    result = server._copy_database_to_target("source-uri", "cognivio", "target-uri", "cognivio")

    assert result["source_db"] == "cognivio"
    assert result["target_db"] == "cognivio"
    assert result["collections"] == {"users": 2, "videos": 1}
    assert result["total_documents"] == 3
    assert target_collections["users"].inserted == [{"id": "1"}, {"id": "2"}]
    assert target_collections["videos"].inserted == [{"id": "v1"}]
