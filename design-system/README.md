# Specification — design system kit

A self-contained copy of the "Specification" design system. Drop this folder
into another repo and you have the full look: tokens, fonts, the Tailwind
mapping, the spec, and a no-build visual reference.

Industrial, drawing-office derived. Cool graphite base so a single surveyor-
orange accent is the only chroma on screen. Sharp corners, hairline rules, red
reserved exclusively for compliance failure. The full reasoning is in
`DESIGN.md`.

## What's in here

| File | What it is | Do you need it |
|---|---|---|
| `tokens.css` | **The single source of truth.** Every brand value as a plain CSS variable, with light + dark. No build step, no framework. | Always |
| `tailwind-theme.css` | Maps the tokens onto Tailwind colour/utility names and defines `.font-display` / `.font-ident` / `.tabular`. Imports `tokens.css`. | Only on Tailwind v4 |
| `fonts.example.tsx` | Loads the three fonts (Public Sans, Archivo w/ `wdth`, Martian Mono) under the variable names the tokens expect. Next.js `next/font`. | Adapt to your stack |
| `DESIGN.md` | The spec and the reasoning — typography, colour, the hard rules, layout. | Read it |
| `CUSTOMIZATION.md` | How to re-skin per brand. Brand values live in one place by design. | When rebranding |
| `design-preview.html` | **Open in any browser, no build.** Palette, fonts, components, document canvas + provenance margin, both themes. Mirrors the token block verbatim. | Reference |
| `components/` | Reference React implementations of the signature elements (title block, provenance margin). Illustrative — see caveats below. | Optional |

## Install (Tailwind v4)

1. Copy this folder into your repo.
2. In your global stylesheet, replace your theme import with:
   ```css
   @import ".../design-system/tailwind-theme.css";  /* pulls in tokens.css + Tailwind */
   ```
3. Load the three fonts under the variable names in `fonts.example.tsx`
   (`--font-public-sans`, `--font-archivo`, `--font-martian-mono`).
4. Dark mode toggles on a `.dark` class on `<html>` (see `fonts.example.tsx`).

## Install (no Tailwind)

Just `@import "tokens.css"`. You get every value as a CSS variable
(`var(--brand)`, `var(--rule)`, `var(--gray-700)`, …). Skip `tailwind-theme.css`;
recreate `.font-display` / `.font-ident` / `.tabular` from the snippets inside it
if you want them.

## The one rule that matters

Red (`--alarm`) is **compliance failure only** — never deletions, never generic
errors, never decoration. That scarcity is what makes "safe to send" readable in
half a second. `design-preview.html` mirrors the tokens verbatim precisely so it
can't drift and quietly break this rule; if you change the tokens, re-copy the
`:root` / `.dark` block into it wholesale rather than hand-editing hex.

## About `components/`

These are lifted from the source app as reference, not a drop-in library:

- `SidebarNavItem.tsx` needs `lucide-react`.
- `TitleBlock.tsx` + `titleBlock.ts` are self-contained.
- `ProvenanceMargin.tsx` / `ProvenanceMarker.tsx` read the `DaveEditAnnotation`
  shape in `components/types.ts` (a trimmed copy). They render off
  `source_verified`, never `source_kind` alone — an unverified claim must look
  exactly like unsourced text.

Treat them as worked examples of the tokens in use; adapt imports to your app.
