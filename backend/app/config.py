from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    mongo_url: str = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name: str = os.getenv("DB_NAME", "cognivio")
    jwt_secret: str = os.getenv("JWT_SECRET", "")
    backend_public_base_url: str = os.getenv("BACKEND_PUBLIC_BASE_URL", "")
    demo_mode: bool = os.getenv("DEMO_MODE", "false").lower() == "true"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
