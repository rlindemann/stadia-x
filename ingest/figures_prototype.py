"""
PROTOTYPE (Phase 1): detect figure/diagram regions in a PDF and render them to PNG.

Standards diagrams are usually VECTOR drawings, not raster images, so we detect a
figure as a region that is DENSE in drawing ops (get_drawings) or contains a raster
image — then render that region to a PNG (works for vector and raster alike).

Saves, per page with detections:
  fig_p{page}_{i}.png            the cropped figure render
  page_{page}_detected.png       the full page with red boxes on detected regions

    uv run python -m ingest.figures_prototype "<pdf>" <outdir>

Nothing is written to the DB; this is for eyeballing detection quality.
"""

from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
from PIL import Image

CELL = 8            # grid cell size in PDF points
DILATE = 2          # bridge small gaps between strokes (in cells)
MIN_W = 55          # min figure width/height in points (drops thin rules/underlines)
MIN_H = 55
MIN_AREA = 6000     # min figure area in sq points
MIN_OPS = 12        # min drawing ops inside a region (drops stray boxes)
WHOLE_PAGE = 0.9    # regions >= this fraction of the page are covers/backgrounds
REPEAT_MIN = 5      # same-shaped region on >= this many pages = header/footer chrome
RENDER_DPI = 150
PAD = 6             # padding around a cropped figure, in points


def sig(rect: fitz.Rect) -> tuple[int, int, int, int]:
    """Coarse position+size signature so repeating chrome (logo, footer) collapses."""
    q = 12
    return (round(rect.x0 / q), round(rect.y0 / q), round(rect.width / q), round(rect.height / q))


def components(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Connected components (4-conn) over a boolean grid -> list of (r0,c0,r1,c1)."""
    seen = np.zeros_like(mask, dtype=bool)
    rows, cols = mask.shape
    out = []
    for sr in range(rows):
        for sc in range(cols):
            if not mask[sr, sc] or seen[sr, sc]:
                continue
            stack = [(sr, sc)]
            seen[sr, sc] = True
            r0 = r1 = sr
            c0 = c1 = sc
            while stack:
                r, c = stack.pop()
                r0, r1 = min(r0, r), max(r1, r)
                c0, c1 = min(c0, c), max(c1, c)
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols and mask[nr, nc] and not seen[nr, nc]:
                        seen[nr, nc] = True
                        stack.append((nr, nc))
            out.append((r0, c0, r1, c1))
    return out


def detect(page: fitz.Page) -> list[fitz.Rect]:
    W, H = page.rect.width, page.rect.height
    cols = int(W // CELL) + 1
    rows = int(H // CELL) + 1
    grid = np.zeros((rows, cols), dtype=bool)

    rects: list[fitz.Rect] = [d["rect"] for d in page.get_drawings()]
    for xref, *_ in page.get_images(full=True):
        rects.extend(page.get_image_rects(xref))
    rects = [rc for rc in rects if rc.get_area() < 0.5 * W * H]  # drop page-scale background fills

    def mark(rc: fitz.Rect):
        c0, c1 = int(rc.x0 // CELL), int(rc.x1 // CELL)
        r0, r1 = int(rc.y0 // CELL), int(rc.y1 // CELL)
        grid[max(0, r0):min(rows, r1 + 1), max(0, c0):min(cols, c1 + 1)] = True

    for rc in rects:
        mark(rc)

    # dilate to join separate strokes of one diagram
    for _ in range(DILATE):
        g = grid.copy()
        g[1:, :] |= grid[:-1, :]; g[:-1, :] |= grid[1:, :]
        g[:, 1:] |= grid[:, :-1]; g[:, :-1] |= grid[:, 1:]
        grid = g

    figs: list[fitz.Rect] = []
    for r0, c0, r1, c1 in components(grid):
        rect = fitz.Rect(c0 * CELL, r0 * CELL, (c1 + 1) * CELL, (r1 + 1) * CELL) & page.rect
        if rect.width < MIN_W or rect.height < MIN_H or rect.get_area() < MIN_AREA:
            continue
        if rect.width >= WHOLE_PAGE * W and rect.height >= WHOLE_PAGE * H:
            continue  # full-page cover / background, not a figure
        ops = sum(1 for rc in rects if rect.contains(fitz.Point((rc.x0 + rc.x1) / 2, (rc.y0 + rc.y1) / 2)))
        if ops < MIN_OPS:
            continue
        figs.append(rect)
    return figs


def render_region(page: fitz.Page, rect: fitz.Rect, mtx: fitz.Matrix) -> Image.Image:
    pad = fitz.Rect(rect.x0 - PAD, rect.y0 - PAD, rect.x1 + PAD, rect.y1 + PAD) & page.rect
    return Image.open(BytesIO(page.get_pixmap(matrix=mtx, clip=pad).tobytes("png"))).convert("RGB")


def stitch(images: list[Image.Image]) -> Image.Image:
    w = max(im.width for im in images)
    h = sum(im.height for im in images) + 8 * (len(images) - 1)
    canvas = Image.new("RGB", (w, h), "white")
    y = 0
    for im in images:
        canvas.paste(im, (0, y))
        y += im.height + 8
    return canvas


def main() -> None:
    pdf_path = Path(sys.argv[1])
    outdir = Path(sys.argv[2] if len(sys.argv) > 2 else "data/figures/out")
    outdir.mkdir(parents=True, exist_ok=True)
    mtx = fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)

    doc = fitz.open(pdf_path)

    # Pass 1: detect on every page, tally region signatures across pages.
    per_page: dict[int, list[fitz.Rect]] = {}
    sig_pages: dict[tuple, set[int]] = {}
    for i in range(len(doc)):
        figs = detect(doc[i])
        per_page[i] = figs
        for r in figs:
            sig_pages.setdefault(sig(r), set()).add(i)
    chrome = {s for s, pages in sig_pages.items() if len(pages) >= REPEAT_MIN and s[2] * 12 < 300}
    kept: dict[int, list[fitz.Rect]] = {i: [r for r in figs if sig(r) not in chrome] for i, figs in per_page.items()}

    # Pass 2: render clean individual crops (before any overlay drawing).
    total = 0
    for i, regs in kept.items():
        for j, rect in enumerate(regs):
            render_region(doc[i], rect, mtx).save(outdir / f"fig_p{i}_{j}.png")
            total += 1

    # Pass 3: stitch page-split tables. A region near the top of a page is a
    # continuation; prepend the similar-width table region from the bottom of the
    # previous page so the column header/legend travels with the body.
    stitched = 0
    for i, regs in kept.items():
        if not regs or not kept.get(i - 1):
            continue
        top = min(regs, key=lambda r: r.y0)
        if top.y0 > 170:  # not near the top -> not a continuation
            continue
        prev = max(kept[i - 1], key=lambda r: r.y1)  # lowest region on previous page
        prevH = doc[i - 1].rect.height
        if prev.y1 < prevH * 0.5 or abs(prev.width - top.width) > 0.25 * top.width:
            continue
        img = stitch([render_region(doc[i - 1], prev, mtx), render_region(doc[i], top, mtx)])
        img.save(outdir / f"fig_p{i}_stitched.png")
        stitched += 1
        print(f"stitched: page {i-1} header + page {i} body -> fig_p{i}_stitched.png", flush=True)

    # Pass 4: overlays (mutates pages, so do it last).
    for i, regs in kept.items():
        if not regs:
            continue
        page = doc[i]
        for rect in regs:
            page.draw_rect(rect, color=(1, 0, 0), width=1.5)
        page.get_pixmap(matrix=mtx).save(outdir / f"page_{i}_detected.png")
        print(f"page {i}: {len(regs)} region(s) -> {[f'{int(r.width)}x{int(r.height)}' for r in regs]}", flush=True)

    dropped = sum(len(per_page[i]) - len(kept[i]) for i in per_page)
    print(f"\nDone: {total} regions + {stitched} stitched continuations saved to {outdir} "
          f"({dropped} dropped as repeating chrome; whole-page covers skipped)", flush=True)
    doc.close()


if __name__ == "__main__":
    main()
