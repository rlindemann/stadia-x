"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { SaveButton } from "@/components/save-button";

type Hit = {
  id: number;
  standard_id: string;
  standard_title: string;
  publisher: string | null;
  clause_path: string;
  heading_trail: string;
  page: number;
  pdf_file_page: number;
  obligation_type: string;
  normativity: string;
  verbatim_text: string;
  defined_terms: string[];
  uri: string | null;
  source_url: string | null;
  score: number;
  standard_status: string | null;
  dense_rnk: number | null;
  qdense_rnk: number | null;
  lex_rnk: number | null;
  dense_sim: number;
  q_sim: number | null;
  lex_score: number;
  matched_question: string | null;
  block_type: string;
  context: string | null;
  rerank_score?: number;
};

type Figure = {
  id: number;
  clause_id: number;
  kind: string;
  image_url: string | null;
  transcription: string;
  page: number;
  standard_id: string;
  standard_title: string;
  clause_path: string | null;
  sim: number;
};

type Expansion = { matched: string; added: string[] };
type Facets = {
  publishers: string[];
  standards: { id: string; title: string }[];
  obligations: string[];
  statuses: string[];
};

const OB_CLASS: Record<string, string> = {
  requirement: "shall",
  recommendation: "should",
  permission: "may",
  informative: "info",
};

// Query terms for match-highlighting: content words from the query plus any
// synonym expansions, minus short/stop words.
const STOP = new Set([
  "the", "and", "for", "are", "with", "that", "this", "from", "must", "shall", "should", "may",
  "what", "how", "which", "when", "where", "who", "does", "can", "was", "were", "has", "have",
  "had", "its", "into", "per", "not", "all", "any", "each", "you", "your", "about", "there",
]);
function queryTerms(q: string, expansions: Expansion[]): string[] {
  const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const all = [...words(q), ...expansions.flatMap((e) => e.added.flatMap(words))];
  return Array.from(new Set(all.filter((t) => t.length >= 3 && !STOP.has(t))));
}
function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length || !text) return text;
  const re = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\w*`, "gi");
  const out: ReactNode[] = [];
  let last = 0, key = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<mark className="hl" key={key++}>{m[0]}</mark>);
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const EXAMPLES = [
  "control room requirements",
  "dressing room showers",
  "flag poles at the stadium",
  "minimum pitch dimensions",
];

// One row of the score breakdown: a labelled signal with a 0-100 bar (or a raw
// value) and its rank in that signal's list.
function Sig({ name, pct, raw, rank }: { name: string; pct?: number | null; raw?: number; rank?: number | null }) {
  const has = pct != null;
  return (
    <div className="rd-s">
      <span className="rd-s-name">{name}</span>
      <span className="rd-s-bar">{has && <i style={{ ["--w" as string]: `${Math.round((pct ?? 0) * 100)}%` }} />}</span>
      <span className="rd-s-val">{has ? `${Math.round((pct ?? 0) * 100)}%` : raw != null ? raw.toFixed(3) : "—"}</span>
      <span className="rd-s-rank">{rank != null ? `#${rank}` : "—"}</span>
    </div>
  );
}

export function SearchView() {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [figures, setFigures] = useState<Figure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState<string | null>(null);
  const [expansions, setExpansions] = useState<Expansion[]>([]);
  const [copied, setCopied] = useState(false);

  // Facets + selected filters.
  const [facets, setFacets] = useState<Facets | null>(null);
  const [obligation, setObligation] = useState<string[]>([]);
  const [publisher, setPublisher] = useState("");
  const [standard, setStandard] = useState("");
  const [currentOnly, setCurrentOnly] = useState(true); // default: binding, current

  useEffect(() => {
    fetch("/api/facets")
      .then((r) => r.json())
      .then((d) => !d.error && setFacets(d))
      .catch(() => {});
  }, []);

  // Initialise from a shared/bookmarked URL and run the search once.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = p.get("q")?.trim();
    if (!q) return;
    const f = {
      obligation: p.get("obligation")?.split(",").filter(Boolean) ?? [],
      publisher: p.get("publisher") ?? "",
      standard: p.get("standard") ?? "",
      currentOnly: p.has("current"),
    };
    setText(q);
    setObligation(f.obligation);
    setPublisher(f.publisher);
    setStandard(f.standard);
    setCurrentOnly(f.currentOnly);
    runSearch(q, f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  type Filt = { obligation: string[]; publisher: string; standard: string; currentOnly: boolean };

  async function runSearch(q: string, f?: Filt) {
    const flt: Filt = f ?? { obligation, publisher, standard, currentOnly };
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query, limit: "20" });
      if (flt.obligation.length) params.set("obligation", flt.obligation.join(","));
      if (flt.publisher) params.set("publisher", flt.publisher);
      if (flt.standard) params.set("standard", flt.standard);
      if (flt.currentOnly) params.set("current", "1");
      // Reflect the query + filters in the URL so it can be shared/bookmarked.
      const shareParams = new URLSearchParams(params);
      shareParams.delete("limit");
      window.history.replaceState(null, "", `/?${shareParams.toString()}`);
      const r = await fetch(`/api/search?${params.toString()}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setHits(data.results ?? []);
      setFigures(data.figures ?? []);
      setExpansions(data.expansions ?? []);
      setSearched(query);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    runSearch(text);
  }

  function onChip(q: string) {
    setText(q);
    runSearch(q);
  }

  function toggleObligation(o: string) {
    setObligation((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));
  }

  // Re-run automatically when a filter changes and there is an active query.
  useEffect(() => {
    if (searched) runSearch(searched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obligation, publisher, standard, currentOnly]);

  const RRF_MAX = 3 / 61; // #1 in all three signals -> upper bound on the fused score
  const terms = searched ? queryTerms(searched, expansions) : [];
  const resultIds = new Set(hits.map((h) => h.id));
  const figByClause = new Map<number, Figure>();
  for (const f of figures) if (!figByClause.has(f.clause_id)) figByClause.set(f.clause_id, f);
  // Tables/figures whose clause the text search missed — surface them on their own.
  const standaloneFigs = figures
    .filter((f) => !resultIds.has(f.clause_id))
    .filter((f, i, arr) => arr.findIndex((x) => x.clause_id === f.clause_id) === i)
    .slice(0, 3);

  const obligations = facets?.obligations ?? ["requirement", "recommendation", "permission", "informative"];

  return (
    <div className="stage">
      <div className="eyebrow">
        <span>Hybrid search — semantic + questions + full-text</span>
      </div>
      <h1 className="title">
        Query the standards, <span className="g">down to the clause</span>.
      </h1>
      <p className="sub">
        Ask in plain language, then press Search. Results are ranked by meaning, by the questions each
        clause answers, and by wording — with the exact clause, its obligation level, and a jump to the
        source page.
      </p>

      <form className="searchbar" onSubmit={onSubmit}>
        <svg className="si" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Ask a question about the standards..."
        />
        {loading && <span className="spin" />}
        <button type="submit" className="search-btn" disabled={loading || !text.trim()}>
          Search
        </button>
      </form>

      <div className="chips">
        <span className="chips-lbl">Try</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" type="button" onClick={() => onChip(ex)}>
            {ex}
          </button>
        ))}
      </div>

      {/* Facet filters — applied server-side. */}
      <div className="facets">
        <div className="facet-group">
          <span className="chips-lbl">Obligation</span>
          {obligations.map((o) => (
            <button
              key={o}
              type="button"
              className={`chip${obligation.includes(o) ? " on" : ""}`}
              onClick={() => toggleObligation(o)}
            >
              {o}
            </button>
          ))}
        </div>
        <div className="facet-group">
          <label className="facet-toggle">
            <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} />
            <span>Current only</span>
          </label>
          <span className="sel">
            <select value={publisher} onChange={(e) => setPublisher(e.target.value)} aria-label="Publisher">
              <option value="">All publishers</option>
              {facets?.publishers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </span>
          <span className="sel">
            <select value={standard} onChange={(e) => setStandard(e.target.value)} aria-label="Standard">
              <option value="">All standards</option>
              {facets?.standards.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </span>
        </div>
      </div>

      {searched && expansions.length > 0 && (
        <p className="synnote">
          Also matched{" "}
          {expansions.map((e, i) => (
            <span key={e.matched}>
              {i > 0 && ", "}
              <b>{e.added.join(", ")}</b> (for “{e.matched}”)
            </span>
          ))}
          .
        </p>
      )}

      {searched && (
        <div className="toolbar">
          <div className="tool-right">
            <span>
              <b>{hits.length}</b> clause{hits.length === 1 ? "" : "s"} for “{searched}”
            </span>
            <button
              type="button"
              className="link-copy"
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Link copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}

      {error && <div className="empty">Search error: {error}</div>}

      {searched && standaloneFigs.length > 0 && (
        <div className="fig-strip">
          <div className="fig-strip-lbl">Matching tables &amp; figures</div>
          <div className="fig-strip-items">
            {standaloneFigs.map((f) => (
              <Link key={f.id} href={`/clause/${f.clause_id}`} className="fig-card">
                {f.image_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={f.image_url} alt={`${f.kind} on page ${f.page}`} loading="lazy" />
                )}
                <div className="fig-card-meta">
                  <span className="fig-card-where">
                    {f.clause_path ?? "—"} · {f.standard_title} · p.{f.page}
                  </span>
                  <span className="fig-card-text">{f.transcription.slice(0, 140)}…</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="list">
        {searched && hits.length === 0 && !loading && (
          <div className="empty">No clauses match “{searched}”.</div>
        )}
        {hits.map((h) => {
          const combined = Math.min(1, h.score / RRF_MAX);
          const fig = figByClause.get(h.id);
          const why = [
            h.dense_rnk != null && { k: "meaning", label: "Meaning" },
            h.lex_rnk != null && h.lex_score > 0 && { k: "wording", label: "Wording" },
            h.qdense_rnk != null && h.matched_question && { k: "question", label: "Answers a question" },
            fig && { k: "table", label: fig.kind === "figure" ? "Figure" : "Table" },
          ].filter(Boolean) as { k: string; label: string }[];
          return (
          <article className="row" key={h.id}>
            <div className="row-top">
              <div className="prov">
                {h.publisher && (
                  <>
                    <span className="pub">{h.publisher}</span>
                    <span className="sep">/</span>
                  </>
                )}
                <span>{h.standard_title}</span>
                {h.standard_status === "Superseded" && <span className="tag-super">Superseded</span>}
              </div>
              <div className="scores">
                <div className="score-row">
                  <span className="score-lbl">Relevance</span>
                  <span className="score-bar">
                    <i className="sc-comb" style={{ ["--w" as string]: `${Math.round(combined * 100)}%` }} />
                  </span>
                  <span className="score-val">{Math.round(combined * 100)}</span>
                </div>
              </div>
            </div>

            <div className="clause">
              <Link className="path" href={`/clause/${h.id}`}>{h.clause_path}</Link>
              {h.heading_trail && <span className="ct">{h.heading_trail}</span>}
              <span className={`ob ${OB_CLASS[h.obligation_type] ?? "info"}`}>
                <span className="sw" />
                {h.obligation_type}
              </span>
            </div>

            {why.length > 0 && (
              <div className="why">
                <span className="why-lbl">Matched on</span>
                {why.map((w) => (
                  <span key={w.k} className={`why-chip wc-${w.k}`}>{w.label}</span>
                ))}
              </div>
            )}

            <p className="quote">{highlight(h.verbatim_text, terms)}</p>

            {h.matched_question && (
              <div className="matchq">
                <span className="ml">Answers</span> {highlight(h.matched_question, terms)}
              </div>
            )}

            {fig && (
              <Link href={`/clause/${h.id}`} className="fig-inline">
                {fig.image_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={fig.image_url} alt={`${fig.kind} on page ${fig.page}`} loading="lazy" />
                )}
                <span className="fig-cap">
                  <b>{fig.kind === "figure" ? "Figure" : "Table"} · p.{fig.page}</b>{" "}
                  {fig.transcription.slice(0, 120)}…
                </span>
              </Link>
            )}

            <details className="rd">
              <summary>Why this ranked here — scores &amp; context</summary>
              <div className="rd-body">
                <div className="rd-row">
                  <span className="rd-lbl">Where it sits</span>
                  <span className="rd-crumb">
                    {h.standard_title}
                    {h.heading_trail && <> <span className="rd-arr">›</span> {h.heading_trail}</>}
                    {" "}<span className="rd-arr">›</span> <b>{h.clause_path}</b>
                    <span className="rd-bt">{h.block_type}</span> · p.{h.page}
                  </span>
                </div>
                {h.context && (
                  <div className="rd-row">
                    <span className="rd-lbl">Indexed context <small>(added for retrieval)</small></span>
                    <span className="rd-ctx">{h.context}</span>
                  </div>
                )}
                <div className="rd-row">
                  <span className="rd-lbl">Match signals</span>
                  <div className="rd-sig">
                    {h.rerank_score != null && <Sig name="Rerank (cross-encoder)" pct={h.rerank_score} />}
                    <Sig name="Semantic (clause)" pct={h.dense_sim} rank={h.dense_rnk} />
                    {h.q_sim != null && <Sig name="Anticipated questions" pct={h.q_sim} rank={h.qdense_rnk} />}
                    <Sig name="Keyword (full-text)" raw={h.lex_score} rank={h.lex_rnk} />
                    <div className="rd-fused">Fused RRF score <b>{h.score.toFixed(4)}</b> · final rank on this page reflects rerank + de-rank levers</div>
                  </div>
                </div>
                {h.matched_question && (
                  <div className="rd-row">
                    <span className="rd-lbl">Best-matching question</span>
                    <span className="rd-mq">“{h.matched_question}”</span>
                  </div>
                )}
              </div>
            </details>

            <div className="src">
              <Link href={`/clause/${h.id}`}>Detail</Link>
              {h.source_url ? (
                <a href={`${h.source_url}#page=${h.pdf_file_page + 1}`} target="_blank" rel="noreferrer">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 3h7v7" />
                    <path d="M10 14 21 3" />
                    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                  </svg>
                  p.{h.page}
                </a>
              ) : (
                <span>p.{h.page}</span>
              )}
              <span className="src-save">
                <SaveButton
                  compact
                  clause={{
                    id: h.id,
                    clause_path: h.clause_path,
                    heading_trail: h.heading_trail,
                    standard_id: h.standard_id,
                    standard_title: h.standard_title,
                    standard_status: h.standard_status,
                    publisher: h.publisher,
                    obligation_type: h.obligation_type,
                    page: h.page,
                    pdf_file_page: h.pdf_file_page,
                    source_url: h.source_url,
                    verbatim_text: h.verbatim_text,
                  }}
                />
              </span>
            </div>
          </article>
          );
        })}
      </div>
    </div>
  );
}
