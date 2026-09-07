# Like Honey Design System

> **Business context:** Like Honey is a premium **children's retail store** —
> clothing, shoes, bags/backpacks, school supplies, toys, accessories, baby
> products and gifts. It is **not** a honey/food/organic retailer. The
> bee/honey identity is brand language only (restrained gold accent, selective
> mascot moments, subtle geometry); honey imagery is never merchandise or
> product art. (Normative statement — see `AGENTS.md`, CRITICAL BUSINESS
> CONTEXT.)

> Phase 1 — foundation. A custom, brand-specific system implemented in
> `packages/ui` as design tokens + primitives + layout, validated by the
> internal design lab at `/__design/storefront` and `/__design/admin`.
> No generic component libraries (shadcn, MUI, Ant Design, Chakra…) are used.

## 1. Philosophy

- **Premium and restrained.** Honey/gold is the brand signature accent — warm,
  quiet, never a honey product statement and never everywhere.
- **Children's retail, product-first.** The customer storefront exists to sell
  kids' clothing, shoes, bags, toys, accessories and baby products. Merchandise
  and product photography lead; the brand motif supports, never dominates.
- **Two expressions, one brand.**
  - Customer storefront (`lh-theme-customer`): warm cream canvases, deep
    charcoal ink, honey accents, soft warm shadows.
  - Administration (`lh-theme-admin`): dark, precise, operational console
    with the same honey accent as the highlight color.
- **Direction-aware by construction.** All spacing and alignment uses CSS
  logical properties (`margin-inline-start`, `inset-block`, `padding-inline`,
  `text-align: start`). Arabic/RTL is the default; English/LTR is a first-class
  citizen. No `left`/`right`/`margin-left` in the system.
- **Accessibility is non-negotiable.** Semantic HTML, visible `:focus-visible`
  rings, keyboard-operable controls, adequate contrast on both themes,
  `prefers-reduced-motion` support.

## 2. Tokens

Tokens are CSS custom properties defined on `:root` and `.lh-theme-customer`
(identical) and overridden by `.lh-theme-admin`. Components consume only
semantic tokens, so a surface — button, card — restyles itself correctly in
either theme without touching its markup.

Style entry point (import once, in the app shell):

```ts
import '@likehoney/ui/styles.css'
```

### Palette (customer light)

| Token                       | Value     | Usage                          |
| --------------------------- | --------- | ------------------------------ |
| `--lh-color-canvas`         | `#f6f1e6` | Page background                |
| `--lh-color-surface`        | `#fffbf3` | Cards, inputs                  |
| `--lh-color-surface-raised` | `#ffffff` | Hover surfaces, switch thumb   |
| `--lh-color-surface-muted`  | `#efe8d8` | Subtle fills, skeletons        |
| `--lh-color-ink`            | `#272118` | Primary text                   |
| `--lh-color-ink-2`          | `#4c4536` | Secondary text                 |
| `--lh-color-ink-3`          | `#6e6655` | Captions, muted text           |
| `--lh-color-ink-4`          | `#9a9180` | Placeholders, faint text       |
| `--lh-color-border`         | `#e6ddc9` | Hairline borders               |
| `--lh-color-border-strong`  | `#d2c5a9` | Control borders                |
| `--lh-color-honey`          | `#c3891b` | Primary action                 |
| `--lh-color-honey-strong`   | `#a97412` | Hover                          |
| `--lh-color-honey-deep`     | `#8c5e0e` | Active, badge text             |
| `--lh-color-honey-soft`     | `#f5e8c8` | Tint fills, icon buttons       |
| `--lh-color-on-honey`       | `#231a07` | Text on honey fills (dark ink) |

Semantic status: `success` `#3e6b4f`, `warning` `#96610f`, `danger` `#a23622`,
`info` `#3e5c76`, each paired with a `<tone>-soft` tint used for badges.

**Contrast note:** the honey action color is consistently paired with **dark
ink text** (`--lh-color-on-honey`), not white — this keeps contrast ≥ 5:1 and
is a distinctive product decision.

### Admin (dark) overrides

The same semantic tokens remap: canvas `#15130f`, surface `#1e1a15`,
ink `#f1eadb`, honey brightened to `#e1a83b`, status colors lifted for dark
backgrounds. No component logic changes between themes.

### Other scales

- **Radii** — `control` 6px · `soft` 8px · `card` 14px · `feature` 22px ·
  `display` 28px · `pill` 999px.
- **Spacing** — `--lh-space-0…12` (0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64,
  80, 96 px). Consume via the `gap`/`pad` props or `var(--lh-space-N)`.
- **Shadows** — warm, low-opacity rings for the customer theme; deeper black
  shadows for the admin theme (`xs`, `sm`, `md`, `lg`).
- **Motion** — `fast` 120ms · `base` 200ms · `slow` 320ms · `slower` 480ms with
  a restrained standard ease; shimmer/spin animations disable under
  `prefers-reduced-motion`.
- **Type scale** — `display`, `heading`, `title`, `body`, `label`, `caption`,
  `eyebrow`, `metric`; display/heading/metric use Cairo (variable), body uses
  IBM Plex Sans Arabic. Metrics use tabular numerals.

## 3. Typography

Fonts ship via `@fontsource-*` static assets (deterministic, offline-friendly —
no runtime Google Fonts fetch):

- **Cairo Variable** — display, headings, metrics. Strong, warm character.
- **IBM Plex Sans Arabic** — body, UI labels, captions. Highly legible Arabic
  with full Latin coverage.

Type roles are applied with semantic classes: `.lh-text-display`,
`.lh-text-heading`, `.lh-text-title`, `.lh-text-body`, `.lh-text-label`,
`.lh-text-caption`, `.lh-text-eyebrow`, `.lh-text-metric`.

## 4. Primitives

All components are in `packages/ui`, exported from the package root
(`@likehoney/ui`). Interactive components are client components; presentational
and layout components are server-compatible. Class names are prefixed `lh-` and
live in the shared stylesheet.

- **Button** — `variant` (primary / secondary / subtle / ghost / danger),
  `size` (sm / md / lg), `block`, `loading` (shows built-in spinner),
  `disabled`.
- **IconButton** — square, `variant` (default / soft / plain), `size`; requires
  an accessible `label`.
- **Field / Input / Textarea** — labeled form groups with `hint`, `error`
  (role="alert"), and `invalid` for the input border.
- **Checkbox / Radio / Switch** — custom, keyboard-accessible controls drawn
  with logical properties; the switch thumb slides direction-aware.
- **Badge** — `tone` (neutral / honey / success / warning / danger / info /
  outline) and optional `dot`.
- **Card** — `interactive`, `accent` (honey top rule), `flush` (media),
  `pad`.
- **Divider** — hairline or `label` version.
- **Surface** — padded container for panels.
- **Skeleton / Spinner** — loading affordances.
- **EmptyState** — icon + title + text + action.

## 5. Layout

- **Container** — `size` sm/md/lg; responsive inline padding.
- **Section** — vertical rhythm `size` xs/sm/md/lg.
- **Stack** (vertical), **Inline** (single-line horizontal), **Cluster**
  (wrapping horizontal), **Grid** — `gap` from the spacing scale; Grid takes
  explicit `columns` or `fluid` + `minWidth` for auto-fit responsive grids.
  Fixed-column grids collapse to a single column below 44rem.

## 6. RTL / LTR

Arabic (`dir="rtl"`) is the default. Logical properties make every primitive
mirror automatically. The design lab toggles direction and language at runtime
to verify both. Directional icons in product code should be flipped with the
`rtl:rotate-180` utility or a logical icon strategy.

## 7. Admin vs storefront differences

- **Storefront** — warm light theme for family/parents, feature-radius on key
  hero/banner composition, generous whitespace, honey accent on actions,
  eyebrow + display headline hero. Products/categories are children's retail
  (clothing, shoes, bags, school, toys, baby, gifts).
- **Admin** — dark theme, tighter density, compact controls, status badges,
  tabular metrics, KPI cards, list panels. Honey is reserved for active nav and
  key highlights; status colors carry most information. Sample data reflects
  the real business: kids' product SKUs, retail orders, stock levels.
- Both share the same token set and primitives; only the theme scope class and
  density differ.

## 7b. Product language (this document is not a style guide change — it guards intent)

- Never depict honey jars, honeycomb, honey spoons, or food imagery as products,
  categories, hero art, or promo backgrounds.
- Synthetic preview data belongs to children's retail categories only and is
  labelled as synthetic (`productsSyntheticNote` in the lab).
- Bee assets may appear in selective storytelling/loading/empty-state moments
  only (hero mascot, story band). Assets that visually read as honey products
  (e.g. `honey/honey-drop.png`) stay in `design-reference` as brand decoration
  and are not used as storefront merchandise.

## 8. Design lab

Internal routes (client-shell with live RTL/LTR + AR/EN toggling):

| Route                  | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `/__design/storefront` | Hero, palette, typography, buttons, forms, product cards, states |
| `/__design/admin`      | Sidebar, search, KPIs, orders list, stock watch, empty states    |

Routing note: Next.js treats any folder starting with `_` as private and
excludes it from routing, so the lab folders live at `apps/web/src/app/lab/`
and `/__design/*` is exposed as a canonical alias via `rewrites` in
`apps/web/next.config.ts`.

The lab uses synthetic data only and is explicitly labeled as an internal
preview. It is the validation surface for new primitives and token changes.

## 9. Usage rules

- Import `@likehoney/ui/styles.css` once; do not re-import per component.
- Consume tokens through components or `.lh-*` classes — avoid raw hex in
  product code.
- Add new tokens/primitives here first, then prove them in the lab before
  product surfaces use them.
- Keep the stylesheet self-contained; the Next.js app may opt into Tailwind
  utilities through the `@theme inline` bridge in `apps/web/src/app/globals.css`
  for lab dressing only.
