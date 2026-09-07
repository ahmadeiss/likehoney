/**
 * Gate B4 Stage 3 — direct adapter tests for the TEST payment provider.
 * Pure/unit-level: no DB, no HTTP route, no persistence anywhere.
 *
 * Run:  node --test src/services/payments/test-provider.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createTestPaymentProvider,
  signTestWebhookBody,
  TEST_SIGNATURE_HEADER,
} from './test-provider'

function input(idempotencyKey: string, amountMinor = 1000) {
  return {
    attemptId: 'attempt-1',
    orderId: 'order-1',
    merchantReference: 'LH-000001',
    idempotencyKey,
    amountMinor,
    currency: 'ILS',
  }
}

// --- §46 createPayment scenarios -------------------------------------------

test('createPayment: pending scenario', async () => {
  const provider = createTestPaymentProvider()
  const result = await provider.createPayment(input('k1:pending'))
  assert.equal(result.outcome, 'created')
  assert.equal(result.outcome === 'created' && result.status, 'pending')
})

test('createPayment: synchronous succeeded scenario', async () => {
  const provider = createTestPaymentProvider()
  const result = await provider.createPayment(input('k1:succeeded'))
  assert.equal(result.outcome, 'created')
  assert.equal(result.outcome === 'created' && result.status, 'succeeded')
})

test('createPayment: definitive failed scenario', async () => {
  const provider = createTestPaymentProvider()
  const result = await provider.createPayment(input('k1:failed'))
  assert.equal(result.outcome, 'definitive_failure')
  assert.equal(result.outcome === 'definitive_failure' && result.status, 'failed')
})

test('createPayment: definitive expired scenario', async () => {
  const provider = createTestPaymentProvider()
  const result = await provider.createPayment(input('k1:expired'))
  assert.equal(result.outcome, 'definitive_failure')
  assert.equal(result.outcome === 'definitive_failure' && result.status, 'expired')
})

test('createPayment: indeterminate init (network timeout) is never mapped to failed', async () => {
  const provider = createTestPaymentProvider()
  const result = await provider.createPayment(input('k1:indeterminate'))
  assert.equal(result.outcome, 'indeterminate')
})

test('default scenario is succeeded when no magic suffix is present', async () => {
  const provider = createTestPaymentProvider()
  const result = await provider.createPayment(input('plain-key-no-suffix'))
  assert.equal(result.outcome, 'created')
  assert.equal(result.outcome === 'created' && result.status, 'succeeded')
})

test('default scenario is configurable via options.defaultScenario', async () => {
  const provider = createTestPaymentProvider({ defaultScenario: 'pending' })
  const result = await provider.createPayment(input('plain-key'))
  assert.equal(result.outcome, 'created')
  assert.equal(result.outcome === 'created' && result.status, 'pending')
})

// --- §46 lookup --------------------------------------------------------

test('lookup by providerPaymentId: pending/succeeded/failed/expired/unknown', async () => {
  const provider = createTestPaymentProvider()
  for (const scenario of ['pending', 'succeeded', 'failed', 'expired'] as const) {
    const created = await provider.createPayment(input(`lk:${scenario}`))
    const id =
      created.outcome === 'created' || created.outcome === 'definitive_failure'
        ? created.providerPaymentId
        : undefined
    assert.ok(id, `expected a providerPaymentId for scenario ${scenario}`)
    const looked = await provider.getPaymentStatus({
      providerPaymentId: id,
      idempotencyKey: `lk:${scenario}`,
      merchantReference: 'LH-000001',
    })
    assert.equal(looked.status, scenario)
  }
})

test('lookup: unknown scenario reports status=unknown, never failed/expired/cancelled', async () => {
  const provider = createTestPaymentProvider()
  const looked = await provider.getPaymentStatus({
    providerPaymentId: undefined,
    idempotencyKey: 'lk:unknown',
    merchantReference: 'LH-000001',
  })
  assert.equal(looked.status, 'unknown')
})

// --- §21 idempotency ------------------------------------------------------

test('idempotent create: same idempotencyKey -> same providerPaymentId', async () => {
  const provider = createTestPaymentProvider()
  const a = await provider.createPayment(input('same-key:succeeded'))
  const b = await provider.createPayment(input('same-key:succeeded'))
  assert.equal(a.outcome, 'created')
  assert.equal(b.outcome, 'created')
  assert.equal(
    a.outcome === 'created' && a.providerPaymentId,
    b.outcome === 'created' && b.providerPaymentId,
  )
})

test('different idempotencyKey -> different providerPaymentId (no duplicate-charge collision)', async () => {
  const provider = createTestPaymentProvider()
  const a = await provider.createPayment(input('key-a:succeeded'))
  const b = await provider.createPayment(input('key-b:succeeded'))
  assert.notEqual(
    a.outcome === 'created' && a.providerPaymentId,
    b.outcome === 'created' && b.providerPaymentId,
  )
})

// --- §11/§22 unknown-init recovery -----------------------------------------

test('unknown-init recovery: lookup by idempotencyKey alone resolves the same outcome createPayment would give, with no providerPaymentId ever persisted', async () => {
  const provider = createTestPaymentProvider()
  const key = 'recover-me:succeeded'
  // Simulate: createPayment was called but its response never reached us
  // (indeterminate at the transport layer) — providerPaymentId was never
  // stored. Recovery uses ONLY the durable attempt identity.
  const recovered = await provider.getPaymentStatus({
    idempotencyKey: key,
    merchantReference: 'LH-000001',
  })
  assert.equal(recovered.status, 'succeeded')
  assert.ok(
    recovered.providerPaymentId,
    'recovery should surface a provider identity once resolved',
  )

  // And it matches what createPayment would have returned for the same key.
  const created = await provider.createPayment(input(key))
  assert.equal(
    created.outcome === 'created' && created.providerPaymentId,
    recovered.providerPaymentId,
  )
})

test('unknown-init recovery for a truly indeterminate attempt stays unknown, not a guess', async () => {
  const provider = createTestPaymentProvider()
  const recovered = await provider.getPaymentStatus({
    idempotencyKey: 'recover-indeterminate:indeterminate',
    merchantReference: 'LH-000001',
  })
  assert.equal(recovered.status, 'unknown')
})

// --- §5 Stage-4 privacy audit: provider id must not leak internal tokens --

test('providerPaymentId does not reversibly contain the raw idempotencyKey', async () => {
  const provider = createTestPaymentProvider()
  const secretLookingKey = 'checkout-super-secret-capability-token-abc123:succeeded'
  const result = await provider.createPayment(input(secretLookingKey))
  assert.equal(result.outcome, 'created')
  const id = result.outcome === 'created' ? result.providerPaymentId : ''
  assert.ok(id.length > 0)
  // The raw key (and its non-suffixed prefix) must not appear anywhere in the id.
  assert.doesNotMatch(id, /checkout-super-secret-capability-token-abc123/)
  assert.doesNotMatch(id, /succeeded/)
  // Not merely base64 of the payload either — decode-attempt must not recover it.
  const b64ish = id.replace(/^test_/, '')
  assert.doesNotMatch(Buffer.from(b64ish, 'base64url').toString('utf8'), /checkout-super-secret/)
})

// --- §2/§3 Stage-4 financial confirmation ----------------------------------

test('synchronous success carries provider-confirmed amount/currency', async () => {
  const provider = createTestPaymentProvider()
  const result = await provider.createPayment(input('fin-check:succeeded', 4200))
  assert.equal(result.outcome, 'created')
  assert.equal(result.outcome === 'created' && result.amountMinor, 4200)
  assert.equal(result.outcome === 'created' && result.currency, 'ILS')
})

test('lookup only reports confirmed financials when the caller supplies expected values (TEST simulation aid)', async () => {
  const provider = createTestPaymentProvider()
  const bare = await provider.getPaymentStatus({
    idempotencyKey: 'fin-lookup:succeeded',
    merchantReference: 'LH-000001',
  })
  assert.equal(bare.status, 'succeeded')
  assert.equal(bare.amountMinor, undefined)
  const withExpected = await provider.getPaymentStatus({
    idempotencyKey: 'fin-lookup:succeeded',
    merchantReference: 'LH-000001',
    expectedAmountMinor: 999,
    expectedCurrency: 'ILS',
  })
  assert.equal(withExpected.amountMinor, 999)
  assert.equal(withExpected.currency, 'ILS')
})

// --- §23 webhook verification -----------------------------------------

test('verifyWebhook: valid signature -> true', async () => {
  const secret = 'test-secret-abc'
  const provider = createTestPaymentProvider({ webhookSecret: secret })
  const rawBody = JSON.stringify({ eventId: 'evt_1', type: 'payment.succeeded' })
  const signature = await signTestWebhookBody(secret, rawBody)
  const ok = await provider.verifyWebhook({
    rawBody,
    headers: { [TEST_SIGNATURE_HEADER]: signature },
  })
  assert.equal(ok, true)
})

test('verifyWebhook: invalid signature -> false, nothing persisted', async () => {
  const provider = createTestPaymentProvider({ webhookSecret: 'test-secret-abc' })
  const rawBody = JSON.stringify({ eventId: 'evt_1' })
  const ok = await provider.verifyWebhook({
    rawBody,
    headers: { [TEST_SIGNATURE_HEADER]: 'not-the-right-signature' },
  })
  assert.equal(ok, false)
})

test('verifyWebhook: missing signature header -> false', async () => {
  const provider = createTestPaymentProvider({ webhookSecret: 'test-secret-abc' })
  const ok = await provider.verifyWebhook({ rawBody: '{}', headers: {} })
  assert.equal(ok, false)
})

test('verifyWebhook: no webhookSecret configured -> always false', async () => {
  const provider = createTestPaymentProvider()
  const ok = await provider.verifyWebhook({
    rawBody: '{}',
    headers: { [TEST_SIGNATURE_HEADER]: 'anything' },
  })
  assert.equal(ok, false)
})

// --- §24 webhook event parsing -----------------------------------------

test('parseWebhook: success/pending/failed/expired normalize correctly', async () => {
  const provider = createTestPaymentProvider()
  for (const status of ['succeeded', 'pending', 'failed', 'expired'] as const) {
    const rawBody = JSON.stringify({
      eventId: `evt_${status}`,
      providerPaymentId: 'test_abc',
      type: `payment.${status}`,
      status,
      amountMinor: 1000,
      currency: 'ILS',
    })
    const event = await provider.parseWebhook({ rawBody, headers: {} })
    assert.equal(event.providerEventId, `evt_${status}`)
    assert.equal(event.providerPaymentId, 'test_abc')
    assert.equal(event.paymentStatus, status)
    assert.equal(event.amountMinor, 1000)
    assert.equal(event.currency, 'ILS')
  }
})

test('parseWebhook: unrecognized status normalizes to unknown, never throws business truth', async () => {
  const provider = createTestPaymentProvider()
  const event = await provider.parseWebhook({
    rawBody: JSON.stringify({ eventId: 'evt_x', type: 'payment.weird', status: 'nonsense' }),
    headers: {},
  })
  assert.equal(event.paymentStatus, 'unknown')
})
