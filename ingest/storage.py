"""Upload source PDFs to Cloudflare R2 (S3-compatible). Returns the public URL."""

from __future__ import annotations

import os
from pathlib import Path

import boto3


def _client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def upload_pdf(path: Path, key: str) -> str:
    _client().upload_file(
        str(path), os.environ["R2_BUCKET"], key,
        ExtraArgs={"ContentType": "application/pdf"},
    )
    return _public(key)


def upload_bytes(data: bytes, key: str, content_type: str) -> str:
    _client().put_object(Bucket=os.environ["R2_BUCKET"], Key=key, Body=data, ContentType=content_type)
    return _public(key)


def _public(key: str) -> str:
    return f"{os.environ['R2_PUBLIC_BASE'].rstrip('/')}/{key}"
