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
  standard_status: string | null;
  dense_rnk: number | null;
  qdense_rnk: number | null;
  lex_rnk: number | null;
  dense_sim: number;
  q_sim: number | null;
  lex_score: number;
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

  // Keyword scores (ts_rank) have no fixed scale — show strength relative to the
  // strongest keyword match in the result set.
  const maxLex = Math.max(1e-9, ...hits.map((h) => h.lex_score));
  const RRF_MAX = 3 / 61; // #1 in all three signals

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
        {hits.map((h) => {
          const semantic = Math.max(h.dense_sim, h.q_sim ?? 0);
          const keyword = h.lex_score / maxLex;
          const combined = Math.min(1, h.score / RRF_MAX);
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
                {[
                  { lbl: "Semantic", v: semantic, cls: "sc-sem" },
                  { lbl: "Keyword", v: keyword, cls: "sc-key" },
                  { lbl: "Combined", v: combined, cls: "sc-comb" },
                ].map((s) => (
                  <div className="score-row" key={s.lbl}>
                    <span className="score-lbl">{s.lbl}</span>
                    <span className="score-bar">
                      <i className={s.cls} style={{ ["--w" as string]: `${Math.round(s.v * 100)}%` }} />
                    </span>
                    <span className="score-val">{Math.round(s.v * 100)}</span>
                  </div>
                ))}
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
            </div>
          </article>
          );
        })}
      </div>
    </div>
  );
}
