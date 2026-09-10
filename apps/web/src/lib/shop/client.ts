/**
 * Typed client for the public (guest) storefront API.
 *
 * All requests travel through the same-origin rewrite (`/api/v1/public/…`) in
 * `next.config.ts` — the browser never talks to the Worker cross-origin and the
 * public endpoints need no identity header. Navigation pages fetch on the
 * server (Server Components); interactive surfaces (cart, checkout) reuse the
 * same client from the browser.
 *
 * Response shapes mirror the documents returned by `apps/api` services
 * (verified against the live dev worker), and all the monetary values are the
 * authoritative integer minor units returned by the backend — never trued up
 * from client math during checkout.
 */
export interface PublicCategoryDoc {
  id: string
  code: string
  slug: string
  nameAr: string
  nameEn: string
  /** Public stream URL of the category display image (`/api/v1/public/media/stream`). */
  imageUrl: string | null
  /** Safe icon key from the approved registry (e.g. "shirt", "camera"); null = none chosen. */
  iconKey: string | null
  /** Storefront display mode: auto | image | icon. */
  visualMode: 'auto' | 'image' | 'icon'
}

export interface PublicDeliveryZoneDoc {
  id: string
  nameAr: string
  nameEn: string
  feeMinor: number
}

export interface PublicProductListItem {
  id: string
  sequence: number
  nameAr: string
  nameEn: string
  shortBlurbAr: string | null
  shortBlurbEn: string | null
  status: 'active'
  category: { id: string; code: string; slug: string; nameAr: string; nameEn: string } | null
  priceFromMinor: number
  priceToMinor: number
  inStock: boolean
  imageUrl: string | null
  /** True when the product needs an option choice before adding to cart. */
  hasOptions: boolean
  /** Present only for a genuinely single-variant product — safe to quick-add. */
  singleVariantId: string | null
}

export interface PublicProductDetail {
  id: string
  sequence: number
  nameAr: string
  nameEn: string
  descriptionAr: string | null
  descriptionEn: string | null
  shortBlurbAr: string | null
  shortBlurbEn: string | null
  status: 'active'
  category: { id: string; code: string; slug: string; nameAr: string; nameEn: string } | null
  priceFromMinor: number
  priceToMinor: number
  options: {
    id: string
    nameAr: string
    nameEn: string
    values: { id: string; code: string; valueAr: string; valueEn: string }[]
  }[]
  variants: {
    id: string
    sku: string
    priceMinor: number
    optionLabelAr: string | null
    optionLabelEn: string | null
    optionValueIds: string[]
    quantityOnHand: number
  }[]
  media: {
    id: string
    mediaType: 'image' | 'video'
    url: string
    altAr: string | null
    altEn: string | null
    isPrimary: boolean
  }[]
}

/** One line of the authoritative quote (`POST /cart/verify`). */
export interface QuoteLine {
  variantId: string
  productId: string
  sku: string
  productNameAr: string
  productNameEn: string
  variantLabelAr: string | null
  variantLabelEn: string | null
  unitPriceMinor: number
  quantity: number
  lineTotalMinor: number
  /** Current physical availability for this line (informational). */
  availableQuantity: number
  inStock: boolean
}

/**
 * The authoritative commercial quote. Requires a real `deliveryZoneId` —
 * there is no zone-less variant of this endpoint. `quoteFingerprint` must be
 * echoed back unchanged at `createOrder`; `paymentMethods` is ACTUAL current
 * availability, never a saved preference.
 */
export interface QuoteResponse {
  lines: QuoteLine[]
  subtotalMinor: number
  deliveryFeeMinor: number
  totalMinor: number
  currency: string
  deliveryZone: { id: string; code: string; nameAr: string; nameEn: string; feeMinor: number }
  paymentMethods: { cod: boolean; electronic: boolean }
  quoteFingerprint: string
  quotedAt: string
}

export type PaymentMethod = 'cod' | 'electronic'

export interface CheckoutInput {
  /** A NEW random key whenever cart/quantities/zone/payment method/contact change. */
  idempotencyKey: string
  /** The `quoteFingerprint` from the most recently confirmed `/cart/verify`. */
  quoteFingerprint: string
  paymentMethod: PaymentMethod
  deliveryZoneId: string
  customer: {
    name: string
    phone: string
    city?: string
    addressLine1: string
    addressLine2?: string
    note?: string
    consentToStoreData: boolean
  }
  lines: { variantId: string; quantity: number }[]
}

/** `POST /orders` response when `paymentMethod: 'cod'`. */
export interface CodOrderResult {
  orderId: string
  number: string
  status: string
  paymentMethod: 'cod'
  paymentStatus: string
  items: {
    sku: string
    productNameAr: string
    productNameEn: string
    quantity: number
    lineTotalMinor: number
  }[]
  subtotalMinor: number
  deliveryFeeMinor: number
  totalMinor: number
  currency: string
  totals: { subtotal: string; deliveryFee: string; total: string; currency: string }
}

/**
 * `POST /orders` response when `paymentMethod: 'electronic'` — provider-
 * agnostic. `state` is the one truth to render from; `redirectUrl` is present
 * only when the provider needs a continuation step. Never infer "paid" from
 * anything but `state === 'paid'`.
 */
export interface ElectronicOrderResult {
  orderId: string
  number: string
  status: string
  paymentMethod: 'electronic'
  paymentStatus: string
  state: 'pending' | 'paid' | 'reconciliation_pending' | 'attempt_failed' | 'attempt_expired'
  redirectUrl?: string
  totalMinor: number
  currency: string
}

export type OrderResult = CodOrderResult | ElectronicOrderResult

/** One approved store review, exactly as the public endpoint returns it —
 *  nothing private (no phone, customer id, moderation fields). */
export interface PublicReviewDoc {
  id: string
  displayName: string
  rating: number
  reviewText: string
  verifiedPurchase: boolean
  createdAt: string
}

export interface PublicReviewListResponse {
  data: PublicReviewDoc[]
  summary: { count: number; average: number | null }
}

export interface ReviewSubmitInput {
  displayName: string
  rating: number
  reviewText: string
  /** Optional verification helpers — never shown publicly (§30/§31). */
  phone?: string
  orderReference?: string
}

export interface PublicOrderDoc {
  id: string
  number: string
  status: string
  paymentMethod: PaymentMethod
  paymentStatus: string
  subtotalMinor: number
  deliveryFeeMinor: number
  totalMinor: number
  currency: string
  createdAt: string
  items: {
    sku: string
    productNameAr: string
    productNameEn: string
    quantity: number
    lineTotalMinor: number
  }[]
}

/** One logical checkout submission's key — regenerate whenever intent changes. */
export function newIdempotencyKey(): string {
  return `lh-${crypto.randomUUID()}`
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Base path for public API calls.
 *
 * The storefront rides the same-origin rewrite (`/api/v1/public/…` in
 * `next.config.ts`), so the browser never talks to the Worker cross-origin and
 * never needs CORS. All storefront data surfaces are Client Components that
 * fetch from the browser through this path.
 */
const API_BASE = '/api/v1/public'

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'network_error', 'network error')
  }

  const text = await response.text()
  let body: unknown = null
  try {
    body = text.length > 0 ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!response.ok) {
    const errorBody = (body ?? {}) as ApiErrorBody
    const code = errorBody.error?.code ?? HttpCodeMapping[response.status] ?? 'unknown_error'
    const message = errorBody.error?.message ?? `HTTP ${response.status}`
    throw new ApiError(response.status, code, message, errorBody.error?.details)
  }

  return body as T
}

const HttpCodeMapping: Partial<Record<number, string>> = {
  400: 'bad_request',
  404: 'not_found',
  409: 'insufficient_stock',
  422: 'unprocessable',
  500: 'internal_error',
  503: 'checkout_unavailable',
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const qs = search.toString()
  return qs.length > 0 ? `?${qs}` : ''
}

let pendingCategories: Promise<{ data: PublicCategoryDoc[] }> | null = null

export const shopClient = {
  listProducts(
    query: { page?: number; pageSize?: number; categorySlug?: string; search?: string } = {},
    signal?: AbortSignal,
  ) {
    return apiRequest<{
      data: PublicProductListItem[]
      meta: { page: number; pageSize: number; total: number }
    }>(`/products${queryString(query)}`, signal ? { signal } : {})
  },
  getProduct(productId: string) {
    return apiRequest<PublicProductDetail>(`/products/${productId}`)
  },
  listCategories() {
    // Coalesce concurrent storefront consumers without caching mutable catalog data.
    pendingCategories ??= apiRequest<{ data: PublicCategoryDoc[] }>('/categories').finally(() => {
      pendingCategories = null
    })
    return pendingCategories
  },
  listDeliveryZones() {
    return apiRequest<{ data: PublicDeliveryZoneDoc[] }>('/delivery-zones')
  },
  /** `deliveryZoneId` is REQUIRED by the backend contract — there is no
   *  zone-less quote. The Cart page (no zone chosen yet) uses the first
   *  active zone purely as quote context and shows only the subtotal;
   *  Checkout uses the customer's actual chosen zone. */
  verifyCart(deliveryZoneId: string, lines: { variantId: string; quantity: number }[]) {
    return apiRequest<QuoteResponse>('/cart/verify', {
      method: 'POST',
      body: JSON.stringify({ deliveryZoneId, lines }),
    })
  },
  createOrder(input: CheckoutInput) {
    return apiRequest<OrderResult>('/orders', { method: 'POST', body: JSON.stringify(input) })
  },
  getOrder(number: string) {
    return apiRequest<PublicOrderDoc>(`/orders/${encodeURIComponent(number)}`)
  },
  /** Approved store reviews + an approved-only count/average summary. */
  listReviews(limit = 12) {
    return apiRequest<PublicReviewListResponse>(`/reviews${queryString({ limit })}`)
  },
  /** Submit a review. It is ALWAYS held for moderation — the response is
   *  generic (`{ id, status: 'pending' }`) and never confirms verification. */
  submitReview(input: ReviewSubmitInput) {
    return apiRequest<{ id: string; status: 'pending' }>('/reviews', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
}

let pendingZones: ReturnType<typeof shopClient.listDeliveryZones> | null = null

/**
 * Canonical storefront subtotal quote. `/cart/verify` requires a real
 * `deliveryZoneId` (there is no zone-less quote), so the first active zone is
 * used purely as quote context — only `subtotalMinor` (and per-line truth) is
 * meaningful to callers who haven't picked a zone yet. Shared by the Cart page
 * and the cart dock so the substotal always comes from the same server path.
 */
export async function quoteAgainstAnyZone(
  lines: {
    variantId: string
    quantity: number
  }[],
): Promise<QuoteResponse> {
  if (lines.length === 0) throw new ApiError(0, 'empty_cart', 'cart is empty')
  pendingZones ??= shopClient.listDeliveryZones().finally(() => {
    pendingZones = null
  })
  const zones = await pendingZones
  const zoneId = zones.data[0]?.id
  if (!zoneId) throw new ApiError(0, 'checkout_unavailable', 'no delivery zone configured')
  return shopClient.verifyCart(zoneId, lines)
}

/** Formats integer ILS minor units as a bare amount string (e.g. `149.00`). */
export function formatILS(minor: number): string {
  return (minor / 100).toFixed(2)
}

/**
 * Canonical customer-facing money formatter for the public storefront.
 * DISPLAY ONLY — the currency code stays `ILS` everywhere (storage, APIs,
 * calculations, snapshots are untouched).
 *
 * Arabic: the shekel symbol `₪` as a prefix (`₪149.00`), preceded by a
 * left-to-right mark (U+200E) so the symbol + amount stay one LTR token when
 * placed inside RTL text — no trailing symbol, no stray spacing, no legacy
 * abbreviation. English: the existing approved `149.00 NIS` form.
 */
export function formatMoney(minor: number, lang: 'ar' | 'en'): string {
  const amount = formatILS(minor)
  return lang === 'ar' ? `\u200e₪${amount}` : `${amount} NIS`
}

export const i18n = {
  money: (minor: number) => formatILS(minor),
}
