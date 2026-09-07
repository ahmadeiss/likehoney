/**
 * Reviews Gate — service-level proof. Pure/unit: the verification DECISION is
 * a pure function tested directly; submit + moderation + public-read run
 * against a hand-built fake `DbClient` (same style as `admin-orders.test.ts`),
 * no real Postgres, no Worker runtime.
 *
 * Covers:
 *  §6/§7/§8/§46 submit validation — valid 1★/5★ → ok; 0/6/-1/decimal/NaN/
 *      string rating → rejected; blank / whitespace / oversized text →
 *      rejected (never truncated); privileged fields (`status`, `approved`,
 *      `verifiedPurchase`, …) → rejected by the strict schema.
 *  §9 submit — always lands `pending`, never verified without evidence.
 *  §10/§11/§12/§48 verified purchase — completed online order / any store
 *      sale for the supplied phone → verified; processing / cancelled /
 *      unknown phone / linked-customer-only / reference-phone-mismatch →
 *      NOT verified.
 *  §5/§46 public read — approved-only projection carries NO private field.
 *  §15/§20/§22/§47 moderation — pending→approve, pending→reject, duplicate
 *      approve idempotent, rejected→approved correction clears `rejectedAt`,
 *      missing review → NotFound, missing moderator → Conflict.
 *
 * Run:  node --test src/services/reviews-gate.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ConflictError, NotFoundError, publicReviewSubmitSchema } from '@likehoney/shared'
import { auditLogs, storeReviews, type DbClient } from '@likehoney/db'

import {
  decideVerification,
  getAdminReviewDetailService,
  listPublicApprovedReviewsService,
  moderateReviewService,
  submitPublicReviewService,
  type VerificationEvidence,
} from './reviews'

// ---------------------------------------------------------------------------
// §6/§7/§8/§46 — submit validation (pure schema, no DB)
// ---------------------------------------------------------------------------

const okBody = {
  displayName: 'سارة',
  rating: 5,
  reviewText: 'خدمة رائعة وتوصيل سريع، شكراً لكم.',
}

test('§46 valid 5-star and 1-star reviews pass validation', () => {
  assert.equal(publicReviewSubmitSchema.safeParse(okBody).success, true)
  assert.equal(publicReviewSubmitSchema.safeParse({ ...okBody, rating: 1 }).success, true)
})

test('§6 invalid ratings (0, 6, -1, decimal, NaN, string) are rejected — never coerced', () => {
  for (const rating of [0, 6, -1, 4.5, Number.NaN, '5']) {
    assert.equal(
      publicReviewSubmitSchema.safeParse({ ...okBody, rating }).success,
      false,
      `rating ${String(rating)} must be rejected`,
    )
  }
})

test('§7 blank / whitespace-only / too-short / oversized text is rejected (never truncated)', () => {
  assert.equal(
    publicReviewSubmitSchema.safeParse({ ...okBody, reviewText: '     ' }).success,
    false,
  )
  assert.equal(publicReviewSubmitSchema.safeParse({ ...okBody, reviewText: 'قصير' }).success, false)
  assert.equal(
    publicReviewSubmitSchema.safeParse({ ...okBody, reviewText: 'ن'.repeat(1001) }).success,
    false,
  )
  assert.equal(publicReviewSubmitSchema.safeParse({ ...okBody, displayName: 'ا' }).success, false)
})

test('§8 privileged moderation / verification fields are rejected by the strict schema', () => {
  for (const extra of [
    { status: 'approved' },
    { approved: true },
    { verifiedPurchase: true },
    { customerId: '00000000-0000-4000-8000-000000000000' },
    { moderatedBy: 'staff-1' },
    { approvedAt: '2026-01-01T00:00:00Z' },
  ]) {
    assert.equal(
      publicReviewSubmitSchema.safeParse({ ...okBody, ...extra }).success,
      false,
      `${JSON.stringify(extra)} must be rejected`,
    )
  }
})

// ---------------------------------------------------------------------------
// §10/§11/§12/§48 — verified-purchase decision (pure)
// ---------------------------------------------------------------------------

const PHONE = '970590000000'
function evidence(over: Partial<VerificationEvidence> = {}): VerificationEvidence {
  return {
    usablePhone: PHONE,
    customerId: null,
    referenceResolved: undefined,
    hasCompletedOnlineOrder: false,
    hasStoreSale: false,
    ...over,
  }
}

test('§48 completed online order for the supplied phone → verified online_order', () => {
  const d = decideVerification(evidence({ hasCompletedOnlineOrder: true }))
  assert.deepEqual([d.verifiedPurchase, d.verifiedSource], [true, 'online_order'])
})

test('§48 any store sale for the supplied phone → verified store_sale', () => {
  const d = decideVerification(evidence({ hasStoreSale: true }))
  assert.deepEqual([d.verifiedPurchase, d.verifiedSource], [true, 'store_sale'])
})

test('§12 a reference whose snapshot phone matches + completed → verified via that source', () => {
  const d = decideVerification(
    evidence({
      referenceResolved: { kind: 'online_order', phoneNormalized: PHONE, completed: true },
    }),
  )
  assert.deepEqual([d.verifiedPurchase, d.verifiedSource], [true, 'online_order'])
})

test('§10/§12 reference that is NOT completed → NOT verified', () => {
  const d = decideVerification(
    evidence({
      referenceResolved: { kind: 'online_order', phoneNormalized: PHONE, completed: false },
    }),
  )
  assert.equal(d.verifiedPurchase, false)
})

test('§12 reference whose snapshot phone does not match the supplied phone → NOT verified', () => {
  const d = decideVerification(
    evidence({
      referenceResolved: { kind: 'online_order', phoneNormalized: '970591111111', completed: true },
    }),
  )
  assert.equal(d.verifiedPurchase, false)
})

test('§48 no phone at all → NOT verified', () => {
  const d = decideVerification(evidence({ usablePhone: null }))
  assert.deepEqual([d.verifiedPurchase, d.verifiedSource], [false, null])
})

test('§11 a linked CRM customer alone (no completed transaction) → NOT verified', () => {
  const d = decideVerification(evidence({ customerId: 'cust-1' }))
  assert.equal(d.verifiedPurchase, false)
  assert.equal(d.customerId, 'cust-1', 'linkage still recorded privately')
})

// ---------------------------------------------------------------------------
// Fake DbClient (submit / read / moderation)
// ---------------------------------------------------------------------------

interface ReviewFx {
  id: string
  displayName: string
  rating: number
  reviewText: string
  status: 'pending' | 'approved' | 'rejected'
  verifiedPurchase: boolean
  verifiedSource: 'online_order' | 'store_sale' | null
  customerId: string | null
  submittedPhoneNormalized: string | null
  submittedReference: string | null
  moderatedByStaffId: string | null
  moderatedAt: Date | null
  moderationNote: string | null
  approvedAt: Date | null
  rejectedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface FakeState {
  reviews: ReviewFx[]
  inserted: Record<string, unknown>[]
  audits: Record<string, unknown>[]
}

function emptyState(): FakeState {
  return { reviews: [], inserted: [], audits: [] }
}

function baseReview(over: Partial<ReviewFx> = {}): ReviewFx {
  const now = new Date('2026-02-01T00:00:00.000Z')
  return {
    id: 'rev-1',
    displayName: 'أم يزن',
    rating: 5,
    reviewText: 'تجربة تسوق ممتازة من زي العسل، التغليف مرتب والتوصيل سريع جداً.',
    status: 'pending',
    verifiedPurchase: false,
    verifiedSource: null,
    customerId: null,
    submittedPhoneNormalized: null,
    submittedReference: null,
    moderatedByStaffId: null,
    moderatedAt: null,
    moderationNote: null,
    approvedAt: null,
    rejectedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

/** Identity-based table id — avoids a `drizzle-orm` runtime import. */
function safeTableName(t: unknown): string {
  if (t === storeReviews) return 'store_reviews'
  if (t === auditLogs) return 'audit_logs'
  return 'other'
}

function node(resolve: () => unknown) {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'limit', 'offset', 'orderBy', 'groupBy', 'leftJoin', 'for']) {
    chain[m] = () => chain
  }
  chain.returning = () => Promise.resolve(resolve())
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(res, rej)
  chain.catch = (rej: (e: unknown) => unknown) => Promise.resolve(resolve()).catch(rej)
  chain.finally = (f: () => void) => Promise.resolve(resolve()).finally(f)
  return chain
}

/**
 * Only ever fed EMPTY commercial tables in these tests (the verification
 * matrix is covered purely above), so the evidence `select`s legitimately
 * resolve to `[]` and every submit here is unverified — exactly what §9
 * needs to prove.
 */
function makeFakeDb(state: FakeState): DbClient {
  const db = {
    select(projection?: Record<string, unknown>) {
      let table = ''
      let sawOrderBy = false
      let sawOffset = false
      const proj = projection ?? {}
      const grouped = 'status' in proj && 'n' in proj
      const agg = 'n' in proj || 'avg' in proj
      const chain = node(() => {
        if (table !== 'store_reviews') return []
        if (grouped) {
          const counts = new Map<string, number>()
          for (const r of state.reviews) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
          return [...counts].map(([status, n]) => ({ status, n }))
        }
        if (agg) {
          const approved = state.reviews.filter((r) => r.status === 'approved')
          const sum = approved.reduce((a, r) => a + r.rating, 0)
          return [
            { n: approved.length, avg: approved.length ? String(sum / approved.length) : null },
          ]
        }
        // Public `listApprovedReviews` = orderBy + limit, no offset → the WHERE
        // clause is `status = 'approved'`, which the fake mirrors here.
        if (sawOrderBy && !sawOffset) {
          return state.reviews.filter((r) => r.status === 'approved')
        }
        return state.reviews
      })
      chain.from = (t: unknown) => {
        table = safeTableName(t)
        return chain
      }
      chain.orderBy = () => {
        sawOrderBy = true
        return chain
      }
      chain.offset = () => {
        sawOffset = true
        return chain
      }
      return chain
    },
    insert(t: unknown) {
      const table = safeTableName(t)
      let values: Record<string, unknown> = {}
      const chain = node(() => {
        if (table === 'store_reviews') {
          const row = baseReview(values as Partial<ReviewFx>)
          row.id = `rev-${state.reviews.length + 1}`
          state.reviews.push(row)
          state.inserted.push(values)
          return [row]
        }
        if (table === 'audit_logs') {
          state.audits.push(values)
          return [{ id: `audit-${state.audits.length}`, ...values }]
        }
        return [{}]
      })
      chain.values = (v: Record<string, unknown>) => {
        values = v
        return chain
      }
      return chain
    },
    update(t: unknown) {
      const table = safeTableName(t)
      let patch: Record<string, unknown> = {}
      const chain = node(() => {
        if (table !== 'store_reviews') return []
        const target = patch.status as ReviewFx['status']
        const legalFrom = target === 'approved' ? ['pending', 'rejected'] : ['pending', 'approved']
        const idx = state.reviews.findIndex((r) => legalFrom.includes(r.status))
        if (idx === -1) return []
        state.reviews[idx] = { ...state.reviews[idx]!, ...(patch as Partial<ReviewFx>) }
        return [state.reviews[idx]]
      })
      chain.set = (p: Record<string, unknown>) => {
        patch = p
        return chain
      }
      return chain
    },
  }
  return db as unknown as DbClient
}

// ---------------------------------------------------------------------------
// §9 — submit always lands pending
// ---------------------------------------------------------------------------

test('§9 a 5-star submission with no verification data → pending + unverified', async () => {
  const state = emptyState()
  const res = await submitPublicReviewService(makeFakeDb(state), {
    displayName: 'أم يزن',
    rating: 5,
    reviewText: 'أفضل متجر أطفال جربته، الجودة ممتازة والخدمة سريعة.',
  })
  assert.equal(res.status, 'pending')
  assert.equal(state.inserted.length, 1)
  assert.equal(state.inserted[0]!.status, 'pending')
  assert.equal(state.inserted[0]!.verifiedPurchase, false)
  assert.equal(state.inserted[0]!.verifiedSource, null)
})

test('§9/§13 submit response is generic — no verification / order detail', async () => {
  const res = await submitPublicReviewService(makeFakeDb(emptyState()), {
    displayName: 'خالد',
    rating: 4,
    reviewText: 'المنتجات جيدة والأسعار مناسبة، سأعود للشراء.',
    phone: '0590000000',
    orderReference: 'LH-000005',
  })
  assert.deepEqual(Object.keys(res).sort(), ['id', 'status'])
  assert.equal(res.status, 'pending')
})

// ---------------------------------------------------------------------------
// §5/§46 — public read exposes nothing private
// ---------------------------------------------------------------------------

test('§5 public approved list carries only the safe projection; pending/rejected absent', async () => {
  const state = emptyState()
  state.reviews = [
    baseReview({
      id: 'rev-approved',
      status: 'approved',
      verifiedPurchase: true,
      verifiedSource: 'online_order',
      customerId: 'cust-9',
      submittedPhoneNormalized: '970590000000',
      submittedReference: 'LH-000005',
      moderationNote: 'internal note',
      moderatedByStaffId: 'staff-1',
      approvedAt: new Date('2026-02-02T00:00:00.000Z'),
    }),
    baseReview({ id: 'rev-pending', status: 'pending' }),
    baseReview({ id: 'rev-rejected', status: 'rejected' }),
  ]

  const res = await listPublicApprovedReviewsService(makeFakeDb(state), 12)
  assert.equal(res.data.length, 1)
  assert.deepEqual(Object.keys(res.data[0]!).sort(), [
    'createdAt',
    'displayName',
    'id',
    'rating',
    'reviewText',
    'verifiedPurchase',
  ])
  const serialized = JSON.stringify(res)
  for (const secret of ['970590000000', 'cust-9', 'internal note', 'staff-1', 'LH-000005']) {
    assert.ok(!serialized.includes(secret), `public payload must not contain ${secret}`)
  }
  assert.equal(res.summary.count, 1)
  assert.equal(res.summary.average, 5)
})

// ---------------------------------------------------------------------------
// §15/§20/§22/§47 — moderation transitions
// ---------------------------------------------------------------------------

function stateWith(status: ReviewFx['status']): FakeState {
  const s = emptyState()
  s.reviews = [baseReview({ id: 'rev-1', status })]
  return s
}

test('§20/§47 pending → approve stamps moderator + approvedAt and writes one audit row', async () => {
  const state = stateWith('pending')
  const detail = await moderateReviewService(
    makeFakeDb(state),
    'rev-1',
    'approve',
    'staff-1',
    undefined,
  )
  assert.equal(detail.status, 'approved')
  assert.equal(detail.moderatedByStaffId, 'staff-1')
  assert.ok(detail.approvedAt)
  assert.equal(state.audits.length, 1)
  assert.equal(state.audits[0]!.action, 'review.approved')
})

test('§21/§47 pending → reject stamps moderator + rejectedAt', async () => {
  const state = stateWith('pending')
  const detail = await moderateReviewService(
    makeFakeDb(state),
    'rev-1',
    'reject',
    'staff-1',
    'مخالف',
  )
  assert.equal(detail.status, 'rejected')
  assert.ok(detail.rejectedAt)
  assert.equal(state.audits[0]!.action, 'review.rejected')
})

test('§22 duplicate approve is an idempotent no-op — no second write, no audit', async () => {
  const state = stateWith('approved')
  const detail = await moderateReviewService(
    makeFakeDb(state),
    'rev-1',
    'approve',
    'staff-1',
    undefined,
  )
  assert.equal(detail.status, 'approved')
  assert.equal(state.audits.length, 0)
})

test('§22 rejected → approved correction clears rejectedAt so stale state cannot re-publish', async () => {
  const state = stateWith('rejected')
  const detail = await moderateReviewService(
    makeFakeDb(state),
    'rev-1',
    'approve',
    'staff-1',
    undefined,
  )
  assert.equal(detail.status, 'approved')
  assert.equal(detail.rejectedAt, null)
})

test('§47 moderating a missing review → NotFoundError', async () => {
  await assert.rejects(
    () => moderateReviewService(makeFakeDb(emptyState()), 'nope', 'approve', 'staff-1', undefined),
    NotFoundError,
  )
})

test('§20 moderating without a moderator identity → ConflictError (no orphan moderation)', async () => {
  await assert.rejects(
    () =>
      moderateReviewService(
        makeFakeDb(stateWith('pending')),
        'rev-1',
        'approve',
        undefined,
        undefined,
      ),
    ConflictError,
  )
})

test('§19 admin detail throws NotFound for an unknown id', async () => {
  await assert.rejects(
    () => getAdminReviewDetailService(makeFakeDb(emptyState()), 'missing'),
    NotFoundError,
  )
})
