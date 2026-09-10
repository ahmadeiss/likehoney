# Production catalog seed reconciliation — 2026-09-09

This report explains how the production seed reconciliation tooling was corrected
so the single partially-landed seed product can be identified, the partial write
can be completed or repaired safely, and reruns never drift or duplicate. No
production data was changed and no production reserves are needed to use this
report. The tooling itself is read-only audit plus a guarded write path that is
fail-closed in any environment without production credentials.

## A. Active partial product identity

The product that exists without its planned full row-set is deterministic:

| Field                 | Value                                                          |
| --------------------- | -------------------------------------------------------------- |
| `id`                  | `6f8137c5-f158-5d6f-9794-9def0039183c`                         |
| Seed                  | `#002` (ordinal `1`, `SEED_START_ORDINAL`)                     |
| Catalog name          | Boys' Cotton Crew T-Shirt (category Clothing — Kids)           |
| Skipped SKU           | one planned variant was not inserted                           |
| Skipped movement type | `INITIAL_STOCK` / "Initial stock from Like Honey catalog seed" |

The id is not random: it is `uuidv5` over `product:{ordinal}`. Verified offline —
`seededProductId(1)` reproduces `6f8137c5-f158-5d6f-9794-9def0039183c` exactly.
That reproducibility is what makes identification possible without any live
network access: any seed product id is computed, never looked up.

## B. What the partial write left behind

The seed transaction that created catalog #001 + seeds #002–#100 partially committed.
Per the snapshot and the reconcile logic:

- The product row for `6f8137c5…` exists (one variant + inventory movement landed).
- The other 98 planned seed products and their variants/movements did not land.
- A `product_media` DB row references `products/6f8137c5-f158-5d6f-9794-9def0039183c/…png`,
  but that object is **not present in R2** — so the media association points at a
  missing object and the storefront would show that product without an image.
- The 98 remaining products are still absent; their positions `#003–#100` are free.

In reconcile terms the product is classified **partial**:
`found.variants=1 of 1` (their own single variant), but the far larger number of
variants/movements/media planned across the fixed 99-namespace are absent, so the
resume pass cannot treat it as complete until the remaining pieces land.

## C. Why the previous audit missed it

The old audit derived its plan _from the live product count_:

- It computed the remaining products as `98` and generated `generateSeedPlan`
  starting at `startIndex = currentCount` → position `#003…`.
- Position `#002` (the one product that actually landed) was **outside the expected
  set entirely**, so it was never examined and never reported.
- The old per-product status compared `db.products.count()` against the 99-target,
  hiding the single partial product inside "98 of 99" aggregate noise with no
  product-level detail.

Net effect: a partially-landed write reported as "98 of 99 present" while the
resume tail started at the wrong product, so the partial product would be silently
skipped forever and its missing R2 object never repaired.

## D. Stable-namespace strategy

- `SEED_START_ORDINAL = 1`, `SEED_COUNT = PRODUCTION_CATALOG_TARGET - SEED_START_ORDINAL = 99`.
- The full seed plan is **always** the fixed `#002–#100` namespace — never the
  count remainder. `fullSeedPlan()` is deterministic and immutable across calls.
- Product/variant/media ids derive from `uuidv5`, so the same seed always maps to
  the same rows on every run (idempotent reruns, no duplicates).
- The write path refuses to run into an **empty** catalog (`productCount === 0`);
  the namespace assumes catalog `#001` already owns the storefront product.

Because the namespace never shifts, "resume" is a reliable set of fixed positions.
The reconcile also refuses to _target the missing products_ — the previous 98-tail
bug is covered by a regression test.

## E. Corrected Neon transaction structure

`@neondatabase/serverless` `transaction()` requires an **array whose elements are
already `sql.query(...)` results** (the Neon `NeonQueryPromise`). Wrapping the
queries in an `async` callback yields native Promises that the library rejects
("transaction() expects an array of queries…").

Fix:

- `toTransactionQueries({ statements, query })` maps each statement (in FK-safe
  order) through a **non-async** `query` helper that returns `sql.query(sql.sql,
sql.params)` directly → a plain array of Neon query objects.
- Regression test proves the write path passes this plain array to
  `sql.transaction(...)` and that a bare async callback is not produced.

## F. Resume / repair semantics

Each planned seed product is opened against its DB rows (products, variants,
movements, media) _and_ the R2 key listing, then handled:

| DB media row | R2 object   | Action (marker)                                                        |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| exists       | present     | no-op — already complete (`·`)                                         |
| exists       | **missing** | re-upload object to the **existing** key (`↻` repaired)                |
| absent       | —           | upload new `products/<id>/<uuid>.png` + insert media row (`✔` created) |

Rollback deletes the uploaded object only for **brand-new** keys (`uploaded &&
insertMedia`); existing keys are never deleted. R2 media ledger + bucket listing
are fetched once before the write loop, and any failure there is fail-closed — no
DB writes happen. The loop tallies `created / repaired / ready / skipped` and the
run completes with a verified integrity pass.

## G. New audit output (read-only)

The CLI `--audit` now prints a deterministic READ-ONLY report, e.g.:

```
Catalog seed audit (READ-ONLY — no writes were made or attempted)
  Current production product count: 1
  Full seed target: 99 products (#002–#100)
  Seeded products found: 1 of 99
  Seeded products complete: 0
  Seeded products partial: 1
  Seeded products missing: 98
  Seeded variants found: (…) planned …
  Seeded inventory movements found: (…) planned …
  Seeded media DB associations found: (…) planned …
  Seed product details:
    - #002 · 6f8137c5-f158-5d6f-9794-9def0039183c · Boys' Cotton Crew T-Shirt …
      state: partial — found 1/1 variants, …
      media DB: products/6f8137c5…/….png → R2 object present: NO (repair required)
  R2 connectivity: …
  Seeded R2 objects found: …
  Orphan R2 objects found: …
  Missing R2 objects referenced by DB: …
  Safe diagnosis: …
```

It names the exact partial product, its missing object key, and whether a repair
(`repaired`) or a creation (`created`) is needed — see
`packages/db/scripts/lib/production-audit.mjs`.

## H. Tests

- `packages/db` now runs **83 tests**, all green (`pnpm --filter @likehoney/db test`).
- New regressions cover:
  - the **stable namespace** (#002–#100) never shifting with live count;
  - `toTransactionQueries` returning a plain (non-async) array;
  - the CLI write path resolving the stable full namespace and matching a
    `sql.transaction(toTransactionQueries(…))` call;
  - reconcile classification (complete / partial / missing) incl. the partial
    product with a missing R2 object;
  - R2 endpoint canonical host, on-wire signed query (no double-encoding),
    connectivity failure surfaced as safe cause, fail-closed invalid config;
  - safe error walking + secret redaction (no connection strings/keys in messages).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` pass across the workspace.

## I. Confirmation: production writes = 0

No write path is reachable in this session:

- `--audit` **fails closed** at the env guard (`PRODUCTION_DATABASE_URL is
required`) and exits non-zero — the smoke run reproduced exactly that, exit 1,
  without touching Neon.
- The guarded write path additionally requires the explicit
  `CONFIRM_PRODUCTION_CATALOG_SEED` flag plus a production URL; none are present.

Nothing has been deployed and no production rows or objects were changed.

## J. How to run / next steps

```
pnpm --filter @likehoney/db db:seed:production-catalog --audit     # read-only, names the partial product + missing R2 key
pnpm --filter @likehoney/db db:seed:production-catalog --dry-run    # safe preview of the write plan
pnpm --filter @likehoney/db db:seed:production-catalog              # guarded write: requires CONFIRM + production URL
```

Run in an environment that has the production R2 credentials and database URL.
The audit alone repairs nothing; it is the operator's checklist. Completion of the
write (or a manual repair for `6f8137c5…`) is a separate, explicitly-approved
production change.
