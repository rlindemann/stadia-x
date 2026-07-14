"""
PROTOTYPE (Phase 2): transcribe a figure/table image into structured text with
Claude vision, so a diagram/matrix becomes searchable and answerable - not just
viewable. Saves the transcription next to the image.

    uv run python -m ingest.vision_transcribe_prototype "<figure.png>"
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv()

MODEL = "claude-opus-4-8"

PROMPT = """This image is a table or figure from the AFC Stadium Regulations (Edition 2026),
a stadium compliance standard. Transcribe it faithfully and completely - do not summarise,
infer, or omit any row or column.

1. Reproduce it as a GitHub-flavoured markdown table, preserving every row label and column
   header and every cell. Represent a tick as ✓ and a triangle as △ exactly where they appear.
2. If a legend defines the symbols (e.g. ✓ = required, △ = recommended), state what each means.
3. Then, one line per row, list which columns are ✓ and which are △ in plain English
   (e.g. "Ball-crew room: required for CAT A, B, C; recommended for CAT D, E").

Use ONLY what is visible in the image. If a cell is blank, leave it blank."""


def main() -> None:
    img = Path(sys.argv[1])
    data = base64.standard_b64encode(img.read_bytes()).decode()

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}},
                    {"type": "text", "text": PROMPT},
                ],
            }
        ],
    )
    text = "".join(b.text for b in resp.content if b.type == "text")

    out = img.with_suffix(".transcription.md")
    out.write_text(text, encoding="utf-8")  # save first, before any console print can fail

    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows console defaults to cp1252
    except Exception:
        pass
    print(text)
    print(f"\n--- saved {out} ---")
    print(f"[vision usage: {resp.usage.input_tokens} in / {resp.usage.output_tokens} out tokens]")


if __name__ == "__main__":
    main()
