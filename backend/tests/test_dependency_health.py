import pytest

from app.services.dependency_health import get_dependency_health, probe_openai, probe_resend


class _FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


class _FakeAsyncClient:
    response = _FakeResponse(200, {"data": []})
    raised = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        if self.raised:
            raise self.raised
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, *args, **kwargs):
        if self.raised:
            raise self.raised
        return self.response


def _reset_settings(monkeypatch, **env):
    from app.config import get_settings

    for key in [
        "RESEND_API_KEY",
        "RESEND_FROM_EMAIL",
        "RESEND_API_BASE_URL",
        "OPENAI_API_KEY",
        "S3_BUCKET",
        "S3_ENDPOINT",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
    ]:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_dependency_health_returns_expected_shape(monkeypatch):
    _reset_settings(monkeypatch)

    result = await get_dependency_health(db=None)

    assert "generated_at" in result
    assert "summary" in result
    assert "dependencies" in result

    names = {item["name"] for item in result["dependencies"]}

    assert "MongoDB Atlas" in names
    assert "Cloudflare R2" in names
    assert "Resend" in names
    assert "OpenAI" in names

    r2 = next(item for item in result["dependencies"] if item["name"] == "Cloudflare R2")
    openai = next(item for item in result["dependencies"] if item["name"] == "OpenAI")

    assert r2["healthy"] is False
    assert openai["healthy"] is False
    assert r2["details"]["configured"] is False
    assert openai["details"]["configured"] is False


@pytest.mark.asyncio
async def test_resend_health_reports_invalid_sender(monkeypatch):
    _reset_settings(
        monkeypatch,
        RESEND_API_KEY="re_test",
        RESEND_FROM_EMAIL="not-an-email",
    )

    result = await probe_resend()

    assert result["healthy"] is False
    assert result["reason_code"] == "invalid_sender"
    assert result["details"]["sender_valid"] is False
    assert "re_test" not in str(result)


@pytest.mark.asyncio
async def test_resend_health_reports_rejected_api_key(monkeypatch):
    _reset_settings(
        monkeypatch,
        RESEND_API_KEY="re_secret_value",
        RESEND_FROM_EMAIL="Cognivio <login@example.com>",
    )
    _FakeAsyncClient.response = _FakeResponse(401, {})
    _FakeAsyncClient.raised = None
    monkeypatch.setattr("app.services.dependency_health.httpx.AsyncClient", _FakeAsyncClient)

    result = await probe_resend()

    assert result["healthy"] is False
    assert result["message"] == "Resend API key was rejected."
    assert result["reason_code"] == "invalid_api_key"
    assert "re_secret_value" not in str(result)


@pytest.mark.asyncio
async def test_resend_health_reports_domain_visibility_and_verification(monkeypatch):
    _reset_settings(
        monkeypatch,
        RESEND_API_KEY="re_secret_value",
        RESEND_FROM_EMAIL="Cognivio <login@example.com>",
    )
    _FakeAsyncClient.raised = None
    monkeypatch.setattr("app.services.dependency_health.httpx.AsyncClient", _FakeAsyncClient)

    _FakeAsyncClient.response = _FakeResponse(200, {"data": [{"name": "other.example", "status": "verified"}]})
    missing_domain = await probe_resend()

    _FakeAsyncClient.response = _FakeResponse(200, {"data": [{"name": "example.com", "status": "pending"}]})
    unverified_domain = await probe_resend()

    _FakeAsyncClient.response = _FakeResponse(200, {"data": [{"name": "example.com", "status": "verified"}]})
    verified_domain = await probe_resend()

    assert missing_domain["details"]["domain_visible"] is False
    assert missing_domain["reason_code"] == "domain_not_found"
    assert unverified_domain["details"]["domain_visible"] is True
    assert unverified_domain["reason_code"] == "domain_not_verified"
    assert unverified_domain["details"]["domain_status"] == "pending"
    assert verified_domain["healthy"] is True
    assert verified_domain["reason_code"] == "ok"


@pytest.mark.asyncio
async def test_provider_failures_are_sanitized(monkeypatch):
    _reset_settings(
        monkeypatch,
        RESEND_API_KEY="re_secret_value",
        RESEND_FROM_EMAIL="Cognivio <login@example.com>",
        OPENAI_API_KEY="sk-secret-value",
    )
    _FakeAsyncClient.response = _FakeResponse(200, {})
    _FakeAsyncClient.raised = RuntimeError("network exploded with re_secret_value")
    monkeypatch.setattr("app.services.dependency_health.httpx.AsyncClient", _FakeAsyncClient)

    class _OpenAI:
        def __init__(self, *args, **kwargs):
            self.models = self

        async def list(self):
            raise RuntimeError("openai failed with sk-secret-value")

    monkeypatch.setattr("app.services.dependency_health.AsyncOpenAI", _OpenAI)

    resend = await probe_resend()
    openai = await probe_openai()

    assert "re_secret_value" not in str(resend)
    assert "sk-secret-value" not in str(openai)
    assert resend["reason_code"] == "network_error"
    assert resend["details"]["error_type"] == "RuntimeError"
    assert openai["details"]["error_type"] == "RuntimeError"
