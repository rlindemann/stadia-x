"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: number; clause_path: string; standard_id: string;
  standard_title: string; obligation_type: string; text: string;
};

export function ClauseJump() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // debounced lookup
  useEffect(() => {
    const t = q.trim();
    if (!t) { setRows([]); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clause-find?q=${encodeURIComponent(t)}`, { signal: ctrl.signal });
        const data = await res.json();
        setRows(data.results ?? []); setActive(0); setOpen(true);
      } catch { /* aborted */ }
    }, 220);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  // close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function go(r: Row) { router.push(`/clause/${r.id}`); setQ(""); setRows([]); setOpen(false); }

  function onKey(e: React.KeyboardEvent) {
    if (!open || rows.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(rows[active] ?? rows[0]); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div className="cj" ref={boxRef}>
      <input
        className="cj-input"
        placeholder="Jump to clause…"
        aria-label="Jump to a clause by number or text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (rows.length) setOpen(true); }}
        onKeyDown={onKey}
      />
      {open && q.trim() && (
        <div className="cj-drop" role="listbox">
          {rows.length === 0 ? (
            <div className="cj-empty">No clauses match &ldquo;{q}&rdquo;.</div>
          ) : (
            rows.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`cj-item${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
              >
                <div className="cj-row">
                  <span className="cj-path">{r.clause_path.replace(/^DEF-/, "◆ ")}</span>
                  <span className="cj-std">{r.standard_title}</span>
                </div>
                <div className="cj-text">{r.text}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
