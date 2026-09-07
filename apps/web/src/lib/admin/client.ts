/**
 * Typed client for the Like Honey API, used only by the Admin area.
 *
 * Requests travel through the same-origin rewrite (`/api/v1/…`) defined in
 * `next.config.ts`, so the browser never talks to the Worker cross-origin and
 * never needs CORS. The active development identity is resolved synchronously
 * from `identity-store` at request time and injected as `X-Staff-Id`.
 * (DEVELOPMENT-ONLY: production staff authentication is intentionally not
 * implemented.)
 *
 * No zod runtime is imported — the response shapes below are the exact
 * documents returned by `apps/api` services (verified against the dev worker).
 */
import {
  MANUAL_MOVEMENT_TYPES,
  type AdminOrderCommandResult,
  type AdminOrderDetail,
  type AdminOrderListResponse,
  type AdminOrderStockReturnReceipt,
  type AdminOrderTimelineEntry,
  type AdminReviewDetail,
  type AdminReviewListItem,
  type AdminReviewListResponse,
  type OrderCancelInput,
  type OrderStockReturnRequest,
  type PaymentSettingsReadModel,
  type ProductReadiness,
  type CoveredMargin,
  type ReportPeriod,
  type ReportsBreakdown,
  type ReportsCustomers,
  type ReportsOverview,
  type ReportsProducts,
  type ReportsRegions,
  type ReportsSupplierDrilldown,
  type ReportsSales,
  type Sellability,
} from '@likehoney/shared'

import { getCurrentStaffId } from './identity-store'
import { bumpCatalog, bumpOrders } from './revalidate'

export type {
  AdminOrderCommandResult,
  AdminOrderDetail,
  AdminOrderListResponse,
  AdminOrderStockReturnReceipt,
  AdminOrderTimelineEntry,
  AdminReviewDetail,
  AdminReviewListItem,
  AdminReviewListResponse,
  OrderCancelInput,
  OrderStockReturnRequest,
  PaymentSettingsReadModel,
  ProductReadiness,
  CoveredMargin,
  ReportPeriod,
  ReportsBreakdown,
  ReportsCustomers,
  ReportsOverview,
  ReportsProducts,
  ReportsRegions,
  ReportsSupplierDrilldown,
  ReportsSales,
  Sellability,
}

export type AdminOrderListItem = AdminOrderListResponse['items'][number]

// ---------------------------------------------------------------------------
// Response documents
// ---------------------------------------------------------------------------

export interface PageMeta {
  page: number
  pageSize: number
  total: number
}

export interface Paged<T> {
  data: T[]
  meta: PageMeta
}

export interface CategoryDoc {
  id: string
  code: string
  slug: string
  nameEn: string
  nameAr: string
  descriptionEn: string | null
  descriptionAr: string | null
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

export interface SupplierDoc {
  id: string
  nameAr: string
  nameEn: string | null
  contactName: string | null
  contactPhone: string | null
  address: string | null
  notes: string | null
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

export type ProductStatus = 'draft' | 'active' | 'inactive' | 'archived'
export type VariantStatus = 'draft' | 'active' | 'inactive'
export type EntityStatus = 'active' | 'inactive'

export interface ProductDoc {
  id: string
  sequence: number
  categoryId: string | null
  supplierId: string | null
  nameEn: string
  nameAr: string
  descriptionEn: string | null
  descriptionAr: string | null
  shortBlurbEn: string | null
  shortBlurbAr: string | null
  status: ProductStatus
  createdAt: string
  updatedAt: string
}

export interface OptionValueDoc {
  id: string
  code: string
  valueEn: string
  valueAr: string
  displayOrder: number
}

export interface OptionDoc {
  id: string
  nameEn: string
  nameAr: string
  displayOrder: number
  values: OptionValueDoc[]
}

export interface VariantDoc {
  id: string
  sku: string
  status: VariantStatus
  priceMinor: number
  /** Acquisition (purchase) cost, minor units. Present ONLY when the caller
   *  holds `catalog-cost:read`. `null` = unknown / not configured (never 0). */
  acquisitionCostMinor?: number | null
  optionLabelEn: string | null
  optionLabelAr: string | null
  optionValueIds: string[]
  quantityOnHand: number
  /** Held for pending electronic orders — a commercial hold, never a
   *  physical deduction. */
  quantityReserved: number
}

export interface ProductDetailDoc extends Omit<ProductDoc, 'categoryId' | 'supplierId'> {
  category: { id: string; code: string; slug: string; nameEn: string; nameAr: string } | null
  supplier: { id: string; nameEn: string | null; nameAr: string } | null
  options: OptionDoc[]
  /** True when the caller may see per-variant acquisition cost. */
  costVisible: boolean
  variants: VariantDoc[]
}

export interface MovementDoc {
  id: string
  variantId: string
  movementType: string
  quantityChange: number
  quantityAfter: number | null
  reason: string | null
  orderId: string | null
  storeSaleId: string | null
  staffId: string | null
  createdAt: string
  /** Enriched by the admin UI when the identity can read variants. */
  sku?: string
}

export interface VariantInventoryDoc {
  variantId: string
  sku: string
  productId: string
  quantityOnHand: number
  quantityReserved: number
  recentMovements: MovementDoc[]
}

export type StockLevel = 'out' | 'low' | 'available'

export interface InventoryAttentionItem {
  productId: string
  productNameAr: string
  productNameEn: string
  categoryId: string | null
  supplierId: string | null
  supplierNameAr: string | null
  supplierNameEn: string | null
  variantId: string
  sku: string
  variantStatus: VariantStatus
  productStatus: ProductStatus
  quantityOnHand: number
  level: Extract<StockLevel, 'out' | 'low'>
}

export interface SupplierShortageDoc {
  supplierId: string
  supplierNameAr: string
  supplierNameEn: string | null
  productCount: number
  lowVariants: number
  outVariants: number
}

export interface InventorySummaryDoc {
  products: { total: number; active: number }
  variants: { total: number; active: number }
  stock: { totalUnits: number }
  stockHealth: { available: number; low: number; out: number }
  attention: InventoryAttentionItem[]
  suppliers: { total: number }
  categories: { total: number }
  supplierShortages: SupplierShortageDoc[]
  /** Derived selling-readiness per product id (physical stock is separate). */
  readiness: Record<string, ProductReadiness>
  /** Physical stock level per product id — real totals, independent of lifecycle. */
  productStock: Record<string, StockLevel>
}

/** One row of the paginated Admin inventory register (`GET /inventory/balances`). */
export interface InventoryBalanceListItem {
  variantId: string
  sku: string
  productId: string
  productNameAr: string
  productNameEn: string
  productStatus: ProductStatus
  variantStatus: VariantStatus
  quantityOnHand: number
  quantityReserved: number
  level: StockLevel
}

export interface MediaDoc {
  id: string
  productId: string
  mediaType: 'image' | 'video'
  mimeType: string | null
  objectKey: string
  altAr: string | null
  altEn: string | null
  sortOrder: number
  isPrimary: boolean
  sizeBytes: number | null
  url: string
}

export interface SettingDoc {
  key: string
  value: unknown | null
  summaryEn: string
  summaryAr: string
}

export interface DeliveryZoneDoc {
  id: string
  code: string
  nameEn: string
  nameAr: string
  feeMinor: number
  isActive: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

export interface StaffDoc {
  id: string
  nameAr: string
  nameEn: string | null
  phoneNormalized: string
  email: string | null
  notes: string | null
  status: EntityStatus
  createdAt: string
  updatedAt: string
}

/**
 * Minimal identity-option shape returned by the DEV-ONLY staff bootstrap
 * endpoint (`GET /staff/dev-options`). Carries only id + display names — the
 * fields the identity picker needs to build real staff choices.
 */
export interface DevStaffOption {
  id: string
  nameAr: string
  nameEn: string | null
}

export interface RoleDoc {
  id: string
  code: string
  nameAr: string
  nameEn: string | null
  descriptionAr: string | null
  descriptionEn: string | null
  permissionIds: string[]
}

export interface PermissionDoc {
  id: string
  code: string
  nameAr: string
  nameEn: string | null
  descriptionAr: string | null
  descriptionEn: string | null
}

/** The signed-in staff member as returned by the backend (server-authoritative). */
export interface AuthStaffDoc {
  id: string
  nameAr: string
  nameEn: string | null
  email: string | null
  phoneNormalized: string | null
  status: EntityStatus
}

/** `GET /auth/me` document. */
export interface AuthMeDoc {
  staff: AuthStaffDoc
  permissions: string[]
  roleIds: string[]
}

// ---------------------------------------------------------------------------
// Store sales (physical register)
// ---------------------------------------------------------------------------

export interface StoreSaleOptionValueHit {
  id: string
  valueAr: string
  valueEn: string
}

export interface StoreSaleOptionHit {
  id: string
  nameAr: string
  nameEn: string
  values: StoreSaleOptionValueHit[]
}

export interface StoreSaleVariantHit {
  variantId: string
  sku: string
  optionLabelAr: string | null
  optionLabelEn: string | null
  optionValueIds: string[]
  priceMinor: number
  quantityOnHand: number
  /** Physical on-hand minus stock held for electronic orders — the true
   *  register sellable ceiling. */
  availableToSell: number
  status: VariantStatus
}

export interface StoreSaleProductHit {
  productId: string
  nameAr: string
  nameEn: string
  imageUrl: string | null
  fromPriceMinor: number
  totalOnHand: number
  totalAvailableToSell: number
  hasOptions: boolean
  options: StoreSaleOptionHit[]
  variants: StoreSaleVariantHit[]
}

export interface StoreSaleItemDoc {
  productId: string
  variantId: string
  sku: string
  productNameAr: string
  productNameEn: string
  variantLabelAr: string | null
  variantLabelEn: string | null
  unitPriceMinor: number
  quantity: number
  lineTotalMinor: number
}

export interface StoreSaleDoc {
  id: string
  number: string
  createdAt: string
  staffId: string
  staffNameAr: string
  staffNameEn: string | null
  itemCount: number
  totalUnits: number
  subtotalMinor: number
  totalMinor: number
  currency: string
  note: string | null
}

/** Minimal customer card — POS lookup, Order/Store-Sale detail. Never full
 *  Customer 360 (lifetime analytics stay behind `customers:read`). */
export interface CustomerCard {
  id: string
  phoneNormalized: string
  nameEn: string | null
  nameAr: string | null
  cityEn: string | null
  cityAr: string | null
  addressEn: string | null
  addressAr: string | null
  isReturning: boolean
}

export interface StoreSaleDetailDoc extends StoreSaleDoc {
  customerPhoneNormalized: string | null
  customer: CustomerCard | null
  items: StoreSaleItemDoc[]
}

export interface CustomerLookupResult {
  found: boolean
  customer: CustomerCard | null
}

export interface StoreSaleCreateResult {
  id: string
  number: string
  createdAt: string
  subtotalMinor: number
  totalMinor: number
  currency: string
  items: StoreSaleItemDoc[]
}

export interface StoreSaleLineInput {
  variantId: string
  quantity: number
}

export interface StoreSaleCreateInput {
  lines: StoreSaleLineInput[]
  note?: string
  customerPhone?: string
  customerName?: string
  customerCity?: string
  customerAddress?: string
}

// ---------------------------------------------------------------------------
// Customers (internal CRM — Directory + 360)
// ---------------------------------------------------------------------------

export interface CustomerListItem {
  id: string
  phoneNormalized: string
  nameEn: string | null
  nameAr: string | null
  cityEn: string | null
  cityAr: string | null
  status: EntityStatus
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export interface CustomerTimelineEntry {
  channel: 'online' | 'store'
  id: string
  number: string
  createdAt: string
  totalMinor: number
  currency: string
  status: 'processing' | 'delivering' | 'completed' | 'cancelled' | null
}

export interface CustomerCommercialSummary {
  completedOrdersCount: number
  completedSalesCount: number
  lifetimeSpendMinor: number
  currency: string
  firstTransactionAt: string | null
  lastTransactionAt: string | null
}

export interface ReportsRangeQuery {
  period: ReportPeriod
  /** anchor for day / week */
  date?: string
  /** YYYY-MM for month */
  month?: string
  /** inclusive bounds for custom */
  fromDate?: string
  toDate?: string
}

export interface ReportsStagnantQuery extends ReportsRangeQuery {
  stagnantDays?: number
  categoryId?: string
  supplierId?: string
  withStockOnly?: boolean
  neverSoldOnly?: boolean
  search?: string
}

export interface Customer360Detail {
  id: string
  phoneNormalized: string
  nameEn: string | null
  nameAr: string | null
  cityEn: string | null
  cityAr: string | null
  addressEn: string | null
  addressAr: string | null
  status: EntityStatus
  consentToContact: boolean
  firstSeenAt: string | null
  lastSeenAt: string | null
  note: string | null
  commercial: CustomerCommercialSummary
  timeline: CustomerTimelineEntry[]
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1'

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)

  // Resolve the active development staff id synchronously at request time from
  // the identity source of truth — never from a render-mutated value. When a
  // valid id is selected it is sent as `X-Staff-Id`; otherwise the header is
  // omitted. This is how protected requests always carry the current identity
  // regardless of navigation/refresh timing.
  const staffId = getCurrentStaffId()
  if (staffId !== null) {
    headers.set('X-Staff-Id', staffId)
  }
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    // `credentials: same-origin` carries the HttpOnly session cookie on
    // protected requests (the rewrite keeps every call same-origin). The dev
    // X-Staff-Id header may also be present; the backend always prefers a valid
    // real session over it.
    // `cache: 'no-store'` — admin operational data is always read live; a
    // browser HTTP cache must never serve a stale product/inventory GET after a
    // mutation elsewhere in the session.
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    })
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
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  500: 'internal_error',
}

// ---------------------------------------------------------------------------
// Payload types (subset of @likehoney/shared input contracts)
// ---------------------------------------------------------------------------

export interface CategoryCreateInput {
  nameAr: string
  nameEn: string
  slug?: string
  code: string
  descriptionEn?: string
  descriptionAr?: string
  status?: EntityStatus
}

export interface CategoryUpdateInput {
  nameAr?: string
  nameEn?: string
  slug?: string
  descriptionEn?: string | null
  descriptionAr?: string | null
  status?: EntityStatus
}

export interface SupplierCreateInput {
  nameAr: string
  nameEn?: string
  contactName?: string
  contactPhone?: string
  address?: string
  notes?: string
  status?: EntityStatus
}

export interface SupplierUpdateInput {
  nameAr?: string
  nameEn?: string | null
  contactName?: string | null
  contactPhone?: string | null
  address?: string | null
  notes?: string | null
  status?: EntityStatus
}

export interface ValueInput {
  code: string
  valueEn: string
  valueAr: string
}

export interface OptionInput {
  nameEn: string
  nameAr: string
  displayOrder?: number
  values: ValueInput[]
}

export interface ProductCreateInput {
  categoryId?: string
  supplierId?: string
  nameEn: string
  nameAr: string
  descriptionEn?: string
  descriptionAr?: string
  shortBlurbEn?: string
  shortBlurbAr?: string
  status?: ProductStatus
  pricing:
    | { mode: 'simple'; priceMinor: number }
    | { mode: 'options'; priceMinor: number; options: OptionInput[] }
}

export interface ProductUpdateInput {
  categoryId?: string | null
  supplierId?: string | null
  nameEn?: string
  nameAr?: string
  descriptionEn?: string | null
  descriptionAr?: string | null
  shortBlurbEn?: string | null
  shortBlurbAr?: string | null
  status?: ProductStatus
}

export interface VariantUpdateInput {
  priceMinor?: number
  /** `null` clears cost to "unknown"; `0` is an explicit zero; omit to leave
   *  untouched. Sending this key at all needs `catalog-cost:write`. */
  acquisitionCostMinor?: number | null
  status?: VariantStatus
  optionLabelEn?: string | null
  optionLabelAr?: string | null
}

export interface VariantCreateInput {
  optionValueIds: string[]
  priceMinor: number
  acquisitionCostMinor?: number | null
  status?: VariantStatus
}

export interface VariantBulkCostInput {
  acquisitionCostMinor: number | null
  /** Omit ⇒ every variant of the product. */
  variantIds?: string[]
}

/** Grows an EXISTING option group with one new value (e.g. Size gains "31").
 *  No `code` — the server derives the SKU segment from `valueEn`. */
export interface OptionValueAddInput {
  valueEn: string
  valueAr: string
  priceMinor: number
  acquisitionCostMinor?: number | null
}

export interface OptionValueAddResult {
  value: OptionValueDoc
  variants: VariantDoc[]
}

export interface MovementRecordResult {
  variantId: string
  quantityOnHand: number
}

export interface MovementCreateInput {
  variantId: string
  movementType: (typeof MANUAL_MOVEMENT_TYPES)[number]
  quantityChange: number
  reason?: string
}

export interface MediaUpdateInput {
  altAr?: string | null
  altEn?: string | null
  sortOrder?: number
  isPrimary?: boolean
}

export interface SettingSetInput {
  value: unknown
}

/** `PATCH /settings/payments` body — at least one field, matching the typed
 *  backend contract (never the generic `/settings/:key` PUT). */
export interface PaymentSettingsUpdateInput {
  codEnabled?: boolean
  electronicEnabled?: boolean
  reservationReconcileAfterMinutes?: number
}

export interface DeliveryZoneCreateInput {
  code: string
  nameEn: string
  nameAr: string
  feeMinor?: number
  isActive?: boolean
  displayOrder?: number
}

export interface DeliveryZoneUpdateInput {
  code?: string
  nameEn?: string
  nameAr?: string
  feeMinor?: number
  isActive?: boolean
  displayOrder?: number
}

export interface StaffCreateInput {
  nameAr: string
  nameEn?: string
  phoneNormalized: string
  email?: string
  notes?: string
}

export interface StaffUpdateInput {
  nameAr?: string
  nameEn?: string | null
  phoneNormalized?: string
  email?: string | null
  notes?: string | null
  status?: EntityStatus
}

export interface RoleCreateInput {
  code: string
  nameAr: string
  nameEn?: string
  descriptionAr?: string
  descriptionEn?: string
}

export interface PermissionCreateInput {
  code: string
  nameAr: string
  nameEn?: string
  descriptionAr?: string
  descriptionEn?: string
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface ListQuery {
  page?: number
  pageSize?: number
  search?: string
}

function queryString(params: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const qs = search.toString()
  return qs.length > 0 ? `?${qs}` : ''
}

/** Wrap a mutation so a successful write signals every live catalog/inventory
 *  screen to revalidate (see `revalidate.ts` + `useResource({ revalidate })`). */
const bump = <T>(p: Promise<T>): Promise<T> =>
  p.then((result) => {
    bumpCatalog()
    return result
  })

/** Signal live Orders screens (and, when `alsoCatalog`, inventory screens). */
const bumpAfter = <T>(p: Promise<T>, alsoCatalog: boolean): Promise<T> =>
  p.then((result) => {
    bumpOrders()
    if (alsoCatalog) bumpCatalog()
    return result
  })

export const client = {
  // Categories
  listCategories: (query: ListQuery & { status?: EntityStatus } = {}) =>
    apiRequest<Paged<CategoryDoc>>(`/categories${queryString(query)}`),
  getCategory: (id: string) => apiRequest<CategoryDoc>(`/categories/${id}`),
  createCategory: (input: CategoryCreateInput) =>
    bump(apiRequest<CategoryDoc>('/categories', { method: 'POST', body: JSON.stringify(input) })),
  updateCategory: (id: string, input: CategoryUpdateInput) =>
    bump(
      apiRequest<CategoryDoc>(`/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    ),
  removeCategory: (id: string) =>
    bump(apiRequest<CategoryDoc>(`/categories/${id}`, { method: 'DELETE' })),

  // Suppliers
  listSuppliers: (query: ListQuery & { status?: EntityStatus } = {}) =>
    apiRequest<Paged<SupplierDoc>>(`/suppliers${queryString(query)}`),
  getSupplier: (id: string) => apiRequest<SupplierDoc>(`/suppliers/${id}`),
  createSupplier: (input: SupplierCreateInput) =>
    bump(apiRequest<SupplierDoc>('/suppliers', { method: 'POST', body: JSON.stringify(input) })),
  updateSupplier: (id: string, input: SupplierUpdateInput) =>
    bump(
      apiRequest<SupplierDoc>(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    ),
  removeSupplier: (id: string) =>
    bump(apiRequest<SupplierDoc>(`/suppliers/${id}`, { method: 'DELETE' })),

  // Products
  listProducts: (
    query: ListQuery & { status?: ProductStatus; categoryId?: string; supplierId?: string } = {},
  ) => apiRequest<Paged<ProductDoc>>(`/products${queryString(query)}`),
  getProduct: (id: string) => apiRequest<ProductDetailDoc>(`/products/${id}`),
  createProduct: (input: ProductCreateInput) =>
    bump(apiRequest<ProductDoc>('/products', { method: 'POST', body: JSON.stringify(input) })),
  updateProduct: (id: string, input: ProductUpdateInput) =>
    bump(
      apiRequest<ProductDoc>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    ),
  addVariant: (productId: string, input: VariantCreateInput) =>
    bump(
      apiRequest<VariantDoc>(`/products/${productId}/variants`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),
  updateVariant: (id: string, input: VariantUpdateInput) =>
    bump(
      apiRequest<VariantDoc>(`/variants/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    ),
  /** §9 — apply one acquisition cost to many variants of a product. */
  bulkVariantCost: (productId: string, input: VariantBulkCostInput) =>
    bump(
      apiRequest<{ updatedCount: number }>(`/products/${productId}/variants/cost`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),
  bulkActivateVariants: (productId: string) =>
    bump(
      apiRequest<{ activatedCount: number; variants: VariantDoc[] }>(
        `/products/${productId}/variants/bulk-activate`,
        { method: 'POST' },
      ),
    ),
  getVariant: (id: string) => apiRequest<VariantDoc>(`/variants/${id}`),
  updateOption: (id: string, input: { nameEn?: string; nameAr?: string; displayOrder?: number }) =>
    bump(
      apiRequest<{ id: string }>(`/variants/options/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    ),
  updateOptionValue: (id: string, input: { valueEn?: string; valueAr?: string }) =>
    bump(
      apiRequest<{ id: string }>(`/variants/option-values/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    ),
  /** "+ إضافة قيمة" — adds a value to an existing option group and generates
   *  only the missing (draft) variant combinations. */
  addOptionValue: (optionId: string, input: OptionValueAddInput) =>
    bump(
      apiRequest<OptionValueAddResult>(`/variants/options/${optionId}/values`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),

  // Inventory
  listMovements: (
    query: { page?: number; pageSize?: number; variantId?: string; movementType?: string } = {},
  ) => apiRequest<Paged<MovementDoc>>(`/inventory/movements${queryString(query)}`),
  /** Read-only admin stock/dashboard summary (real catalog + inventory data). */
  stockSummary: () => apiRequest<InventorySummaryDoc>('/inventory/summary'),
  /** Paginated, searched, stock-level-filtered inventory register — server-side. */
  listInventoryBalances: (query: ListQuery & { level?: StockLevel } = {}) =>
    apiRequest<Paged<InventoryBalanceListItem>>(`/inventory/balances${queryString(query)}`),
  getVariantInventory: (variantId: string) =>
    apiRequest<VariantInventoryDoc>(`/inventory/variants/${variantId}`),
  recordMovement: (input: MovementCreateInput) =>
    bump(
      apiRequest<MovementRecordResult>('/inventory/movements', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),

  // Store sales (physical register)
  searchStoreSaleProducts: (q: string, limit = 8) =>
    apiRequest<{ data: StoreSaleProductHit[] }>(
      `/store-sales/search${queryString({ q, limit })}`,
    ).then((result) => result.data),
  createStoreSale: (input: StoreSaleCreateInput) =>
    bump(
      apiRequest<StoreSaleCreateResult>('/store-sales', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),
  listStoreSales: (query: ListQuery = {}) =>
    apiRequest<Paged<StoreSaleDoc>>(`/store-sales${queryString(query)}`),
  getStoreSale: (id: string) => apiRequest<StoreSaleDetailDoc>(`/store-sales/${id}`),
  /** POS phone-first lookup (§14) — minimal card only, never full 360 data. */
  lookupStoreSaleCustomer: (phone: string) =>
    apiRequest<CustomerLookupResult>(`/store-sales/customer-lookup${queryString({ phone })}`),

  // Customers (internal CRM Directory + 360 — `customers:read`)
  listCustomers: (
    query: ListQuery & {
      status?: EntityStatus
      channel?: 'online' | 'store' | 'both'
      type?: 'new' | 'returning' | 'no_purchase'
      inactiveDays?: number
    } = {},
  ) => apiRequest<Paged<CustomerListItem>>(`/customers${queryString(query)}`),
  getCustomer360: (id: string) => apiRequest<Customer360Detail>(`/customers/${id}`),
  setCustomerStatus: (id: string, status: EntityStatus) =>
    apiRequest<{ id: string; status: EntityStatus }>(`/customers/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Store reviews moderation (`reviews:moderate`)
  listReviews: (query: ListQuery & { status?: 'pending' | 'approved' | 'rejected' | 'all' } = {}) =>
    apiRequest<AdminReviewListResponse>(`/reviews${queryString(query)}`),
  getReview: (id: string) => apiRequest<AdminReviewDetail>(`/reviews/${id}`),
  approveReview: (id: string, note?: string) =>
    apiRequest<AdminReviewDetail>(`/reviews/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(note !== undefined && note.length > 0 ? { note } : {}),
    }),
  rejectReview: (id: string, note?: string) =>
    apiRequest<AdminReviewDetail>(`/reviews/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(note !== undefined && note.length > 0 ? { note } : {}),
    }),

  // Reports & Insights (`reports:read`)
  reportsOverview: (q: ReportsRangeQuery = { period: 'month' }) =>
    apiRequest<ReportsOverview>(`/reports/overview${queryString(q)}`),
  reportsSales: (q: ReportsRangeQuery = { period: 'month' }) =>
    apiRequest<ReportsSales>(`/reports/sales${queryString(q)}`),
  reportsProducts: (q: ReportsStagnantQuery = { period: 'month' }) =>
    apiRequest<ReportsProducts>(`/reports/products${queryString(q)}`),
  reportsSuppliers: (q: ReportsRangeQuery = { period: 'month' }) =>
    apiRequest<ReportsBreakdown>(`/reports/suppliers${queryString(q)}`),
  reportsSupplierDrilldown: (supplierId: string, q: ReportsRangeQuery = { period: 'month' }) =>
    apiRequest<ReportsSupplierDrilldown>(
      `/reports/suppliers/${supplierId}/products${queryString(q)}`,
    ),
  reportsCustomers: (q: ReportsRangeQuery = { period: 'month' }) =>
    apiRequest<ReportsCustomers>(`/reports/customers${queryString(q)}`),
  reportsRegions: (q: ReportsRangeQuery = { period: 'month' }) =>
    apiRequest<ReportsRegions>(`/reports/regions${queryString(q)}`),

  // Admin online orders (Gate B3)
  listOrders: (
    query: {
      cursor?: string
      limit?: number
      status?: string
      paymentMethod?: string
      paymentStatus?: string
      dateFrom?: string
      dateTo?: string
      search?: string
    } = {},
  ) => apiRequest<AdminOrderListResponse>(`/orders${queryString(query)}`),
  getOrder: (id: string) => apiRequest<AdminOrderDetail>(`/orders/${id}`),
  getOrderTimeline: (id: string) =>
    apiRequest<{ data: AdminOrderTimelineEntry[] }>(`/orders/${id}/timeline`).then((r) => r.data),
  startOrderDelivery: (id: string) =>
    bumpAfter(
      apiRequest<AdminOrderCommandResult>(`/orders/${id}/start-delivery`, { method: 'POST' }),
      false,
    ),
  completeOrder: (id: string) =>
    bumpAfter(
      apiRequest<AdminOrderCommandResult>(`/orders/${id}/complete`, { method: 'POST' }),
      false,
    ),
  cancelOrder: (id: string, input: OrderCancelInput) =>
    bumpAfter(
      apiRequest<AdminOrderCommandResult>(`/orders/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      // a cancellation may restore inventory → also revalidate catalog screens
      true,
    ),
  recordOrderStockReturn: (id: string, input: OrderStockReturnRequest) =>
    bumpAfter(
      apiRequest<AdminOrderStockReturnReceipt>(`/orders/${id}/stock-returns`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      // adds physical stock → also revalidate catalog/inventory screens
      true,
    ),

  // Media
  listMedia: (productId: string) => apiRequest<MediaDoc[]>(`/media/products/${productId}/media`),
  uploadMedia: (productId: string, form: FormData) =>
    apiRequest<MediaDoc>(`/media/products/${productId}/media`, { method: 'POST', body: form }),
  updateMedia: (id: string, input: MediaUpdateInput) =>
    apiRequest<MediaDoc>(`/media/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeMedia: (id: string) => apiRequest<MediaDoc>(`/media/${id}`, { method: 'DELETE' }),
  /** Applies a full new display order atomically — `mediaIds` must be exactly
   *  the product's current media set. */
  reorderMedia: (productId: string, mediaIds: string[]) =>
    apiRequest<MediaDoc[]>(`/media/products/${productId}/media/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ mediaIds }),
    }),

  // Settings
  listSettings: () => apiRequest<SettingDoc[]>('/settings'),
  getSetting: (key: string) => apiRequest<SettingDoc>(`/settings/${encodeURIComponent(key)}`),
  setSetting: (key: string, input: SettingSetInput) =>
    apiRequest<SettingDoc>(`/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  // Payment settings (Gate B4 Stage 3/4 typed contract — never the generic
  // /settings/:key path; backend is the sole authority on availability).
  getPaymentSettings: () => apiRequest<PaymentSettingsReadModel>('/settings/payments'),
  updatePaymentSettings: (input: PaymentSettingsUpdateInput) =>
    apiRequest<PaymentSettingsReadModel>('/settings/payments', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listDeliveryZones: (
    query: { page?: number; pageSize?: number; isActive?: boolean; activeOnly?: boolean } = {},
  ) => apiRequest<Paged<DeliveryZoneDoc>>(`/settings/delivery-zones${queryString(query)}`),
  createDeliveryZone: (input: DeliveryZoneCreateInput) =>
    apiRequest<DeliveryZoneDoc>('/settings/delivery-zones', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateDeliveryZone: (id: string, input: DeliveryZoneUpdateInput) =>
    apiRequest<DeliveryZoneDoc>(`/settings/delivery-zones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeDeliveryZone: (id: string) =>
    apiRequest<DeliveryZoneDoc>(`/settings/delivery-zones/${id}`, { method: 'DELETE' }),

  // Staff + RBAC
  listStaff: (query: ListQuery & { status?: EntityStatus } = {}) =>
    apiRequest<Paged<StaffDoc>>(`/staff${queryString(query)}`),
  /** Dev-only bootstrap: real active staff, minimal fields, id + display names. */
  listDevStaffOptions: () =>
    apiRequest<{ data: DevStaffOption[] }>('/staff/dev-options').then((result) => result.data),
  getStaff: (id: string) => apiRequest<StaffDoc & { roleIds: string[] }>(`/staff/${id}`),
  createStaff: (input: StaffCreateInput) =>
    apiRequest<StaffDoc>('/staff', { method: 'POST', body: JSON.stringify(input) }),
  updateStaff: (id: string, input: StaffUpdateInput) =>
    apiRequest<StaffDoc>(`/staff/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  setStaffRoles: (id: string, roleIds: string[]) =>
    apiRequest<{ roleIds: string[] }>(`/staff/${id}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roleIds }),
    }),
  listRoles: () => apiRequest<RoleDoc[]>('/staff/roles'),
  createRole: (input: RoleCreateInput) =>
    apiRequest<RoleDoc>('/staff/roles', { method: 'POST', body: JSON.stringify(input) }),
  setRolePermissions: (roleId: string, permissionIds: string[]) =>
    apiRequest<{ permissionIds: string[] }>(`/staff/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissionIds }),
    }),
  listPermissions: () => apiRequest<PermissionDoc[]>('/staff/permissions'),
  createPermission: (input: PermissionCreateInput) =>
    apiRequest<PermissionDoc>('/staff/permissions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Auth (real server-side sessions)
  /** Sign-in. On success an HttpOnly session cookie is set by the server. */
  login: (identifier: string, password: string) =>
    apiRequest<AuthMeDoc>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),
  /** Sign-out. Revokes the current server session and clears the cookie. */
  logout: () => apiRequest<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  /** Resolves the signed-in staff member + permissions (401 when anonymous). */
  me: () => apiRequest<AuthMeDoc>('/auth/me'),
  /** Changes the signed-in staff member's own password (revokes their sessions). */
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<{ ok: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  /** Admin sets/resets a staff member's password (revokes their sessions). */
  setStaffPassword: (id: string, password: string) =>
    apiRequest<{ ok: boolean }>(`/staff/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    }),
}
