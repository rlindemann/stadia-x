"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { StandardClauseRow } from "@/lib/db";

const OB_CLASS: Record<string, string> = {
  requirement: "shall",
  recommendation: "should",
  permission: "may",
  informative: "info",
};

export function StandardClauseList({ clauses }: { clauses: StandardClauseRow[] }) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return clauses;
    return clauses.filter(
      (c) =>
        c.clause_path.toLowerCase().includes(t) ||
        (c.heading_trail ?? "").toLowerCase().includes(t) ||
        c.text.toLowerCase().includes(t),
    );
  }, [q, clauses]);

  return (
    <div className="sc-list">
      <div className="sc-filter">
        <input
          className="sc-input"
          placeholder="Filter clauses by number, heading, or text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="sc-shown">{shown.length} of {clauses.length}</span>
      </div>

      {shown.length === 0 ? (
        <p className="c-muted">No clauses match “{q}”.</p>
      ) : (
        <ul className="sc-items">
          {shown.map((c) => (
            <li key={c.id}>
              <Link href={`/clause/${c.id}`} className="sc-item">
                <span className="sc-path">{c.clause_path.replace(/^DEF-/, "◆ ")}</span>
                <span className={`ob ${OB_CLASS[c.obligation_type] ?? "info"}`}>
                  <span className="sw" />
                  {c.obligation_type}
                </span>
                {c.heading_trail && <span className="sc-trail">{c.heading_trail}</span>}
                <span className="sc-text">{c.text}</span>
                <span className="sc-page">p.{c.page}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
