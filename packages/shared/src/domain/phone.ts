/**
 * Customer phone normalization.
 *
 * V1 performs no phone-ownership verification. Normalization exists so the
 * same customer can be matched across orders when they consent to data
 * retention. It is a best-effort canonical form, not an identity guarantee.
 *
 * Strategy:
 * - strip every non-digit character (drops spaces, dashes, parens);
 * - drop a leading `00` international prefix;
 * - map a leading Palestinian local `0` to the country code `970`;
 * - treat a bare 9-digit number as a local number and prefix `970`.
 *
 * Example: `059 000 0000` → `970590000000`
 */
export const COUNTRY_CODE = '970'

export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '')

  if (digits.startsWith('00')) digits = digits.slice(2)

  if (digits.startsWith('0') && digits.length >= 9) {
    digits = `${COUNTRY_CODE}${digits.slice(1)}`
  }

  if (digits.length === 9 && !digits.startsWith(COUNTRY_CODE)) {
    digits = `${COUNTRY_CODE}${digits}`
  }

  return digits
}

/**
 * Gate C (§6) — a normalized value is only safe to use as a CUSTOMER-IDENTITY
 * match key when it has the exact shape `970` + a 9-digit local number (the
 * only shape `normalizePhone` is designed to produce from a real Palestinian
 * number). `normalizePhone` itself never throws — it happily returns a
 * mangled digit string for garbage input — so identity-matching call sites
 * MUST additionally check this before treating the result as a match key.
 * Order/store-sale checkout snapshots may still store whatever the customer
 * typed even when this returns false; only CRM identity resolution (customer
 * create/link) gates on it.
 */
export function isValidNormalizedPhone(normalized: string): boolean {
  return /^970\d{9}$/.test(normalized)
}
