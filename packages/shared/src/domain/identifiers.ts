/**
 * Human-readable business identifiers.
 *
 * Internal database identities are UUIDs and are never shown to customers.
 * Orders and store sales carry their own human-readable numbers; products
 * carry a sequence used to build SKUs (see `packages/shared/src/domain/sku.ts`).
 *
 * Formats (documented in docs/architecture/DATA_MODEL.md):
 * - order number:   LH-000001
 * - store-sale number: LH-POS-000001
 */

export const IDENTIFIER_PREFIX = 'LH'
export const IDENTIFIER_SEPARATOR = '-'
export const IDENTIFIER_DIGIT_WIDTH = 6

export const ORDER_NUMBER_PREFIX = `${IDENTIFIER_PREFIX}${IDENTIFIER_SEPARATOR}`
export const STORE_SALE_NUMBER_PREFIX = `${IDENTIFIER_PREFIX}${IDENTIFIER_SEPARATOR}POS${IDENTIFIER_SEPARATOR}`

/** Formats a contiguous sequence into a zero-padded human-readable number. */
export function formatHumanNumber(
  sequence: number,
  prefix: string,
  width: number = IDENTIFIER_DIGIT_WIDTH,
): string {
  return `${prefix}${String(sequence).padStart(width, '0')}`
}

/** e.g. `formatOrderNumber(1)` → `LH-000001`. */
export function formatOrderNumber(sequence: number): string {
  return formatHumanNumber(sequence, ORDER_NUMBER_PREFIX)
}

/** e.g. `formatStoreSaleNumber(1)` → `LH-POS-000001`. */
export function formatStoreSaleNumber(sequence: number): string {
  return formatHumanNumber(sequence, STORE_SALE_NUMBER_PREFIX)
}
