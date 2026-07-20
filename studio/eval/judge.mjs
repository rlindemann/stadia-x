// LLM-as-judge eval.
//
// Path-based scoring (run.mjs) can't tell a VALID alternative answer from the exact
// source clause — e.g. "27 Camera Positions" genuinely answers a camera question even
// though the pair was generated from clause 30.1, so it scores as a miss. This judges
// semantically: for each generated question, ask an LLM whether the top search results
// actually answer it. Reports the TRUE hit@1 / hit@3.
//
//   node eval/judge.mjs [--base http://localhost:3000]
//
// Uses ANTHROPIC_API_KEY (read from ../.env or studio/.env.local). Haiku, ~210 calls.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, "..", "..");
const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3000").replace(/\/$/, "");
const MODEL = "claude-haiku-4-5-20251001";
const CONC = 6;

function envKey(name) {
  for (const f of [join(root, ".env"), join(root, "studio", ".env.local")]) {
    if (!existsSync(f)) continue;
    const line = readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.startsWith(name + "="));
    if (line) return line.slice(name.length + 1).replace(/^["']|["']$/g, "").replace(/["']$/, "").trim();
  }
  return process.env[name];
}
const KEY = envKey("ANTHROPIC_API_KEY");
if (!KEY) { console.error("ANTHROPIC_API_KEY not found"); process.exit(1); }

async function judge(question, clauseText) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 5,
      messages: [{ role: "user", content:
        `Does the clause below answer the user's question (fully or partly)? Reply with only YES or NO.\n\nQuestion: ${question}\n\nClause: ${clauseText.slice(0, 700)}` }],
    }),
  });
  const d = await res.json();
  return ((d.content?.[0]?.text ?? "").trim().toUpperCase()).startsWith("Y");
}

async function search(q) {
  const r = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&limit=3`);
  return (await r.json()).results ?? [];
}

const pairs = JSON.parse(readFileSync(join(dir, "pairs-generated.json"), "utf8"));
let h1 = 0, h3 = 0, n = 0;

async function run(p) {
  const res = await search(p.q);
  if (res.length === 0) return;
  const verdicts = await Promise.all(res.slice(0, 3).map((r) => judge(p.q, r.verbatim_text)));
  n++;
  if (verdicts[0]) h1++;
  if (verdicts.some(Boolean)) h3++;
  process.stdout.write(verdicts[0] ? "." : verdicts.some(Boolean) ? "o" : "x");
}

// simple concurrency pool
const queue = [...pairs];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) await run(queue.shift());
}));

console.log(`\n\nLLM-as-judge (${n} questions) — does the top result actually answer the question?`);
console.log(`  judge hit@1  ${h1}/${n}  (${Math.round((100 * h1) / n)}%)`);
console.log(`  judge hit@3  ${h3}/${n}  (${Math.round((100 * h3) / n)}%)`);
console.log(`\n(vs path-based: strict hit@1 34%, topic hit@1 46% — those undercount valid alternative answers.)`);
