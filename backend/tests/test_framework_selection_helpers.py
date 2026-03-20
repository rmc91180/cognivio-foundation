import importlib.util
import os
import sys
import types
from pathlib import Path


def _load_server_module():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "cognivio_test")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
    os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://api.example.com")
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
    module_path = Path(__file__).resolve().parents[1] / "server.py"
    spec = importlib.util.spec_from_file_location("backend_server_framework_helpers", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


server = _load_server_module()


def test_parse_uploaded_rubric_file_accepts_csv_domains_and_elements():
    rubric_name, domains = server._parse_uploaded_rubric_file(
        "focus-rubric.csv",
        b"domain,element\nClassroom Culture,Student Belonging\nClassroom Culture,Discussion Norms\nInstruction,Checks for Understanding\n",
    )

    assert rubric_name == "focus-rubric"
    assert len(domains) == 2
    assert domains[0]["source_type"] == "uploaded"
    assert domains[0]["name"] == "Classroom Culture"
    assert len(domains[0]["elements"]) == 2
    assert domains[1]["elements"][0]["name"] == "Checks for Understanding"


def test_parse_uploaded_rubric_file_accepts_json_domains():
    rubric_name, domains = server._parse_uploaded_rubric_file(
        "priority-rubric.json",
        (
            b'{"name":"Priority Rubric","domains":['
            b'{"name":"Discussion","elements":[{"name":"Student Talk Moves"},{"name":"Academic Language"}]}]}'
        ),
    )

    assert rubric_name == "Priority Rubric"
    assert len(domains) == 1
    assert domains[0]["name"] == "Discussion"
    assert [element["name"] for element in domains[0]["elements"]] == [
        "Student Talk Moves",
        "Academic Language",
    ]
