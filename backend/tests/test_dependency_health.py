import os

import pytest

from app.services.dependency_health import get_dependency_health


@pytest.mark.asyncio
async def test_dependency_health_returns_expected_shape(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("S3_BUCKET", raising=False)
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)

    from app.config import get_settings

    get_settings.cache_clear()

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