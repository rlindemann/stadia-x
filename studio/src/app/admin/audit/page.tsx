import Link from "next/link";
import { auditStats, listAudit } from "@/lib/db";

export const metadata = { title: "Audit log — STADIA-X" };
export const dynamic = "force-dynamic";

const fmt = (ts: string) => new Date(ts).toISOString().replace("T", " ").slice(0, 19);

export default async function AuditPage() {
  const [stats, rows] = await Promise.all([auditStats(24), listAudit(150)]);
  const totals = stats.reduce(
    (a, s) => ({ n: a.n + s.n, errors: a.errors + s.errors }),
    { n: 0, errors: 0 },
  );

  return (
    <div className="stage">
      <div className="cd-crumbs">
        <Link href="/admin">Admin</Link>
        <span className="sep">/</span>
        <span>Audit log</span>
      </div>

      <div className="page-head">
        <h1 className="page-title">Audit log &amp; activity</h1>
        <p className="page-sub">
          Every search, question, and admin action is recorded with its anonymous session,
          latency, and outcome — the accountability and observability layer. Last 24h:{" "}
          {totals.n} events, {totals.errors} errors.
        </p>
      </div>

      <div className="au-stats">
        {stats.length === 0 ? (
          <div className="empty">No activity in the last 24 hours yet.</div>
        ) : (
          stats.map((s) => (
            <div className="au-stat" key={s.action}>
              <div className="au-stat-action">{s.action}</div>
              <div className="au-stat-n">{s.n}</div>
              <dl className="au-stat-meta">
                <div><dt>sessions</dt><dd>{s.sessions}</dd></div>
                <div><dt>errors</dt><dd className={s.errors ? "au-err" : ""}>{s.errors}</dd></div>
                <div><dt>p50</dt><dd>{s.p50_ms != null ? `${s.p50_ms}ms` : "—"}</dd></div>
                <div><dt>p95</dt><dd>{s.p95_ms != null ? `${s.p95_ms}ms` : "—"}</dd></div>
              </dl>
            </div>
          ))
        )}
      </div>

      <div className="table-wrap">
        <table className="table au-table">
          <thead>
            <tr>
              <th>Time (UTC)</th><th>Session</th><th>Action</th><th>Target</th>
              <th>Status</th><th className="c-num">Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="c-muted">No events recorded yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="c-code">{fmt(r.ts)}</td>
                  <td className="c-code">{r.session_id ? r.session_id.slice(0, 8) : "—"}</td>
                  <td><span className={`au-tag au-${r.action}`}>{r.action}</span></td>
                  <td className="au-target">{r.target ?? "—"}</td>
                  <td>
                    <span className={`au-status ${r.status === "error" ? "au-err" : r.status === "insufficient" ? "au-warn" : ""}`}>
                      {r.status ?? "—"}
                    </span>
                  </td>
                  <td className="c-num">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
