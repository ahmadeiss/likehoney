export interface CatalogMeasurement {
  width: number
  height: number
}

/** Paging may grow a frame, but only an actual responsive resize may shrink it. */
export function reserveCatalogFrame(
  previous: CatalogMeasurement,
  next: CatalogMeasurement,
): CatalogMeasurement {
  return {
    width: next.width,
    height: previous.width === next.width ? Math.max(previous.height, next.height) : next.height,
  }
}
