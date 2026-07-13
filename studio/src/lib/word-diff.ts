// Minimal word-level diff (LCS) for showing what changed between two clause texts.
export type DiffSeg = { type: "same" | "add" | "del"; text: string };

function tokenize(s: string): string[] {
  // Keep words and the whitespace between them as separate tokens.
  return s.match(/\S+|\s+/g) ?? [];
}

export function wordDiff(a: string, b: string): DiffSeg[] {
  const x = tokenize(a);
  const y = tokenize(b);
  const n = x.length;
  const m = y.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const segs: DiffSeg[] = [];
  const push = (type: DiffSeg["type"], text: string) => {
    const last = segs[segs.length - 1];
    if (last && last.type === type) last.text += text;
    else segs.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push("same", x[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", x[i]);
      i++;
    } else {
      push("add", y[j]);
      j++;
    }
  }
  while (i < n) push("del", x[i++]);
  while (j < m) push("add", y[j++]);
  return segs;
}
