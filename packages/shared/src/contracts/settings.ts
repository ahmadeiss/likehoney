/**
 * Store settings + delivery zone wire contracts.
 *
 * Setting keys are technical identifiers (Type D) and are never translated;
 * human labels for keys live in the UI. Every setting value is validated
 * against its typed schema in the registry below; unknown keys are rejected so
 * the registry stays the single source of truth for what can be configured.
 * A setting whose value itself is human-readable stores a localized shape
 * (`{ar,en}`) inside its JSON value.
 */
import { z } from 'zod'

export interface StoreSettingDef {
  /** Technical key (Type D). */
  key: string
  /** Human intent, used by documentation/UI. */
  summaryEn: string
  summaryAr: string
  valueSchema: z.ZodType
}

export const STORE_SETTING_DEFS = {
  'checkout:cod.enabled': {
    key: 'checkout:cod.enabled',
    summaryEn: 'Whether Cash on Delivery checkout is enabled',
    summaryAr: 'هل الدفع عند الاستلام مفعّل',
    valueSchema: z.object({ enabled: z.boolean() }),
  },
  /**
   * Gate B4 Stage 3 — PROTECTED payment setting. Reads are fine through the
   * generic settings endpoint; writes MUST go through the typed
   * payment-settings service (`apps/api/src/services/payments/settings.ts`),
   * which enforces the electronic-enablement guard and the
   * no-zero-payment-method invariant. `setSettingService` rejects direct
   * writes to this key — see the Stage-3 layering/bypass audit.
   */
  'payments:electronic.enabled': {
    key: 'payments:electronic.enabled',
    summaryEn: 'Whether electronic checkout is enabled (protected — see payment settings service)',
    summaryAr: 'هل الدفع الإلكتروني مفعّل (محمي — عبر خدمة إعدادات الدفع)',
    valueSchema: z.object({ enabled: z.boolean() }),
  },
  /** Gate B4 Stage 3 — PROTECTED payment setting, same rule as above. */
  'payments:reservation.reconcile_after_minutes': {
    key: 'payments:reservation.reconcile_after_minutes',
    summaryEn:
      'Minutes after which a held stock reservation becomes eligible for reconciliation (does not authorize release)',
    summaryAr: 'الدقائق قبل تأهل حجز المخزون للمطابقة (لا تُخوّل تحرير المخزون)',
    valueSchema: z.object({ minutes: z.number().int().min(1).max(1440) }),
  },
  'store:announcement': {
    key: 'store:announcement',
    summaryEn: 'Banner announcement (localized value)',
    summaryAr: 'إعلان على الموقع (قيمة مترجمة)',
    valueSchema: z.object({
      ar: z.string().max(1000),
      en: z.string().max(1000),
    }),
  },
  'general:currency': {
    key: 'general:currency',
    summaryEn: 'Store currency (ILS only in V1)',
    summaryAr: 'عملة المتجر (شيكل فقط في الإصدار الأول)',
    valueSchema: z.object({ code: z.literal('ILS') }),
  },
} as const satisfies Record<string, StoreSettingDef>

export type StoreSettingKey = keyof typeof STORE_SETTING_DEFS

/**
 * Keys the generic settings write path (`PUT /settings/:key`) MUST reject —
 * their invariants (electronic-enablement guard, no-zero-payment-method) can
 * only be enforced by the typed payment-settings service, which may need to
 * write more than one of these keys atomically.
 */
export const PROTECTED_PAYMENT_SETTING_KEYS: readonly StoreSettingKey[] = [
  'checkout:cod.enabled',
  'payments:electronic.enabled',
  'payments:reservation.reconcile_after_minutes',
]

export const storeSettingKeySchema = z
  .custom<StoreSettingKey>((value) =>
    typeof value === 'string' ? value in STORE_SETTING_DEFS : false,
  )
  .optional()

export const storeSettingSetSchema = z.object({
  value: z.unknown(),
})

export function getStoreSettingDef(key: string): StoreSettingDef | null {
  const def = STORE_SETTING_DEFS[key as StoreSettingKey]
  return def ?? null
}

export const deliveryZoneCreateSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{1,32}$/, 'uppercase ASCII code, 1-32 chars'),
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  feeMinor: z.number().int().min(0).max(100_000_000).default(0),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(10000).default(0),
})

/**
 * A genuinely separate schema from `deliveryZoneCreateSchema` — NOT
 * `.partial()` on it. `.partial()` only relaxes *requiredness*; every
 * `.default(...)` on the create schema still fires for a field the caller
 * omitted, materializing that default into the parsed output. For a PATCH
 * that means "omitted" and "explicitly set to the default value" become
 * indistinguishable by the time the service sees it — omitting `feeMinor`
 * silently zeroed a real delivery fee. Every field here is plain
 * `.optional()` with no default, so an omitted field parses to `undefined`
 * and is never written (the repository's `.set()` already skips `undefined`
 * keys) — only fields the caller actually sent are touched. An explicit
 * `feeMinor: 0` still parses and updates normally (zero is a valid fee, not
 * an absent one).
 */
export const deliveryZoneUpdateSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z0-9]{1,32}$/, 'uppercase ASCII code, 1-32 chars')
      .optional(),
    nameEn: z.string().trim().min(1).max(200).optional(),
    nameAr: z.string().trim().min(1).max(200).optional(),
    feeMinor: z.number().int().min(0).max(100_000_000).optional(),
    isActive: z.boolean().optional(),
    displayOrder: z.number().int().min(0).max(10000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one updatable field is required',
  })

export const deliveryZoneListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

export type StoreSettingSetInput = z.infer<typeof storeSettingSetSchema>
export type DeliveryZoneCreateInput = z.infer<typeof deliveryZoneCreateSchema>
export type DeliveryZoneUpdateInput = z.infer<typeof deliveryZoneUpdateSchema>
