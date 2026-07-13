"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

type GapRow = {
  topic: string;
  covered: boolean;
  score: number;
  best: {
    id: number;
    clause_path: string;
    standard_title: string;
    obligation_type: string;
    page: number;
    verbatim_text: string;
  } | null;
};

const SAMPLE = `medical room
pitch dimensions
floodlighting levels
turnstile capacity
anti-doping facilities
helicopter landing pad`;

export default function GapsPage() {
  const [text, setText] = useState(SAMPLE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<GapRow[] | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    const topics = text.split("\n").map((t) => t.trim()).filter(Boolean);
    if (topics.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/gap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setRows(data.results);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const gaps = rows?.filter((r) => !r.covered).length ?? 0;

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Coverage / gap analysis</h1>
        <p className="page-sub">
          Paste your project topics (one per line). Each is checked against the corpus; topics with no
          strongly-governing clause are flagged as gaps so you know where the standards are silent.
        </p>
      </div>

      <form onSubmit={run} className="gap-form">
        <textarea
          className="gap-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder="One topic per line…"
        />
        <button type="submit" className="search-btn" disabled={loading}>
          {loading ? "Checking…" : "Analyse coverage"}
        </button>
      </form>

      {error && <div className="empty">Gap analysis error: {error}</div>}

      {rows && (
        <>
          <div className="toolbar">
            <div className="tool-right">
              <span><b>{rows.length - gaps}</b> covered · <b>{gaps}</b> gap{gaps === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className="list">
            {rows.map((r) => (
              <article className={`gap-row${r.covered ? "" : " gap-miss"}`} key={r.topic}>
                <div className="gap-head">
                  <span className={`gap-badge ${r.covered ? "ok" : "miss"}`}>{r.covered ? "Covered" : "Gap"}</span>
                  <span className="gap-topic">{r.topic}</span>
                  <span className="gap-score">{Math.round(r.score * 100)}</span>
                </div>
                {r.covered && r.best ? (
                  <div className="gap-best">
                    <Link className="path" href={`/clause/${r.best.id}`}>{r.best.clause_path}</Link>
                    <span className="gap-best-prov">{r.best.standard_title} · p.{r.best.page}</span>
                    <p className="gap-best-text">{r.best.verbatim_text}</p>
                  </div>
                ) : (
                  <div className="gap-none">No governing clause found in the corpus.</div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
