import { listTerms } from "@/lib/db";

export const metadata = { title: "Defined terms — STADIA-X" };
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const terms = await listTerms();

  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Defined terms</h1>
        <p className="page-sub">
          The controlled vocabulary of the corpus — each term as defined by its source standard, with a
          link back to the defining clause. {terms.length} term{terms.length === 1 ? "" : "s"} extracted.
        </p>
      </div>

      <div className="terms">
        {terms.length === 0 ? (
          <div className="empty">No defined terms loaded yet.</div>
        ) : (
          terms.map((t) => {
            // The clause verbatim starts with the term itself — trim that echo.
            const def = t.definition.startsWith(t.term)
              ? t.definition.slice(t.term.length).trim()
              : t.definition;
            return (
              <div className="term" key={`${t.standard_id}-${t.term}`}>
                <div className="t">{t.term}</div>
                <div>
                  <p className="d">{def}</p>
                  <div className="meta">
                    {t.standard_title} &nbsp;·&nbsp; {t.clause_path}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
