"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StandardRow } from "@/lib/db";

export function StandardsTable({ standards }: { standards: StandardRow[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<StandardRow | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Title</th>
              <th>Publisher</th>
              <th>Version</th>
              <th>Status</th>
              <th className="c-num">Clauses</th>
            </tr>
          </thead>
          <tbody>
            {standards.length === 0 ? (
              <tr>
                <td colSpan={6} className="c-muted">
                  No standards loaded yet.
                </td>
              </tr>
            ) : (
              standards.map((s) => (
                <tr
                  key={s.id}
                  className="row-clickable"
                  title="Open in the review viewer"
                  onClick={() => router.push(`/review?doc=${encodeURIComponent(s.id)}`)}
                  onMouseEnter={() => s.thumb_url && setHover(s)}
                  onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                >
                  <td className="c-code">{s.id}</td>
                  <td className="c-title">
                    {s.title}
                    {s.superseded_by_title && (
                      <span className="repl">Replaced by {s.superseded_by_title}</span>
                    )}
                  </td>
                  <td className="c-muted">{s.publisher ?? "—"}</td>
                  <td className="c-muted">{s.version ?? "—"}</td>
                  <td>
                    {s.status ? (
                      <span className={`status ${s.status === "Superseded" ? "superseded" : ""}`}>
                        <span className="sw" />
                        {s.status}
                      </span>
                    ) : (
                      <span className="c-muted">—</span>
                    )}
                  </td>
                  <td className="c-num">{s.clause_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hover?.thumb_url && (
        <img
          className="thumb-pop"
          src={hover.thumb_url}
          alt={`${hover.title} title page`}
          style={{
            left: Math.min(pos.x + 20, (typeof window !== "undefined" ? window.innerWidth : 1200) - 260),
            top: Math.min(pos.y + 16, (typeof window !== "undefined" ? window.innerHeight : 800) - 340),
          }}
        />
      )}
    </>
  );
}
