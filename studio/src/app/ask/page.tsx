"use client";

import Link from "next/link";
import { type FormEvent, Fragment, useMemo, useState } from "react";

type Clause = {
  id: number;
  standard_title: string;
  publisher: string | null;
  standard_status: string | null;
  clause_path: string;
  obligation_type: string;
  page: number;
  pdf_file_page: number;
  verbatim_text: string;
  source_url: string | null;
};

type AskResult = {
  sufficient: boolean;
  answer: string;
  clauses: Clause[];
};

const EXAMPLES = [
  "What are the minimum floodlighting levels for a stadium pitch?",
  "How many turnstiles are required per spectator capacity?",
  "What must a medical room contain?",
];

export default function AskPage() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [asked, setAsked] = useState<string | null>(null);

  async function ask(q: string) {
    const question = q.trim();
    if (!question) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, filters: { currentOnly: false } }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      setAsked(question);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    ask(text);
  }

  const byId = useMemo(() => {
    const m = new Map<number, Clause>();
    result?.clauses.forEach((c) => m.set(c.id, c));
    return m;
  }, [result]);

  // Which clauses were actually cited (in citation order of first appearance).
  const cited = useMemo(() => {
    if (!result) return [];
    const ids: number[] = [];
    const re = /\[\[(\d+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(result.answer))) {
      const id = Number(match[1]);
      if (byId.has(id) && !ids.includes(id)) ids.push(id);
    }
    return ids.map((id) => byId.get(id)!);
  }, [result, byId]);

  return (
    <div className="stage">
      <div className="eyebrow">
        <span>Ask — grounded answers with citations</span>
      </div>
      <h1 className="title">
        Ask the corpus, <span className="g">get a cited answer</span>.
      </h1>
      <p className="sub">
        Ask a compliance question in plain language. The answer is written only from the retrieved
        clauses, and every claim links to the exact clause and its source page.
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
          Ask
        </button>
      </form>

      <div className="chips">
        <span className="chips-lbl">Try</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" type="button" onClick={() => { setText(ex); ask(ex); }}>
            {ex}
          </button>
        ))}
      </div>

      {error && <div className="empty">Ask error: {error}</div>}

      {loading && <div className="empty">Reading the clauses…</div>}

      {result && !loading && (
        <div className="ask-out">
          {!result.sufficient && (
            <div className="ask-nobasis">No sufficient basis in the corpus — answer below is limited.</div>
          )}
          <p className="ask-answer">
            <Answer text={result.answer} byId={byId} />
          </p>

          {cited.length > 0 && (
            <div className="ask-sources">
              <div className="ask-sources-lbl">Citations</div>
              {cited.map((c) => (
                <div className="ask-source" key={c.id}>
                  <div className="ask-source-head">
                    <Link className="path" href={`/clause/${c.id}`}>{c.clause_path}</Link>
                    <span className="ask-source-prov">
                      {c.publisher ? `${c.publisher} · ` : ""}{c.standard_title}
                    </span>
                    {c.standard_status === "Superseded" && <span className="tag-super">Superseded</span>}
                  </div>
                  <p className="ask-source-text">{c.verbatim_text}</p>
                  <div className="src">
                    <Link href={`/clause/${c.id}`}>Detail</Link>
                    {c.source_url ? (
                      <a href={`${c.source_url}#page=${c.pdf_file_page + 1}`} target="_blank" rel="noreferrer">
                        p.{c.page}
                      </a>
                    ) : (
                      <span>p.{c.page}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {asked && !result && !loading && !error && (
        <div className="empty">No answer for “{asked}”.</div>
      )}
    </div>
  );
}

// Render answer text, turning [[id]] markers into citation chips linking to the clause.
function Answer({ text, byId }: { text: string; byId: Map<number, Clause> }) {
  const parts = text.split(/(\[\[\d+\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[\[(\d+)\]\]$/);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const id = Number(m[1]);
        const c = byId.get(id);
        if (!c) return null; // drop dangling markers
        return (
          <Link key={i} href={`/clause/${id}`} className="cite-chip" title={`${c.clause_path} — ${c.standard_title}`}>
            {c.clause_path}
          </Link>
        );
      })}
    </>
  );
}
