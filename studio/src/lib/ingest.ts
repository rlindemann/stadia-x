import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// The Python extraction/load pipeline lives in the repo root (parent of studio).
// It cannot run inside a Vercel request (no Python); enable on a self-hosted /
// local server by setting LOCAL_INGEST=1. INGEST_ROOT overrides the repo path.
export const ingestEnabled = () => process.env.LOCAL_INGEST === "1";
const repoRoot = () => process.env.INGEST_ROOT || path.resolve(process.cwd(), "..");
const uploadsDir = () => path.join(repoRoot(), "data", "uploads");

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function savePdf(id: string, bytes: Uint8Array): Promise<string> {
  await mkdir(uploadsDir(), { recursive: true });
  const p = path.join(uploadsDir(), `${slug(id)}.pdf`);
  await writeFile(p, bytes);
  return p;
}

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: repoRoot(), shell: process.platform === "win32" });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", (e) => resolve({ code: -1, out: out + `\n${e.message}` }));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

export type IngestOpts = {
  id: string;
  title: string;
  publisher?: string | null;
  supersedes?: string | null;
  pdfPath: string;
  ocr?: boolean;
};

// Run extract -> load. Clauses land under the standard, which stays 'pending' in
// review_status (load does not touch meta) until an admin publishes it.
export async function runPipeline(o: IngestOpts): Promise<{ ok: boolean; log: string }> {
  const jsonl = path.join("data", "out", `${slug(o.id)}.jsonl`);
  const extractArgs = ["run", "python", "-m", "ingest.extract", o.pdfPath, o.id, "--title", o.title];
  if (o.ocr) extractArgs.push("--ocr");
  const ex = await run("uv", extractArgs);
  if (ex.code !== 0) return { ok: false, log: ex.out };

  const loadArgs = ["run", "python", "-m", "ingest.load", jsonl, o.id, "--title", o.title, "--pdf", o.pdfPath];
  if (o.publisher) loadArgs.push("--publisher", o.publisher);
  if (o.supersedes) loadArgs.push("--supersedes", o.supersedes);
  const ld = await run("uv", loadArgs);
  return { ok: ld.code === 0, log: ex.out + "\n" + ld.out };
}
