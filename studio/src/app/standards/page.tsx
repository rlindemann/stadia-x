import { listStandards } from "@/lib/db";

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
        </p>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Title</th>
              <th>Publisher</th>
              <th>Version</th>
              <th>Status</th>
              <th className="c-num">Clauses</th>
            </tr>
          </thead>
          <tbody>
            {standards.length === 0 ? (
              <tr>
                <td colSpan={6} className="c-muted">
                  No standards loaded yet.
                </td>
              </tr>
            ) : (
              standards.map((s) => (
                <tr key={s.id}>
                  <td className="c-code">{s.id}</td>
                  <td className="c-title">{s.title}</td>
                  <td className="c-muted">{s.publisher ?? "—"}</td>
                  <td className="c-muted">{s.version ?? "—"}</td>
                  <td>
                    {s.status ? (
                      <span className={`status ${s.status === "Superseded" ? "superseded" : ""}`}>
                        <span className="sw" />
                        {s.status}
                      </span>
                    ) : (
                      <span className="c-muted">—</span>
                    )}
                  </td>
                  <td className="c-num">{s.clause_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
