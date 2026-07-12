"""Central configuration. Every module reads from here — no hardcoded endpoints."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_env(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, no dependency. Existing env wins."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env(Path.cwd() / ".env")


@dataclass(frozen=True)
class Settings:
    fuseki_base: str = os.getenv("STADIA_FUSEKI_BASE", "http://localhost:3030")
    dataset: str = os.getenv("STADIA_DATASET", "stadia")
    fuseki_user: str = os.getenv("STADIA_FUSEKI_USER", "fuseki")
    fuseki_password: str = os.getenv("STADIA_FUSEKI_PASSWORD", "")
    ontology_base: str = os.getenv("STADIA_ONTOLOGY_BASE", "https://stadia.example/ontology#")
    instance_base: str = os.getenv("STADIA_INSTANCE_BASE", "https://stadia.example")
    model: str = os.getenv("STADIA_MODEL", "claude-sonnet-4-5")


settings = Settings()


def data_url(ds: str | None = None) -> str:
    return f"{settings.fuseki_base}/{ds or settings.dataset}/data"


def sparql_url(ds: str | None = None) -> str:
    return f"{settings.fuseki_base}/{ds or settings.dataset}/sparql"


def update_url(ds: str | None = None) -> str:
    return f"{settings.fuseki_base}/{ds or settings.dataset}/update"


def ping_url() -> str:
    return f"{settings.fuseki_base}/$/ping"
