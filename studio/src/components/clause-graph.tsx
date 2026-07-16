"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { GraphViewNode } from "@/lib/db";

const TYPES = ["reference", "supersedes", "defines_term", "similar"] as const;
const TYPE_LABEL: Record<string, string> = {
  reference: "reference",
  supersedes: "supersedes",
  defines_term: "defines term",
  similar: "similar",
};
const MAX_NODES = 200;

type Meta = {
  id: number;
  clause_path: string;
  standard_id: string;
  standard_title: string;
  obligation_type: string;
  text: string;
};
type SimNode = Meta & { expanded: boolean };
type SimEdge = { key: string; src: number; dst: number; type: string };
type P = { x: number; y: number; vx: number; vy: number; fx: number | null; fy: number | null };

const edgeKey = (a: number, b: number, type: string) => {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `${x}-${y}-${type}`;
};

const nodeTf = (p: { x: number; y: number }) => `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`;
const edgeD = (s: { x: number; y: number }, u: { x: number; y: number }) => {
  const mx = (s.x + u.x) / 2, my = (s.y + u.y) / 2, dx = u.x - s.x, dy = u.y - s.y;
  const len = Math.hypot(dx, dy) || 1, bow = Math.min(len * 0.12, 40);
  const cx = mx - (dy / len) * bow, cy = my + (dx / len) * bow;
  return `M${s.x.toFixed(2)} ${s.y.toFixed(2)} Q${cx.toFixed(2)} ${cy.toFixed(2)} ${u.x.toFixed(2)} ${u.y.toFixed(2)}`;
};

// Seed the accumulating graph from the server-fetched 2-hop tree, laying nodes
// out radially as a tidy starting arrangement (the force sim relaxes it after).
function buildInitial(seed: number, initial: GraphViewNode[]) {
  const byId = new Map(initial.map((n) => [n.id, n]));
  const children = new Map<number, GraphViewNode[]>();
  for (const n of initial) {
    if (n.parent == null) continue;
    const arr = children.get(n.parent) ?? [];
    arr.push(n);
    children.set(n.parent, arr);
  }
  const pos = new Map<number, P>();
  const put = (id: number, x: number, y: number) => pos.set(id, { x, y, vx: 0, vy: 0, fx: null, fy: null });
  put(seed, 0, 0);
  const ring1 = initial.filter((n) => n.depth === 1);
  const R1 = 150, R2 = 300;
  ring1.forEach((n, i) => {
    const ang = -Math.PI / 2 + (i / Math.max(ring1.length, 1)) * Math.PI * 2;
    put(n.id, R1 * Math.cos(ang), R1 * Math.sin(ang));
    (children.get(n.id) ?? []).forEach((kid, j) => {
      const kn = (children.get(n.id) ?? []).length;
      const spread = 0.7;
      const t = ang + (kn > 1 ? (j / (kn - 1) - 0.5) * spread : 0);
      put(kid.id, R2 * Math.cos(t), R2 * Math.sin(t));
    });
  });

  const nodes: SimNode[] = initial.map((n) => ({
    id: n.id, clause_path: n.clause_path, standard_id: n.standard_id, standard_title: n.standard_title,
    obligation_type: n.obligation_type, text: n.text, expanded: n.depth <= 1,
  }));
  const edges: SimEdge[] = [];
  const eseen = new Set<string>();
  for (const n of initial) {
    if (n.parent == null || !byId.has(n.parent)) continue;
    const k = edgeKey(n.parent, n.id, n.via ?? "similar");
    if (eseen.has(k)) continue;
    eseen.add(k);
    edges.push({ key: k, src: n.parent, dst: n.id, type: n.via ?? "similar" });
  }
  const expandedIds = new Set(nodes.filter((n) => n.expanded).map((n) => n.id));
  return { nodes, edges, pos, expandedIds };
}

export function ClauseGraph({ seed, nodes: initial }: { seed: number; nodes: GraphViewNode[] }) {
  const first = useMemo(() => buildInitial(seed, initial), [seed, initial]);

  const [nodes, setNodes] = useState<SimNode[]>(first.nodes);
  const [edges, setEdges] = useState<SimEdge[]>(first.edges);
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(seed);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [t, setT] = useState({ k: 1, tx: 0, ty: 0 });
  const [capped, setCapped] = useState(false);

  const posRef = useRef<Map<number, P>>(first.pos);
  const expandedRef = useRef<Set<number>>(first.expandedIds);
  const gRefs = useRef<Map<number, SVGGElement>>(new Map());
  const eRefs = useRef<Map<string, SVGPathElement>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);
  const graphRef = useRef({ nodes, edges });
  const tRef = useRef(t);
  const alphaRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const nodeDragRef = useRef<{ id: number; sx: number; sy: number; moved: boolean } | null>(null);

  graphRef.current = { nodes, edges };
  useEffect(() => { tRef.current = t; }, [t]);

  const adj = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const n of nodes) m.set(n.id, new Set());
    for (const e of edges) { m.get(e.src)?.add(e.dst); m.get(e.dst)?.add(e.src); }
    return m;
  }, [nodes, edges]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { reference: 0, supersedes: 0, defines_term: 0, similar: 0 };
    for (const e of edges) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [edges]);

  // --- force simulation: velocity-Verlet with cooling; positions written to the
  // DOM imperatively so React re-renders (hover, expand) never fight the layout.
  const tick = useCallback(() => {
    const pos = posRef.current;
    const { nodes: ns, edges: es } = graphRef.current;
    const ids = ns.map((n) => n.id);
    let alpha = alphaRef.current;
    const VDECAY = 0.6, REP = 2600, SPRING = 0.06, LEN = 95, CENTER = 0.004;

    for (let i = 0; i < ids.length; i++) {
      const a = pos.get(ids[i]); if (!a) continue;
      for (let j = i + 1; j < ids.length; j++) {
        const b = pos.get(ids[j]); if (!b) continue;
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (ids[i] % 7) - 3 || 1; dy = (ids[j] % 7) - 3 || 1; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2), f = (REP * alpha) / d2;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    for (const e of es) {
      const s = pos.get(e.src), u = pos.get(e.dst); if (!s || !u) continue;
      const dx = u.x - s.x, dy = u.y - s.y, d = Math.hypot(dx, dy) || 0.01;
      const f = SPRING * alpha * (d - LEN), ux = dx / d, uy = dy / d;
      s.vx += ux * f; s.vy += uy * f; u.vx -= ux * f; u.vy -= uy * f;
    }
    for (const id of ids) {
      const p = pos.get(id); if (!p) continue;
      p.vx += -p.x * CENTER * alpha; p.vy += -p.y * CENTER * alpha;
      p.vx *= VDECAY; p.vy *= VDECAY;
      if (p.fx == null) { p.x += p.vx; p.y += p.vy; } else { p.x = p.fx; p.y = p.fy!; p.vx = 0; p.vy = 0; }
    }
    const sp = pos.get(seed); if (sp) { sp.x = 0; sp.y = 0; sp.vx = 0; sp.vy = 0; }

    for (const id of ids) {
      const el = gRefs.current.get(id), p = pos.get(id);
      if (el && p) el.setAttribute("transform", nodeTf(p));
    }
    for (const e of es) {
      const el = eRefs.current.get(e.key); if (!el) continue;
      const s = pos.get(e.src), u = pos.get(e.dst); if (!s || !u) continue;
      el.setAttribute("d", edgeD(s, u));
    }

    alpha *= 0.985; alphaRef.current = alpha;
    rafRef.current = alpha > 0.02 ? requestAnimationFrame(tick) : null;
  }, [seed]);

  const startSim = useCallback((a = 0.9) => {
    alphaRef.current = Math.max(alphaRef.current, a);
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  // Reheat whenever the node/edge set changes (mount + every expansion).
  useEffect(() => { startSim(0.9); }, [nodes, edges, startSim]);
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  // Non-passive wheel zoom around the cursor.
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = el.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setT((prev) => {
        const k = Math.min(4, Math.max(0.35, prev.k * f));
        return { k, tx: p.x - (p.x - prev.tx) * (k / prev.k), ty: p.y - (p.y - prev.ty) * (k / prev.k) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const el = svgRef.current!;
    const pt = el.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const v = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: (v.x - tRef.current.tx) / tRef.current.k, y: (v.y - tRef.current.ty) / tRef.current.k };
  };

  async function expand(id: number) {
    if (busy.has(id)) return;
    setBusy((b) => new Set(b).add(id));
    try {
      const res = await fetch(`/api/clause/${id}/graph`);
      const data: { neighbours: (Meta & { edge_type: string })[] } = await res.json();
      expandedRef.current.add(id);
      const cur = graphRef.current;
      const nodeIds = new Set(cur.nodes.map((n) => n.id));
      const ekeys = new Set(cur.edges.map((e) => e.key));
      const center = posRef.current.get(id) ?? { x: 0, y: 0 };
      const addN: SimNode[] = []; const addE: SimEdge[] = [];
      let overflow = false;
      data.neighbours.forEach((nb, i) => {
        if (!nodeIds.has(nb.id)) {
          if (cur.nodes.length + addN.length >= MAX_NODES) { overflow = true; return; }
          nodeIds.add(nb.id);
          addN.push({ id: nb.id, clause_path: nb.clause_path, standard_id: nb.standard_id,
            standard_title: nb.standard_title, obligation_type: nb.obligation_type, text: nb.text, expanded: false });
          const ang = (i / Math.max(data.neighbours.length, 1)) * Math.PI * 2;
          posRef.current.set(nb.id, { x: center.x + Math.cos(ang) * 55, y: center.y + Math.sin(ang) * 55, vx: 0, vy: 0, fx: null, fy: null });
        }
        const k = edgeKey(id, nb.id, nb.edge_type);
        if (!ekeys.has(k) && nodeIds.has(nb.id)) { ekeys.add(k); addE.push({ key: k, src: id, dst: nb.id, type: nb.edge_type }); }
      });
      if (overflow) setCapped(true);
      setNodes((pn) => pn.map((n) => (n.id === id ? { ...n, expanded: true } : n)).concat(addN));
      setEdges((pe) => pe.concat(addE));
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(id); return n; });
    }
  }

  function handleNodeClick(id: number) {
    setSelected(id);
    if (!expandedRef.current.has(id)) expand(id);
  }

  // pointer plumbing: node drag vs background pan vs click
  const onNodeDown = (id: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    nodeDragRef.current = { id, sx: e.clientX, sy: e.clientY, moved: false };
    const p = posRef.current.get(id); if (p) { p.fx = p.x; p.fy = p.y; }
  };
  const onSvgDown = (e: React.PointerEvent) => {
    panRef.current = { x: e.clientX, y: e.clientY, tx: tRef.current.tx, ty: tRef.current.ty, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onSvgMove = (e: React.PointerEvent) => {
    if (nodeDragRef.current) {
      const nd = nodeDragRef.current, w = toWorld(e.clientX, e.clientY), p = posRef.current.get(nd.id);
      if (p) { p.fx = w.x; p.fy = w.y; p.x = w.x; p.y = w.y; }
      if (Math.abs(e.clientX - nd.sx) + Math.abs(e.clientY - nd.sy) > 3) nd.moved = true;
      startSim(0.3);
      return;
    }
    if (panRef.current) {
      const ctm = svgRef.current!.getScreenCTM()!;
      const dx = (e.clientX - panRef.current.x) / ctm.a, dy = (e.clientY - panRef.current.y) / ctm.d;
      const nt = { k: tRef.current.k, tx: panRef.current.tx + dx, ty: panRef.current.ty + dy };
      tRef.current = nt; setT(nt); panRef.current.moved = true;
    }
  };
  const onSvgUp = () => {
    if (nodeDragRef.current) {
      const nd = nodeDragRef.current; const p = posRef.current.get(nd.id);
      if (p) { p.fx = null; p.fy = null; }
      nodeDragRef.current = null;
      if (!nd.moved) handleNodeClick(nd.id);
      return;
    }
    panRef.current = null;
  };

  function reset() {
    const fresh = buildInitial(seed, initial);
    posRef.current = fresh.pos; expandedRef.current = fresh.expandedIds;
    gRefs.current.clear(); eRefs.current.clear();
    setNodes(fresh.nodes); setEdges(fresh.edges);
    setSelected(seed); setHover(null); setCapped(false);
    tRef.current = { k: 1, tx: 0, ty: 0 }; setT({ k: 1, tx: 0, ty: 0 });
  }

  const keep = hover == null ? null : new Set<number>([hover, ...(adj.get(hover) ?? [])]);
  const focusId = selected ?? hover ?? seed;
  const focus = nodes.find((n) => n.id === focusId);
  const focusEdge = focus ? edges.find((e) => e.dst === focus.id || e.src === focus.id) : undefined;

  return (
    <div className="cg-stage">
      <div className="cg-toolbar">
        <span className="cg-count">{nodes.length} clauses &middot; {edges.length} links</span>
        <button className="cg-btn" onClick={reset}>Reset</button>
      </div>

      <svg
        ref={svgRef}
        className="cg-svg"
        viewBox="-500 -420 1000 840"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Interactive graph of linked clauses"
        onPointerDown={onSvgDown}
        onPointerMove={onSvgMove}
        onPointerUp={onSvgUp}
        onPointerLeave={() => { onSvgUp(); setHover(null); }}
      >
        <g transform={`translate(${t.tx} ${t.ty}) scale(${t.k})`}>
          <g>
            {edges.map((e) => (
              <path
                key={e.key}
                ref={(el) => {
                  if (el) {
                    eRefs.current.set(e.key, el);
                    const s = posRef.current.get(e.src), u = posRef.current.get(e.dst);
                    if (s && u) el.setAttribute("d", edgeD(s, u));
                  } else eRefs.current.delete(e.key);
                }}
                className={`cg-edge cg-e-${e.type}${keep && e.src !== hover && e.dst !== hover ? " faded" : ""}${hidden.has(e.type) ? " hidden" : ""}`}
                strokeWidth={e.type === "similar" ? 1.1 : 1.8}
                style={{ opacity: e.type === "similar" ? 0.4 : 0.72 }}
              />
            ))}
          </g>
          <g>
            {nodes.map((n) => {
              const isSeed = n.id === seed;
              const r = isSeed ? 14 : 8;
              const faded = keep ? !keep.has(n.id) : false;
              const cls = [
                "cg-node",
                isSeed ? "cg-seed" : n.expanded ? "cg-open" : "cg-shut",
                faded ? "faded" : "",
                keep?.has(n.id) ? "show" : "",
                n.id === selected ? "sel" : "",
                busy.has(n.id) ? "busy" : "",
              ].join(" ");
              return (
                <g
                  key={n.id}
                  ref={(el) => {
                    if (el) {
                      gRefs.current.set(n.id, el);
                      const p = posRef.current.get(n.id);
                      if (p) el.setAttribute("transform", nodeTf(p));
                    } else gRefs.current.delete(n.id);
                  }}
                  className={cls}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.clause_path}${n.expanded ? "" : " — expand"}`}
                  onPointerDown={onNodeDown(n.id)}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(n.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleNodeClick(n.id); } }}
                >
                  <circle r={r} />
                  {!isSeed && !n.expanded && <text className="cg-plus" y={3.2} textAnchor="middle">+</text>}
                  <text className="cg-lbl-t" x={isSeed ? 0 : r + 5} y={isSeed ? r + 16 : 3.5} textAnchor={isSeed ? "middle" : "start"}>
                    {n.clause_path.replace(/^DEF-/, "◆ ")}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

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

      {focus && (
        <aside className="cg-panel">
          <div className="cg-p-path">{focus.clause_path.startsWith("DEF-") ? focus.clause_path.slice(4) : focus.clause_path}</div>
          <div className="cg-p-badges">
            <span className="cg-badge">{focus.standard_title}</span>
            <span className={`cg-badge ob-${focus.obligation_type}`}>{focus.obligation_type}</span>
          </div>
          <div className="cg-p-via">
            {focus.id === seed ? (
              <><span className="cg-vdot cg-dot-seed" /> the <b>seed</b> clause you are viewing</>
            ) : focusEdge ? (
              <><span className={`cg-vdot cg-dot-${focusEdge.type}`} /> linked by <b>{TYPE_LABEL[focusEdge.type]}</b></>
            ) : null}
          </div>
          <p className="cg-p-text">{focus.text}</p>
          <div className="cg-p-actions">
            {focus.id !== seed && !expandedRef.current.has(focus.id) && (
              <button className="cg-btn" onClick={() => expand(focus.id)} disabled={busy.has(focus.id)}>
                {busy.has(focus.id) ? "Loading…" : "Expand neighbours"}
              </button>
            )}
            <Link className="cg-open-link" href={`/clause/${focus.id}`}>Open full clause &rarr;</Link>
          </div>
        </aside>
      )}

      {capped && <div className="cg-cap">Showing the first {MAX_NODES} clauses — reset to explore elsewhere.</div>}
      <div className="cg-hint">click a node to pull in its neighbours &middot; drag nodes &middot; scroll to zoom</div>
    </div>
  );
}
