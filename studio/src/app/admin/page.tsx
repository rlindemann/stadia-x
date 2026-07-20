"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

type Row = {
  id: string;
  title: string;
  publisher: string | null;
  status: string | null;
  review_status: string;
  clause_count: number;
  source_url: string | null;
};

export default function AdminPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ingest, setIngest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const d = await fetch("/api/admin/standards").then((r) => r.json());
    setRows(d.standards ?? []);
    setIngest(!!d.ingestEnabled);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/upload", { method: "POST", body: new FormData(e.currentTarget) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMsg(d.message ?? (d.ok ? "Done." : "Extraction reported an error — check the log.") + (d.log ? `\n\n${d.log.slice(-1500)}` : ""));
      (e.target as HTMLFormElement).reset();
      refresh();
    } catch (err) {
      setMsg(`Error: ${String((err as Error).message ?? err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "publish" | "unpublish" | "delete") {
    if (action === "delete" && !confirm(`Delete "${id}" and all its clauses?`)) return;
    await fetch("/api/admin/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    refresh();
  }

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Admin — standards</h1>
        <p className="page-sub">
          Upload a PDF to add a standard. It is registered as pending review and stays out of public
          search until you publish it. {ingest ? "Extraction runs on this server." : "Automatic extraction is off on this server (set LOCAL_INGEST=1 on a host with the Python pipeline)."}
        </p>
        <div className="src"><a href="/admin/audit">Audit log &amp; activity &rarr;</a></div>
      </div>

      <form className="adm-form" onSubmit={onUpload}>
        <div className="adm-grid">
          <label>Standard ID<input name="id" required placeholder="AFC-STADIUM-REGULATIONS-2030" /></label>
          <label>Title<input name="title" required placeholder="AFC Stadium Regulations (Edition 2030)" /></label>
          <label>Publisher<input name="publisher" placeholder="AFC" /></label>
          <label>Supersedes (optional)<input name="supersedes" placeholder="AFC-STADIUM-REGULATIONS-2026" /></label>
        </div>
        <div className="adm-row2">
          <label className="adm-file">PDF<input type="file" name="file" accept="application/pdf" required /></label>
          <label className="facet-toggle"><input type="checkbox" name="ocr" /> <span>OCR scanned pages</span></label>
          <button type="submit" className="search-btn" disabled={busy}>{busy ? "Working…" : "Upload"}</button>
        </div>
      </form>

      {msg && <pre className="adm-msg">{msg}</pre>}

      <div className="table-wrap" style={{ marginTop: 28 }}>
        <table className="table">
          <thead>
            <tr><th>Standard</th><th>Publisher</th><th>Review</th><th className="c-num">Clauses</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows?.map((s) => (
              <tr key={s.id}>
                <td className="c-title">
                  {s.title}
                  {s.status === "Superseded" && <span className="tag-super">Superseded</span>}
                </td>
                <td className="c-muted">{s.publisher ?? "—"}</td>
                <td>
                  <span className={`status ${s.review_status === "pending" ? "superseded" : ""}`}>
                    <span className="sw" />{s.review_status}
                  </span>
                </td>
                <td className="c-num">{s.clause_count}</td>
                <td>
                  <div className="adm-actions">
                    <Link href={`/review?doc=${encodeURIComponent(s.id)}`}>Review</Link>
                    {s.review_status === "pending" ? (
                      <button type="button" onClick={() => act(s.id, "publish")} disabled={!s.clause_count}>Publish</button>
                    ) : (
                      <button type="button" onClick={() => act(s.id, "unpublish")}>Unpublish</button>
                    )}
                    <button type="button" className="adm-del" onClick={() => act(s.id, "delete")}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={5} className="c-muted">No standards yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
