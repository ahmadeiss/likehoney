# Like Honey — Inventory Rules (V1)

> Permanent business constraint (AGENTS.md §10). Companion to
> [`DATA_MODEL.md`](./DATA_MODEL.md).

Inventory is **shared** between physical-store sales and online orders: one
stock pool per sellable variant. Every stock event is recorded in a single table
structure with two roles, defined explicitly below.

## 1. The model and its authority

- `inventory_balances` is the **authoritative current operational stock
  state**: `quantity_on_hand` per variant (a projection of stock is never
  stored elsewhere).
- `inventory_movements` is the **immutable audit ledger** explaining every
  change to a balance. Rows are never deleted or edited.
- The two are **not independent sources of truth**. Future services MUST write
  both in **one PostgreSQL transaction**: the balance update and its movement
  row commit or roll back together, so a crash mid-way rolls back the stock and
  the sale together.
- `quantity_change > 0` adds stock; `< 0` consumes; `0` is forbidden.
- `quantity_after` snapshots the resulting `quantity_on_hand` for audit.
- Movements link to their source when applicable: `ONLINE_ORDER` (via
  `order_id`), `STORE_SALE` (via `store_sale_id`), manual actions (via
  `staff_id`).

Database-enforced invariants (CHECK constraints):

- `quantity_on_hand >= 0`
- `quantity_change <> 0`
- `quantity_after >= 0`

## 2. The one hard rule

**Never** perform an unsafe _read → subtract in memory → write_ sequence.

All stock writes must be **atomic PostgreSQL operations**:

- A single `UPDATE ... SET quantity_on_hand = quantity_on_hand - $n WHERE
variant_id = $v AND quantity_on_hand >= $n` deduction statement — its row
  count (1 vs 0) is the oversell guard; or
- A properly designed transaction that acquires the balance row lock
  (`SELECT ... FOR UPDATE`) before any read-modify-write, keeping the write
  inside the same transaction.

Two orders (or an order + a store sale) in the same moment must **never** both
deduct the last unit. Only atomic SQL or transactional locking satisfies this.

## 3. When stock moves (V1 event map)

| Event                 | `movement_type`              | Balance effect                           |
| --------------------- | ---------------------------- | ---------------------------------------- |
| Initial stock booked  | `INITIAL_STOCK`              | `+qty` on-hand                           |
| Supplier restock      | `RESTOCK`                    | `+qty` on-hand                           |
| Online order placed   | `ONLINE_ORDER`               | `-qty` on-hand (atomic deduction)        |
| Order cancelled       | `ORDER_CANCELLATION_RESTORE` | `+qty` on-hand (atomic restoration)      |
| Store sale (register) | `STORE_SALE`                 | `-qty` on-hand                           |
| Returned goods        | `RETURN`                     | `+qty` on-hand                           |
| Damaged / lost        | `DAMAGE`                     | `-qty` on-hand                           |
| Manual correction     | `MANUAL_ADJUSTMENT`          | `+/-` on-hand (captured by staff action) |

## 4. Approved V1 behavior (no reservation)

V1 has **no stock reservation** state. Cart interactions never touch stock.
The only approved stock mutations are:

1. **Cart** → no stock mutation of any kind.
2. **Successful order submission** → atomic stock deduction (`ONLINE_ORDER`
   movement) inside the same transaction that creates the order and its items.
3. **Order cancellation** → atomic stock restoration
   (`ORDER_CANCELLATION_RESTORE` movement) inside the same transaction that
   updates the order status.

Stock reservation with expiration may be designed later **if and when**
electronic (non-COD) payment is formally approved — it is deliberately not
modeled today.

## 5. Concurrency & idempotency

- Online checkout deducts stock atomically at submission and forms the order in
  the same transaction. Never deduct twice for the same order: the movement row
  for that `order_id` is created once, inside the same commit.
- Store sales deduct stock atomically and record the movement; the sale row and
  its items commit in the same transaction.
- Cancellation restores stock once, idempotently (the transaction moves the
  order `processing → cancelled` exactly once and writes exactly one
  `ORDER_CANCELLATION_RESTORE`).
- All writes happen inside the backend service (`apps/api`), never the browser.

## 6. Human reconciliation

Because balances are authoritative but movements are append-only and linked,
physical-count differences are corrected with `MANUAL_ADJUSTMENT` movements
(never by freehand editing of balances). As a cross-check, the balance must
equal `SUM(quantity_change)` over all movements for the variant; this equation
is the daily reconciliation check — the ledger verifies the authoritative
balance but does not "own" it.

## 7. Overselling policy

`quantity_on_hand` must never go negative. The CHECK constraint catches
violations at the database level; the atomic deduct guards against the race
that produces them. Pre-orders (selling beyond on-hand) are **out of scope**
for V1.

## 8. Non-goals (V1)

- No multi-warehouse / per-location stock (single store + online, one pool).
- No stock reservation / expiration (see §4).
- No barcodes/scanning integration yet.
- No forecasting or replenishment automation.
