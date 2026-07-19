import { getApplicabilitySummary } from "@/lib/db";
import { CategoryExplorer } from "./CategoryExplorer";

export const metadata = { title: "Category requirements — STADIA-X" };
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const summary = await getApplicabilitySummary();

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Requirements by stadium category</h1>
        <p className="page-sub">
          The compliance matrices (required vs best-practice per Stadium Category), extracted from the
          source tables into queryable requirements. Pick a standard and a category to see exactly what a
          stadium of that class must comply with — the mandatory items, the best-practice ones, and the
          per-category values — each linking to its clause.
        </p>
      </div>

      {summary.length === 0 ? (
        <div className="empty">
          No category applicability extracted yet. Run <code>uv run python -m ingest.applies_to</code>.
        </div>
      ) : (
        <CategoryExplorer summary={summary} />
      )}
    </div>
  );
}
