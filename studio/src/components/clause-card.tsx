import type { CSSProperties } from "react";
import type { Clause } from "@/lib/data";

export function ClauseCard({ clause, showScore = true }: { clause: Clause; showScore?: boolean }) {
  const c = clause;
  return (
    <article className="row">
      <div className="row-top">
        <div className="prov">
          <span className="pub">{c.pub}</span>
          <span className="sep">/</span>
          <span>{c.std}</span>
          {c.status === "Superseded" && (
            <>
              <span className="sep">/</span>
              <span className="sup">superseded</span>
            </>
          )}
        </div>
        {showScore && (
          <div className="rel">
            <span className="track">
              <i style={{ "--w": `${c.score}%` } as CSSProperties} />
            </span>
            <span className="num">{c.score.toFixed(1)}</span>
          </div>
        )}
      </div>

      <div className="clause">
        <span className="path">{c.path}</span>
        <span className="ct">{c.title}</span>
        <span className={`ob ${c.ob}`}>
          <span className="sw" />
          {c.ob}
        </span>
      </div>

      <p className="quote" dangerouslySetInnerHTML={{ __html: c.quote }} />

      <div className="src">
        <a href="#">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 3h7v7" />
            <path d="M10 14 21 3" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
          {c.page}
        </a>
        <span>{c.src}</span>
      </div>
    </article>
  );
}
