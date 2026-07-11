import { TERMS } from "@/lib/data";

export const metadata = { title: "Defined terms — STADIA-X" };

export default function TermsPage() {
  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Defined terms</h1>
        <p className="page-sub">
          The controlled vocabulary of the corpus — each term as defined by its source standard, with
          a link back to the defining clause. This is what keeps a search for &ldquo;gangway&rdquo;
          consistent across every document.
        </p>
      </div>

      <div className="terms">
        {TERMS.map((t) => (
          <div className="term" key={t.term}>
            <div className="t">{t.term}</div>
            <div>
              <p className="d">{t.definition}</p>
              <div className="meta">
                {t.standard} &nbsp;·&nbsp; <a href="#">{t.clause}</a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
