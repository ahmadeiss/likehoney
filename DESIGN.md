# Design

Visual system for the Like Honey **Admin** console. The storefront has its own
warm light theme and is out of scope here. All values are semantic tokens defined
in `packages/ui/src/styles/styles.css`; admin-specific composition classes live
in `apps/web/src/app/globals.css` under the `lh-admin-*` namespace.

## Theme

Split-surface console. The persistent chrome (sidebar rail + top bar) is a deep
near-black (`.lh-admin-shell`, `color-scheme: dark`); the workspace is a warm
neutral paper (`.lh-theme-admin`, `color-scheme: light`). This gives the app a
calm, high-fidelity "operations desk" feel: the dark rail frames the work, the
paper workspace is where thinking happens. Not dark-for-cool, not
beige-everywhere — the two surfaces do different jobs.

## Color

Strategy: **Restrained.** Tinted warm-neutral surfaces + one brand accent
(honey/gold) used only for primary action, current selection, and the single
most important metric on a screen. Everything else is neutral ink. Danger is
reserved for destructive actions and true "out of stock". Severity on the
dashboard is expressed with small dots, soft tint chips, and weight — not fields
of red/orange.

Workspace palette (light):

| Role                              | Token                                      | Value                                                                |
| --------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| Canvas (page)                     | `--lh-color-canvas`                        | `#f4f1ea`                                                            |
| Surface (panel)                   | `--lh-color-surface`                       | `#fdfdf9`                                                            |
| Surface raised                    | `--lh-color-surface-raised`                | `#ffffff`                                                            |
| Surface muted                     | `--lh-color-surface-muted`                 | `#efebe0`                                                            |
| Ink (primary text)                | `--lh-color-ink`                           | `#1d1a14`                                                            |
| Ink-2                             | `--lh-color-ink-2`                         | `#4a443a`                                                            |
| Ink-3 (secondary)                 | `--lh-color-ink-3`                         | `#767060`                                                            |
| Border                            | `--lh-color-border`                        | `#e5dfd0`                                                            |
| Border strong                     | `--lh-color-border-strong`                 | `#ccc4ae`                                                            |
| Brand honey                       | `--lh-color-honey`                         | `#b8860b`                                                            |
| Honey deep (text on paper)        | `--lh-color-honey-deep`                    | `#8a5f0d`                                                            |
| Honey soft (tint)                 | `--lh-color-honey-soft`                    | `#f4e7c4`                                                            |
| Success / Warning / Danger / Info | `--lh-color-{success,warning,danger,info}` | green `#3f6b52` · amber `#96610f` · rust `#a23622` · slate `#3e5c76` |

Shell palette (dark rail): `--lh-color-surface #171717`, `ink #f6f4ef`,
`ink-3 #8a8478`, `border #2b2a26`, honey lifts to `#d7ae55` for contrast on black.

Contrast: `ink` on `surface` ≈ 15:1; `ink-3` on `surface` ≈ 4.7:1 (secondary text
only); `honey-deep` on `honey-soft` ≈ 4.9:1. Placeholder text uses `ink-4` on
inputs only, never for content.

## Typography

One family: **IBM Plex Sans Arabic** for body/UI, **Cairo Variable** for display
weights — both carry Arabic and Latin, paired on a weight axis, not two similar
sans. Fixed rem scale (no fluid clamp inside the app):

| Role          | Size / weight               | Use                                                 |
| ------------- | --------------------------- | --------------------------------------------------- |
| Page title    | 1.375rem / 800, `-0.01em`   | one per screen, in the page header                  |
| Section title | 0.8125rem / 700             | panel + module headers, slightly toned (`ink-2`)    |
| Metric        | 1.75rem / 800, tabular-nums | stat-strip values                                   |
| Body          | 0.875rem / 400              | default                                             |
| Label         | 0.8125rem / 600             | field labels, table headers (not uppercase-tracked) |
| Caption       | 0.75rem / 400, `ink-3`      | helper text, meta                                   |

No giant headlines — this is an operational app. Section labels are sentence-case
Arabic, not tiny tracked uppercase eyebrows. The greeting on the owner dashboard
is the one place a larger heading (1.5rem) is allowed, because it sets context.

## Spacing & layout

8px-based scale (`--lh-space-*`), admin density overrides make steps 1–4 tighter.
Vertical rhythm: sections are separated by `--lh-space-7` (2rem), modules inside a
section by `--lh-space-4`. Pages must not trail off into dead canvas — content
fills a deliberate max width and stacks with rhythm.

Content widths (`.lh-admin-page` container):

- Standard pages: `max-width: 1120px`, centered.
- Data-dense pages (Products, Inventory, Staff): `max-width: 1280px`.
- Dashboard: `max-width: 1200px`, 12-col-ish grid (main + side rail on ≥1024px).
- Forms (Create product): two-column workspace + sticky summary on ≥1200px,
  single column below.

Mobile (≤768px): rail becomes a drawer, top bar stays compact with the primary
action visible, tables become card/list modules, filters move into a sheet.

## Components

Vocabulary — deliberately varied, not "white card ×20":

- **Panel** (`lh-admin-panel`): the workhorse surface. 1px border, `surface` bg,
  `--lh-radius-card`, soft `shadow-sm`. Optional `lh-admin-panel--flush` for
  tables/lists that go edge to edge. Never nested.
- **Panel header** (`lh-admin-panel-head`): section title + caption on the start
  side, one link/action on the end side, thin divider under.
- **Stat strip** (`lh-admin-stat-strip` / `lh-admin-stat`): a horizontal band of
  compact metrics. Label (caption), value (metric), note. One value may take the
  honey accent; the rest are ink. Links get a hover lift.
- **List module** (`lh-admin-list` / `lh-admin-list-row`): rows with a leading
  16–32px status glyph, a title + meta stack, and trailing value/chips/action.
  Replaces "table in a card" for attention lists, reorder groups, activity.
- **Activity timeline** (`lh-admin-activity`): list module variant with a dot +
  connector rail, event sentence, actor + relative time. For the ledger's
  human view.
- **Filter toolbar** (`lh-admin-toolbar`): a single bordered bar — search grows,
  selects are grouped and shrink-to-content, result count trails. On mobile a
  "تصفية" button opens the filters in a sheet.
- **Data table** (`lh-admin-table`): only where a table genuinely wins (Products
  desktop, Inventory balances, Staff, delivery zones). Sticky head, `ink-3`
  labels, hover row tint, tabular-nums numeric columns aligned to the end.
- **Status chip** (`lh-admin-chip`): one shape, semantic tint + dot. `active`,
  `draft`, `inactive`, `low`, `out`, `in`, `pending`, `done`. Same everywhere.
- **Stock pill** (`lh-stock-pill`): the low/out/in trio, tint + dot.
- **Quick action** (`lh-admin-quick`): large touch target — icon tile + label +
  sub — for the employee home and dashboard shortcuts.
- **KPI-less empty state** (`lh-admin-empty`): icon in a honey-soft disc, title,
  one sentence, one CTA. Used for zero data and "قريبًا".
- **Coming-soon panel** (`lh-admin-soon`): muted panel, small "قريبًا" chip,
  one line explaining what will live here. No numbers.

Every interactive element ships default / hover / focus-visible / active /
disabled / loading. Loading is a skeleton of the real shape, never a centered
spinner in a panel.

## Motion

150–200ms, `--lh-ease-standard`. State only: row hover tint, button press
(`translateY(1px)`), drawer slide, dropdown fade, save-confirmation flash.
Staggered list entrance is allowed on first load of a module (≤4 items, 30ms
step). No page-load choreography. `prefers-reduced-motion` → instant.

## Iconography

`lucide-react`, 16px in dense rows / 18px in nav / 20px in headers, `1.75`–`2`
stroke. Icons are always paired with text except in the mobile menu toggle and
icon-only table actions (which carry `aria-label`).
