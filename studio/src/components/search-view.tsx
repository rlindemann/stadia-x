"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
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

  // Keyword scores (ts_rank) have no fixed scale — show strength relative to the
  // strongest keyword match in the result set.
  const maxLex = Math.max(1e-9, ...hits.map((h) => h.lex_score));
  const RRF_MAX = 3 / 61; // #1 in all three signals

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
              <Link className="path" href={`/clause/${h.id}`}>{h.clause_path}</Link>
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
