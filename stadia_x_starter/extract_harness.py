"""
extract_harness
===============
Domain-agnostic multipass LLM extraction harness, ported from KYRA's
extract_knowledge.py. All the production machinery, none of the podcast coupling.

You supply:
  - a list of Pass objects (name, build_prompt(context), validate(data))
  - a ModelConfig (Anthropic or Gemini)
  - per-item seed contexts (whatever your loader produces)

The harness owns: sequential passes threading an accumulating context,
per-pass checkpoint/resume, retry with backoff, a hard USD budget cap,
thread-pool parallelism with an API-concurrency semaphore, a dead-letter queue,
schema-hash versioning, and JSONL + console logging. Each item is written to
<out_dir>/<item_id>/knowledge_object.json with an _audit block.

For Stadia-X, a Pass set might be: document+entities -> requirements+references
-> analysis. The schema lives in your build_prompt closures; this file never
sees it.

Deps: anthropic, python-dotenv. Gemini path also needs google-genai.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional, Sequence

import anthropic
from dotenv import load_dotenv

load_dotenv()


# ── Contracts ─────────────────────────────────────────────────────────────────

@dataclass
class ModelConfig:
    id: str                 # provider model id, e.g. "claude-sonnet-4-6"
    type: str               # "anthropic" | "gemini"
    input_price: float      # USD per 1M input tokens
    output_price: float     # USD per 1M output tokens
    max_tokens: int = 32000


@dataclass
class Pass:
    """One extraction pass.

    build_prompt receives the accumulating context dict (seed + prior pass
    outputs, keyed by pass name) and returns the prompt string. validate raises
    on a bad result. The pass output (a dict) is stored under context[name].
    """
    name: str
    build_prompt: Callable[[dict], str]
    validate: Callable[[dict], None] = lambda data: None


# ── Errors ────────────────────────────────────────────────────────────────────

class BudgetExceededError(Exception):
    pass


class PassValidationError(Exception):
    pass


# ── Budget tracker ────────────────────────────────────────────────────────────

class BudgetTracker:
    def __init__(self, cap_usd: Optional[float] = None):
        self._cap = cap_usd
        self._spent = 0.0
        self._lock = threading.Lock()

    def charge(self, amount: float, label: str = "") -> None:
        with self._lock:
            projected = self._spent + amount
            if self._cap is not None and projected > self._cap:
                raise BudgetExceededError(
                    f"Budget cap ${self._cap:.2f} exceeded "
                    f"(spent ${self._spent:.4f} + ${amount:.4f} for {label})"
                )
            self._spent = projected

    @property
    def spent(self) -> float:
        with self._lock:
            return self._spent

    def remaining(self) -> Optional[float]:
        if self._cap is None:
            return None
        with self._lock:
            return round(self._cap - self._spent, 4)

    def summary(self) -> str:
        r = self.remaining()
        if r is None:
            return f"spent ${self.spent:.4f} (no cap)"
        return f"spent ${self.spent:.4f} / ${self._cap:.2f} (${r:.4f} remaining)"


# ── Checkpoint store ──────────────────────────────────────────────────────────

class CheckpointStore:
    """Per-item pass checkpoints. Enables resuming failed extractions."""

    FINAL_FILE = "knowledge_object.json"
    AUDIT_FILE = "_audit.json"

    def __init__(self, out_dir: Path, item_id: str):
        # item_id may contain path separators (e.g. "iso-19650/part-1"); keep them.
        self._dir = out_dir / item_id
        self._dir.mkdir(parents=True, exist_ok=True)

    @property
    def dir(self) -> Path:
        return self._dir

    def _pass_file(self, pass_name: str) -> Path:
        return self._dir / f"pass_{pass_name}.json"

    def save_pass(self, pass_name: str, data: dict) -> None:
        self._atomic_write(self._pass_file(pass_name), data)

    def load_pass(self, pass_name: str) -> Optional[dict]:
        path = self._pass_file(pass_name)
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def has_pass(self, pass_name: str) -> bool:
        return self._pass_file(pass_name).exists()

    def save_final(self, data: dict) -> Path:
        path = self._dir / self.FINAL_FILE
        self._atomic_write(path, data)
        return path

    def save_audit(self, audit: dict) -> None:
        self._atomic_write(self._dir / self.AUDIT_FILE, audit)

    def is_complete(self) -> bool:
        return (self._dir / self.FINAL_FILE).exists()

    @staticmethod
    def _atomic_write(path: Path, data: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)


# ── Retry ─────────────────────────────────────────────────────────────────────

_RETRYABLE = (
    anthropic.RateLimitError,
    anthropic.InternalServerError,
    anthropic.APITimeoutError,
    anthropic.APIConnectionError,
    json.JSONDecodeError,
    ValueError,  # empty response
)


def with_retry(fn, max_attempts: int = 3, base_delay: float = 2.0,
               logger: logging.Logger = None, label: str = "") -> tuple[dict, dict, int]:
    """Call fn() up to max_attempts times with exponential backoff.
    Returns (result, usage, attempts_taken). BudgetExceededError is non-retryable."""
    last_exc = None
    for attempt in range(1, max_attempts + 1):
        try:
            result, usage = fn()
            return result, usage, attempt
        except BudgetExceededError:
            raise
        except _RETRYABLE as exc:
            last_exc = exc
            if attempt == max_attempts:
                break
            delay = base_delay * (2 ** (attempt - 1))
            if logger:
                logger.warning(
                    f"{label} attempt {attempt} failed ({type(exc).__name__}); retrying in {delay:.0f}s"
                )
            time.sleep(delay)
    raise last_exc


# ── Model callers ─────────────────────────────────────────────────────────────

def _strip_fences(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s.rstrip())
    return s


def compute_cost(usage: dict, model: ModelConfig) -> float:
    return round(
        (usage["input_tokens"] * model.input_price + usage["output_tokens"] * model.output_price) / 1_000_000,
        4,
    )


def estimate_cost(input_tokens: int, output_tokens: int, model: ModelConfig) -> float:
    return round((input_tokens * model.input_price + output_tokens * model.output_price) / 1_000_000, 4)


def _call_anthropic(prompt: str, model: ModelConfig) -> tuple[dict, dict]:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    t0 = time.time()
    with client.messages.stream(
        model=model.id,
        max_tokens=model.max_tokens,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        raw = stream.get_final_text()
        usage = stream.get_final_message().usage
    stripped = _strip_fences(raw)
    if not stripped:
        raise ValueError("Empty response from model")
    return json.loads(stripped), {
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "elapsed_sec": round(time.time() - t0, 1),
    }


def _call_gemini(prompt: str, model: ModelConfig) -> tuple[dict, dict]:
    from google import genai
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    t0 = time.time()
    response = client.models.generate_content(
        model=model.id,
        contents=prompt,
        config=genai.types.GenerateContentConfig(
            response_mime_type="application/json",
            max_output_tokens=model.max_tokens,
            temperature=0,
        ),
    )
    usage = response.usage_metadata
    return json.loads(response.text), {
        "input_tokens": usage.prompt_token_count,
        "output_tokens": usage.candidates_token_count,
        "elapsed_sec": round(time.time() - t0, 1),
    }


# ── Logging ───────────────────────────────────────────────────────────────────

class _JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        for key in ("item", "pass_name", "cost_usd", "run_id", "attempts"):
            val = getattr(record, key, None)
            if val is not None:
                entry[key] = val
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def setup_logging(log_dir: Path, run_id: str) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(f"extract.{run_id}")
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s", "%H:%M:%S"))

    fh = logging.FileHandler(log_dir / f"{run_id}.jsonl", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(_JSONFormatter())

    logger.addHandler(ch)
    logger.addHandler(fh)
    return logger


# ── Schema versioning ─────────────────────────────────────────────────────────

def compute_schema_hash(schema_files: Sequence[Path]) -> str:
    h = hashlib.sha256()
    for path in schema_files:
        if Path(path).exists():
            h.update(Path(path).read_bytes())
    return h.hexdigest()[:12]


# ── Dead letter queue ─────────────────────────────────────────────────────────

def write_dead_letter(out_dir: Path, run_id: str, failed: list) -> Optional[Path]:
    if not failed:
        return None
    dlq_dir = out_dir / ".failures"
    dlq_dir.mkdir(parents=True, exist_ok=True)
    path = dlq_dir / f"{run_id}.json"
    path.write_text(
        json.dumps({"run_id": run_id, "failed": failed,
                    "written_at": datetime.now(timezone.utc).isoformat()}, indent=2),
        encoding="utf-8",
    )
    return path


def load_latest_dead_letter(out_dir: Path) -> list:
    dlq_dir = out_dir / ".failures"
    if not dlq_dir.exists():
        return []
    files = sorted(dlq_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        return []
    data = json.loads(files[0].read_text(encoding="utf-8"))
    return [r["item_id"] for r in data.get("failed", [])]


# ── Harness ───────────────────────────────────────────────────────────────────

def _default_merge(outputs: dict[str, dict]) -> dict:
    """Shallow-merge every pass output in pass order into one object."""
    merged: dict = {}
    for data in outputs.values():
        merged.update(data)
    return merged


class ExtractionHarness:
    def __init__(
        self,
        passes: Sequence[Pass],
        model: ModelConfig,
        out_dir: Path,
        schema_files: Sequence[Path] = (),
        merge_fn: Callable[[dict[str, dict]], dict] = _default_merge,
        max_api_calls: int = 6,
    ):
        self.passes = list(passes)
        self.model = model
        self.out_dir = Path(out_dir)
        self.schema_files = list(schema_files)
        self.merge_fn = merge_fn
        self._semaphore = threading.Semaphore(max_api_calls)

    def _call(self, prompt: str) -> tuple[dict, dict]:
        with self._semaphore:
            if self.model.type == "anthropic":
                return _call_anthropic(prompt, self.model)
            return _call_gemini(prompt, self.model)

    def extract_item(
        self,
        item_id: str,
        context: dict,
        budget: BudgetTracker,
        run_id: str,
        logger: logging.Logger,
        schema_hash: str,
        skip_existing: bool = True,
        resume: bool = True,
    ) -> dict:
        """Run all passes for one item. `context` is the seed dict your loader
        produced; each pass output is merged into it under context[pass.name]."""
        checkpoint = CheckpointStore(self.out_dir, item_id)
        pass_stats: list[dict] = []
        outputs: dict[str, dict] = {}
        t_start = time.time()

        def log(level, msg, **kw):
            logger.log(level, msg, extra={"item": item_id, "run_id": run_id, **kw})

        if skip_existing and checkpoint.is_complete():
            log(logging.INFO, "skipping — already complete")
            return {"item_id": item_id, "status": "skipped"}

        try:
            for idx, p in enumerate(self.passes, 1):
                tag = f"[{idx}/{len(self.passes)}] {p.name}"
                if resume and checkpoint.has_pass(p.name):
                    data = checkpoint.load_pass(p.name)
                    outputs[p.name] = data
                    context[p.name] = data
                    log(logging.INFO, f"{tag} loaded from checkpoint", pass_name=p.name)
                    pass_stats.append({"pass": p.name, "cached": True})
                    continue

                log(logging.INFO, f"{tag}...")
                prompt = p.build_prompt(context)
                data, usage, attempts = with_retry(
                    lambda: self._call(prompt), logger=logger, label=f"{item_id}/{p.name}"
                )
                p.validate(data)
                cost = compute_cost(usage, self.model)
                budget.charge(cost, label=f"{item_id}/{p.name}")
                checkpoint.save_pass(p.name, data)
                outputs[p.name] = data
                context[p.name] = data
                pass_stats.append({"pass": p.name, **usage, "cost_usd": cost, "attempts": attempts})
                log(logging.INFO,
                    f"{tag} done — {usage['input_tokens']:,}in/{usage['output_tokens']:,}out "
                    f"${cost} {usage['elapsed_sec']}s (attempt {attempts})",
                    pass_name=p.name, cost_usd=cost, attempts=attempts)

            knowledge_object = self.merge_fn(outputs)
            total_cost = round(sum(s.get("cost_usd", 0) for s in pass_stats), 4)
            total_elapsed = round(time.time() - t_start, 1)
            audit = {
                "run_id": run_id,
                "item_id": item_id,
                "model": self.model.id,
                "schema_hash": schema_hash,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "total_cost_usd": total_cost,
                "total_elapsed_sec": total_elapsed,
                "passes": pass_stats,
            }
            final_path = checkpoint.save_final({"_audit": audit, **knowledge_object})
            checkpoint.save_audit(audit)
            log(logging.INFO, f"complete — ${total_cost} total, {total_elapsed}s", cost_usd=total_cost)
            return {
                "item_id": item_id, "status": "ok",
                "total_cost_usd": total_cost, "total_elapsed_sec": total_elapsed,
                "output_path": str(final_path),
            }

        except BudgetExceededError as exc:
            log(logging.ERROR, f"budget exceeded: {exc}")
            return {"item_id": item_id, "status": "budget_exceeded", "error": str(exc)}
        except (PassValidationError, FileNotFoundError, ValueError) as exc:
            log(logging.ERROR, f"failed: {exc}")
            return {"item_id": item_id, "status": "failed", "error": str(exc)}
        except Exception as exc:
            log(logging.ERROR, f"unexpected error: {exc}", exc_info=True)
            return {"item_id": item_id, "status": "failed", "error": str(exc)}

    def run_batch(
        self,
        items: Sequence[tuple[str, dict]],   # (item_id, seed_context)
        budget: BudgetTracker,
        logger: logging.Logger,
        run_id: str,
        workers: int = 3,
        skip_existing: bool = True,
        resume: bool = True,
    ) -> dict:
        schema_hash = compute_schema_hash(self.schema_files)
        logger.info(
            f"Batch start — items={len(items)} model={self.model.id} "
            f"workers={workers} schema={schema_hash} {budget.summary()}"
        )
        results: list[dict] = []
        budget_hit = threading.Event()

        def _run_one(item_id: str, context: dict) -> dict:
            if budget_hit.is_set():
                return {"item_id": item_id, "status": "aborted", "error": "budget exceeded in another worker"}
            result = self.extract_item(
                item_id, context, budget, run_id, logger, schema_hash,
                skip_existing=skip_existing, resume=resume,
            )
            if result["status"] == "budget_exceeded":
                budget_hit.set()
            return result

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_run_one, iid, ctx): iid for iid, ctx in items}
            for future in as_completed(futures):
                results.append(future.result())

        by_status: dict[str, list] = {}
        for r in results:
            by_status.setdefault(r["status"], []).append(r)
        ok = by_status.get("ok", [])
        failed = by_status.get("failed", [])
        total_cost = round(sum(r.get("total_cost_usd", 0) for r in ok), 4)

        dlq_path = write_dead_letter(self.out_dir, run_id, failed)
        logger.info(
            f"Batch complete — ok={len(ok)} skipped={len(by_status.get('skipped', []))} "
            f"failed={len(failed)} aborted={len(by_status.get('aborted', []))} "
            f"total_cost=${total_cost} {budget.summary()}"
        )
        return {
            "run_id": run_id,
            "ok": len(ok),
            "skipped": len(by_status.get("skipped", [])),
            "failed": len(failed),
            "aborted": len(by_status.get("aborted", [])),
            "total_cost_usd": total_cost,
            "dead_letter_path": str(dlq_path) if dlq_path else None,
            "results": results,
        }


def new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "_" + uuid.uuid4().hex[:6]


# ── Reference model configs (edit prices to current rates) ────────────────────

SONNET = ModelConfig(id="claude-sonnet-4-6", type="anthropic", input_price=3, output_price=15)
OPUS = ModelConfig(id="claude-opus-4-6", type="anthropic", input_price=15, output_price=75)
GEMINI_FLASH = ModelConfig(id="gemini-3-flash-preview", type="gemini", input_price=0.50, output_price=3.00)
