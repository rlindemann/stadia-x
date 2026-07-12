"""Fuseki loader over the SPARQL Graph Store Protocol. Idempotent clear-then-load."""

from __future__ import annotations

from pathlib import Path

import requests

from .config import data_url, ping_url, settings, sparql_url, update_url


class Fuseki:
    def __init__(self, user: str | None = None, password: str | None = None):
        self.session = requests.Session()
        user = user or settings.fuseki_user
        password = password if password is not None else settings.fuseki_password
        if password:
            self.session.auth = (user, password)

    def ping(self, timeout: int = 5) -> bool:
        try:
            return self.session.get(ping_url(), timeout=timeout).ok
        except requests.RequestException:
            return False

    def clear(self) -> None:
        """CLEAR ALL first — prevents blank-node accumulation on re-runs."""
        r = self.session.post(update_url(), data={"update": "CLEAR ALL"}, timeout=30)
        r.raise_for_status()

    def upload(self, ttl: str | bytes | Path) -> int:
        if isinstance(ttl, Path):
            ttl = ttl.read_bytes()
        if isinstance(ttl, str):
            ttl = ttl.encode("utf-8")
        r = self.session.post(
            data_url(),
            data=ttl,
            headers={"Content-Type": "text/turtle; charset=utf-8"},
            timeout=120,
        )
        r.raise_for_status()
        return r.status_code

    def count(self) -> int:
        r = self.session.get(
            sparql_url(),
            params={"query": "SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }"},
            headers={"Accept": "application/sparql-results+json"},
            timeout=30,
        )
        r.raise_for_status()
        b = r.json()["results"]["bindings"]
        return int(b[0]["n"]["value"]) if b else 0

    def query(self, sparql: str) -> list[dict]:
        r = self.session.post(
            sparql_url(),
            data={"query": sparql},
            headers={"Accept": "application/sparql-results+json"},
            timeout=60,
        )
        r.raise_for_status()
        return r.json()["results"]["bindings"]
