"""Central versioned-URI minter — the single source of truth for the identity policy.

Never build a URI by string-concatenation scattered across scripts; call these helpers.
Pattern: {instance_base}/instances/{org}/{corpus}/{Prefix}-{local_id}@{version}
"""

from __future__ import annotations

import re

from .config import settings


def slug(s: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def mint(prefix: str, org: str, corpus: str, local_id: str, version: str = "v1") -> str:
    return (
        f"{settings.instance_base}/instances/"
        f"{slug(org)}/{slug(corpus)}/{prefix}-{slug(local_id)}@{version}"
    )


def doc_uri(org: str, corpus: str, doc_id: str, version: str = "v1") -> str:
    return mint("doc", org, corpus, doc_id, version)
