/**
 * Gate C — financial truth + historical-label safety (final owner-UX pass).
 *
 * Two invariants this file locks forever:
 *
 *   1. Unknown acquisition cost is NEVER treated as 0.
 *      Gross margin is computed ONLY over lines that carried a captured
 *      `unit_cost_snapshot`. Coverage is REVENUE-weighted. At 0% coverage the
 *      margin is `null` ("unavailable"), never a number.
 *
 *      Directive example — Sale A: revenue 100 / cost 60, Sale B: revenue 900 /
 *      cost UNKNOWN → coverage = 10%, covered gross margin = 40 (NOT 940).
 *
 *   2. Corrupted legacy snapshot text (U+FFFD, control chars, lone surrogates)
 *      never surfaces in a report label or an insight sentence. The display
 *      falls back AR → EN → SKU → a stable human constant — never to the
 *      current mutable catalog name.
 *
 * Run:  node --test src/services/gate-c-financial-truth.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  HISTORICAL_FALLBACK_AR,
  HISTORICAL_FALLBACK_EN,
  computeCoveredMargin,
  isUsableLabel,
  safeHistoricalLabel,
  safeHistoricalText,
} from '@likehoney/shared'

import { buildInsights } from './reports'

const FFFD = '�'
const junkAr = `منتج ${FFFD}${FFFD} قديم`
const allJunk = `${FFFD}${FFFD}${FFFD}`

// --- §1–§4  covered margin -------------------------------------------------

test('directive example: covered revenue 100 / cost 60, 900 uncovered → margin 40, coverage 10%', () => {
  // eligible merchandise revenue = 100 + 900 = 1000; covered revenue = 100.
  const m = computeCoveredMargin(100, 60, 1000)
  assert.equal(m.coveredGrossMarginMinor, 40)
  assert.notEqual(m.coveredGrossMarginMinor, 940)
  assert.equal(m.coveragePct, 10)
  assert.equal(m.complete, false)
})

test('100% coverage → full gross margin, marked complete', () => {
  const m = computeCoveredMargin(10_000, 6_000, 10_000)
  assert.equal(m.coveredGrossMarginMinor, 4_000)
  assert.equal(m.coveragePct, 100)
  assert.equal(m.complete, true)
})

test('0% coverage → margin is null (unavailable), never 0', () => {
  const m = computeCoveredMargin(0, 0, 900)
  assert.equal(m.coveredGrossMarginMinor, null)
  assert.equal(m.coveragePct, 0)
  assert.equal(m.complete, false)
})

test('no eligible revenue at all → coverage 0, margin null, not complete', () => {
  const m = computeCoveredMargin(0, 0, 0)
  assert.equal(m.coveragePct, 0)
  assert.equal(m.coveredGrossMarginMinor, null)
  assert.equal(m.complete, false)
})

test('coverage is revenue-weighted, not line-count-weighted', () => {
  // One tiny covered line + one huge uncovered line: coverage tracks money.
  assert.equal(computeCoveredMargin(50, 30, 5_000).coveragePct, 1)
})

test('a supplier / product row uses the identical rule (partial coverage)', () => {
  // Same shape as reports repo BreakdownRow / SupplierProductRow.
  const row = { coveredRevenueMinor: 200, cogsMinor: 150, revenueMinor: 2_000 }
  const m = computeCoveredMargin(row.coveredRevenueMinor, row.cogsMinor, row.revenueMinor)
  assert.equal(m.coveredGrossMarginMinor, 50)
  assert.equal(m.coveragePct, 10)
  assert.equal(m.complete, false)
})

// --- §5  historical label safety ----------------------------------------

test('isUsableLabel rejects U+FFFD, control chars, lone surrogates, blank', () => {
  assert.equal(isUsableLabel('عسل جبلي'), true)
  assert.equal(isUsableLabel('Mountain honey'), true)
  assert.equal(isUsableLabel(allJunk), false)
  assert.equal(isUsableLabel(`الأكثر مبيعًا: ${FFFD}`), false)
  assert.equal(isUsableLabel(`bad${String.fromCharCode(8)}bell`), false) // backspace C0
  assert.equal(isUsableLabel('kept\tthe tab'), true) // tab / LF / CR stay allowed
  assert.equal(isUsableLabel(`${String.fromCharCode(0xd800)}lone`), false)
  assert.equal(isUsableLabel('   '), false)
  assert.equal(isUsableLabel(null), false)
  assert.equal(isUsableLabel(undefined), false)
})

test('fallback chain: AR → EN → SKU → stable human constant', () => {
  assert.equal(safeHistoricalText({ ar: 'عسل', en: 'Honey', sku: 'HN-1' }, 'ar'), 'عسل')
  assert.equal(safeHistoricalText({ ar: allJunk, en: 'Honey', sku: 'HN-1' }, 'ar'), 'Honey')
  assert.equal(safeHistoricalText({ ar: allJunk, en: allJunk, sku: 'HN-1' }, 'ar'), 'HN-1')
  assert.equal(
    safeHistoricalText({ ar: allJunk, en: allJunk, sku: allJunk }, 'ar'),
    HISTORICAL_FALLBACK_AR,
  )
  assert.equal(
    safeHistoricalText({ ar: allJunk, en: allJunk, sku: allJunk }, 'en'),
    HISTORICAL_FALLBACK_EN,
  )
})

test('safeHistoricalLabel flags whether the human fallback was used', () => {
  assert.equal(safeHistoricalLabel({ ar: 'عسل' }).isFallback, false)
  assert.equal(safeHistoricalLabel({ ar: allJunk, en: null, sku: null }).isFallback, true)
})

test('the safe label never contains the corrupted input', () => {
  const out = safeHistoricalText({ ar: junkAr, en: 'Old product', sku: 'OLD-9' }, 'ar')
  assert.ok(!out.includes(FFFD))
  assert.equal(out, 'Old product')
})

// --- §5  mojibake must never reach an insight sentence ----------------------

test('a corrupted top-seller snapshot never produces a U+FFFD insight', () => {
  const rawSnapshot = { ar: `${allJunk}????`, en: '', sku: 'SKU-77' }
  const topSeller = {
    nameAr: safeHistoricalText(rawSnapshot, 'ar'),
    nameEn: safeHistoricalText(rawSnapshot, 'en'),
    units: 42,
  }
  const insights = buildInsights(
    { currentMinor: 100, previousMinor: 100, changePct: 0 },
    {
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
    },
    { processingOrders: 0, deliveringOrders: 0 },
    0,
    0,
    topSeller,
  )
  const top = insights.find((i) => i.code === 'top_seller')
  assert.ok(top, 'expected a top_seller insight')
  assert.ok(!top.textAr.includes(FFFD))
  assert.ok(!top.textEn.includes(FFFD))
  assert.ok(top.textAr.includes('SKU-77'))
})
