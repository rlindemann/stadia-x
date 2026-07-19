// Approved-Q-A eval harness.
//
// Scores the LIVE Search and Ask endpoints against a curated, human-approved set
// of question -> expected-clause(-and-facts) pairs (eval/pairs.json). This is the
// trust/regression layer: run it after any ranking/prompt change to get a number,
// not a vibe. It is NOT the anticipated-questions index (that boosts retrieval);
// these pairs measure whether the system returns the RIGHT clause and answer.
//
//   node eval/run.mjs                      # retrieval only (fast, free)
//   node eval/run.mjs --ask                # also score Ask answers (uses the LLM)
//   node eval/run.mjs --base https://stadia-x.vercel.app --ask
//
// Exit code is non-zero on a hard failure (an expected clause missing from the
// top-K, or Ask inventing an answer it should have refused) so it can gate CI.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const BASE = flag("--base", "http://localhost:3000").replace(/\/$/, "");
const DO_ASK = args.includes("--ask");
const K = 10; // an expected clause must appear within the top-K search results

const dir = dirname(fileURLToPath(import.meta.url));
const pairs = JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8"));

const lc = (s) => (s ?? "").toLowerCase();
// Ids are compared as strings: Neon returns bigint columns as strings, and the
// [[id]] markers are text — normalise both sides to avoid a silent type mismatch.
const citedIds = (answer) => [...answer.matchAll(/\[\[(\d+)\]\]/g)].map((m) => m[1]);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

async function search(q) {
  const r = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&limit=20`);
  if (!r.ok) throw new Error(`search ${r.status}`);
  return (await r.json()).results ?? [];
}
async function ask(q) {
  const r = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: q }),
  });
  if (!r.ok) throw new Error(`ask ${r.status}`);
  return r.json();
}

let sTotal = 0, sHit1 = 0, sHit5 = 0, sFound = 0, mrr = 0;
let aTotal = 0, aPass = 0;
let hardFail = 0;
const rows = [];

for (const p of pairs) {
  const row = { id: p.id, rank: "-", top: "", ask: "" };

  if (!p.abstain) {
    sTotal++;
    const res = await search(p.q);
    let rank = 0;
    for (let i = 0; i < Math.min(res.length, K); i++) {
      if (p.clauses.includes(res[i].clause_path)) { rank = i + 1; break; }
    }
    row.rank = rank || "MISS";
    row.top = res[0]?.clause_path ?? "-";
    if (rank) { sFound++; mrr += 1 / rank; if (rank === 1) sHit1++; if (rank <= 5) sHit5++; }
    else hardFail++;
  }

  if (DO_ASK) {
    aTotal++;
    const a = await ask(p.q);
    if (p.abstain) {
      const ok = a.sufficient === false;
      row.ask = ok ? "abstained OK" : "HALLUCINATED";
      if (ok) aPass++; else hardFail++;
    } else {
      const byId = new Map((a.clauses ?? []).map((c) => [String(c.id), c.clause_path]));
      const cited = citedIds(a.answer ?? "").map((id) => byId.get(id)).filter(Boolean);
      const citeOk = cited.some((path) => p.clauses.includes(path));
      const factsOk = (p.facts ?? []).every((f) => lc(a.answer).includes(lc(f)));
      const ok = a.sufficient && citeOk && factsOk;
      row.ask = ok ? "PASS" : `FAIL(cite:${citeOk ? "y" : "n"} facts:${factsOk ? "y" : "n"} suff:${a.sufficient ? "y" : "n"})`;
      if (ok) aPass++;
    }
  }
  rows.push(row);
  process.stdout.write(".");
}

console.log("\n");
console.log(pad("pair", 26) + pad("rank", 7) + pad("top", 8) + (DO_ASK ? "ask" : ""));
console.log("-".repeat(DO_ASK ? 70 : 41));
for (const r of rows) console.log(pad(r.id, 26) + pad(r.rank, 7) + pad(r.top, 8) + (DO_ASK ? r.ask : ""));

console.log("\nRetrieval:");
console.log(`  pairs        ${sTotal}`);
console.log(`  found@${K}     ${sFound}/${sTotal}  (${sTotal ? Math.round((100 * sFound) / sTotal) : 0}%)`);
console.log(`  hit@1        ${sHit1}/${sTotal}  (${sTotal ? Math.round((100 * sHit1) / sTotal) : 0}%)`);
console.log(`  hit@5        ${sHit5}/${sTotal}  (${sTotal ? Math.round((100 * sHit5) / sTotal) : 0}%)`);
console.log(`  MRR          ${sTotal ? (mrr / sTotal).toFixed(3) : "0"}`);
if (DO_ASK) {
  console.log("\nAnswers (Ask):");
  console.log(`  passed       ${aPass}/${aTotal}  (${aTotal ? Math.round((100 * aPass) / aTotal) : 0}%)`);
}
console.log(`\n${hardFail === 0 ? "PASS" : "FAIL"} — ${hardFail} hard failure(s).`);
process.exit(hardFail === 0 ? 0 : 1);
