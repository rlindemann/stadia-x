"use client";

import { type FormEvent, useState } from "react";

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

const EXAMPLES = [
  "control room requirements",
  "dressing room showers",
  "flag poles at the stadium",
  "minimum pitch dimensions",
];

export function SearchView() {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState<string | null>(null);

  async function runSearch(q: string) {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=20`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setHits(data.results ?? []);
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

  const maxScore = hits.length ? hits[0].score : 1;

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

      {searched && (
        <div className="toolbar">
          <div className="tool-right">
            <span>
              <b>{hits.length}</b> clause{hits.length === 1 ? "" : "s"} for “{searched}”
            </span>
          </div>
        </div>
      )}

      {error && <div className="empty">Search error: {error}</div>}

      <div className="list">
        {searched && hits.length === 0 && !loading && (
          <div className="empty">No clauses match “{searched}”.</div>
        )}
        {hits.map((h) => (
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
                <span className="num">{Math.round((h.score / maxScore) * 100)}</span>
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
        ))}
      </div>
    </div>
  );
}
