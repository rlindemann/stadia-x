"""
OCR fallback for scanned / image-only PDF pages.

Pages whose extractable text layer is near-empty (scans) are skipped by the
normal extraction path. When OCR is enabled, such pages are rendered and passed
to an OCR provider so their text can be extracted like any other page.

Providers (pluggable, lazy-imported so none is a hard dependency):
  - "tesseract": PyMuPDF's built-in Tesseract integration. Requires the Tesseract
    binary on the system (and its data files); no cloud credentials.
  - "azure": Azure Document Intelligence. Requires AZURE_DI_ENDPOINT + AZURE_DI_KEY.

Select with the OCR_PROVIDER env var (default "tesseract"). A page is considered
scanned when its text layer is shorter than MIN_CHARS and it carries a raster image.
"""

from __future__ import annotations

import os

import fitz  # PyMuPDF

MIN_CHARS = 50


def is_scanned(page: fitz.Page, min_chars: int = MIN_CHARS) -> bool:
    """A page with almost no selectable text but at least one image is a scan."""
    text = page.get_text("text").strip()
    if len(text) >= min_chars:
        return False
    return bool(page.get_images(full=True))


def ocr_page(page: fitz.Page, provider: str | None = None, dpi: int = 300) -> str:
    """Return OCR'd text for a page, or "" if OCR is unavailable/failed."""
    provider = (provider or os.getenv("OCR_PROVIDER") or "tesseract").lower()
    try:
        if provider == "tesseract":
            return _ocr_tesseract(page, dpi)
        if provider == "azure":
            return _ocr_azure(page, dpi)
    except Exception as e:  # never let OCR crash a whole extraction run
        print(f"  ocr failed on pdf page {page.number} ({provider}): {e}")
    return ""


def _ocr_tesseract(page: fitz.Page, dpi: int) -> str:
    # PyMuPDF ships a Tesseract bridge; needs the tesseract binary + TESSDATA_PREFIX.
    tp = page.get_textpage_ocr(flags=0, dpi=dpi, full=True)
    return page.get_text("text", textpage=tp).strip()


def _ocr_azure(page: fitz.Page, dpi: int) -> str:
    from azure.ai.documentintelligence import DocumentIntelligenceClient
    from azure.core.credentials import AzureKeyCredential

    endpoint = os.environ["AZURE_DI_ENDPOINT"]
    key = os.environ["AZURE_DI_KEY"]
    client = DocumentIntelligenceClient(endpoint, AzureKeyCredential(key))
    png = page.get_pixmap(dpi=dpi).tobytes("png")
    poller = client.begin_analyze_document("prebuilt-read", body=png, content_type="image/png")
    result = poller.result()
    return (result.content or "").strip()
