"""Runtime configuration, read from environment variables (and an optional .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
RAW_CORPUS = DATA_DIR / "raw" / "psi_combustion_corpus.json"
PROCESSED_DIR = DATA_DIR / "processed"
DEFAULT_DB = DATA_DIR / "flameatlas.db"
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


def _load_dotenv() -> None:
    """Minimal .env loader (no dependency). Existing environment variables win."""
    for candidate in (REPO_ROOT / ".env", REPO_ROOT / "backend" / ".env"):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    db_path: Path = Path(os.environ.get("FLAMEATLAS_DB", str(DEFAULT_DB)))
    llm_provider: str = os.environ.get("LLM_PROVIDER", "auto")  # auto | anthropic | openai | none
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-5-5")
    openai_api_key: str = os.environ.get("OPENAI_API_KEY", "")
    openai_model: str = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    llm_timeout_s: float = float(os.environ.get("LLM_TIMEOUT_S", "40"))
    cors_origins: tuple[str, ...] = tuple(
        o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()
    )

    @property
    def active_llm(self) -> str:
        if self.llm_provider == "none":
            return "none"
        if self.llm_provider in ("anthropic", "auto") and self.anthropic_api_key:
            return "anthropic"
        if self.llm_provider in ("openai", "auto") and self.openai_api_key:
            return "openai"
        return "none"


settings = Settings()
