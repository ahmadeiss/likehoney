export const CATALOG_PAGE_SIZE = 12

export function parseCatalogPage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

/** Bounded pagination even for catalogs with thousands of pages. */
export function catalogPages(current: number, total: number): (number | 'gap')[] {
  if (total <= 0) return []
  const selected = new Set([1, total])
  for (let page = Math.max(1, current - 1); page <= Math.min(total, current + 1); page++)
    selected.add(page)
  const pages = [...selected].sort((a, b) => a - b)
  const result: (number | 'gap')[] = []
  for (const page of pages) {
    const previous = result[result.length - 1]
    if (typeof previous === 'number' && page - previous > 1) result.push('gap')
    result.push(page)
  }
  return result
}
