# Design System — DAVE

Created 2026-07-21 by `/design-consultation`. This file is the source of truth for every
visual decision. Values live in `frontend/src/app/globals.css`; this file explains why.

**The memorable thing: "I know this is safe to send."**

Every rule below serves that. A bid manager finishing a tender response at 4:50pm on a
Friday should be able to answer, in half a second and without clicking anything, whether
the document in front of them is safe to send to a client. Verification is the loudest
thing in the product. Provenance is always visible. Everything else stays quiet so those
two can be heard.

## Product Context

- **What this is:** Document Automation & Verification Engine. An internal AI tool for
  drafting and reviewing AEC project documents — RFP and tender responses, Design and
  Access Statements, planning statements, RIBA stage reports.
- **Who it's for:** Architects and bid managers at an architecture practice. Desktop-first,
  dense, work-all-day software.
- **Space:** AEC document tooling. Adjacent: legal AI (Harvey, Legora), AEC platforms
  (Monograph, Arcol, Snaptrude).
- **Project type:** Internal tool, copied and re-skinned per company (see `docs/CUSTOMIZATION.md`).

## Aesthetic Direction

- **Direction:** **Specification** — industrial/utilitarian, drawing-office derived.
- **Decoration level:** minimal. Typography and 1px rules do all the work.
- **Mood:** The spec book, the schedule of accommodation, the title block — not the
  brochure. Precision as the aesthetic. It should look like the drawings on the practice's
  wall, not like the software they begrudgingly pay for.

### Why this, and not what the category does

Researched 2026-07-21 with live screenshots and computed styles:

| Product | What it does | Read |
|---|---|---|
| [Harvey](https://www.harvey.ai) | `#0F0E0D`, custom serif display 72px/400 | Premium professional services. Serif signals heritage and billable hours. |
| [Arcol](https://arcol.io) | `#171717` + cream, PP Telegraf 95px/-2.85px | Confident modern grotesk, dark, product-screenshot hero. |
| [Monograph](https://monograph.com) | `#F5F6F4`, **Söhne** + Söhne Mono | Licenses a serious studio typeface, then spends it on violet accents, pill buttons and a rainbow gantt. |

**The gap:** AEC software dresses like generic SaaS. AEC *practices* do not — their own
brand language is monochrome, gridded and drawing-derived. Because DAVE is an internal tool
wearing each practice's identity rather than a vendor selling to them, it should look like
the practice. That is the whole thesis.

**Söhne is deliberately not used.** Monograph already licenses it for exactly these users;
picking it would mean dressing as the vendor they already have.

## Typography

Three families, each with exactly one job.

- **Structural — Archivo** (variable, `wdth` axis, Google Fonts). Used **only** at
  `wdth: 118–125`, ALL CAPS, 11–12px, `letter-spacing: 0.08em`: section markers, grid
  column headers, page titles, wordmark, empty states. This is a drawing sheet label and a
  title block stamp — it signals *authority and filing*, not *magazine headline*.
- **Body & UI — Public Sans** (variable, Google Fonts). A civic-infrastructure grotesque
  commissioned for US government systems, built for forms and tables read for eight hours.
  Narrower than Inter, so **more columns fit in the tabular review grid**. Real tabular figures.
- **Identifiers — Martian Mono** (variable, `wdth: 80`, Google Fonts). Semi-condensed, so
  `RIBA-3 / DAS-04 / rev C` survives inside a 30px table cell. Provenance markers, document
  IDs, clause references, revision codes.

**Mono is for identifiers, not numbers.** Tabular figures in a proportional face align just
as well and read better in columns, so money, word counts and dates stay in Public Sans with
`font-variant-numeric: tabular-nums`. Mono is reserved for things that are *codes*.

**No serif anywhere, including the document canvas.** RFP responses and RIBA reports ship as
Word documents in a corporate sans; rendering them in EB Garamond was a costume the client
never sees. This deliberately overturns the "worth keeping" call in `docs/UX-AUDIT.md`.

**Scale — six steps, no in-betweens:**

| px | Role | Line height |
|---|---|---|
| 11 | Structural labels, grid column headers | 1.35 |
| 12.5 | Dense table content, secondary metadata | 1.35 |
| 14 | Default UI text, buttons, inputs | 1.35 |
| 16.5 | Document canvas | 1.7 |
| 21 | Sub-headings | 1.35 |
| 30 | Page titles | 1.1 |

Loading: `next/font/google` in `frontend/src/app/layout.tsx`, self-hosted at build time.

## Color

**Approach: restrained.** Cool graphite base (hue 250°) so the single orange accent is the
only thing on screen with chroma. Attention goes exactly where the system points it.

### Light

| Token | oklch | hex |
|---|---|---|
| `bg` | `oklch(0.968 0.003 250)` | `#F5F6F7` |
| `surface` | `oklch(1 0 0)` | `#FFFFFF` |
| `text` | `oklch(0.245 0.008 250)` | `#24272B` |
| `muted` | `oklch(0.555 0.008 250)` | `#71757B` |
| `rule` | `oklch(0.895 0.005 250)` | `#DEE0E3` |
| `rule-strong` | `oklch(0.79 0.007 250)` | `#C0C3C8` |
| `accent` | `oklch(0.62 0.17 45)` | `#DE5F26` |
| `accent-text` (AA on surface) | `oklch(0.545 0.155 42)` | `#C04F14` |
| `accent-wash` | `oklch(0.955 0.03 55)` | `#FCEDE4` |
| **`alarm`** | `oklch(0.455 0.165 27)` | `#A32B1E` |
| `verified` | `oklch(0.525 0.1 158)` | `#2A7355` |
| `warning` | `oklch(0.68 0.125 85)` | `#A87C16` |

### Dark

| Token | oklch | hex |
|---|---|---|
| `bg` | `oklch(0.19 0.005 250)` | `#17191C` |
| `surface` | `oklch(0.235 0.005 250)` | `#1F2226` |
| `raised` | `oklch(0.275 0.006 250)` | `#272A2F` |
| `text` | `oklch(0.945 0.003 250)` | `#EDEEEF` |
| `muted` | `oklch(0.655 0.008 250)` | `#91959B` |
| `rule` | `oklch(0.325 0.006 250)` | `#31353A` |
| `rule-strong` | `oklch(0.425 0.008 250)` | `#474C53` |
| `accent` | `oklch(0.72 0.17 48)` | `#FF7A3D` |
| `accent-text` | `oklch(0.775 0.15 50)` | `#FF9560` |
| `accent-wash` | `oklch(0.29 0.05 45)` | `#38241A` |
| `alarm` | `oklch(0.665 0.17 27)` | `#E5624F` |
| `verified` | `oklch(0.735 0.13 158)` | `#4FBF90` |
| `warning` | `oklch(0.8 0.13 85)` | `#D9A441` |

**Surveyor's orange** is the accent — the colour of setting-out paint, site marking and
hi-vis. It is AEC-native, and it appears in zero AI document products, which are uniformly
blue or purple.

### Hard rules — these are not preferences

1. **Red is reserved for compliance failure on the document and review surfaces.**
   Missing mandatory response, word-count breach, unanswered tender question — things that
   lose the practice points. On the canvas, the review grid and the title block, red means
   that and nothing else. Never for deletions, never for generic errors, never decoratively.
   Red being scarce *there* is what makes "safe to send" legible in half a second.

   **Scope qualifier:** chrome-level destructive actions (delete project, remove document)
   and file-type icons keep conventional red. They never co-occur with a compliance flag, so
   they cannot dilute the signal. This was originally written as an absolute ban, which was
   wrong — it is violated in ~50 reasonable places and banning destructive red would be worse
   design, not better. The rule protects a *context*, not a hex value.
2. **Unsourced content is distinguished by form, not by red.** `MODEL — unsourced` gets a
   dashed accent outline. Unsourced is *unverified*, not *failed*. Breaking this collapses
   rule 1. (This was caught and fixed during the first preview render — it is the easiest
   rule in the system to break by accident.)
3. **Accent never fills a block; alarm always does.** Accent and alarm are adjacent hues,
   separated by lightness (0.62 vs 0.455) and by form. They never appear in the same
   component. This is the weakest joint in the system and needs enforcing.
4. **Redlines are not red/green.** Insertions: `accent-text` with a 1.5px `accent` left rule
   on the paragraph (inline insertions take colour only, no rule). Deletions: `muted`,
   struck through, 60% opacity. An AI deletion is not an error and an insertion is not a
   success — they are *proposals*.
5. **Archivo is small labels only.** Extended caps are illegible at any length. Never use it
   for running text or anything above 30px.
6. **No confidence percentages, ever.** "87% confident" is a number a bid manager cannot act
   on and will be blamed for ignoring. Source or no source. That binary is the trust model.

**Dark mode strategy:** both themes are designed, not derived. The legacy `gray-*` and
`blue-*` ramps invert between `:root` and `.dark`, which is what re-skins ~1600 hardcoded
`gray-*` classes across 68 components without editing them. Preserve that mechanism.

## Spacing

- **Base unit:** 4px
- **Density:** compact — this is work-all-day software, not a marketing page.
- **Scale:** 2 / 4 / 8 / 12 / 16 / 24 / 32 / 48

## Layout

- **Approach:** grid-disciplined.
- **Max document measure:** 62–68ch, **left-aligned, not centred**.
- **Border radius:** 2px on controls (buttons, inputs, chips). **0px on panels, table cells
  and rules.** Sharp corners are the point.
- **Elevation:** hierarchy comes from 1px rules and background steps only. No card shadows
  on work surfaces. Shadows exist solely for things that genuinely float — popovers, command
  palette, drag ghosts.
- **Grid:** 30px rows, no zebra striping, 1px `rule-strong` verticals, hairline horizontals,
  sticky Archivo caps header, numerics tabular and right-aligned. Stripes are a crutch for
  bad rules.

### Signature elements

Three things carry the memorable thing. Do not dilute them.

1. **The title block.** A 28px full-width bar pinned to the bottom edge, mono, tabular,
   never scrolls: `DAS-04 · REV C · 4,120 / 5,000 WORDS · 12 OPEN REDLINES · 3 COMPLIANCE
   FLAGS · SYNCED 14:07`. Four of a bid manager's most-asked questions answered
   permanently, without a click.
2. **The 52px icon-only left rail.** A toolbar, not a nav sidebar. The project explorer
   opens as an overlay drawer or via `⌘K` rather than permanently occupying 280px.
3. **The provenance margin.** The document sits left; the right margin is a designed
   surface carrying source markers in Martian Mono (`PQQ-2019 §4.2`, `BREEAM-EXCELLENT`,
   `PRACTICE-BOILERPLATE`, `MODEL`). A document pinned left with annotations down the right
   *is* a marked-up drawing. That asymmetry is the composition.

### Planned structural change (not yet implemented)

**The document becomes the primary surface.** Today `ChatView.tsx:449` gives chat `flex-1`
capped at `max-w-4xl`, while the deliverable sits in the `shrink-0` `AssistantSidePanel`.
That inverts: the document owns the main surface, chat docks as a full-width command line
above the title block, and history becomes a drawer. The deliverable is what wins or loses
the fee — it should own the screen.

## Motion

- **Approach:** minimal-functional.
- **Duration:** 90ms state, 160ms position. Two durations only.
- **Easing:** `cubic-bezier(0.2, 0, 0, 1)`.
- Nothing fades in on load. Nothing bounces.
- **Skeleton loaders are banned.** Use a 2px `accent` progress hairline on the top edge of
  the affected panel.
- Streaming AI text shows a 1px `accent` block caret. No shimmer, no pulsing dots.

## Preview

**`docs/design-preview.html`** — open it in any browser, no build step. Fonts, palette,
components, document canvas with provenance margin, review grid, both themes.

It mirrors the `:root` / `.dark` token block from `globals.css` **verbatim** and references
every colour through `var()`, so it cannot silently disagree with the app. When those
blocks change, re-copy them wholesale — do not re-derive the values as hex. An earlier
hand-copied version drifted and ended up colouring compliance flags with the accent
instead of alarm, breaking the very rule it was meant to illustrate.

For the live components rather than a static page, run the app and open `/design-check`
(development only).

## Porting this system to another repo

Copy two things:

1. **`DESIGN.md`** — the spec and the reasoning.
2. **The token block in `frontend/src/app/globals.css`** — the `@theme inline`, `:root`
   and `.dark` blocks, plus the `@layer utilities` definitions of `.font-display`,
   `.font-ident` and `.tabular`.

Then load the three fonts (`Archivo` with the `wdth` axis, `Public Sans`, `Martian Mono`)
in the root layout. `docs/design-preview.html` travels as a self-contained reference.

The system is built to be re-skinned: brand values live in exactly one place because the
template is copied per company (see `docs/CUSTOMIZATION.md`).

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-21 | Initial design system created | `/design-consultation` with live competitive research |
| 2026-07-21 | Direction: Specification (industrial, drawing-office) | AEC software dresses as generic SaaS; AEC practices do not. DAVE is re-skinned per practice, so it should look like the practice. |
| 2026-07-21 | Neutrals warm (85°) → cool graphite (250°) | Reads technical and drawing-derived rather than literary/editorial. |
| 2026-07-21 | Accent ink blue → surveyor orange | AEC-native; zero AI document products use it. Frees blue from meaning "AI product". |
| 2026-07-21 | Red reserved exclusively for compliance failure | Makes "safe to send" legible in half a second. The core of the memorable thing. |
| 2026-07-21 | Inter → Public Sans, EB Garamond retired, Archivo + Martian Mono added | Public Sans is narrower (more grid columns) with real tabular figures; serif on the canvas was a costume the client never sees. |
| 2026-07-21 | Söhne rejected despite fitting the brief | Monograph already licenses it for these exact users. |
| 2026-07-21 | Unsourced marker uses dashed outline, not red | Caught in first preview render; using red there would collapse the compliance-only rule. |
