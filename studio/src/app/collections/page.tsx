"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  type Collection,
  createCollection,
  deleteCollection,
  load,
  removeItem,
  renameCollection,
  setNote,
  subscribe,
} from "@/lib/collections";

const OB_CLASS: Record<string, string> = {
  requirement: "shall",
  recommendation: "should",
  permission: "may",
  informative: "info",
};

// Send the collection to the server, which renders a cited report and streams it back.
async function exportCollection(col: Collection, fmt: "pdf" | "docx") {
  const r = await fetch(`/api/export?fmt=${fmt}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: col.name, items: col.items }),
  });
  if (!r.ok) {
    alert(`Export failed: ${await r.text()}`);
    return;
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${col.name.replace(/[^\w.-]+/g, "_")}.${fmt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CollectionsPage() {
  const [cols, setCols] = useState<Collection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCols(load());
    return subscribe(() => setCols(load()));
  }, []);

  const active = useMemo(
    () => cols.find((c) => c.id === activeId) ?? cols[0] ?? null,
    [cols, activeId],
  );

  if (!mounted) return <div className="stage"><div className="empty">Loading…</div></div>;

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Collections</h1>
        <p className="page-sub">
          Named sets of clauses for a project, with notes. Saved in this browser. Save a clause from any
          search result or its detail page, then export a collection as a cited report.
        </p>
      </div>

      <div className="col-layout">
        <aside className="col-side">
          {cols.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`col-tab${(active?.id === c.id) ? " on" : ""}`}
              onClick={() => setActiveId(c.id)}
            >
              <span>{c.name}</span>
              <span className="col-tab-n">{c.items.length}</span>
            </button>
          ))}
          <div className="col-new">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  const col = createCollection(newName);
                  setActiveId(col.id);
                  setNewName("");
                }
              }}
              placeholder="New collection…"
            />
          </div>
        </aside>

        <div className="col-main">
          {!active ? (
            <div className="empty">No collections yet — create one, then save clauses into it.</div>
          ) : (
            <>
              <div className="col-head">
                <input
                  className="col-title-input"
                  value={active.name}
                  onChange={(e) => renameCollection(active.id, e.target.value)}
                />
                <div className="col-actions">
                  <button type="button" className="col-export" disabled={!active.items.length} onClick={() => exportCollection(active, "pdf")}>
                    Export PDF
                  </button>
                  <button type="button" className="col-export" disabled={!active.items.length} onClick={() => exportCollection(active, "docx")}>
                    Export Word
                  </button>
                  <button
                    type="button"
                    className="col-delete"
                    onClick={() => {
                      deleteCollection(active.id);
                      setActiveId(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {active.items.length === 0 ? (
                <div className="empty">This collection is empty. Save clauses from search or a clause page.</div>
              ) : (
                <div className="list">
                  {active.items.map(({ clause: c, note }) => (
                    <article className="row" key={c.id}>
                      <div className="prov">
                        {c.publisher && <><span className="pub">{c.publisher}</span><span className="sep">/</span></>}
                        <span>{c.standard_title}</span>
                        {c.standard_status === "Superseded" && <span className="tag-super">Superseded</span>}
                      </div>
                      <div className="clause">
                        <Link className="path" href={`/clause/${c.id}`}>{c.clause_path}</Link>
                        {c.heading_trail && <span className="ct">{c.heading_trail}</span>}
                        <span className={`ob ${OB_CLASS[c.obligation_type] ?? "info"}`}>
                          <span className="sw" />{c.obligation_type}
                        </span>
                      </div>
                      <p className="quote">{c.verbatim_text}</p>
                      <textarea
                        className="col-note"
                        defaultValue={note}
                        placeholder="Add a note…"
                        onBlur={(e) => setNote(active.id, c.id, e.target.value)}
                      />
                      <div className="src">
                        <Link href={`/clause/${c.id}`}>Detail</Link>
                        {c.source_url ? (
                          <a href={`${c.source_url}#page=${c.pdf_file_page + 1}`} target="_blank" rel="noreferrer">p.{c.page}</a>
                        ) : (
                          <span>p.{c.page}</span>
                        )}
                        <button type="button" className="col-remove" onClick={() => removeItem(active.id, c.id)}>Remove</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
