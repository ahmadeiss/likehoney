/**
 * Store business time.
 *
 * All timestamps are persisted as `timestamptz` at authoritative **UTC** server
 * time — that never changes. Timezone matters only when a UTC instant must be
 * interpreted as a *business* day / week / month (reporting windows, Gate C).
 *
 * Like Honey operates in Jenin, in the West Bank. The canonical zone is the IANA
 * identifier `Asia/Hebron` (State of Palestine, West Bank) — NOT a fixed UTC
 * offset, because Palestinian daylight-saving rules change and IANA tracks them,
 * and NOT the browser / owner's timezone.
 */
export const STORE_TIMEZONE = 'Asia/Hebron'

interface WallClock {
  year: number
  /** 1–12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const PART_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = PART_FORMATTER_CACHE.get(timeZone)
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    PART_FORMATTER_CACHE.set(timeZone, f)
  }
  return f
}

/** The wall-clock reading of a UTC instant in `timeZone`. */
export function instantToStoreWallClock(
  instant: Date,
  timeZone: string = STORE_TIMEZONE,
): WallClock {
  const map: Record<string, string> = {}
  for (const p of partsFormatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/** Business calendar month (`YYYY-MM`) that a UTC instant falls in for the store. */
export function storeBusinessMonth(instant: Date, timeZone: string = STORE_TIMEZONE): string {
  const w = instantToStoreWallClock(instant, timeZone)
  return `${w.year.toString().padStart(4, '0')}-${w.month.toString().padStart(2, '0')}`
}

/**
 * The UTC instant for a wall-clock time in `timeZone`. One correction pass over
 * `Intl` — exact except within the ~1h of a DST transition (never a concern for
 * day/month boundaries away from late-March / late-October in Palestine).
 */
export function storeTimeToUtc(wall: WallClock, timeZone: string = STORE_TIMEZONE): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  const seen = instantToStoreWallClock(new Date(guess), timeZone)
  const seenAsUtc = Date.UTC(
    seen.year,
    seen.month - 1,
    seen.day,
    seen.hour,
    seen.minute,
    seen.second,
  )
  // `seenAsUtc - guess` is the zone offset at that instant; remove it.
  return new Date(guess - (seenAsUtc - guess))
}

/**
 * `[startUtc, endUtc)` for a store-local calendar month — e.g. the UTC range a
 * "September 2026 completed sales" report window resolves to.
 */
export function storeMonthUtcRange(
  year: number,
  month: number,
  timeZone: string = STORE_TIMEZONE,
): { startUtc: Date; endUtc: Date } {
  const startUtc = storeTimeToUtc({ year, month, day: 1, hour: 0, minute: 0, second: 0 }, timeZone)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const endUtc = storeTimeToUtc(
    { year: nextYear, month: nextMonth, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  )
  return { startUtc, endUtc }
}
