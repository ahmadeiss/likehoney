/**
 * Bilingual (Arabic-first / English) localization layer for the Like Honey
 * domain.
 *
 * V1 stores stable machine-readable enum values in the database and explicit
 * bilingual text in `*_ar` / `*_en` columns. Raw enum values are never shown
 * to users: every enum / status value is resolved to a human-readable label
 * through the typed maps in this module. Arabic is the default operational and
 * customer language; English is a first-class alternative.
 *
 * The value unions below mirror the DB enum values in
 * `packages/db/src/schema/enums.ts` (the database remains the authoritative
 * source of stable values; keep them in sync). Label maps are annotated as
 * `BilingualLabelMap<T>` so a missing entry is a compile error, not a runtime
 * gap. There is intentionally NO translation dictionary or generic i18n
 * infrastructure.
 */
import type { OrderPaymentStatus, PaymentMethod } from './payments'

export const DEFAULT_LOCALE = 'ar' as const

export const SUPPORTED_LOCALES = ['ar', 'en'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

/** A bilingual text pair. Mirrors the `*_ar` / `*_en` column convention. */
export interface LocalizedText {
  ar: string
  en: string
}

/** A complete, exhaustive label map keyed by the stable machine values. */
export type BilingualLabelMap<T extends string> = Record<T, LocalizedText>

/**
 * Resolve a stable value to its human-readable label for a given locale.
 * Completeness is guaranteed per map by construction; the runtime guard is a
 * defensive assertion for any value that slips past the exhaustive maps.
 */
export function localizedLabel<T extends string>(
  labels: BilingualLabelMap<T>,
  value: T,
  locale: Locale,
): string {
  const entry = labels[value]
  if (entry === undefined) {
    throw new Error(`No bilingual label mapping for value "${value}"`)
  }
  return entry[locale]
}

/** Pick the localized string from a pair of AR/EN columns (or a LocalizedText). */
export function pickLocalized(text: LocalizedText, locale: Locale): string {
  return text[locale]
}

// ---------------------------------------------------------------------------
// Order status
// ---------------------------------------------------------------------------

export type OrderStatus = 'processing' | 'delivering' | 'completed' | 'cancelled'

export const ORDER_STATUS_LABELS: BilingualLabelMap<OrderStatus> = {
  processing: { ar: 'قيد التجهيز', en: 'Preparing' },
  delivering: { ar: 'قيد التوصيل', en: 'Out for delivery' },
  completed: { ar: 'مكتمل', en: 'Completed' },
  cancelled: { ar: 'ملغي', en: 'Cancelled' },
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

// `PaymentMethod`, `OrderPaymentStatus` and `CancellationSource` are defined
// once in `./payments` (the canonical payment/reservation vocabulary). This
// file only owns their bilingual labels.
export const PAYMENT_METHOD_LABELS: BilingualLabelMap<PaymentMethod> = {
  cod: { ar: 'الدفع عند الاستلام', en: 'Cash on Delivery' },
  electronic: { ar: 'دفع إلكتروني', en: 'Electronic payment' },
}

export const PAYMENT_STATUS_LABELS: BilingualLabelMap<OrderPaymentStatus> = {
  unpaid: { ar: 'غير مدفوع', en: 'Unpaid' },
  paid: { ar: 'مدفوع', en: 'Paid' },
  pending: { ar: 'قيد الدفع', en: 'Payment pending' },
  expired: { ar: 'انتهت مهلة الدفع', en: 'Payment expired' },
}

/**
 * Operational, method-aware payment presentation for staff. For Cash on
 * Delivery the state reads as a *collection* status — an unpaid COD order is
 * "not yet collected", never "payment failed" / "unpaid electronically".
 * Electronic-payment states slot into the same layer in a later gate.
 */
export type CodCollectionState = 'pending' | 'collected'

export const COD_COLLECTION_LABELS: BilingualLabelMap<CodCollectionState> = {
  pending: { ar: 'لم يُحصّل بعد', en: 'Not yet collected' },
  collected: { ar: 'تم التحصيل', en: 'Collected' },
}

// ---------------------------------------------------------------------------
// Catalog statuses
// ---------------------------------------------------------------------------

export type ProductStatus = 'draft' | 'active' | 'inactive' | 'archived'

export const PRODUCT_STATUS_LABELS: BilingualLabelMap<ProductStatus> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  active: { ar: 'نشط', en: 'Active' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
  archived: { ar: 'مؤرشف', en: 'Archived' },
}

export type VariantStatus = 'draft' | 'active' | 'inactive'

export const VARIANT_STATUS_LABELS: BilingualLabelMap<VariantStatus> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  active: { ar: 'نشط', en: 'Active' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
}

export type EntityStatus = 'active' | 'inactive'

export const ENTITY_STATUS_LABELS: BilingualLabelMap<EntityStatus> = {
  active: { ar: 'نشط', en: 'Active' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
}

export type ContentStatus = 'draft' | 'published' | 'archived'

export const CONTENT_STATUS_LABELS: BilingualLabelMap<ContentStatus> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  published: { ar: 'منشور', en: 'Published' },
  archived: { ar: 'مؤرشف', en: 'Archived' },
}

export type MediaType = 'image' | 'video'

export const MEDIA_TYPE_LABELS: BilingualLabelMap<MediaType> = {
  image: { ar: 'صورة', en: 'Image' },
  video: { ar: 'فيديو', en: 'Video' },
}

// ---------------------------------------------------------------------------
// Store review moderation (Reviews Gate)
// ---------------------------------------------------------------------------

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export const REVIEW_STATUS_LABELS: BilingualLabelMap<ReviewStatus> = {
  pending: { ar: 'بانتظار المراجعة', en: 'Pending' },
  approved: { ar: 'معتمد', en: 'Approved' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
}

export type ReviewVerifiedSource = 'online_order' | 'store_sale'

export const REVIEW_VERIFIED_SOURCE_LABELS: BilingualLabelMap<ReviewVerifiedSource> = {
  online_order: { ar: 'طلب أونلاين مكتمل', en: 'Completed online order' },
  store_sale: { ar: 'بيع داخل المحل', en: 'In-store sale' },
}

// ---------------------------------------------------------------------------
// Inventory movement types
// ---------------------------------------------------------------------------

export type InventoryMovementType =
  | 'INITIAL_STOCK'
  | 'RESTOCK'
  | 'ONLINE_ORDER'
  | 'ORDER_CANCELLATION_RESTORE'
  | 'RETURN'
  | 'DAMAGE'
  | 'MANUAL_ADJUSTMENT'
  | 'STORE_SALE'

export const INVENTORY_MOVEMENT_TYPE_LABELS: BilingualLabelMap<InventoryMovementType> = {
  INITIAL_STOCK: { ar: 'رصيد افتتاحي', en: 'Initial stock' },
  RESTOCK: { ar: 'تزويد مخزون', en: 'Restock' },
  ONLINE_ORDER: { ar: 'طلب أونلاين', en: 'Online order' },
  ORDER_CANCELLATION_RESTORE: { ar: 'إعادة رصيد (إلغاء طلب)', en: 'Order cancellation restore' },
  RETURN: { ar: 'مرتجع', en: 'Return' },
  DAMAGE: { ar: 'تالف / مفقود', en: 'Damaged / lost' },
  MANUAL_ADJUSTMENT: { ar: 'تسوية يدوية', en: 'Manual adjustment' },
  STORE_SALE: { ar: 'بيع من المتجر', en: 'Store sale' },
}

// ---------------------------------------------------------------------------
// Audit actor type
// ---------------------------------------------------------------------------

export type ActorType = 'staff' | 'system'

export const ACTOR_TYPE_LABELS: BilingualLabelMap<ActorType> = {
  staff: { ar: 'موظف', en: 'Staff' },
  system: { ar: 'النظام', en: 'System' },
}
