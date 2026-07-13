"use client";

import { useEffect, useRef, useState } from "react";
import {
  type ClauseSnapshot,
  type Collection,
  addItem,
  createCollection,
  load,
  removeItem,
  subscribe,
} from "@/lib/collections";

// Popover to add/remove a clause from the user's collections. Snapshot is stored
// so the Collections page can render without re-fetching.
export function SaveButton({ clause, compact }: { clause: ClauseSnapshot; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState<Collection[]>([]);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCols(load());
    return subscribe(() => setCols(load()));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const inCount = cols.filter((c) => c.items.some((it) => it.clause.id === clause.id)).length;

  function toggle(col: Collection) {
    if (col.items.some((it) => it.clause.id === clause.id)) removeItem(col.id, clause.id);
    else addItem(col.id, clause);
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    const col = createCollection(name);
    addItem(col.id, clause);
    setNewName("");
  }

  return (
    <div className="save" ref={ref}>
      <button
        type="button"
        className={`save-btn${inCount ? " on" : ""}${compact ? " compact" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Save to collection"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill={inCount ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        {inCount ? `Saved${inCount > 1 ? ` (${inCount})` : ""}` : "Save"}
      </button>

      {open && (
        <div className="save-pop">
          {cols.length === 0 && <div className="save-empty">No collections yet.</div>}
          {cols.map((c) => {
            const inIt = c.items.some((it) => it.clause.id === clause.id);
            return (
              <label className="save-row" key={c.id}>
                <input type="checkbox" checked={inIt} onChange={() => toggle(c)} />
                <span>{c.name}</span>
                <span className="save-count">{c.items.length}</span>
              </label>
            );
          })}
          <div className="save-new">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="New collection…"
            />
            <button type="button" onClick={create} disabled={!newName.trim()}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
