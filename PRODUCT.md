# Product

## Register

product

## Users

**Owner / Admin (User A).** A Palestinian shop owner who frequently manages the
store remotely from Germany. Comes to the Admin to understand how the store is
doing, see what needs a decision (low stock, out-of-stock, suppliers to
coordinate with), and occasionally manage staff and settings. Wants a calm,
scannable overview first, with the ability to drill down. Reads Arabic first.

**Store employee (User B).** Works on the ground in the shop in Palestine. Comes
to the Admin to get daily work done with minimal friction: find a product fast,
check and adjust stock, receive new merchandise, record damage/corrections, add
products. Executive dashboards and analytics are noise for this person. Often on
a phone or a small screen. Reads Arabic first.

The two roles must not land on the same experience. Role is derived from
**permissions** (an account that can manage staff, settings, or view reports is
treated as an owner), never from a hardcoded identity.

## Product Purpose

The Like Honey Admin is the operational console for a real bilingual
(Arabic-first) children's retail business. It manages the catalog (products,
categories, suppliers, variants, media), the shared inventory ledger, staff and
role-based access, and store settings. Success is when the owner opens it and
within seconds knows what needs attention, and when an employee opens it and
immediately knows what to do next — both without wading through generic
back-office chrome.

Order management, in-store point-of-sale, and sales analytics are on the roadmap
but not yet backed by the API. The Admin must present those areas honestly (clear
"coming soon" states) and never fabricate figures.

## Brand Personality

Calm, premium, operational. Three words: **composed, precise, warm**. The
interface should feel purpose-built for this one shop — like a tool a product
team designed for a specific retail business, not a template. It speaks plain
store Arabic ("وصلت بضاعة جديدة", "تلف / فقدان"), never exposes raw enums, SKanui
internals, or permission codes as primary UI. Confident and quiet: quality comes
from alignment, rhythm, and restraint, not effects.

## Anti-references

- Generic shadcn/Tailwind starter dashboards — white card grid, one accent, KPI
  row on top, table in every card.
- ERP / spreadsheet-with-styling density without hierarchy.
- SaaS analytics templates — rainbow charts, decorative doughnuts, hero metric
  with gradient accent.
- AI-admin tells: a big empty beige canvas with a small floating content column,
  a tiny uppercase tracked eyebrow over every section, numbered square badges as
  the primary visual language on forms, identical bordered-white cards repeated
  down the page.
- Faked fullness — hardcoded sample numbers to make a screen look alive. Zero is
  acceptable and must still look composed.

## Design Principles

1. **Role first.** The owner sees a decision surface (what's happening, what
   needs attention). The employee sees an action surface (do the task). Same data
   model, deliberately different front doors.
2. **Attention over inventory-dump.** Lead with "what is low / out / needs a
   decision", not "here is the full ledger". The ledger is available, not the
   headline.
3. **Plain store language.** Every operator-facing string is human Arabic.
   Enums, SKUs, UUIDs, and permission codes stay internal or behind a "technical
   details" disclosure.
4. **Honest emptiness.** Fresh data and unbuilt features look intentional:
   ₪0 / 0 orders / "قريبًا", with a clear next step — never a blank table filling
   the screen, never invented metrics.
5. **Earn every surface.** Tables only when a table is the best affordance;
   otherwise list modules, split panels, stat strips, timelines. No nested cards.
   Use the viewport — composed and centered on desktop, dense where data earns
   it, single-column and touch-first on mobile.

## Accessibility & Inclusion

- Arabic-first RTL by construction (CSS logical properties throughout); English
  LTR fully supported. Test both directions.
- WCAG 2.1 AA: body text ≥ 4.5:1, large text / UI ≥ 3:1, visible focus rings on
  every interactive element, real `:focus-visible` states.
- Status is never carried by color alone — pair with a label, icon, or dot.
- Touch targets ≥ 40px on the employee/mobile surfaces.
- Honor `prefers-reduced-motion` (the design system already does); motion is
  state feedback only — hover, press, drawer, save confirmation.
- Test breakpoints 390 / 768 / 1024 / 1440 / large desktop; responsive behavior
  is structural (collapse rail, swap table→cards), not fluid type.
