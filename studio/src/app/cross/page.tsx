"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { CitedText, type CiteClause } from "@/components/cited-text";

type Std = { id: string; title: string };
type Clause = CiteClause & { obligation_type: string; verbatim_text: string };
type Result = {
  topic: string;
  overview: string;
  positions: { standard_id: string; summary: string }[];
  standards: Std[];
  clauses: Clause[];
};

const EXAMPLES = ["media facilities", "pitch dimensions", "spectator safety", "floodlighting"];

export default function CrossPage() {
  const [facets, setFacets] = useState<Std[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    fetch("/api/facets")
      .then((r) => r.json())
      .then((d) => !d.error && setFacets(d.standards ?? []))
      .catch(() => {});
  }, []);

  async function run(topic: string) {
    const t = topic.trim();
    if (!t) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/cross-standard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t, standards: selected }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run(text);
  }

  const byId = useMemo(() => {
    const m = new Map<number, Clause>();
    result?.clauses.forEach((c) => m.set(c.id, c));
    return m;
  }, [result]);

  const titleOf = (id: string) => result?.standards.find((s) => s.id === id)?.title ?? id;

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Cross-standard comparison</h1>
        <p className="page-sub">
          Compare how different standards treat the same topic. Pick standards (or leave all selected),
          enter a topic, and get each standard&apos;s position with the concrete differences called out —
          every claim cited to a clause.
        </p>
      </div>

      <form className="searchbar" onSubmit={onSubmit}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          placeholder="A topic to compare, e.g. media facilities..."
        />
        {loading && <span className="spin" />}
        <button type="submit" className="search-btn" disabled={loading || !text.trim()}>
          Compare
        </button>
      </form>

      <div className="chips">
        <span className="chips-lbl">Try</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" type="button" onClick={() => { setText(ex); run(ex); }}>
            {ex}
          </button>
        ))}
      </div>

      {facets.length > 0 && (
        <div className="facets">
          <div className="facet-group">
            <span className="chips-lbl">Standards</span>
            {facets.map((s) => {
              const on = selected.includes(s.id) || selected.length === 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`chip${selected.includes(s.id) ? " on" : ""}`}
                  onClick={() =>
                    setSelected((prev) =>
                      prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                    )
                  }
                  title={on ? "included" : "excluded"}
                >
                  {s.title}
                </button>
              );
            })}
            {selected.length === 0 && <span className="synnote" style={{ padding: 0 }}>all standards</span>}
          </div>
        </div>
      )}

      {error && <div className="empty">Compare error: {error}</div>}
      {loading && <div className="empty">Comparing standards…</div>}

      {result && !loading && (
        <div className="ask-out">
          <p className="ask-answer">
            <CitedText text={result.overview} byId={byId} />
          </p>

          <div className="cross-grid">
            {result.positions.map((p) => (
              <div className="cross-col" key={p.standard_id}>
                <div className="cross-col-head">{titleOf(p.standard_id)}</div>
                <p className="cross-col-body">
                  <CitedText text={p.summary} byId={byId} />
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
