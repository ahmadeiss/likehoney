/**
 * Display-only safe labels for HISTORICAL snapshot text (Gate C final).
 *
 * Some legacy immutable snapshot rows contain undecodable bytes that render as
 * U+FFFD. Those rows must NEVER be rewritten (historical truth), but the
 * corrupted text must NEVER surface in Owner Intelligence either.
 *
 * This helper is presentation-only. It does NOT fall back to the current
 * mutable catalog name — that would misrepresent a past sale. The chain is:
 *   1. valid sale-time Arabic snapshot
 *   2. valid sale-time English snapshot
 *   3. valid snapshot SKU
 *   4. a stable human fallback (Arabic / English constants below)
 */

const REPLACEMENT_CHAR = '�'

// Lone UTF-16 surrogate halves (mangled encoding).
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** A C0 control char other than tab (9) / LF (10) / CR (13). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) return true
  }
  return false
}

/** Is this string safe to show to a human as a label? */
export function isUsableLabel(value: string | null | undefined): value is string {
  if (value == null) return false
  const t = value.trim()
  if (t.length === 0) return false
  if (t.includes(REPLACEMENT_CHAR)) return false
  if (hasControlChar(t)) return false
  if (LONE_SURROGATE_RE.test(t)) return false
  return true
}

export interface HistoricalLabelInput {
  ar?: string | null
  en?: string | null
  sku?: string | null
}

export interface SafeHistoricalLabel {
  /** The chosen display text — always usable. */
  text: string
  /** True only when the chain fell through to the human fallback string. */
  isFallback: boolean
}

export const HISTORICAL_FALLBACK_AR = 'منتج تاريخي'
export const HISTORICAL_FALLBACK_EN = 'Historical product'

export function safeHistoricalLabel(
  input: HistoricalLabelInput,
  locale: 'ar' | 'en' = 'ar',
): SafeHistoricalLabel {
  if (isUsableLabel(input.ar)) return { text: input.ar.trim(), isFallback: false }
  if (isUsableLabel(input.en)) return { text: input.en.trim(), isFallback: false }
  if (isUsableLabel(input.sku)) return { text: input.sku.trim(), isFallback: false }
  return {
    text: locale === 'ar' ? HISTORICAL_FALLBACK_AR : HISTORICAL_FALLBACK_EN,
    isFallback: true,
  }
}

/** Convenience: just the text (for places that only need a string). */
export function safeHistoricalText(
  input: HistoricalLabelInput,
  locale: 'ar' | 'en' = 'ar',
): string {
  return safeHistoricalLabel(input, locale).text
}
