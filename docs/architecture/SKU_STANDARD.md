# Like Honey — SKU Standard (V1)

> Internal control document. Referenced by
> [`DATA_MODEL.md`](./DATA_MODEL.md) and enforced at the database layer by a
> CHECK constraint on `product_variants.sku`.

## 1. What a SKU is

A SKU (Stock Keeping Unit) is Like Honey's **internal inventory identifier**
for a sellable variant. It is used on the shop floor, in order and store-sale
recording, in inventory movements, in search and on labels.

A Like Honey SKU is **not** a GS1 / EAN / UPC barcode, is not registered with
any standards body, and must never be presented to customers or suppliers as
one. If barcodes are ever printed, the SKU is the payload content — the format
is ours.

## 2. Format

```
LH-{CATEGORY_CODE}-{PRODUCT_SEQUENCE}-{VARIANT_SUFFIX}
│  │                │                 └ Default variant: DEF
│  │                │                   Multi-option: PNK-30, GRN-XXL
│  │                └ 6-digit zero-padded products.sequence (identity)
│  └ Uppercase ASCII category code (1–8 chars), fallback GEN
└ Reserved brand segment
```

Examples:

| Variant                 | SKU                    |
| ----------------------- | ---------------------- |
| Ballet flats 2026, Pink | `LH-SHO-000123-PNK`    |
| Pink / Size 30          | `LH-SHO-000123-PNK-30` |
| Green / Size 3T         | `LH-CLT-000094-GRN-3T` |
| Backpack (no options)   | `LH-BAG-000156-DEF`    |
| No category assigned    | `LH-GEN-000158-DEF`    |

## 3. Grammar and limits

| Rule              | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| Total length      | ≤ 32 chars (barcode/label friendly)                          |
| Characters        | `A-Z`, `0-9`, hyphen only                                    |
| Segment regex     | `^[A-Z0-9]{1,8}$` (category code, each suffix segment)       |
| Product sequence  | 6 digits, zero-padded, from `products.sequence`              |
| Variant suffix    | `DEF`, or hyphen-joined option-value codes                   |
| Full-format regex | `^LH-[A-Z0-9]{1,8}-[0-9]{6}-[A-Z0-9]{1,8}(-[A-Z0-9]{1,8})*$` |

The same grammar is mirrored in
`packages/shared/src/domain/sku.ts` (`buildSku`, `buildVariantSuffix`,
`isValidSku`) and in a database CHECK constraint, so invalid SKUs cannot be
inserted by any path.

## 4. Option-value codes

Each `product_option_values.code` is the short uppercase ASCII segment used in
the suffix (e.g. `PNK` for "Pink", `30` for size 30). Codes are set once when
an option value is created and are unique per option (`option_id + code`).
Display labels (`value_en` / `value_ar`) may change; **codes must not**.

Default suffix `DEF` is reserved for the automatically created single variant
of products without options — no option value may use `DEF`.

## 5. Generation rules (service contract)

1. On product creation the database assigns `products.sequence`; the service
   reads it back via `RETURNING`.
2. The default (or first) variant's SKU is built with `buildSku(...)` and
   persisted **before the variant can become `active`**.
3. Multi-option products generate one variant per unique combination; each
   variant's suffix is built from its option-value codes in option display
   order.
4. Category with no SKU-ready code (or product with no category) uses `GEN`.

## 6. Immutability policy

Once a SKU has been used by any transactional record — an `order_items` or
`store_sale_items` snapshot, an `inventory_movements` row, or a printed label —
it is **permanently immutable**:

- The SKU is re-printed on every item snapshot; changing it would detach new
  history from old history.
- `product_variants.sku` is database-unique; reuse after change is forbidden.
- A variant should be end-of-lifed via `inactive`/`archived` status **rather
  than** reassigned.

There is no UI or lock column dedicated to SKU editing in V1; the business rule
above is the invariant services must enforce. This policy is intentionally
simple: SKUs are derived from category code + immutable product sequence +
option-value codes, so they are already collision- and drift-resistant.

## 7. Display and privacy

SKUs are shown in back-office screens, on recceipts/store documents and on
shipping internal labels. Public storefront pages need not show SKUs, but may
(they contain no personal data).
