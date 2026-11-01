from functools import lru_cache
from pathlib import Path
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ directory (…/backend/app/core/config.py -> parents[2]). Relative paths in .env are resolved against it,
# so the app behaves the same no matter which directory uvicorn / pytest is started from.
BASE_DIR = Path(__file__).resolve().parents[2]

# Origins that are always allowed in development (a static dev server such as VS Code Live Server, or the API host itself).
DEV_ORIGINS = [
    "http://127.0.0.1:5500", "http://localhost:5500",
    "http://127.0.0.1:8000", "http://localhost:8000",
]


class Settings(BaseSettings):
    # Later files override earlier ones: backend/.env first, then a .env in the current directory.
    model_config = SettingsConfigDict(env_file=(str(BASE_DIR / ".env"), ".env"), env_file_encoding="utf-8", extra="ignore")
    app_env: str = "development"
    secret_key: str = "dev-only-change-this-secret-key-32-chars"
    database_url: str = "sqlite:///./shot_or.db"
    access_token_expire_minutes: int = Field(default=30, ge=5, le=1440)
    upload_dir: str = "./data/uploads"
    max_upload_size_mb: int = Field(default=10, ge=1, le=50)
    max_extracted_text_chars: int = Field(default=250000, ge=1000, le=1000000)
    # Local/offline Ollama (https://ollama.com). No API key needed: run `ollama serve` and `ollama pull <model>`.
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.2"
    ollama_connect_timeout_seconds: float = Field(default=5, gt=0, le=30)
    ollama_read_timeout_seconds: float = Field(default=120, gt=0, le=300)
    ollama_max_output_tokens: int = Field(default=1200, ge=128, le=8192)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/google/callback"
    google_token_encryption_key: str = ""
    google_state_ttl_minutes: int = 10
    allowed_origins: str = ""      # extra CORS origins, comma separated
    frontend_url: str = ""         # where to send the browser after Google OAuth; empty = same origin as the API
    frontend_dir: str = ""         # folder with index.html to serve at "/"; empty = auto-detect ../frontend

    @field_validator("secret_key")
    @classmethod
    def validate_secret(cls, value, info):
        if info.data.get("app_env", "development") == "production" and (len(value) < 32 or value.startswith("dev-only")):
            raise ValueError("SECRET_KEY must be a unique random value of at least 32 characters in production")
        return value

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir).expanduser()
        if not path.is_absolute():
            path = BASE_DIR / path
        path = path.resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def sqlalchemy_url(self) -> str:
        """database_url, with a relative SQLite file path anchored to backend/ instead of the current directory."""
        url = self.database_url
        prefix = "sqlite:///"
        if url.startswith(prefix) and not url.startswith("sqlite:////") and ":memory:" not in url:
            rel = url[len(prefix):]
            if rel and not Path(rel).is_absolute():
                return prefix + (BASE_DIR / rel).resolve().as_posix()
        return url

    @property
    def cors_origin_list(self) -> list[str]:
        extra = [x.strip().rstrip("/") for x in self.allowed_origins.split(",") if x.strip()]
        origins = ([] if self.app_env == "production" else list(DEV_ORIGINS)) + extra
        return list(dict.fromkeys(origins))

    @property
    def frontend_path(self) -> Path | None:
        candidates = [Path(self.frontend_dir).expanduser()] if self.frontend_dir else [BASE_DIR.parent / "frontend", BASE_DIR / "frontend"]
        for candidate in candidates:
            if (candidate / "index.html").is_file():
                return candidate.resolve()
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
