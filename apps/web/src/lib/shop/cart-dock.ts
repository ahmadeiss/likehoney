/**
 * Pure cart-dock decisions — kept framework-free so the visibility rule and the
 * unit label are unit-testable without a DOM.
 *
 * The dock is the persistent "browse with your cart" summary bar. It shows on
 * every storefront route while shopping except where the cart is the stage
 * itself (cart page), the final step (checkout), or the confirmation (success).
 * It stays visible on the product page, where it floats above the mobile
 * sticky buy bar instead of fighting it.
 */

export function shouldShowCartDock(pathname: string): boolean {
  if (pathname === '/shop/cart') return false
  if (pathname === '/shop/checkout') return false
  if (pathname.startsWith('/shop/checkout/')) return false
  return true
}

/** True on the product detail route (the PDP has its own mobile sticky bar). */
export function isProductDetailRoute(pathname: string): boolean {
  return pathname.startsWith('/shop/product/')
}

/** "قطعة" / "قطع" (or "item"/"items") — the units part of the dock summary. */
export function dockUnits(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}
