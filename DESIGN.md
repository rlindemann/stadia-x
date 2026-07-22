# Design System — STADIA-X

Created 2026-07-21 by `/design-consultation`. This file is the source of truth for every
visual decision in `studio/`.

This is the **"Specification"** design system, ported from `design-system/` (the portable
kit dropped into this repo). The kit's `DESIGN.md` describes DAVE, a document-drafting
tool with title blocks and provenance margins. This file is the same system rewritten for
the screens STADIA-X actually has: search, library, clause detail, gap analysis, edition
compare, graph.

**Values live in `studio/src/app/globals.css`. This file explains why.**

**The memorable thing: "I can see exactly where this came from."**

Every rule below serves that. Someone specifying a stadium concourse should be able to
look at any answer on screen and see, without clicking, which standard it came from,
which clause, which page, and whether that edition is still current. Provenance is the
loudest thing in the product. Everything else stays quiet so it can be heard.

## Product Context

- **What this is:** A query engine over policy documents and sports-venue standards,
  extracted to clause level with clause-level provenance. Ingest PDF, extract verbatim
  clauses, query by meaning, wording, the questions a clause answers, and the links
  between clauses.
- **Who it's for:** People specifying and reviewing sports venues against standards.
  Desktop-first, dense, read-all-day software.
- **Space:** Standards and compliance retrieval. Adjacent: legal AI (Harvey, Legora),
  standards bodies' own portals (BSI Knowledge, ISO OBP, NFPA LiNK).
- **Live at:** stadia-x.vercel.app
- **Stack:** Next.js, plain CSS. **No Tailwind** — the kit's `tailwind-theme.css` does not
  apply here. Only the token layer ports.

## Aesthetic Direction

- **Direction:** **Specification** — industrial, drawing-office derived.
- **Decoration level:** minimal. Typography and 1px rules do all the work.
- **Mood:** The standard itself. The spec book, the schedule, the title block. Precision as
  the aesthetic. It should look like the document it is quoting, not like a search product
  wrapped around it.

### Why this, and not what the category does

Standards portals are either institutional and dated (BSI, ISO OBP) or dressed as generic
SaaS. Neither reads as *precise*. The opportunity is that STADIA-X's whole claim is
exactness — verbatim text, clause path, page number — and the visual language can carry
that claim before anyone reads a word.

Surveyor's orange is the accent: the colour of setting-out paint and site marking. It is
construction-native, and it appears in essentially zero AI retrieval products, which are
uniformly blue or purple.

## Typography

Three families, each with exactly one job. Loaded in `studio/src/app/layout.tsx` via
`next/font/google`, self-hosted at build time.

- **Structural — Archivo** (variable, `wdth` axis). Used **only** at `wdth: 118–125`,
  ALL CAPS, 11–14px, `letter-spacing: .06–.14em`: section markers, table column headers,
  field labels, obligation badges, the wordmark. This is a drawing-sheet label and a title
  block stamp. Exposed as `var(--display)`.
- **Body & UI — Public Sans** (variable). A civic-infrastructure grotesque commissioned for
  US government systems, built for forms and tables read for eight hours. Narrower than
  Inter, so more columns fit in the results grid. Real tabular figures. `var(--ui)`.
- **Identifiers — Martian Mono** (variable). Clause paths, standard codes, page refs,
  revision codes, URIs, provenance strings. `var(--ident)`.

**Mono is for identifiers, not numbers.** Tabular figures in a proportional face align just
as well and read better in columns, so counts, scores and dates stay in Public Sans —
`font-variant-numeric: tabular-nums` is set on `body`. Mono is reserved for things that are
*codes*: `6.2.1`, `AFC 24051`, `p.114`.

**Scale — six steps, no in-betweens.** The app previously used 21 distinct sizes; it now
uses exactly these six.

| px | Role | Line height |
|---|---|---|
| 11 | Structural labels, table column headers | 1.35 |
| 12.5 | Dense table content, secondary metadata, identifiers | 1.35 |
| 14 | Default UI text, buttons, inputs (`body` default) | 1.35 |
| 16.5 | Clause text, answer prose — the reading surface | 1.7 |
| 21 | Sub-headings, wordmark | 1.35 |
| 30 | Page titles | 1.1 |

## Color

**Approach: restrained.** Cool graphite base (hue 250) so the single orange accent is the
only thing on screen with chroma. Attention goes exactly where the system points it.

White cards sit on a graphite-tinted ground, not the reverse. That inversion is what makes
a result row read as a sheet of paper on a desk.

### Light

| Token | oklch | Role |
|---|---|---|
| `--bg` | `oklch(0.968 0.003 250)` | page ground |
| `--panel` | `oklch(0.945 0.004 250)` | recessed, row hover |
| `--raised` | `oklch(1 0 0)` | cards, inputs, popovers |
| `--ink` | `oklch(0.245 0.008 250)` | primary text |
| `--ink-2` | `oklch(0.378 0.008 250)` | clause body text |
| `--muted` | `oklch(0.555 0.008 250)` | secondary |
| `--faint` | `oklch(0.680 0.008 250)` | labels |
| `--line` | `oklch(0.895 0.005 250)` | hairline |
| `--line-2` | `oklch(0.790 0.007 250)` | strong rule |
| `--accent` | `oklch(0.62 0.17 45)` | fills, active states |
| `--accent-2` | `oklch(0.545 0.155 42)` | links and text (AA on white) |
| `--accent-wash` | `oklch(0.955 0.03 55)` | accent backgrounds |
| **`--alarm`** | `oklch(0.455 0.165 27)` | **risk only — see hard rule 1** |
| `--verified` | `oklch(0.525 0.100 158)` | confirmed coverage |
| `--shall` | `var(--ink)` | obligation: SHALL |
| `--should` | `oklch(0.68 0.125 85)` | obligation: SHOULD, and warnings |
| `--may` | `oklch(0.555 0.020 250)` | obligation: MAY |

### Dark

Both themes are designed, not derived. Dark is graphite, not black. Full values in
`globals.css` under `[data-theme="dark"]`.

### Hard rules — these are not preferences

1. **Red (`--alarm`) means risk, and nothing else.** Specifically: a requirement with no
   clause covering it (`gaps`), a superseded or withdrawn document being cited
   (`.tag-super`, `.status.superseded`, `.c-title .repl`), and chrome-level destructive
   actions (delete a collection, delete a standard). That is the entire list.

   This was the main thing that changed on adoption. Red was previously spent on six
   different meanings — obligation level, gaps, edition diffs, graph edges, deletes and
   operational errors — which made it ambient. Red being scarce is what makes "this answer
   is built on a withdrawn edition" legible in half a second.

2. **SHALL is not red.** Obligation level is a neutral fact about a clause, and SHALL is
   the most common level, so colouring it red would put red on most rows. Obligation reads
   by **form first**: SHALL is a solid ink block at weight 600, SHOULD a solid amber block,
   MAY a hollow outline. SHALL still reads first without spending scarcity.

3. **Operational errors are amber, not red.** An ingest failure or an audit alert is the
   team's problem, not a standards-compliance risk to the reader. `--should` carries these.

4. **Edition diffs are not red/green.** A clause removed between editions is not an error
   and an added one is not a success — they are *changes*. Insertions take `--accent-2` on
   a wash; deletions go `--muted`, struck through, 60% opacity. Never red.

5. **A `supersedes` graph edge is amber; a superseded document is red.** The relationship is
   information. The state of the thing you are about to cite is risk. Do not merge them.

6. **Archivo is small caps labels only.** Extended caps are illegible at any length. Never
   for running text, never above 30px.

7. **Accent fills interactive controls; alarm fills status.** Accent (orange) is the action
   colour: it fills buttons, active chips, active pills and toggles — the things you click.
   It never fills a passive content block or a background sitting behind body text. Alarm is
   the one that fills status blocks. Accent and alarm are adjacent hues separated by
   lightness (0.62 vs 0.455) and by role; they must never appear in the same component.

8. **Colour that carries meaning meets WCAG AA (4.5:1) as text.** Amber has two cuts:
   `--should` for fills (swatches, badges, bars) and `--should-text` for text, which is
   darkened in light mode to pass. `--faint` is a de-emphasis tier, not a text-contrast
   escape hatch — it clears AA-large only, so never set essential content in it below the
   large-text size. This mirrors the `--accent` / `--accent-2` split.

## Spacing

- **Base unit:** 4px
- **Density:** compact. This is read-all-day software, not a marketing page.
- **Scale:** 2 / 4 / 8 / 12 / 16 / 24 / 32 / 48

## Layout

- **Approach:** grid-disciplined.
- **Max reading measure:** 68ch, left-aligned, never centred.
- **Border radius:** **2px on controls** (buttons, inputs, chips, badges, pills).
  **0 on panels, popovers, cards, tables and rules.** Sharp corners are the point. The only
  exceptions are genuinely circular elements (the spinner, graph node dots).
- **Elevation:** hierarchy comes from 1px rules and background steps only. **No shadows on
  work surfaces.** Shadows exist solely for things that genuinely float: popovers, the
  clause-jump dropdown, the document picker, the graph inspector, hover thumbnails. All
  shadow colours are `color-mix` on `--ink` so they adapt to dark.
- **Grid:** no zebra striping, 1px rules, sticky Archivo caps header, numerics tabular and
  right-aligned. Stripes are a crutch for bad rules.

### Signature elements

Three things carry the memorable thing. Do not dilute them.

1. **The provenance line.** Every result carries standard code, clause path, and page in
   Martian Mono, before the text. It is never truncated away on desktop.
2. **The obligation block.** A solid/hollow swatch plus an Archivo caps label. Readable at a
   glance down a column of results without reading a word.
3. **The score breakdown.** Semantic, keyword and combined shown as three separate bars with
   the numbers exposed. The product's claim is precision; hiding the ranking would
   contradict it.

## Motion

- **Approach:** minimal-functional.
- **Durations:** two only. **90ms** for state (colour, border, background), **160ms** for
  position and size.
- **Easing:** `cubic-bezier(0.2, 0, 0, 1)`.
- Nothing fades in on load. Nothing bounces.
- Skeleton loaders are banned.

## Porting this system elsewhere

Copy two things: this file, and the `:root` / `[data-theme="dark"]` block at the top of
`studio/src/app/globals.css`. Then load Archivo (with the `wdth` axis), Public Sans and
Martian Mono under `--font-archivo`, `--font-public-sans`, `--font-martian-mono`.

`design-system/` holds the original portable kit including `tokens.css`,
`design-preview.html` (open in any browser, no build) and reference React components. If
the kit's values change, **re-copy them into `globals.css` wholesale** rather than
re-deriving them by hand. The kit's own README documents why: a hand-copied version drifted
and ended up breaking the very rule it was meant to illustrate.

## Known gaps

- `design-system/components/` are React reference implementations for DAVE's title block and
  provenance margin. Neither surface exists in STADIA-X. They are not wired in and should
  not be copied without adapting them to clause provenance.
- `design-system/tailwind-theme.css` and the `--gray-*` / `--blue-*` legacy ramps in
  `tokens.css` are Tailwind-only. They are unused here and can be ignored.
- The kit's `design-preview.html` renders DAVE's screens, not STADIA-X's.

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-21 | Adopt the Specification system from `design-system/` | Kit was dropped into the repo as the intended look. Values ported verbatim; spec rewritten for STADIA-X's screens. |
| 2026-07-21 | Keep stadia-x token *names*, take kit *values* | 867 lines of existing CSS keep working. A rename map, not a rewrite. |
| 2026-07-21 | Green `#2E6B4D` → surveyor orange | Construction-native; frees the palette from reading as generic SaaS. |
| 2026-07-21 | Warm off-white → cool graphite (hue 250) | Reads technical and drawing-derived rather than editorial. |
| 2026-07-21 | Abel + Source Code Pro → Public Sans + Archivo + Martian Mono | Three families, one job each. Public Sans is narrower with real tabular figures; Archivo carries the drawing-sheet label. |
| 2026-07-21 | Red reserved for risk; SHALL moved to ink + form | Red was spent on six meanings and had gone ambient. SHALL is a neutral fact, not a failure. |
| 2026-07-21 | Type scale collapsed from 21 sizes to 6 | Six steps, no in-betweens. The scale is the system. |
| 2026-07-21 | Radius: 2px controls, 0 panels | Sharp corners are the point. |
| 2026-07-21 | Transitions normalized to 90ms, one easing curve | Two durations only; 49 transitions were on four different values. |
| 2026-07-22 | Accessibility pass: `--should-text` cut added, `--faint` darkened | Amber text was 2.91:1 and faint labels 2.88:1 on white — both failed WCAG AA. Amber now splits fill/text like accent does. |
| 2026-07-22 | Rule 7 rewritten; rule 8 (contrast) added | Ported DAVE rule banned accent fills, but orange buttons are the action colour. Rule now describes the real invariant. |
