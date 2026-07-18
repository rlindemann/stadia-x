import Link from "next/link";
import { notFound } from "next/navigation";
import { listStandards, listStandardClauses } from "@/lib/db";
import { StandardClauseList } from "./StandardClauseList";

export const dynamic = "force-dynamic";

export default async function StandardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const standardId = decodeURIComponent(id);
  const [standards, clauses] = await Promise.all([listStandards(), listStandardClauses(standardId)]);
  const std = standards.find((s) => s.id === standardId);
  if (!std) notFound();

  return (
    <div className="stage">
      <div className="cd-crumbs">
        <Link href="/standards">Standards</Link>
        <span className="sep">/</span>
        <span>{std.id}</span>
      </div>

      <div className="page-head">
        <h1 className="page-title">{std.title}</h1>
        <p className="page-sub">
          {std.publisher ? `${std.publisher} · ` : ""}
          {std.version ? `${std.version} · ` : ""}
          {clauses.length} clauses. Click any clause to open it — full text, references, and the
          relationship graph.
          {std.status === "Superseded" && std.superseded_by_title && (
            <> This edition is superseded by {std.superseded_by_title}.</>
          )}
        </p>
        <div className="src">
          <Link href={`/review?doc=${encodeURIComponent(std.id)}`}>Open in Review viewer</Link>
        </div>
      </div>

      <StandardClauseList clauses={clauses} />
    </div>
  );
}
