"use client";

import { useMemo, useRef, useState } from "react";
import { CLAUSES, OBLIGATION_RANK, PUBLISHERS, type Obligation, type Status } from "@/lib/data";
import { ClauseCard } from "./clause-card";

const PAGE = 6;

export function SearchView() {
  const [pub, setPub] = useState("");
  const [ob, setOb] = useState("");
  const [status, setStatus] = useState<Status | "">("Current");
  const [sort, setSort] = useState("rel");
  const [shown, setShown] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const rows = CLAUSES.filter(
      (c) =>
        (!pub || c.pub === pub) &&
        (!ob || c.ob === (ob as Obligation)) &&
        (!status || c.status === status)
    );
    rows.sort((a, b) => {
      if (sort === "std") return a.std.localeCompare(b.std) || b.score - a.score;
      if (sort === "ob") return OBLIGATION_RANK[b.ob] - OBLIGATION_RANK[a.ob] || b.score - a.score;
      return b.score - a.score;
    });
    return rows;
  }, [pub, ob, status, sort]);

  const visible = filtered.slice(0, shown);

  function onFilterChange<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setShown(PAGE);
    };
  }

  return (
    <div className="stage">
      <div className="eyebrow">
        <span className="prev">Preview data</span>
        <span>108 standards indexed</span>
        <span className="ln" />
        <span>Library v0.1</span>
      </div>
      <h1 className="title">
        Query the standards, <span className="g">down to the clause</span>.
      </h1>
      <p className="sub">
        Semantic and keyword search across every sports-venue standard in the library, returning the
        exact clause, its obligation level, and the source page.
      </p>

      <div className="searchbar" onClick={() => inputRef.current?.focus()}>
        <svg className="si" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          defaultValue="minimum gangway width for spectator viewing"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search across every standard..."
        />
        <kbd>/</kbd>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="f-pub">Publisher</label>
          <div className="sel">
            <select id="f-pub" value={pub} onChange={(e) => onFilterChange(setPub)(e.target.value)}>
              <option value="">All publishers</option>
              {PUBLISHERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="f-ob">Obligation</label>
          <div className="sel">
            <select id="f-ob" value={ob} onChange={(e) => onFilterChange(setOb)(e.target.value)}>
              <option value="">Any</option>
              <option value="shall">Shall</option>
              <option value="should">Should</option>
              <option value="may">May</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="f-st">Status</label>
          <div className="sel">
            <select id="f-st" value={status} onChange={(e) => onFilterChange(setStatus)(e.target.value as Status | "")}>
              <option value="Current">Current</option>
              <option value="Superseded">Superseded</option>
              <option value="">All</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="f-so">Sort by</label>
          <div className="sel">
            <select id="f-so" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="rel">Relevance</option>
              <option value="std">Standard</option>
              <option value="ob">Obligation</option>
            </select>
          </div>
        </div>

        <div className="tool-right">
          <span>
            <b>{filtered.length}</b> of 108 clauses
          </span>
        </div>
      </div>

      <div className="synnote">
        Query expanded with synonyms — <b>gangway</b> also matches <b>circulation route</b> and{" "}
        <b>vomitory</b>.
      </div>

      <div className="list">
        {visible.length === 0 ? (
          <div className="empty">No clauses match these filters.</div>
        ) : (
          visible.map((c) => <ClauseCard key={c.id} clause={c} />)
        )}
      </div>

      {shown < filtered.length && (
        <div className="more">
          <button onClick={() => setShown((s) => s + PAGE)}>Load more results</button>
        </div>
      )}
    </div>
  );
}
