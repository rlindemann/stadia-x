"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ApplicabilitySummary, CategoryRequirement } from "@/lib/db";

const CATS = ["A", "B", "C", "D", "E"];

export function CategoryExplorer({ summary }: { summary: ApplicabilitySummary[] }) {
  const standards = Array.from(
    new Map(summary.map((s) => [s.standard_id, s.standard_title])).entries(),
  ).map(([id, title]) => ({ id, title }));

  const [standard, setStandard] = useState(standards[0]?.id ?? "");
  const [category, setCategory] = useState("B");
  const [rows, setRows] = useState<CategoryRequirement[]>([]);
  const [loading, setLoading] = useState(false);

  const catsForStandard = new Set(summary.filter((s) => s.standard_id === standard).map((s) => s.category));

  useEffect(() => {
    if (!standard || !category) return;
    setLoading(true);
    fetch(`/api/applicability?standard=${encodeURIComponent(standard)}&category=${category}`)
      .then((r) => r.json())
      .then((d) => setRows(d.requirements ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [standard, category]);

  const mandatory = rows.filter((r) => r.modality === "mandatory");
  const best = rows.filter((r) => r.modality === "best_practice");

  const group = (list: CategoryRequirement[], label: string, cls: string) =>
    list.length > 0 && (
      <div className="cat-group">
        <div className={`cat-group-lbl ${cls}`}>{label} — {list.length}</div>
        <ul className="cat-items">
          {list.map((r) => (
            <li className="cat-item" key={r.id}>
              {r.req_ref && (
                r.clause_id
                  ? <Link href={`/clause/${r.clause_id}`} className="cat-ref">{r.req_ref}</Link>
                  : <span className="cat-ref">{r.req_ref}</span>
              )}
              <span className="cat-req">{r.requirement}</span>
              {r.value && !["mandatory", "best practice"].includes(r.value.toLowerCase()) && (
                <span className="cat-val">{r.value}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="cat-explorer">
      <div className="cat-controls">
        <span className="sel">
          <select value={standard} onChange={(e) => setStandard(e.target.value)} aria-label="Standard">
            {standards.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </span>
        <div className="cat-pills">
          {CATS.map((c) => (
            <button
              key={c}
              className={`cat-pill${category === c ? " on" : ""}`}
              disabled={!catsForStandard.has(c)}
              onClick={() => setCategory(c)}
            >
              Category {c}
            </button>
          ))}
        </div>
      </div>

      <p className="cat-lead">
        What a <b>Category {category}</b> stadium must comply with under{" "}
        {standards.find((s) => s.id === standard)?.title}.
        {" "}
        {loading ? "Loading…" : `${mandatory.length} mandatory, ${best.length} best practice.`}
      </p>

      {!loading && rows.length === 0 && (
        <div className="empty">No applicability data for this category yet.</div>
      )}
      {group(mandatory, "Mandatory", "m")}
      {group(best, "Best practice", "b")}
    </div>
  );
}
