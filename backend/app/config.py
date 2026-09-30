"""Application settings, read from environment variables (see .env.example)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    app_env: str = "development"
    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/mplads"
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    cors_origins: str = "http://localhost:5173,http://localhost:8080"
    upload_dir: str = str(ROOT_DIR / "uploads")
    max_upload_mb: int = 10
    seed_on_startup: bool = True
    demo_password: str = "Demo@12345"
    show_demo_credentials: bool = True
    enable_scheduler: bool = True
    allow_signup: bool = True
    signup_limit_per_hour: int = 10
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    frontend_dist: str = str(ROOT_DIR / "frontend" / "dist")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
