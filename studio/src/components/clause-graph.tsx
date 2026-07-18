"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import cytoscape from "cytoscape";
import type { GraphViewNode } from "@/lib/db";

const TYPES = ["reference", "supersedes", "defines_term", "similar"] as const;
const TYPE_LABEL: Record<string, string> = {
  reference: "reference", supersedes: "supersedes", defines_term: "defines term", similar: "similar",
};
const MAX_NODES = 200;

type NodeData = { id: string; label: string; path: string; std: string; obl: string; text: string; expanded: number };

const edgeKey = (a: number, b: number, type: string) => {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `e-${x}-${y}-${type}`;
};

// Radial starting positions: seed centre, 1-hop ring, 2-hop fanned from parent.
function radialPositions(seed: number, initial: GraphViewNode[]) {
  const children = new Map<number, GraphViewNode[]>();
  for (const n of initial) {
    if (n.parent == null) continue;
    const a = children.get(n.parent) ?? []; a.push(n); children.set(n.parent, a);
  }
  const pos = new Map<number, { x: number; y: number }>();
  pos.set(seed, { x: 0, y: 0 });
  const ring1 = initial.filter((n) => n.depth === 1);
  ring1.forEach((n, i) => {
    const ang = -Math.PI / 2 + (i / Math.max(ring1.length, 1)) * Math.PI * 2;
    pos.set(n.id, { x: 150 * Math.cos(ang), y: 150 * Math.sin(ang) });
    const kids = children.get(n.id) ?? [];
    kids.forEach((kid, j) => {
      const t = ang + (kids.length > 1 ? (j / (kids.length - 1) - 0.5) * 0.7 : 0);
      pos.set(kid.id, { x: 300 * Math.cos(t), y: 300 * Math.sin(t) });
    });
  });
  return pos;
}

function buildElements(seed: number, initial: GraphViewNode[]): cytoscape.ElementDefinition[] {
  const pos = radialPositions(seed, initial);
  const nodes: cytoscape.ElementDefinition[] = initial.map((n) => ({
    group: "nodes",
    data: {
      id: String(n.id), label: n.clause_path.replace(/^DEF-/, "◆ "), path: n.clause_path,
      std: n.standard_title, obl: n.obligation_type, text: n.text, expanded: n.depth <= 1 ? 1 : 0,
    } as NodeData,
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    classes: n.id === seed ? "seed" : "",
  }));
  const seen = new Set<string>();
  const edges: cytoscape.ElementDefinition[] = [];
  for (const n of initial) {
    if (n.parent == null) continue;
    const k = edgeKey(n.parent, n.id, n.via ?? "similar");
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ group: "edges", data: { id: k, source: String(n.parent), target: String(n.id), type: n.via ?? "similar" } });
  }
  return [...nodes, ...edges];
}

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const g = (v: string) => cs.getPropertyValue(v).trim();
  return {
    accent: g("--accent"), accent2: g("--accent-2"), wash: g("--accent-wash"),
    shall: g("--shall"), should: g("--should"), may: g("--may"),
    ink: g("--ink"), raised: g("--raised"), line2: g("--line-2"),
  };
}

function buildStyle(p: ReturnType<typeof palette>): cytoscape.StylesheetJson {
  return [
    { selector: "node", style: {
      width: 14, height: 14, "background-color": p.raised, "border-color": p.line2, "border-width": 2,
      label: "data(label)", "font-family": "monospace", "font-size": 9, color: p.ink,
      "text-halign": "right", "text-valign": "center", "text-margin-x": 3, "min-zoomed-font-size": 7,
    } },
    { selector: "node[expanded = 1]", style: { "background-color": p.wash, "border-color": p.accent2 } },
    { selector: ".seed", style: { width: 24, height: 24, "background-color": p.accent, "border-width": 0, "font-size": 12, "font-weight": "bold" } },
    { selector: ".sel", style: { "border-color": p.accent, "border-width": 3 } },
    { selector: ".dim", style: { opacity: 0.15 } },
    { selector: "edge", style: { width: 1.6, "curve-style": "bezier", "line-color": p.may, opacity: 0.7 } },
    { selector: 'edge[type = "reference"]', style: { "line-color": p.accent2 } },
    { selector: 'edge[type = "supersedes"]', style: { "line-color": p.shall } },
    { selector: 'edge[type = "defines_term"]', style: { "line-color": p.should } },
    { selector: 'edge[type = "similar"]', style: { "line-color": p.may, width: 1, opacity: 0.4 } },
    { selector: "edge.dim", style: { opacity: 0.05 } },
    { selector: "edge.hide", style: { display: "none" } },
  ];
}

export function ClauseGraph({ seed, nodes: initial }: { seed: number; nodes: GraphViewNode[] }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const expandRef = useRef<(id: number) => void>(() => {});
  const busyRef = useRef<Set<number>>(new Set());
  const expandedRef = useRef<Set<number>>(new Set(initial.filter((n) => n.depth <= 1).map((n) => n.id)));
  const lastTap = useRef<{ id: number; t: number }>({ id: 0, t: 0 });
  const hiddenRef = useRef<Set<string>>(new Set());

  const [selected, setSelected] = useState<NodeData | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [capped, setCapped] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({ reference: 0, supersedes: 0, defines_term: 0, similar: 0 });
  const [stats, setStats] = useState({ nodes: initial.length, edges: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: buildElements(seed, initial),
      style: buildStyle(palette()),
      layout: { name: "preset" },
      minZoom: 0.2, maxZoom: 4, wheelSensitivity: 0.25,
    });
    cyRef.current = cy;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __cy?: cytoscape.Core }).__cy = cy;
    cy.fit(undefined, 40);

    const refresh = () => {
      const c: Record<string, number> = { reference: 0, supersedes: 0, defines_term: 0, similar: 0 };
      cy.edges().forEach((e) => { c[e.data("type")] = (c[e.data("type")] ?? 0) + 1; });
      setCounts(c);
      setStats({ nodes: cy.nodes().length, edges: cy.edges().length });
    };
    refresh();

    const expand = async (id: number) => {
      if (busyRef.current.has(id) || expandedRef.current.has(id)) return;
      busyRef.current.add(id); setPendingId(id);
      try {
        const res = await fetch(`/api/clause/${id}/graph`);
        const data: { neighbours: (NodeData & { edge_type: string })[] } = await res.json();
        const parent = cy.getElementById(String(id));
        const pp = parent.position();
        const add: cytoscape.ElementDefinition[] = [];
        let added = 0, overflow = false;
        data.neighbours.forEach((nb, i) => {
          const sid = String(nb.id);
          if (cy.getElementById(sid).empty() && !add.some((a) => a.data.id === sid)) {
            if (cy.nodes().length + added >= MAX_NODES) { overflow = true; return; }
            added++;
            const ang = (i / Math.max(data.neighbours.length, 1)) * Math.PI * 2;
            add.push({ group: "nodes", data: {
              id: sid, label: String(nb.path).replace(/^DEF-/, "◆ "), path: nb.path,
              std: nb.std, obl: nb.obl, text: nb.text, expanded: 0,
            } as NodeData, position: { x: pp.x + Math.cos(ang) * 70, y: pp.y + Math.sin(ang) * 70 } });
          }
          const k = edgeKey(id, Number(nb.id), nb.edge_type);
          const present = !cy.getElementById(sid).empty() || add.some((a) => a.data.id === sid);
          if (cy.getElementById(k).empty() && !add.some((a) => a.data.id === k) && present) {
            add.push({ group: "edges", data: { id: k, source: String(id), target: sid, type: nb.edge_type } });
          }
        });
        parent.data("expanded", 1);
        if (add.length) cy.add(add);
        TYPES.forEach((t) => { if (hiddenRef.current.has(t)) cy.edges(`[type = "${t}"]`).addClass("hide"); });
        expandedRef.current.add(id);
        if (overflow) setCapped(true);
        refresh();
      } finally {
        busyRef.current.delete(id);
        setPendingId((p) => (p === id ? null : p));
      }
    };
    expandRef.current = (id) => { void expand(id); };

    const select = (n: cytoscape.NodeSingular) => {
      cy.nodes().removeClass("sel dim"); cy.edges().removeClass("dim");
      n.addClass("sel");
      const others = cy.elements().difference(n.closedNeighborhood());
      others.addClass("dim");
      setSelected(n.data() as NodeData);
    };

    cy.on("tap", "node", (e) => {
      const n = e.target as cytoscape.NodeSingular;
      const id = Number(n.id());
      const now = e.timeStamp || 0;
      if (lastTap.current.id === id && now - lastTap.current.t < 350) {
        router.push(`/clause/${id}`); // double-tap = open the full clause
        return;
      }
      lastTap.current = { id, t: now };
      select(n);
      if (!n.data("expanded")) void expand(id);
    });
    cy.on("tap", (e) => {
      if (e.target === cy) {
        cy.nodes().removeClass("sel dim"); cy.edges().removeClass("dim");
        setSelected(null);
      }
    });

    return () => { cy.destroy(); cyRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, initial]);

  // keep a ref of hidden for the async expand closure
  useEffect(() => {
    hiddenRef.current = hidden;
    const cy = cyRef.current; if (!cy) return;
    TYPES.forEach((t) => {
      const eds = cy.edges(`[type = "${t}"]`);
      if (hidden.has(t)) eds.addClass("hide"); else eds.removeClass("hide");
    });
  }, [hidden]);

  // re-theme the canvas when the app theme flips
  useEffect(() => {
    const obs = new MutationObserver(() => cyRef.current?.style(buildStyle(palette())));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  function reset() {
    const cy = cyRef.current; if (!cy) return;
    cy.elements().remove();
    cy.add(buildElements(seed, initial));
    expandedRef.current = new Set(initial.filter((n) => n.depth <= 1).map((n) => n.id));
    setSelected(null); setCapped(false);
    cy.fit(undefined, 40);
    const c: Record<string, number> = { reference: 0, supersedes: 0, defines_term: 0, similar: 0 };
    cy.edges().forEach((e) => { c[e.data("type")] = (c[e.data("type")] ?? 0) + 1; });
    setCounts(c); setStats({ nodes: cy.nodes().length, edges: cy.edges().length });
  }

  return (
    <div className="cg-stage">
      <div className="cg-toolbar">
        <span className="cg-count">{stats.nodes} clauses &middot; {stats.edges} links</span>
        <button className="cg-btn" onClick={() => cyRef.current?.fit(undefined, 40)}>Fit</button>
        <button className="cg-btn" onClick={reset}>Reset</button>
      </div>

      <div className="cg-canvas" ref={containerRef} />

      <div className="cg-legend">
        <div className="cg-lg-title">Edge type — click to filter</div>
        {TYPES.map((ty) => (
          <button
            key={ty}
            className={`cg-chip${hidden.has(ty) ? " off" : ""}`}
            onClick={() => setHidden((h) => { const n = new Set(h); n.has(ty) ? n.delete(ty) : n.add(ty); return n; })}
          >
            <span className={`cg-dot cg-dot-${ty}`} />
            <span>{TYPE_LABEL[ty]}</span>
            <span className="cg-ct">{counts[ty]}</span>
          </button>
        ))}
      </div>

      {selected && (
        <aside className="cg-panel">
          <div className="cg-p-path">{selected.path.startsWith("DEF-") ? selected.path.slice(4) : selected.path}</div>
          <div className="cg-p-badges">
            <span className="cg-badge">{selected.std}</span>
            <span className={`cg-badge ob-${selected.obl}`}>{selected.obl}</span>
          </div>
          <p className="cg-p-text">{selected.text}</p>
          <div className="cg-p-actions">
            {!expandedRef.current.has(Number(selected.id)) && (
              <button className="cg-btn" onClick={() => expandRef.current(Number(selected.id))} disabled={pendingId === Number(selected.id)}>
                {pendingId === Number(selected.id) ? "Loading…" : "Expand neighbours"}
              </button>
            )}
            <Link className="cg-open-link" href={`/clause/${selected.id}`}>Open full clause &rarr;</Link>
          </div>
        </aside>
      )}

      {capped && <div className="cg-cap">Showing the first {MAX_NODES} clauses — reset to explore elsewhere.</div>}
      <div className="cg-hint">click a node to expand &middot; double-click to open it &middot; drag &middot; scroll to zoom</div>
    </div>
  );
}
