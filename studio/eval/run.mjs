// Approved-Q-A eval harness (+ eval at scale).
//
// Scores the LIVE Search and Ask endpoints against:
//   - eval/pairs.json            human-approved, high-trust (matched by clause_path)
//   - eval/pairs-generated.json  LLM-generated at scale (matched by exact clause_id)
// The approved set is the trust/regression gate; the generated set is the larger
// "exam" that makes a ranking change measurable. Only APPROVED misses are hard
// failures (generated pairs are synthetic signal, not a gate).
//
//   node eval/run.mjs                      # retrieval only (fast, free)
//   node eval/run.mjs --ask                # also score Ask answers (approved pairs)
//   node eval/run.mjs --base https://stadia-x.vercel.app
//
// Exit code is non-zero on a hard failure so it can gate CI.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const BASE = flag("--base", "http://localhost:3000").replace(/\/$/, "");
const DO_ASK = args.includes("--ask");
const K = 10;

const dir = dirname(fileURLToPath(import.meta.url));
const load = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : []);
const pairs = [
  ...load("pairs.json").map((p) => ({ ...p, set: "approved" })),
  ...load("pairs-generated.json").map((p) => ({ ...p, set: "generated" })),
];

const lc = (s) => (s ?? "").toLowerCase();
const citedIds = (a) => [...a.matchAll(/\[\[(\d+)\]\]/g)].map((m) => m[1]);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const hit = (r, p) => (p.clause_id != null ? String(r.id) === String(p.clause_id) : (p.clauses ?? []).includes(r.clause_path));
// lenient "topic hit": same clause_path (any edition) or a parent-section / sub-clause of it
const clean = (s) => (s ?? "").replace(/\.$/, "");
const topicHit = (r, p) => {
  const rp = clean(r.clause_path), wp = clean(p.clause_path);
  return !!rp && !!wp && (rp === wp || rp.startsWith(wp + ".") || wp.startsWith(rp + "."));
};

async function search(q) {
  const r = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&limit=20`);
  if (!r.ok) throw new Error(`search ${r.status}`);
  return (await r.json()).results ?? [];
}
async function ask(q) {
  const r = await fetch(`${BASE}/api/ask`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }),
  });
  if (!r.ok) throw new Error(`ask ${r.status}`);
  return r.json();
}

const S = {
  approved: { n: 0, found: 0, h1: 0, h5: 0, mrr: 0 },
  generated: { n: 0, found: 0, h1: 0, h5: 0, mrr: 0, lfound: 0, lh1: 0, lh5: 0, lmrr: 0 },
};
let aTotal = 0, aPass = 0, hardFail = 0;

for (const p of pairs) {
  if (!p.abstain) {
    const s = S[p.set];
    s.n++;
    const res = await search(p.q);
    let rank = 0, lrank = 0;
    for (let i = 0; i < Math.min(res.length, K); i++) {
      if (!rank && hit(res[i], p)) rank = i + 1;
      if (!lrank && (p.set === "generated" ? topicHit(res[i], p) : hit(res[i], p))) lrank = i + 1;
    }
    if (rank) { s.found++; s.mrr += 1 / rank; if (rank === 1) s.h1++; if (rank <= 5) s.h5++; }
    else if (p.set === "approved") hardFail++;
    if (p.set === "generated" && lrank) { s.lfound++; s.lmrr += 1 / lrank; if (lrank === 1) s.lh1++; if (lrank <= 5) s.lh5++; }
  }
  if (DO_ASK && (p.facts || p.abstain)) {
    aTotal++;
    const a = await ask(p.q);
    if (p.abstain) { const ok = a.sufficient === false; if (ok) aPass++; else hardFail++; }
    else {
      const byId = new Map((a.clauses ?? []).map((c) => [String(c.id), c.clause_path]));
      const cited = citedIds(a.answer ?? "").map((id) => byId.get(id)).filter(Boolean);
      const citeOk = cited.some((path) => (p.clauses ?? []).includes(path));
      const factsOk = (p.facts ?? []).every((f) => lc(a.answer).includes(lc(f)));
      if (a.sufficient && citeOk && factsOk) aPass++;
    }
  }
  process.stdout.write(".");
}

const report = (name, s) => {
  if (!s.n) return;
  const pc = (x) => `${Math.round((100 * x) / s.n)}%`;
  console.log(`\n${name} (${s.n} pairs)`);
  console.log(`  found@${K}  ${pad(s.found + "/" + s.n, 8)} ${pc(s.found)}`);
  console.log(`  hit@1     ${pad(s.h1 + "/" + s.n, 8)} ${pc(s.h1)}`);
  console.log(`  hit@5     ${pad(s.h5 + "/" + s.n, 8)} ${pc(s.h5)}`);
  console.log(`  MRR       ${(s.mrr / s.n).toFixed(3)}`);
  if (s.lfound !== undefined)
    console.log(`  topic     found@${K} ${pc(s.lfound)}  hit@1 ${pc(s.lh1)}  hit@5 ${pc(s.lh5)}  MRR ${(s.lmrr / s.n).toFixed(3)}   <- exact-clause too strict; this counts section/sub-clause/edition matches`);
};

console.log("\n");
report("Approved retrieval (gate)", S.approved);
report("Generated retrieval (at scale)", S.generated);
if (DO_ASK) console.log(`\nAsk answers: ${aPass}/${aTotal} passed (${aTotal ? Math.round((100 * aPass) / aTotal) : 0}%)`);
console.log(`\n${hardFail === 0 ? "PASS" : "FAIL"} — ${hardFail} hard failure(s) (approved only).`);
process.exit(hardFail === 0 ? 0 : 1);
