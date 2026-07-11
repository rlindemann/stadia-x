import { STANDARDS } from "@/lib/data";

export const metadata = { title: "Standards — STADIA-X" };

export default function StandardsPage() {
  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Standards library</h1>
        <p className="page-sub">
          Every standard and policy document indexed in STADIA-X, with its publisher, version, and
          clause count. Preview data — the full corpus of 108 documents loads once ingestion is wired in.
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
            {STANDARDS.map((s) => (
              <tr key={s.id}>
                <td className="c-code">{s.code}</td>
                <td className="c-title">{s.title}</td>
                <td className="c-muted">{s.publisher}</td>
                <td className="c-muted">{s.version}</td>
                <td>
                  <span className={`status ${s.status === "Superseded" ? "superseded" : ""}`}>
                    <span className="sw" />
                    {s.status}
                  </span>
                </td>
                <td className="c-num">{s.clauses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
