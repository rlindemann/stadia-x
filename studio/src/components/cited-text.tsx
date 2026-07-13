"use client";

import Link from "next/link";
import { Fragment } from "react";

export type CiteClause = { id: number; clause_path: string; standard_title: string };

// Render text containing [[clause_id]] markers, turning each into a chip that
// links to the clause detail page. Unknown ids are dropped.
export function CitedText({ text, byId }: { text: string; byId: Map<number, CiteClause> }) {
  const parts = text.split(/(\[\[\d+\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[\[(\d+)\]\]$/);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const id = Number(m[1]);
        const c = byId.get(id);
        if (!c) return null;
        return (
          <Link key={i} href={`/clause/${id}`} className="cite-chip" title={`${c.clause_path} — ${c.standard_title}`}>
            {c.clause_path}
          </Link>
        );
      })}
    </>
  );
}
