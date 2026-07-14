"""
Extract tables/figures from a standard's PDF into `clause_figures`.

For each detected table/diagram region: render to PNG (stitching page-split
tables so the header travels with the body), upload to R2, transcribe with Claude
vision into structured text, embed the transcription with Voyage, associate it
with the clause it sits under, and store the row. This is what makes diagram/
matrix content searchable and answerable, not just lost by text-only extraction.

    uv run python -m ingest.figures "<pdf>" <STANDARD_ID>

Idempotent per standard (clears and re-extracts). Requires the standard's clauses
to already be loaded (run ingest.load first). Skips gracefully if a PDF has none.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from io import BytesIO
from pathlib import Path

import anthropic
import fitz  # PyMuPDF
import numpy as np
import psycopg
import voyageai
from dotenv import load_dotenv
from pgvector.psycopg import register_vector
from PIL import Image

from ingest.extract import slug
from ingest.storage import upload_bytes

load_dotenv()

MODEL = "claude-opus-4-8"
EMBED_MODEL = "voyage-3.5"
EMBED_DIM = 1024

# --- detection thresholds (a figure = a region dense in vector-drawing ops) ---
CELL = 8
DILATE = 2
MIN_W = MIN_H = 55
MIN_AREA = 6000
MIN_OPS = 12
WHOLE_PAGE = 0.9
REPEAT_MIN = 5
RENDER_DPI = 150
PAD = 6

TRANSCRIBE_PROMPT = """This image is a table or figure from a stadium standard/regulation.
Transcribe it faithfully and completely - do not summarise, infer, or omit any row or column.

1. Reproduce it as a GitHub-flavoured markdown table (or a clear description if it is a diagram
   rather than a table), preserving every row label, column header, and cell. Represent a tick
   as REQUIRED and a triangle as RECOMMENDED where those symbols appear (this is the usual legend:
   tick = required/mandatory, triangle = recommended/optional).
2. Then, one line per row, state in plain English which columns/categories are required and which
   are recommended (e.g. "Player-escort room: required for CAT A, B, C; recommended for CAT D, E").

Use ONLY what is visible in the image."""

vo = voyageai.Client()
anthro = anthropic.Anthropic()

mtx = fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)


# ----------------------------- detection -----------------------------
def _components(mask: np.ndarray):
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
                r0, r1, c0, c1 = min(r0, r), max(r1, r), min(c0, c), max(c1, c)
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols and mask[nr, nc] and not seen[nr, nc]:
                        seen[nr, nc] = True
                        stack.append((nr, nc))
            out.append((r0, c0, r1, c1))
    return out


def detect(page: fitz.Page) -> list[fitz.Rect]:
    W, H = page.rect.width, page.rect.height
    cols, rows = int(W // CELL) + 1, int(H // CELL) + 1
    grid = np.zeros((rows, cols), dtype=bool)
    rects = [d["rect"] for d in page.get_drawings()]
    for xref, *_ in page.get_images(full=True):
        rects.extend(page.get_image_rects(xref))
    for rc in rects:
        c0, c1 = int(rc.x0 // CELL), int(rc.x1 // CELL)
        r0, r1 = int(rc.y0 // CELL), int(rc.y1 // CELL)
        grid[max(0, r0):min(rows, r1 + 1), max(0, c0):min(cols, c1 + 1)] = True
    for _ in range(DILATE):
        g = grid.copy()
        g[1:, :] |= grid[:-1, :]; g[:-1, :] |= grid[1:, :]
        g[:, 1:] |= grid[:, :-1]; g[:, :-1] |= grid[:, 1:]
        grid = g
    figs = []
    for r0, c0, r1, c1 in _components(grid):
        rect = fitz.Rect(c0 * CELL, r0 * CELL, (c1 + 1) * CELL, (r1 + 1) * CELL) & page.rect
        if rect.width < MIN_W or rect.height < MIN_H or rect.get_area() < MIN_AREA:
            continue
        if rect.width >= WHOLE_PAGE * W and rect.height >= WHOLE_PAGE * H:
            continue
        if sum(1 for rc in rects if rect.contains(fitz.Point((rc.x0 + rc.x1) / 2, (rc.y0 + rc.y1) / 2))) < MIN_OPS:
            continue
        figs.append(rect)
    return figs


def _sig(rect: fitz.Rect):
    q = 12
    return (round(rect.x0 / q), round(rect.y0 / q), round(rect.width / q), round(rect.height / q))


def _render(page: fitz.Page, rect: fitz.Rect) -> Image.Image:
    pad = fitz.Rect(rect.x0 - PAD, rect.y0 - PAD, rect.x1 + PAD, rect.y1 + PAD) & page.rect
    return Image.open(BytesIO(page.get_pixmap(matrix=mtx, clip=pad).tobytes("png"))).convert("RGB")


def _stack(images: list[Image.Image]) -> Image.Image:
    w = max(im.width for im in images)
    h = sum(im.height for im in images) + 8 * (len(images) - 1)
    canvas = Image.new("RGB", (w, h), "white")
    y = 0
    for im in images:
        canvas.paste(im, (0, y))
        y += im.height + 8
    return canvas


def _is_table(page: fitz.Page, rect: fitz.Rect) -> bool:
    h = v = 0
    for d in page.get_drawings():
        r = d["rect"]
        if not rect.intersects(r):
            continue
        if r.height <= 2 and r.width >= 40:
            h += 1
        elif r.width <= 2 and r.height >= 40:
            v += 1
    return h >= 2 and v >= 2


# ----------------------------- association -----------------------------
def clause_label_ys(page: fitz.Page, clause_paths: list[str]) -> dict[str, float]:
    """Left-margin y-position of each clause number on the page (its section label)."""
    ys: dict[str, float] = {}
    for cp in clause_paths:
        hits = [h for h in page.search_for(cp) if h.x0 < 135]
        if hits:
            ys[cp] = min(h.y0 for h in hits)
    return ys


def owning_clause(label_ys: dict[str, float], path_to_id: dict[str, int], top_y: float):
    """Clause whose label sits immediately above the region top."""
    above = [(y, cp) for cp, y in label_ys.items() if y <= top_y + 4]
    if above:
        return path_to_id[max(above)[1]]
    if label_ys:  # nothing above -> topmost clause on the page
        return path_to_id[min(label_ys.items(), key=lambda kv: kv[1])[0]]
    return None


# ----------------------------- transcription + embed -----------------------------
def transcribe(img: Image.Image) -> str:
    buf = BytesIO()
    img.save(buf, format="PNG")
    data = base64.standard_b64encode(buf.getvalue()).decode()
    resp = anthro.messages.create(
        model=MODEL, max_tokens=2048,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}},
            {"type": "text", "text": TRANSCRIBE_PROMPT},
        ]}],
    )
    return "".join(b.text for b in resp.content if b.type == "text")


def embed(text: str) -> np.ndarray:
    r = vo.embed([text[:8000]], model=EMBED_MODEL, input_type="document", output_dimension=EMBED_DIM)
    return np.asarray(r.embeddings[0], dtype=np.float32)


SCHEMA = """
create table if not exists clause_figures (
  id            bigserial primary key,
  clause_id     bigint references clauses(id) on delete cascade,
  standard_id   text not null references standards(id) on delete cascade,
  page          int,
  pdf_file_page int,
  bbox          jsonb,
  kind          text,
  image_url     text,
  transcription text,
  embedding     vector(1024),
  meta          jsonb not null default '{}'
);
create index if not exists clause_figures_clause_idx on clause_figures(clause_id);
create index if not exists clause_figures_standard_idx on clause_figures(standard_id);
create index if not exists clause_figures_embedding_idx on clause_figures using hnsw (embedding vector_cosine_ops);
"""


def run(pdf_path: str, standard_id: str) -> None:
    doc = fitz.open(pdf_path)
    s = slug(standard_id)

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            cur.execute("delete from clause_figures where standard_id = %s", (standard_id,))

            # clauses per page for this standard
            cur.execute(
                "select id, clause_path, page, pdf_file_page from clauses where standard_id = %s",
                (standard_id,),
            )
            by_page: dict[int, dict[str, int]] = {}
            printed_page: dict[int, int] = {}
            for cid, cp, pg, fp in cur.fetchall():
                by_page.setdefault(fp, {})[cp] = cid
                printed_page[fp] = pg

            # detect per page, drop repeating chrome
            per_page = {i: detect(doc[i]) for i in range(len(doc))}
            sig_pages: dict[tuple, set[int]] = {}
            for i, figs in per_page.items():
                for r in figs:
                    sig_pages.setdefault(_sig(r), set()).add(i)
            chrome = {sg for sg, ps in sig_pages.items() if len(ps) >= REPEAT_MIN}
            kept = {i: [r for r in figs if _sig(r) not in chrome] for i, figs in per_page.items()}

            # group into table units, stitching page-split continuations
            consumed: set[tuple[int, int]] = set()
            units = []  # (start_page, top_y, [(page, rect), ...])
            for i, regs in kept.items():
                if not regs or not kept.get(i - 1):
                    continue
                top_idx = min(range(len(regs)), key=lambda k: regs[k].y0)
                top = regs[top_idx]
                if top.y0 > 170:
                    continue
                prev_regs = kept[i - 1]
                prev_idx = max(range(len(prev_regs)), key=lambda k: prev_regs[k].y1)
                prev = prev_regs[prev_idx]
                if prev.y1 < doc[i - 1].rect.height * 0.5 or abs(prev.width - top.width) > 0.25 * top.width:
                    continue
                units.append((i - 1, prev.y0, [(i - 1, prev), (i, top)]))
                consumed.add((i - 1, prev_idx))
                consumed.add((i, top_idx))
            for i, regs in kept.items():
                for k, r in enumerate(regs):
                    if (i, k) not in consumed:
                        units.append((i, r.y0, [(i, r)]))

            stored = 0
            for start_page, top_y, regions in units:
                paths = list(by_page.get(start_page, {}).keys())
                label_ys = clause_label_ys(doc[start_page], paths) if paths else {}
                clause_id = owning_clause(label_ys, by_page.get(start_page, {}), top_y)
                if clause_id is None:
                    print(f"  page {start_page}: figure with no clause to attach to, skipping", flush=True)
                    continue

                img = _stack([_render(doc[p], r) for p, r in regions])
                first_page, first_rect = regions[0]
                kind = "table" if _is_table(doc[first_page], first_rect) else "figure"
                key = f"figures/{s}/p{start_page}_{stored}.png"
                buf = BytesIO(); img.save(buf, format="PNG")
                url = upload_bytes(buf.getvalue(), key, "image/png")

                text = transcribe(img)
                vec = embed(text)
                bbox = {"x0": first_rect.x0, "y0": first_rect.y0, "x1": first_rect.x1, "y1": first_rect.y1}
                cur.execute(
                    """insert into clause_figures
                       (clause_id, standard_id, page, pdf_file_page, bbox, kind, image_url, transcription, embedding)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (clause_id, standard_id, printed_page.get(start_page), start_page,
                     json.dumps(bbox), kind, url, text, vec),
                )
                stored += 1
                print(f"  page {start_page} -> clause {clause_id} ({kind}, {len(regions)} region(s)) {url}", flush=True)
        conn.commit()
    doc.close()
    print(f"done: {stored} figures stored for {standard_id}", flush=True)


def main() -> None:
    run(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
