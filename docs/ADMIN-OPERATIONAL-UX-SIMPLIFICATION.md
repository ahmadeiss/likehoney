# Admin Operational UX Simplification

**Status:** Implemented & verified — 2026-09-03
**Scope driver:** User directive to simplify the entire Admin operational UX: Arabic-first,
human-language terminology and operational clarity across **all existing** Admin pages. No
visual redesign, no DB/backend/auth changes, no new pages built, no commerce feature
development.

---

## What changed

### 1. Humanized inventory movement dialog (shared component)

New reusable component `apps/web/src/app/admin/_components/stock-movement-dialog.tsx` used by
both the Inventory page and the Product detail page:

- Operators pick an **action** (add `زيادة` / subtract `نقص`) and a **reason** preset
  (arrived / correction / damaged / other) instead of raw enum names.
- Internal `movementTypeFor(mode, reasonKey)` maps these human actions to the existing,
  legitimate members of `MANUAL_MOVEMENT_TYPES` (`RESTOCK` / `DAMAGE` / `MANUAL_ADJUSTMENT`) —
  **no unsafe `as` casts**, compiler-verified.
- Hardcoded human reason strings (e.g. `وصلت بضاعة جديدة`, `تصحيح كمية`, `تلف / فقدان`).
- Guard rails: reason requires a positive quantity; subtract cannot exceed current on-hand.

### 2. Human-readable movement events

`apps/web/src/lib/admin/movements.ts` — `movementEventLabel()` converts a raw ledger enum
into store language (e.g. `RESTOCK` → `إضافة (ن قطع)`, `DAMAGE` → `تلف / فقدان (ن قطع)`,
`MANUAL_ADJUSTMENT` (negative) → `تصحيح يدوي (ن قطع)`). Enum values stay internal; operators
only ever see plain Arabic.

### 3. Page-level simplification

| Page                         | Change                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory                    | Replaced the local technical dialog with the shared `StockMovementDialog`. Ledger rows rendered via `movementEventLabel`; human reason shown beside the product code.  |
| Dashboard                    | Removed technical recent-activity table (SKU / movementType / quantityChange / quantityAfter), replaced with human event list using `movementEventLabel` + human date. |
| Categories                   | Removed `code` and `slug` columns from the primary table (kept list / status / actions).                                                                               |
| Product detail               | Swapped the technical dialog for `StockMovementDialog`; humanized the `MovementsDialog`; dropped `@likehoney/shared` import entirely.                                  |
| New product                  | SKU is auto-generated after creation (form text reinforces this); no invented pseudo-SKU exposure.                                                                     |
| Login (dev picker)           | Reworded labels via `auth.devAccount` / `auth.devHint`; auth logic untouched.                                                                                          |
| Suppliers / Staff / Settings | Reviewed — already human-first, no structural change required.                                                                                                         |

### 4. i18n dictionary

`apps/web/src/lib/admin/i18n.tsx` — humanized inventory/product/dashboard/dev-identity keys;
added `auth.devAccount` / `auth.devHint`. `inventory.movementType` is retained internally for
the technical ledger filter and is not shown to operators.

---

## Verification

### Static checks (all pass)

- `pnpm format` / `pnpm lint` — clean (one pre-existing `no-img-element` warning, unrelated).
- `pnpm --filter @likehoney/web typecheck` — passes, no `error TS`.
- `pnpm --filter @likehoney/db db:check` — passes.
- `pnpm build` — full `-r` build passes; 20/20 static pages; API wrangler dry-run OK.

### Browser verification (Playwright, dev identity)

All **16 checks PASS** (8 admin pages × AR-1440 + AR-390):

- Every admin page loads its data (HTTP 200) through the dev `X-Staff-Id` identity.
- **No console/page errors** and **no terminology leaks** on any page — scanner confirms the
  raw enum strings `RESTOCK`, `DAMAGE`, `MANUAL_ADJUSTMENT`, `STORE_SALE`, `ONLINE_ORDER` and
  `X-Staff-Id` do **not** appear in rendered text.
- Responsive at both desktop and 390px mobile widths.

Note on the verification method: the dev bootstrap intentionally calls `/api/v1/auth/me`,
which 401s (no real session in dev) and is the mechanism that switches the shell to dev
identity — this is expected and whitelisted in the test. Data endpoints authenticate via
`X-Staff-Id`.

---

## Findings outside current scope (logged for a later decision)

**Pre-existing API route-order collision:** on the Staff page, `GET /staff/roles` and
`GET /staff/permissions` return `400 "expected a valid UUID"` because the router registers
`GET /:id` (staff.ts line 100) **before** `GET /roles` (line 137) and `GET /permissions`
(line 171) — so those paths are captured by `/:id`. This is a backend routing bug, **not**
introduced by this UX pass and outside its scope; the Staff Roles/Permissions panels cannot
load until it is fixed (reorder/guard, e.g. register static route segments before `/:id`).

---

## Files touched

- `apps/web/src/app/admin/_components/stock-movement-dialog.tsx` (new)
- `apps/web/src/lib/admin/movements.ts` (new)
- `apps/web/src/lib/admin/i18n.tsx`
- `apps/web/src/app/admin/inventory/page.tsx`
- `apps/web/src/app/admin/page.tsx` (dashboard)
- `apps/web/src/app/admin/categories/page.tsx`
- `apps/web/src/app/admin/products/[productId]/page.tsx`
- `apps/web/src/app/admin/login/page.tsx`
