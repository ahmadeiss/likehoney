/** Preserve partially typed amounts while converting decimal digits exactly. */
export function parseMoneyDraft(raw: string): { text: string; valueMinor: number } | null {
  const text = raw
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace('٫', '.')
  if (!/^\d*(?:\.\d{0,2})?$/.test(text)) return null
  const [whole = '', fraction = ''] = text.split('.')
  const valueMinor = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(valueMinor)) return null
  return { text, valueMinor }
}
