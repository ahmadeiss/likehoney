# Design Direction — Like Honey

> Phase 0 documents principles only. **No screens are designed in this phase.**
> These are the non-negotiable standards for every future UI decision.

## Business context

**Like Honey is a premium children's retail store** — clothing, shoes,
bags/backpacks, school supplies, toys, accessories, baby products and gifts —
not a honey, food, or agricultural business.

The **bee and honey identity is brand language only**: a restrained gold accent,
a selectively used mascot, and subtle geometric motifs. It must never present
honey jars, honeycomb, or food imagery as storefront merchandise, categories,
hero art, or product photography. The visual focus is the merchandise and the
child/family lifestyle it serves.

> This statement is normative for every future UI decision; it is repeated
> prominently in `AGENTS.md` (CRITICAL BUSINESS CONTEXT).

## Positioning

- Premium, custom **children's retail** experience for parents and families —
  warm, modern, energetic, trust-building; premium, never childish or cartoonish.
- **Arabic-first**, English secondary.
- Sophisticated rather than childish; a honey/gold visual language used
  carefully, never cartoonishly.
- Cinematic moments may be used **selectively** to elevate key experiences.
- The customer storefront should feel **warm and premium**; the administration
  experience should feel **precise, dark/elegant, and operational**.

## Mandatory principles

- Strong responsive behavior; **mobile receives dedicated art direction**.
- **Accessibility and readability are mandatory**, never negotiable.
- Animations must support usability and perceived quality — never fight it.
- No excessive glassmorphism.
- No generic SaaS template appearance.
- No obvious AI-generated layout patterns.
- No hard-coded directional CSS assumptions: the future design system must
  provide **direction-aware components** (RTL for Arabic, LTR for English).

## Design system

A custom design system lives in `packages/ui` and will provide typography,
buttons, form controls, cards, dialogs, tables, layout and feedback primitives.
Generic component libraries (shadcn, Material UI, Ant Design, etc.) are **not**
used — the Like Honey design language is built in-house on a brand-specific
token system.

## Reference assets

Visual reference images, when present, live under `design-reference/concepts`
(mood/concept boards) and `design-reference/brand` (brand assets that may
eventually be used by the application). They are reference material, not
production assets.

## Status — Phase 1 (corrected)

The concrete system that implements these principles lives in
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) (`packages/ui`), validated by the
internal design lab at `/__design/storefront` and `/__design/admin`.

The lab's synthetic data uses realistic children's retail categories and
products (kids' clothing, shoes, bags, school supplies, toys, baby products,
gifts). Honey imagery is never used as merchandise.

Classified brand assets are organised under `design-reference/brand`
(`logo/`, `bee/`, `honey/`) with mirror copies for the app in
`apps/web/public/brand/`. The bee and honey assets are **brand decoration /
storytelling** only: the bee mascot may appear in selective moments; assets
that read as honey products (e.g. honey jar/drop art) are not used as
merchandise. Originals are never deleted — they are the supplied brand
identity, not the store's product range.
