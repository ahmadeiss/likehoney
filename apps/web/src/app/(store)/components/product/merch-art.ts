/**
 * Local merchandising artwork fallback, keyed by real category code.
 *
 * Real R2 media always wins (a product's own `imageUrl`). For products with
 * no photography yet, a known category illustration from `public/brand/merch`
 * stands in — a warm, credible stand-in that never implies a honey product.
 * Codes we do not have artwork for fall through to the neutral empty stage
 * (`null`), never to a fake photo and never to the bee.
 */

export const CATEGORY_MERCH: Readonly<Record<string, string>> = {
  shoes: '/brand/merch/girl-shoes.png',
  bags: '/brand/merch/boy-bag.png',
}

export function merchForCategory(code: string | null | undefined): string | null {
  if (!code) return null
  return CATEGORY_MERCH[code] ?? null
}
