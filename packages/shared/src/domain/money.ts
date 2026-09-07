/**
 * Money representation.
 *
 * Authoritative monetary values are ALWAYS stored as integer minor units and
 * NEVER as JavaScript floating-point numbers. Example: 145.00 ILS is stored as
 * `14500`.
 *
 * These helpers are presentation / serialization helpers only — the database
 * and all APIs use integer minor units as the source of truth.
 */

export const DEFAULT_CURRENCY = 'ILS' as const

export const CURRENCIES = {
  ILS: { code: 'ILS', minorDigits: 2 },
} as const

export type CurrencyCode = keyof typeof CURRENCIES

/**
 * Convert a decimal string amount such as `"145.00"` to integer minor units.
 * Parsing is string-based so it never touches floating-point arithmetic.
 */
export function toMinorUnits(amount: string, code: CurrencyCode = DEFAULT_CURRENCY): number {
  const minorDigits = CURRENCIES[code].minorDigits
  const trimmed = amount.trim()
  const normalize = (fragment: string) => (fragment.length === 0 ? '0' : fragment)

  if (trimmed.includes('.')) {
    const parts = trimmed.split('.')
    const whole = parts[0] ?? ''
    const fraction = parts[1] ?? ''
    const fractionPadded = normalize(fraction).padEnd(minorDigits, '0').slice(0, minorDigits)
    return (
      Number.parseInt(normalize(whole), 10) * 10 ** minorDigits +
      Number.parseInt(fractionPadded, 10)
    )
  }

  return Number.parseInt(normalize(trimmed), 10) * 10 ** minorDigits
}

/** Render integer minor units as a decimal string for display, e.g. `14500` → `"145.00"`. */
export function fromMinorUnits(minorUnits: number, code: CurrencyCode = DEFAULT_CURRENCY): string {
  const minorDigits = CURRENCIES[code].minorDigits
  const divisor = 10 ** minorDigits
  const whole = Math.trunc(minorUnits / divisor)
  const fraction = Math.abs(minorUnits % divisor)
    .toString()
    .padStart(minorDigits, '0')
  return `${whole}.${fraction}`
}
