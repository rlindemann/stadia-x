import Link from "next/link";

export const metadata = { title: "Analyze — STADIA-X" };

const TOOLS = [
  {
    href: "/compare",
    title: "Edition comparison",
    desc: "See what changed between two editions of the same standard — added, removed, and reworded clauses, matched by clause number with an inline text diff.",
  },
  {
    href: "/cross",
    title: "Cross-standard comparison",
    desc: "Compare how different standards treat the same topic, with each standard's position and the concrete differences called out — every claim cited to a clause.",
  },
  {
    href: "/gaps",
    title: "Coverage / gap analysis",
    desc: "Check a list of project topics against the corpus and flag the ones with no strongly-governing clause, so you know where the standards are silent.",
  },
];

export default function AnalyzePage() {
  return (
    <div className="stage">
      <div className="page-head">
        <h1 className="page-title">Analyze</h1>
        <p className="page-sub">
          Tools that reason across the corpus — comparing editions, comparing standards, and finding
          where coverage is missing.
        </p>
      </div>

      <div className="analyze-grid">
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className="analyze-card">
            <div className="analyze-card-title">{t.title}</div>
            <p className="analyze-card-desc">{t.desc}</p>
            <span className="analyze-card-go">Open →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
