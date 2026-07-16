"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GraphViewNode } from "@/lib/db";

const TYPES = ["reference", "supersedes", "defines_term", "similar"] as const;
const TYPE_LABEL: Record<string, string> = {
  reference: "reference",
  supersedes: "supersedes",
  defines_term: "defines term",
  similar: "similar",
};

type Pt = { x: number; y: number; ang: number };
type Edge = { src: number; dst: number; type: string; d: string };

// Radial layout: seed at centre, 1-hop ring, 2-hop fanned out from each parent.
function layout(seed: number, nodes: GraphViewNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<number, GraphViewNode[]>();
  for (const n of nodes) {
    if (n.parent == null) continue;
    (children.get(n.parent) ?? children.set(n.parent, []).get(n.parent)!).push(n);
  }
  const pos = new Map<number, Pt>();
  pos.set(seed, { x: 0, y: 0, ang: 0 });

  const R1 = 215, R2 = 420;
  const ring1 = nodes.filter((n) => n.depth === 1);
  const wt = new Map<number, number>();
  let total = 0;
  for (const n of ring1) {
    const w = (children.get(n.id)?.length ?? 0) + 1.6;
    wt.set(n.id, w);
    total += w;
  }
  const gap = 0.05;
  const usable = Math.PI * 2 - gap * Math.max(ring1.length, 1);
  let a = -Math.PI / 2;
  for (const n of ring1) {
    const slice = usable * (wt.get(n.id)! / total);
    const center = a + slice / 2;
    pos.set(n.id, { x: R1 * Math.cos(center), y: R1 * Math.sin(center), ang: center });
    const kids = children.get(n.id) ?? [];
    const span = kids.length > 1 ? slice * 0.94 : 0;
    kids.forEach((kid, i) => {
      const t = kids.length === 1 ? center : center - span / 2 + span * (i / (kids.length - 1));
      const rr = R2 + (i % 2 ? 40 : 0);
      pos.set(kid.id, { x: rr * Math.cos(t), y: rr * Math.sin(t), ang: t });
    });
    a += slice + gap;
  }

  const edges: Edge[] = [];
  for (const n of nodes) {
    if (n.parent == null || !pos.has(n.parent) || !pos.has(n.id)) continue;
    const s = pos.get(n.parent)!, d = pos.get(n.id)!;
    const mx = (s.x + d.x) / 2, my = (s.y + d.y) / 2;
    const dx = d.x - s.x, dy = d.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(len * 0.12, 46);
    const cx = mx - (dy / len) * bow, cy = my + (dx / len) * bow;
    edges.push({ src: n.parent, dst: n.id, type: n.via ?? "similar", d: `M${s.x} ${s.y} Q${cx} ${cy} ${d.x} ${d.y}` });
  }
  return { pos, edges, byId };
}

export function ClauseGraph({ seed, nodes }: { seed: number; nodes: GraphViewNode[] }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  const { pos, edges, byId } = useMemo(() => layout(seed, nodes), [seed, nodes]);
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

  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [t, setT] = useState({ k: 1, tx: 0, ty: 0 });

  // Non-passive wheel zoom (React's onWheel is passive, so preventDefault is ignored).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const toVB = (e: WheelEvent) => {
      const p = el.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      return p.matrixTransform(el.getScreenCTM()!.inverse());
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toVB(e);
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setT((prev) => {
        const k = Math.min(4, Math.max(0.45, prev.k * f));
        return { k, tx: p.x - (p.x - prev.tx) * (k / prev.k), ty: p.y - (p.y - prev.ty) * (k / prev.k) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const keep = hover == null ? null : new Set<number>([hover, ...(adj.get(hover) ?? [])]);
  const focus = byId.get(hover ?? seed)!;
  const focusInc = focus ? nodes.find((n) => n.id === focus.id) : undefined;

  function onDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current || !svgRef.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    const ctm = svgRef.current.getScreenCTM()!;
    setT((prev) => ({ ...prev, tx: drag.current!.tx + dx / ctm.a, ty: drag.current!.ty + dy / ctm.d }));
  }
  function onUp() { setTimeout(() => (drag.current = null), 0); }

  function open(id: number) {
    if (drag.current?.moved) return;
    if (id !== seed) router.push(`/clause/${id}`);
  }

  return (
    <div className="cg-stage">
      <svg
        ref={svgRef}
        className="cg-svg"
        viewBox="-640 -580 1280 1160"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Graph of clauses linked to this one"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => { onUp(); setHover(null); }}
      >
        <g transform={`translate(${t.tx} ${t.ty}) scale(${t.k})`}>
          <g>
            {edges.map((e, i) => (
              <path
                key={i}
                d={e.d}
                className={`cg-edge cg-e-${e.type}${keep && e.src !== hover && e.dst !== hover ? " faded" : ""}${hidden.has(e.type) ? " hidden" : ""}`}
                strokeWidth={e.type === "similar" ? 1.1 : 1.8}
                style={{ opacity: e.type === "similar" ? 0.4 : 0.72 }}
              />
            ))}
          </g>
          <g>
            {nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const via = n.via ?? "seed";
              const r = n.depth === 0 ? 15 : n.depth === 1 ? 9 : 5.5;
              const faded = keep ? !keep.has(n.id) : false;
              const show = keep ? keep.has(n.id) : false;
              const cls = `cg-node cg-d${n.depth} cg-via-${via}${faded ? " faded" : ""}${show ? " show" : ""}`;
              const label = n.clause_path.replace(/^DEF-/, "◆ ");
              const cos = Math.cos(p.ang), out = r + 6;
              return (
                <g
                  key={n.id}
                  className={cls}
                  transform={`translate(${p.x} ${p.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.clause_path} — ${TYPE_LABEL[via] ?? "seed"}`}
                  onMouseEnter={() => setHover(n.id)}
                  onFocus={() => setHover(n.id)}
                  onClick={() => open(n.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(n.id); } }}
                >
                  <circle r={r} />
                  {n.depth === 0 ? (
                    <text className="cg-lbl-t" y={r + 20} textAnchor="middle">{label}</text>
                  ) : (
                    <text className="cg-lbl-t" x={cos >= 0 ? out : -out} y={4} textAnchor={cos >= 0 ? "start" : "end"}>{label}</text>
                  )}
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
            {focusInc?.via ? (
              <>
                <span className={`cg-vdot cg-dot-${focusInc.via}`} /> reached via <b>{TYPE_LABEL[focusInc.via]}</b>
                {focusInc.parent != null && byId.get(focusInc.parent) && (
                  <> from <span className="cg-vpath">{byId.get(focusInc.parent)!.clause_path.replace(/^DEF-/, "")}</span></>
                )}
              </>
            ) : (
              <><span className="cg-vdot cg-dot-seed" /> the <b>seed</b> clause you are viewing</>
            )}
          </div>
          <p className="cg-p-text">{focus.text}</p>
          {focus.id !== seed && <div className="cg-p-open">Click node to open clause &rarr;</div>}
        </aside>
      )}
      <div className="cg-hint">hover to trace &middot; click a node to open it &middot; scroll to zoom &middot; drag to pan</div>
    </div>
  );
}
