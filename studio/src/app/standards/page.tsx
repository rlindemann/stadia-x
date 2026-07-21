import { listAllClauses, listStandards } from "@/lib/db";
import { StandardsLibrary } from "./StandardsLibrary";

export const metadata = { title: "Documents — STADIA-X" };
export const dynamic = "force-dynamic";

export default async function StandardsPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const [{ doc }, standards, clauses] = await Promise.all([
    searchParams,
    listStandards(),
    listAllClauses(),
  ]);
  const total = standards.reduce((n, s) => n + s.clause_count, 0);

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Documents</h1>
        <p className="page-sub">
          Every document and every clause in one place. Pick a document on the left to focus its
          clauses, or browse all {total} at once. {standards.length} document
          {standards.length === 1 ? "" : "s"} indexed.
        </p>
      </div>

      <StandardsLibrary standards={standards} clauses={clauses} initialDoc={doc ?? ""} />
    </div>
  );
}
