import { CLAUSES, SAVED_IDS } from "@/lib/data";
import { ClauseCard } from "@/components/clause-card";

export const metadata = { title: "Saved — STADIA-X" };

export default function SavedPage() {
  const saved = CLAUSES.filter((c) => SAVED_IDS.includes(c.id));

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Saved clauses</h1>
        <p className="page-sub">
          Clauses you have pinned for a project. Save a result from any search to build a working set
          you can return to.
        </p>
      </div>

      <div className="list">
        {saved.length === 0 ? (
          <div className="empty">No saved clauses yet — pin one from a search to see it here.</div>
        ) : (
          saved.map((c) => <ClauseCard key={c.id} clause={c} showScore={false} />)
        )}
      </div>
    </div>
  );
}
