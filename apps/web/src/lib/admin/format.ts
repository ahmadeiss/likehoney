import {
  DEFAULT_CURRENCY,
  STORE_TIMEZONE,
  fromMinorUnits,
  storeTimeToUtc,
  type Locale,
} from '@likehoney/shared'

function currencyLocale(locale: Locale): string {
  return locale === 'ar' ? 'ar-PS-u-nu-latn' : 'en-IL'
}

export function formatPrice(minorUnits: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(currencyLocale(locale), {
      style: 'currency',
      currency: DEFAULT_CURRENCY,
      currencyDisplay: 'narrowSymbol',
    }).format(minorUnits / 100)
  } catch {
    return `${fromMinorUnits(minorUnits, DEFAULT_CURRENCY)} ${DEFAULT_CURRENCY}`
  }
}

export function formatCount(value: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(currencyLocale(locale)).format(value)
  } catch {
    return String(value)
  }
}

export function formatDate(value: string | Date, locale: Locale): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(currencyLocale(locale), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

/**
 * Date + time rendered in the store's business timezone (Asia/Hebron) — the
 * only correct reading for operational Admin screens regardless of the
 * operator's device timezone. Server timestamps stay UTC; this is display only.
 */
export function formatStoreDateTime(value: string | Date, locale: Locale): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(currencyLocale(locale), {
      timeZone: STORE_TIMEZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

/** Time-of-day only, store business timezone (list rows: "١٢:٣٥ ص"). */
export function formatStoreTime(value: string | Date, locale: Locale): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(currencyLocale(locale), {
      timeZone: STORE_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  } catch {
    return ''
  }
}

/**
 * A staff-entered date-only value (`YYYY-MM-DD`) is a *store-local business
 * date*. `dayStart` → the UTC instant of 00:00:00 that local day; `dayEnd` →
 * the UTC instant of the FOLLOWING local midnight (exclusive upper bound). Used
 * to build `dateFrom` / `dateTo` query params for the orders list.
 */
export function storeDateOnlyToUtcRange(
  isoDate: string,
): { dayStartUtc: string; dayEndUtc: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (m === null) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const start = storeTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0 })
  const next = storeTimeToUtc({ year, month, day: day + 1, hour: 0, minute: 0, second: 0 })
  return { dayStartUtc: start.toISOString(), dayEndUtc: next.toISOString() }
}

/**
 * DISPLAY-ONLY human phone formatting (Gate C §11). Stored / identity-normalized
 * phone data is NEVER mutated — this only reshapes it for reading:
 *   "970599123001"  → "0599 123 001"           (local, default)
 *   "970599123001"  → "+970 599 123 001"       (intl: true)
 * Anything that isn't a clean `970` + 9-digit number is returned as-is so we
 * never hide or corrupt an unexpected value.
 */
export function formatPhone(raw: string | null | undefined, opts?: { intl?: boolean }): string {
  if (raw == null) return ''
  const digits = raw.replace(/\D/g, '')
  if (!/^970\d{9}$/.test(digits)) return raw.trim()
  const local9 = digits.slice(3) // e.g. "599123001"
  const a = local9.slice(0, 3)
  const b = local9.slice(3, 6)
  const c = local9.slice(6, 9)
  return opts?.intl ? `+970 ${a} ${b} ${c}` : `0${a} ${b} ${c}`
}

/**
 * "اليوم ١١:٤٢" / "أمس ٠٩:١٥" / "الاثنين" / a medium date for anything older —
 * the store-language phrasing an activity timeline wants, not a full timestamp.
 */
export function formatRelative(value: string | Date, locale: Locale): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  const loc = currencyLocale(locale)
  let time = ''
  try {
    time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(date)
  } catch {
    time = ''
  }

  if (dayDiff === 0) return `${locale === 'ar' ? 'اليوم' : 'Today'} ${time}`.trim()
  if (dayDiff === 1) return `${locale === 'ar' ? 'أمس' : 'Yesterday'} ${time}`.trim()
  if (dayDiff > 1 && dayDiff < 7) {
    try {
      return new Intl.DateTimeFormat(loc, { weekday: 'long' }).format(date)
    } catch {
      /* fall through */
    }
  }
  try {
    return new Intl.DateTimeFormat(loc, { dateStyle: 'medium' }).format(date)
  } catch {
    return date.toLocaleDateString()
  }
}
