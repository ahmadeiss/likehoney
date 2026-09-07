# ADR 0001 — Commerce Gap Audit, Phase Sequencing & Cancellation-Verification Correction

| Section  | Detail                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status   | Accepted                                                                                                                                                                                                 |
| Date     | 2026-09-03                                                                                                                                                                                               |
| Decision | Lock in the commerce gap audit as the source of truth; adopt a fixed phase sequence for the missing commerce workflows; record that real order-cancellation stock restoration is **not** verified today. |

## Context

Like Honey is a children's retail store. V1 covers the existing Admin pages plus a public
storefront checkout. A precise audit of what already exists for **Orders**, **Store Sales**
and **Checkout** is needed before any further commerce feature work, so we do not rebuild
what exists and do not assume verified what is not.

The audit result (evidence-cited, files under `apps/api`, `apps/web`, `packages/db`,
`packages/shared`):

### Database — fully present for all three

- `orders` + `order_items` with immutable snapshots (`sku_snapshot`, name/sublabel/price
  snapshots), FKs (`cascade`/`restrict`), checks and indexes — `packages/db/src/schema/orders.ts`.
- `store_sales` + `store_sale_items` (same snapshot pattern, `LH-POS-######` numbers; no
  status/delivery/tax columns) — `packages/db/src/schema/store-sales.ts`.
- `customers` (guest model); ledger links `inventory_movements.order_id` / `.store_sale_id`.
- Enums: `order_status` = `processing / delivering / completed / cancelled`;
  `payment_status`; `inventory_movement_type` includes `STORE_SALE` and
  `ORDER_CANCELLATION_RESTORE`.

### Backend

- **Orders** — partial. No admin `routes/orders.ts`, no admin list/detail/status/cancel, no
  `orders:*` permission codes. Only the **public** checkout exists:
  `POST /public/orders` → `createCheckoutOrderService`, plus `POST /cart/verify` and
  `GET /orders/:number`. Atomic `deductStock` (`WHERE quantity_on_hand >= amount`) is real and
  correct. **No status-transition enforcement and no restore-on-cancel exist.**
- **Store Sales** — entirely absent at the backend: no route, no service, no repository, no
  `createSale`, no `STORE_SALE` write path. Schema only.

### Frontend

- **Admin**: no `/admin/orders`, no `/admin/store-sales`, no nav entries, no admin client
  methods.
- **Public storefront checkout is fully built**: catalog → product (add to cart) → cart →
  `checkout/page.tsx` (COD + delivery zones + consent) → `POST /orders` → `success/page.tsx`.
  `checkout:cod.enabled` is declared but not enforced.

### Tests / verification reality

- There are **zero committed test files** in the repo (no `.test`/`.spec`, no vitest/playwright).
- The earlier "successful commerce verification" was a **manual harness** (`commerce-verify.mjs`,
  kept outside the repo) that called the **real live HTTP routes** on port 8787, verifying
  server-authoritative pricing, tamper-ignoring, concurrent no-oversell (one `201` / one `409`),
  and an **atomic RESTOCK proxy** for rollback. It cleaned up to 0 orders / 0 products.

## Decision

1. **Gap audit is the source of truth.** No commerce feature exists beyond what the audit above
   records. Do not rebuild public checkout. Do not report any commerce workflow as present unless
   the audit lists it.

2. **Fix phase sequence for future commerce work** (each is a separately scoped phase; none
   starts automatically):
   1. **Employee Daily Operations — Store Sales** (highest business priority; the employee's
      most frequent daily operation).
   2. **Admin Orders** — operational workflow for website orders.
   3. **Owner Dashboard + Analytics** — deeper owner-management layer.
      Public checkout/order placement already exists and is not rebuilt.

3. **Correction — order cancellation is NOT verified.** The previous verification proved stock
   restoration only via an **atomic RESTOCK proxy/harness**, not a real Admin order-cancel
   transition. Therefore, when Admin Orders is implemented later, it MUST build and verify:
   - `processing / delivering → cancelled`
   - stock restored **transactionally**
   - restoration happens **exactly once**
   - **repeated cancellation cannot restore twice**
   - the inventory movement records `ORDER_CANCELLATION_RESTORE`
   - proper audit trail
   - forbidden invalid transitions are rejected

   We do **not** report cancellation restore as fully implemented today.

4. **Current pass (this decision's immediate scope):** the full terminology + operational-UX
   simplification across ALL **existing** Admin pages only (Create Product, Products
   list/search, Inventory, Dashboard, Categories, Suppliers, Staff, Settings, product detail,
   shared components). No missing pages are added in this pass. Backend/domain rigor is preserved.

## Consequences

- **Easier:** a clear, evidence-based map of commerce foundations; no duplicated checkout work;
  an honest statement of what cancellation does and does not verify.
- **Harder:** Store Sales has the least foundation (zero backend) despite being top priority, so
  that phase carries the most new backend work (repo + service + route + permissions + UI).
- Admin Orders can reuse the public checkout write path and the atomic `deductStock`/move
  primitives, but still needs new `orders:*` permissions, list/detail/status routes, and the
  transactional cancel + restore (which is new, integrity-critical logic).

## Alternatives

- **Build Store Sales now** — rejected this phase because it is the largest new-backend build and
  the user chose to do the plain UX simplification pass first, with each commerce phase scoped
  separately afterward.
- **Treat cancellation as verified** — rejected: only the RESTOCK proxy was verified, not a real
  Admin cancel transition.
