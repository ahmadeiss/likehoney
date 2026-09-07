/**
 * Gate C — Reports period resolution + KPI helpers.
 *
 * `resolvePeriod` is the timezone-critical core: a store-local `Asia/Hebron`
 * business period must resolve to the correct UTC instant range, and each
 * mode's comparison window must match its spec (§13–§16):
 *   day    → previous business day
 *   week   → the preceding 7 days (business week = Sunday..Saturday, §14)
 *   month  → the previous calendar month
 *   custom → the preceding equal-length window
 * The KPI helpers must never fabricate a baseline or assume full cost
 * coverage. All pure — no DB.
 *
 * Run:  node --test src/services/gate-c-reports.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { STORE_TIMEZONE, instantToStoreWallClock } from '@likehoney/shared'

import { buildInsights, coveredMargin, pct, resolvePeriod } from './reports'

const totals = (over: Partial<Parameters<typeof coveredMargin>[0]> = {}) => ({
  merchandiseRevenueMinor: 0,
  onlineMerchandiseMinor: 0,
  storeMerchandiseMinor: 0,
  deliveryFeesMinor: 0,
  completedOrders: 0,
  completedStoreSales: 0,
  unitsSold: 0,
  cogsMinor: 0,
  coveredRevenueMinor: 0,
  lineRevenueTotalMinor: 0,
  costLinesTotal: 0,
  costLinesCovered: 0,
  ...over,
})

const NOW = new Date('2026-09-15T10:00:00Z') // mid-September, store time

// --- resolvePeriod: day (§13) ----------------------------------------------

test('§13 day mode — one business date, boundary at Asia/Hebron local midnight', () => {
  const r = resolvePeriod({ period: 'day', date: '2026-09-05' }, NOW)
  assert.equal(r.info.fromDate, '2026-09-05')
  assert.equal(r.info.toDate, '2026-09-06')
  assert.equal(r.info.timezone, STORE_TIMEZONE)
  const wc = instantToStoreWallClock(new Date(r.info.fromUtc))
  assert.deepEqual([wc.year, wc.month, wc.day, wc.hour, wc.minute], [2026, 9, 5, 0, 0])
  // Palestine is ahead of UTC → local midnight is the previous UTC day.
  assert.ok(r.info.fromUtc < '2026-09-05T00:00:00.000Z')
})

test('§13 day mode — comparison window is exactly the previous business day', () => {
  const r = resolvePeriod({ period: 'day', date: '2026-09-05' }, NOW)
  assert.equal(r.info.compareFromDate, '2026-09-04')
  assert.equal(r.info.compareToDate, '2026-09-05')
  const oneDay = 86_400_000
  assert.equal(r.toUtc.getTime() - r.fromUtc.getTime(), oneDay)
  assert.equal(r.compareToUtc.getTime() - r.compareFromUtc.getTime(), oneDay)
})

test('§13 day mode defaults to today (store time) when no date is given', () => {
  const r = resolvePeriod({ period: 'day' }, NOW)
  assert.equal(r.info.fromDate, '2026-09-15')
})

// --- resolvePeriod: week (§14) --------------------------------------------

test('§14 week mode — the business week is Sunday..Saturday (directive example)', () => {
  // 2026-09-05 is a Saturday; its week runs Sun 2026-08-30 .. Sat 2026-09-05.
  const r = resolvePeriod({ period: 'week', date: '2026-09-05' }, NOW)
  assert.equal(r.info.fromDate, '2026-08-30')
  assert.equal(r.info.toDate, '2026-09-06') // exclusive next day
  assert.equal(r.info.humanLabelEn, '30 August – 5 September 2026')
})

test('§14 week mode — any day inside the week resolves to the same window', () => {
  const sat = resolvePeriod({ period: 'week', date: '2026-09-05' }, NOW).info
  const wed = resolvePeriod({ period: 'week', date: '2026-09-02' }, NOW).info
  const sun = resolvePeriod({ period: 'week', date: '2026-08-30' }, NOW).info
  assert.equal(sat.fromDate, wed.fromDate)
  assert.equal(wed.fromDate, sun.fromDate)
  assert.equal(sat.toDate, sun.toDate)
})

test('§14 week comparison is the immediately-preceding 7 days', () => {
  const r = resolvePeriod({ period: 'week', date: '2026-09-05' }, NOW)
  assert.equal(r.info.compareFromDate, '2026-08-23')
  assert.equal(r.info.compareToDate, '2026-08-30')
  const week = 7 * 86_400_000
  assert.equal(r.toUtc.getTime() - r.fromUtc.getTime(), week)
  assert.equal(r.compareToUtc.getTime() - r.compareFromUtc.getTime(), week)
})

// --- resolvePeriod: month (§15) ------------------------------------------

test('§15 month mode — a chosen month, compared to the previous CALENDAR month', () => {
  const r = resolvePeriod({ period: 'month', month: '2026-09' }, NOW)
  assert.equal(r.info.fromDate, '2026-09-01')
  assert.equal(r.info.toDate, '2026-10-01')
  assert.equal(r.info.compareFromDate, '2026-08-01')
  assert.equal(r.info.compareToDate, '2026-09-01')
})

test('§15 month mode — January rolls the comparison back into December', () => {
  const r = resolvePeriod({ period: 'month', month: '2026-01' }, NOW)
  assert.equal(r.info.fromDate, '2026-01-01')
  assert.equal(r.info.toDate, '2026-02-01')
  assert.equal(r.info.compareFromDate, '2025-12-01')
  assert.equal(r.info.compareToDate, '2026-01-01')
})

test('§15 month mode defaults to the current store month', () => {
  const r = resolvePeriod({ period: 'month' }, NOW)
  assert.equal(r.info.fromDate, '2026-09-01')
})

// --- resolvePeriod: custom (§16) --------------------------------------------

test('§16 custom — toDate is inclusive; the exclusive bound is the next day', () => {
  const r = resolvePeriod({ period: 'custom', fromDate: '2026-09-01', toDate: '2026-09-07' }, NOW)
  assert.equal(r.info.fromDate, '2026-09-01')
  assert.equal(r.info.toDate, '2026-09-08')
  const days = (r.toUtc.getTime() - r.fromUtc.getTime()) / 86_400_000
  assert.ok(Math.abs(days - 7) < 0.05)
})

test('§16 custom — comparison is the preceding equal-length window', () => {
  const r = resolvePeriod({ period: 'custom', fromDate: '2026-09-01', toDate: '2026-09-07' }, NOW)
  assert.equal(r.info.compareFromDate, '2026-08-25')
  assert.equal(r.info.compareToDate, '2026-09-01')
  assert.equal(
    r.compareToUtc.getTime() - r.compareFromUtc.getTime(),
    r.toUtc.getTime() - r.fromUtc.getTime(),
  )
})

test('§16 custom — a reversed range never 500s (from/to are swapped)', () => {
  assert.doesNotThrow(() =>
    resolvePeriod({ period: 'custom', fromDate: '2026-09-07', toDate: '2026-09-01' }, NOW),
  )
})

// --- Human label (§18) ---------------------------------------------------

test('§18 human label is unambiguous for a single day, a range, and a month', () => {
  assert.equal(
    resolvePeriod({ period: 'day', date: '2026-09-05' }, NOW).info.humanLabelEn,
    '5 September 2026',
  )
  assert.equal(
    resolvePeriod({ period: 'month', month: '2026-08' }, NOW).info.humanLabelEn,
    '1–31 August 2026',
  )
  assert.equal(
    resolvePeriod({ period: 'custom', fromDate: '2026-08-28', toDate: '2026-09-02' }, NOW).info
      .humanLabelEn,
    '28 August – 2 September 2026',
  )
})

// --- KPI helpers -------------------------------------------------------------

test('pct returns null when there is no baseline — never divides by zero', () => {
  assert.equal(pct(500, 0), null)
  assert.equal(pct(0, 0), null)
  assert.equal(pct(150, 100), 50)
  assert.equal(pct(80, 100), -20)
})

test('coverage is REVENUE-weighted — 0 when no eligible revenue, real ratio otherwise', () => {
  assert.equal(coveredMargin(totals()).coveragePct, 0)
  assert.equal(
    coveredMargin(totals({ lineRevenueTotalMinor: 1000, coveredRevenueMinor: 400 })).coveragePct,
    40,
  )
  assert.equal(
    coveredMargin(totals({ lineRevenueTotalMinor: 300, coveredRevenueMinor: 300 })).coveragePct,
    100,
  )
})

test('covered margin subtracts captured COGS only from cost-covered revenue — never all revenue', () => {
  // Sale A: revenue 100, cost 60 (covered). Sale B: revenue 900, cost UNKNOWN.
  const m = coveredMargin(
    totals({
      merchandiseRevenueMinor: 1000,
      lineRevenueTotalMinor: 1000,
      coveredRevenueMinor: 100,
      cogsMinor: 60,
    }),
  )
  assert.equal(m.coveredGrossMarginMinor, 40) // NOT 940
  assert.equal(m.coveragePct, 10)
  assert.equal(m.complete, false)
})

test('covered margin is null (unavailable) at 0% coverage — unknown cost is never 0 profit', () => {
  const m = coveredMargin(totals({ merchandiseRevenueMinor: 900, lineRevenueTotalMinor: 900 }))
  assert.equal(m.coveredGrossMarginMinor, null)
  assert.equal(m.coveragePct, 0)
})

test('covered margin equals full gross margin at 100% coverage', () => {
  const m = coveredMargin(
    totals({
      merchandiseRevenueMinor: 10000,
      lineRevenueTotalMinor: 10000,
      coveredRevenueMinor: 10000,
      cogsMinor: 6000,
    }),
  )
  assert.equal(m.coveredGrossMarginMinor, 4000)
  assert.equal(m.coveragePct, 100)
  assert.equal(m.complete, true)
})

// --- Insights ---------------------------------------------------------------

const noPipeline = { processingOrders: 0, deliveringOrders: 0 }

test('§ insights are deterministic — identical input yields byte-identical output', () => {
  const args = [
    { currentMinor: 200, previousMinor: 100, changePct: 100 },
    totals({
      lineRevenueTotalMinor: 1000,
      coveredRevenueMinor: 200,
      costLinesTotal: 10,
      costLinesCovered: 2,
    }),
    { processingOrders: 3, deliveringOrders: 1 },
    2,
    5,
    { nameAr: 'منتج', nameEn: 'Product', units: 12 },
  ] as const
  assert.deepEqual(buildInsights(...args), buildInsights(...args))
})

test('§ insights are capped at 6 and every item carries fully-formed bilingual text', () => {
  const out = buildInsights(
    { currentMinor: 500, previousMinor: 100, changePct: 400 },
    totals({
      lineRevenueTotalMinor: 1000,
      coveredRevenueMinor: 100,
      costLinesTotal: 10,
      costLinesCovered: 1,
    }),
    { processingOrders: 9, deliveringOrders: 4 },
    7,
    12,
    { nameAr: 'الأكثر', nameEn: 'Top', units: 30 },
  )
  assert.ok(out.length <= 6)
  for (const i of out) {
    assert.ok(i.textAr.length > 0 && !i.textAr.includes('undefined'))
    assert.ok(i.textEn.length > 0 && !i.textEn.includes('undefined'))
    assert.ok(['positive', 'attention', 'neutral'].includes(i.kind))
  }
})

test('§ a low cost-coverage window always surfaces the "partial margin" caveat', () => {
  const out = buildInsights(
    { currentMinor: 100, previousMinor: 100, changePct: 0 },
    totals({
      lineRevenueTotalMinor: 1000,
      coveredRevenueMinor: 300,
      costLinesTotal: 10,
      costLinesCovered: 3,
    }),
    noPipeline,
    0,
    0,
    null,
  )
  assert.ok(out.some((i) => i.code === 'cost_coverage_low' && i.kind === 'attention'))
})

test('§ full cost coverage does NOT raise the caveat', () => {
  const out = buildInsights(
    { currentMinor: 100, previousMinor: 100, changePct: 0 },
    totals({
      lineRevenueTotalMinor: 1000,
      coveredRevenueMinor: 1000,
      costLinesTotal: 10,
      costLinesCovered: 10,
    }),
    noPipeline,
    0,
    0,
    null,
  )
  assert.ok(!out.some((i) => i.code === 'cost_coverage_low'))
})
