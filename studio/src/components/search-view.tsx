"use client";

import { useEffect, useRef, useState } from "react";

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
  dense_rnk: number | null;
  qdense_rnk: number | null;
  lex_rnk: number | null;
  matched_question: string | null;
};

const OB_CLASS: Record<string, string> = {
  requirement: "shall",
  recommendation: "should",
  permission: "may",
  informative: "info",
};

const EXAMPLE = "how many dressing rooms for a double-header match";

export function SearchView() {
  const [query, setQuery] = useState(EXAMPLE);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced live search against /api/search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setRan(false);
      return;
    }
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) throw new Error(data.error);
          setHits(data.results ?? []);
          setRan(true);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(String(e.message ?? e));
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const maxScore = hits.length ? hits[0].score : 1;

  return (
    <div className="stage">
      <div className="eyebrow">
        <span className="prev">Live</span>
        <span>Hybrid search — semantic + questions + full-text</span>
      </div>
      <h1 className="title">
        Query the standards, <span className="g">down to the clause</span>.
      </h1>
      <p className="sub">
        Ask in plain language. Results are ranked by meaning, by the questions each clause answers, and
        by wording — with the exact clause, its obligation level, and a jump to the source page.
      </p>

      <div className="searchbar" onClick={() => inputRef.current?.focus()}>
        <svg className="si" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Ask a question about the standards..."
        />
        {loading && <span className="spin" />}
      </div>

      <div className="toolbar">
        <div className="tool-right">
          <span>{ran ? <><b>{hits.length}</b> clause{hits.length === 1 ? "" : "s"}</> : "Type to search"}</span>
        </div>
      </div>

      {error && <div className="empty">Search error: {error}</div>}

      <div className="list">
        {ran && hits.length === 0 && !loading ? (
          <div className="empty">No clauses match that query.</div>
        ) : (
          hits.map((h) => (
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
                </div>
                <div className="rel">
                  <span className="track">
                    <i style={{ ["--w" as string]: `${(h.score / maxScore) * 100}%` }} />
                  </span>
                  <span className="num">{h.score.toFixed(3)}</span>
                </div>
              </div>

              <div className="clause">
                <span className="path">{h.clause_path}</span>
                {h.heading_trail && <span className="ct">{h.heading_trail}</span>}
                <span className={`ob ${OB_CLASS[h.obligation_type] ?? "info"}`}>
                  <span className="sw" />
                  {h.obligation_type}
                </span>
              </div>

              <p className="quote">{h.verbatim_text}</p>

              {h.matched_question && (
                <div className="matchq">
                  <span className="ml">Matched question</span> {h.matched_question}
                </div>
              )}

              <div className="src">
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
                <span className="signals">
                  semantic {h.dense_rnk ?? "—"} · question {h.qdense_rnk ?? "—"} · text {h.lex_rnk ?? "—"}
                </span>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
