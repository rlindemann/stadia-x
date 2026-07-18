import { listAllClauses } from "@/lib/db";
import { AllClauseList } from "./AllClauseList";

export const metadata = { title: "Clauses — STADIA-X" };
export const dynamic = "force-dynamic";

export default async function ClausesPage() {
  const clauses = await listAllClauses();

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">All clauses</h1>
        <p className="page-sub">
          Every clause across all documents, in reading order. Filter by clause number, standard, or
          text, then click to open it — full text, references, and the relationship graph.
          {" "}{clauses.length} clauses.
        </p>
      </div>

      <AllClauseList clauses={clauses} />
    </div>
  );
}
