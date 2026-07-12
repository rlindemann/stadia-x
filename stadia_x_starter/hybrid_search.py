"""
hybrid_search
=============
Store-agnostic hybrid search, ported from KYRA's query/search.py (+ synonyms.py,
textutil.py folded in). The ranking is unchanged; the coupling to ChromaDB and
podcast metadata is gone.

Pipeline:
  1. Dense retrieval  — semantic vectors (your store) for meaning.
  2. Sparse retrieval — BM25 over canonical tokens for exact terms / names.
  3. Fusion           — Reciprocal Rank Fusion + exact-phrase bonus.
  4. Re-ranking       — cross-encoder rescoring (graceful fallback to fused).
  5. Structural blend — coverage + phrase proximity + per-field boost.

Every Hit carries a transparent score breakdown so relevance is auditable.

You supply a Retriever (two methods) and, optionally, synonym groups and a
field-boost map. Nothing here knows about standards, podcasts, or any schema.

Deps: rank-bm25 (required); sentence-transformers (only for the reranker;
optional — search degrades to fused score without it).

Example
-------
    retriever = MyPgVectorRetriever(...)          # implements Retriever
    search = HybridSearch(
        retriever,
        synonym_groups=[["BIM", "building information modeling"], ...],
        field_boosts={
            "standard_id": (["standard_id"], 1.0),
            "clause":      (["clause_path", "heading"], 1.0),
            "tag":         (["jurisdiction", "terms"], 0.6),
        },
    )
    hits = search.search("fire compartmentation requirements", limit=20)
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Protocol, Sequence

from rank_bm25 import BM25Okapi


# ── Retriever contract ────────────────────────────────────────────────────────

class Retriever(Protocol):
    """Your vector store, adapted to two methods."""

    def dense(self, query: str, n: int, where: dict | None) -> list[tuple[str, str, dict, float]]:
        """Top-n semantic matches as (id, document, metadata, cosine_distance)."""
        ...

    def all_docs(self) -> tuple[list[str], list[str], list[dict]]:
        """The whole corpus as (ids, documents, metadatas) for the BM25 index."""
        ...


# ── Tokenization (folded from textutil.py) ────────────────────────────────────

_WORD = re.compile(r"[a-z0-9][a-z0-9'_-]*")

STOPWORDS: frozenset[str] = frozenset(
    """
    a an the this that these those of in on at to for from with without by about as into
    over under again further then once and or but if while is are was were be been being
    have has had do does did doing will would shall should can could may might must
    i you he she it we they me him her us them my your his its our their mine yours
    not no nor so than too very just also only own same s t can don t now d ll m o re ve y
    what which who whom whose where when why how all any both each few more most other some such
    here there up out off down above below between through during before after own
    """.split()
)


def tokens(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def content_tokens(text: str) -> list[str]:
    return [t for t in tokens(text) if t not in STOPWORDS and len(t) > 2]


# ── Synonym canonicalization (folded from synonyms.py) ────────────────────────

class Synonyms:
    """Collapse acronym/synonym groups to one canonical token so retrieval,
    coverage, phrase matching, and highlighting treat equivalents as one concept.
    First form in each group is canonical. Empty groups => identity behaviour."""

    def __init__(self, groups: Sequence[Sequence[str]] = ()):
        self.phrase_to_canon: dict[str, str] = {}
        self.word_to_canon: dict[str, str] = {}
        self.canon_to_forms: dict[str, list[str]] = {}
        for group in groups:
            forms = [f.lower().strip() for f in group]
            if not forms:
                continue
            canon = forms[0].replace(" ", "_").replace("&", "and")
            self.canon_to_forms[canon] = forms
            for f in forms:
                (self.phrase_to_canon if " " in f else self.word_to_canon)[f] = canon
        self.canon_set = frozenset(self.canon_to_forms)
        self.phrases_by_len = sorted(self.phrase_to_canon, key=len, reverse=True)

    def canonical_tokens(self, text: str) -> list[str]:
        t = text.lower()
        for phrase in self.phrases_by_len:  # longest first so the fullest match wins
            t = re.sub(rf"\b{re.escape(phrase)}\b", f" {self.phrase_to_canon[phrase]} ", t)
        out = []
        for w in tokens(t):
            w = self.word_to_canon.get(w, w)
            if w in self.canon_set or (w not in STOPWORDS and len(w) > 2):
                out.append(w)
        return out

    def surface_forms(self, query: str) -> tuple[list[str], list[str]]:
        raw = content_tokens(query)
        singles: set[str] = set(raw)
        phrases: set[str] = {f"{a} {b}" for a, b in zip(raw, raw[1:])}
        for canon in self.canonical_tokens(query):
            for f in self.canon_to_forms.get(canon, []):
                (phrases if " " in f else singles).add(f)
        return sorted(singles, key=len, reverse=True), sorted(phrases, key=len, reverse=True)

    def expansions(self, query: str) -> list[str]:
        notes = []
        for canon in dict.fromkeys(self.canonical_tokens(query)):
            forms = self.canon_to_forms.get(canon)
            if forms and len(forms) > 1:
                notes.append(f"{forms[0]} = {', '.join(forms[1:])}")
        return notes


# ── Tunables ──────────────────────────────────────────────────────────────────

RERANK_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
RRF_K = 60           # rank-fusion constant
DENSE_POOL = 50      # candidates from each retriever
SPARSE_POOL = 50
RERANK_POOL = 40     # how many fused candidates the cross-encoder scores
PHRASE_BONUS = 0.02  # added to RRF when the exact query phrase appears
FIELD_MAX = 2.0      # normaliser for the field-boost factor

# Default field boosts. Each entry: boost_name -> (metadata_keys, weight).
# A query term appearing in these metadata fields outranks an incidental body
# mention. Re-point these at your schema (standard_id, clause_path, ...).
DEFAULT_FIELD_BOOSTS: dict[str, tuple[list[str], float]] = {
    "title": (["title"], 1.0),
    "tag": (["tags"], 0.6),
}


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


@dataclass
class Hit:
    id: str
    text: str
    meta: dict
    score: float          # final relevance 0-100 — THE sort key
    semantic: float       # dense cosine 0-100 (0 if only lexical)
    lexical: float        # bm25 normalised 0-100 (0 if only dense)
    coverage: float       # % of the query's content terms present
    terms_matched: int
    terms_total: int
    phrases_matched: int
    phrases_total: int
    reranked: bool
    matched_terms: list[str] = field(default_factory=list)
    matched_phrases: list[str] = field(default_factory=list)
    matched_fields: list[str] = field(default_factory=list)


class HybridSearch:
    def __init__(
        self,
        retriever: Retriever,
        synonym_groups: Sequence[Sequence[str]] = (),
        field_boosts: dict[str, tuple[list[str], float]] | None = None,
        embed_device: str = "cpu",
        rerank_model: str = RERANK_MODEL,
    ):
        self.retriever = retriever
        self.syn = Synonyms(synonym_groups)
        self.field_boosts = field_boosts if field_boosts is not None else DEFAULT_FIELD_BOOSTS
        self.embed_device = embed_device
        self.rerank_model = rerank_model

        ids, docs, metas = retriever.all_docs()
        self.ids = ids
        self.by_id = {i: (d, m) for i, d, m in zip(ids, docs, metas)}
        # Canonical tokens collapse synonyms, so BM25 and all term/phrase matching
        # treat "BIM" and "building information modeling" as one concept.
        self.canon = {i: self.syn.canonical_tokens(d) for i, d in zip(ids, docs)}
        self.bm25 = BM25Okapi([self.canon[i] for i in ids])
        self._reranker = None  # lazy

    # ── retrievers ───────────────────────────────────────────────────────────
    def _dense(self, query: str, where: dict | None) -> list[tuple[str, float]]:
        out = self.retriever.dense(query, DENSE_POOL, where)
        return [(i, 1 - dist) for i, _, _, dist in out]  # cosine similarity 0-1

    def _sparse(self, query: str) -> list[tuple[str, float]]:
        scores = self.bm25.get_scores(self.syn.canonical_tokens(query))
        ranked = sorted(zip(self.ids, scores), key=lambda x: -x[1])
        return [(i, s) for i, s in ranked[:SPARSE_POOL] if s > 0]

    # ── reranker ─────────────────────────────────────────────────────────────
    def _rerank(self, query: str, ids: list[str]) -> dict[str, float] | None:
        try:
            if self._reranker is None:
                from sentence_transformers import CrossEncoder
                self._reranker = CrossEncoder(self.rerank_model, device=self.embed_device)
            pairs = [(query, self.by_id[i][0]) for i in ids]
            raw = self._reranker.predict(pairs)
            return {i: _sigmoid(float(s)) for i, s in zip(ids, raw)}
        except Exception:
            return None

    def _field_tokens(self, meta: dict, keys: list[str]) -> set[str]:
        text = " ".join(str(meta.get(k, "")) for k in keys)
        return set(self.syn.canonical_tokens(text))

    # ── orchestration ─────────────────────────────────────────────────────────
    def search(self, query: str, where: dict | None = None, limit: int = 20) -> list[Hit]:
        """`where` is passed straight to your retriever's dense() for hard
        filtering (e.g. {"standard_id": "ISO 19650-1"}); the sparse side is
        filtered to match by simple metadata equality on the same keys."""
        dense = self._dense(query, where)
        sparse = self._sparse(query)
        if where:
            sparse = [
                (i, s) for i, s in sparse
                if all(self.by_id[i][1].get(k) == v for k, v in where.items())
            ]

        dense_sim = dict(dense)
        sparse_raw = dict(sparse)
        max_bm25 = max(sparse_raw.values(), default=1.0) or 1.0

        # Reciprocal Rank Fusion across the two rankings.
        rrf: dict[str, float] = {}
        for rank, (i, _) in enumerate(dense):
            rrf[i] = rrf.get(i, 0.0) + 1 / (RRF_K + rank)
        for rank, (i, _) in enumerate(sparse):
            rrf[i] = rrf.get(i, 0.0) + 1 / (RRF_K + rank)

        # Exact-phrase bonus: reward verbatim occurrence of the whole query.
        phrase = query.strip().lower()
        if len(phrase) > 3:
            for i in list(rrf):
                if phrase in self.by_id[i][0].lower():
                    rrf[i] += PHRASE_BONUS

        fused = sorted(rrf, key=lambda i: -rrf[i])[:RERANK_POOL]
        rerank = self._rerank(query, fused)

        q_canon = list(dict.fromkeys(self.syn.canonical_tokens(query)))
        q_set = set(q_canon)
        n_terms = len(q_set) or 1
        seq = self.syn.canonical_tokens(query)
        q_bigrams = list(zip(seq, seq[1:]))
        n_bigrams = len(q_bigrams)
        surf_singles, surf_phrases = self.syn.surface_forms(query)
        reranked = rerank is not None
        mx = max(rrf.values(), default=1.0) or 1.0

        def present_surface(doc_low: str, forms: list[str]) -> list[str]:
            return [f for f in forms if re.search(rf"\b{re.escape(f)}\b", doc_low)]

        hits: list[Hit] = []
        for i in fused:
            doc, meta = self.by_id[i]
            dt = self.canon[i]
            dt_set = set(dt)
            present = [t for t in q_canon if t in dt_set]
            coverage = len(present) / n_terms

            doc_pairs = set(zip(dt, dt[1:]))
            matched_bi = sum(1 for b in q_bigrams if b in doc_pairs)
            phrase_ratio = (matched_bi / n_bigrams) if n_bigrams else 0.0

            # Field boosting: a query term in a boosted metadata field is worth
            # more than an incidental body mention.
            matched_fields = [
                name for name, (keys, _w) in self.field_boosts.items()
                if q_set & self._field_tokens(meta, keys)
            ]
            field_boost = min(
                1.0,
                sum(self.field_boosts[name][1] for name in matched_fields) / FIELD_MAX,
            )

            r = rerank[i] if reranked else rrf[i] / mx
            # Additive blend so structural signals can lift a result the reranker
            # scored low (e.g. a title/field match absent from the body).
            structural = 0.40 * coverage + 0.25 * phrase_ratio + 0.35 * field_boost
            final = 0.6 * r + 0.4 * structural

            low = doc.lower()
            hits.append(Hit(
                id=i,
                text=doc,
                meta=meta,
                score=round(final * 100, 1),
                semantic=round(dense_sim.get(i, 0.0) * 100, 1),
                lexical=round(sparse_raw.get(i, 0.0) / max_bm25 * 100, 1),
                coverage=round(coverage * 100, 1),
                terms_matched=len(present),
                terms_total=n_terms,
                phrases_matched=matched_bi,
                phrases_total=n_bigrams,
                reranked=reranked,
                matched_terms=present_surface(low, surf_singles),
                matched_phrases=present_surface(low, surf_phrases),
                matched_fields=matched_fields,
            ))

        hits.sort(key=lambda h: -h.score)  # displayed score IS the sort key
        return hits[:limit]
