import { listStandards } from "@/lib/db";
import { StandardsTable } from "./StandardsTable";

export const metadata = { title: "Standards — STADIA-X" };
export const dynamic = "force-dynamic";

export default async function StandardsPage() {
  const standards = await listStandards();
  const total = standards.reduce((n, s) => n + s.clause_count, 0);

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Standards library</h1>
        <p className="page-sub">
          Every standard and policy document ingested into Stadia-X, with its publisher and clause
          count. {standards.length} document{standards.length === 1 ? "" : "s"}, {total} clauses indexed.
          Hover a row to preview its title page.
        </p>
      </div>

      <StandardsTable standards={standards} />
    </div>
  );
}
