/**
 * Gate B4 Stage 3 — deterministic, development-only TEST payment provider.
 *
 * Exists only to prove the generic `PaymentProvider` contract end-to-end
 * (createPayment / getPaymentStatus / verifyWebhook / parseWebhook), including
 * the two invariants that matter most for Stage 4:
 *
 *  - IDEMPOTENCY: the same `idempotencyKey` always yields the same
 *    `providerPaymentId`, with no simulated duplicate charge.
 *  - UNKNOWN-INIT RECOVERY: `getPaymentStatus` can resolve the correct
 *    outcome from the durable attempt identity (`idempotencyKey`) alone, even
 *    when `providerPaymentId` was never returned/persisted (an `indeterminate`
 *    create).
 *
 * Both are achieved WITHOUT any stored/in-memory state (Cloudflare Worker
 * isolates are not durable — see Stage 3 §20): the provider payment id is a
 * deterministic, self-describing encoding of `(idempotencyKey, scenario)`, and
 * the scenario is itself a pure function of the input (a magic suffix on the
 * idempotency key, e.g. `...:failed`; default `succeeded`). Decoding an id (or
 * re-deriving one from the same key) always reproduces the same answer.
 *
 * `testScenario` never contaminates the generic `PaymentProvider` interface —
 * it is entirely internal to this factory.
 *
 * Uses only Web-standard APIs (`crypto.subtle`, `TextEncoder`, `btoa`/`atob`)
 * — no `node:*` import — so it type-checks against `@cloudflare/workers-types`
 * alone and runs identically under Workers and plain Node test runs.
 */
import type {
  NormalizedProviderEvent,
  PaymentProvider,
  PaymentProviderReadiness,
  ProviderCreatePaymentInput,
  ProviderCreatePaymentResult,
  ProviderPaymentLookupInput,
  ProviderPaymentLookupResult,
  ProviderPaymentStatus,
  ProviderWebhookParseInput,
  ProviderWebhookVerificationInput,
} from '@likehoney/shared'

export const TEST_PROVIDER_CODE = 'test'
export const TEST_SIGNATURE_HEADER = 'x-test-signature'

/** The full controllable outcome space for the TEST provider. */
export type TestPaymentScenario = ProviderPaymentStatus | 'indeterminate'

const TEST_SCENARIOS: readonly TestPaymentScenario[] = [
  'pending',
  'succeeded',
  'failed',
  'expired',
  'unknown',
  'indeterminate',
]

export interface TestScenarioContext {
  idempotencyKey: string
  merchantReference: string
}

export type TestScenarioResolver = (ctx: TestScenarioContext) => TestPaymentScenario

/**
 * Default resolver: a magic `:<scenario>` suffix on the idempotency key picks
 * the scenario deterministically (e.g. `chk_abc123:failed`); otherwise falls
 * back to `defaultScenario` (`succeeded` unless configured otherwise).
 */
export function magicSuffixScenarioResolver(
  defaultScenario: TestPaymentScenario,
): TestScenarioResolver {
  return (ctx: TestScenarioContext): TestPaymentScenario => {
    const idx = ctx.idempotencyKey.lastIndexOf(':')
    if (idx !== -1) {
      const candidate = ctx.idempotencyKey.slice(idx + 1)
      if ((TEST_SCENARIOS as readonly string[]).includes(candidate)) {
        return candidate as TestPaymentScenario
      }
    }
    return defaultScenario
  }
}

// ---------------------------------------------------------------------------
// Web-standard crypto helpers (no Buffer / node:crypto)
// ---------------------------------------------------------------------------

async function sha256Hex(message: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time-ish comparison of two equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---------------------------------------------------------------------------
// Deterministic, stateless, NON-REVERSIBLE provider-payment-id
// ---------------------------------------------------------------------------
//
// Gate B4 Stage 4 (§5 privacy audit): the Stage-3 version reversibly embedded
// the raw idempotencyKey (base64 is not encryption) inside the provider id —
// a real gateway id is opaque and an id that can leak our internal capability
// token is a privacy defect even in a dev-only tool, since it can appear in
// logs / URLs. This is now a one-way SHA-256 digest: same
// (idempotencyKey, scenario) -> same id; different input -> a different id;
// but the id cannot be reversed back to the idempotency key. Recovery
// (unknown-init, lookup-by-durable-identity) therefore ALWAYS re-derives the
// scenario from `resolver(idempotencyKey, merchantReference)` — never by
// decoding the opaque id — exactly mirroring how a real adapter would look
// its own record up by a durable reference it controls, not by parsing what
// it handed back to us.

async function digestTestPaymentId(
  idempotencyKey: string,
  scenario: TestPaymentScenario,
): Promise<string> {
  const hex = await sha256Hex(`lh-test-payment:${idempotencyKey}:${scenario}`)
  return 'test_' + hex.slice(0, 32)
}

/** `indeterminate` at create time still means "inconclusive" on lookup. */
function scenarioToLookupStatus(scenario: TestPaymentScenario): ProviderPaymentStatus {
  return scenario === 'indeterminate' ? 'unknown' : scenario
}

export interface CreateTestPaymentProviderOptions {
  /** Injectable for direct adapter tests; defaults to the magic-suffix resolver. */
  scenarioResolver?: TestScenarioResolver
  /** Scenario used when the idempotency key carries no magic suffix. */
  defaultScenario?: TestPaymentScenario
  /** TEST-ONLY webhook secret. Never a real provider secret. */
  webhookSecret?: string
}

/** Build a fresh TEST provider instance. Pure factory — no shared state. */
export function createTestPaymentProvider(
  options: CreateTestPaymentProviderOptions = {},
): PaymentProvider {
  const resolver =
    options.scenarioResolver ?? magicSuffixScenarioResolver(options.defaultScenario ?? 'succeeded')
  const webhookSecret = options.webhookSecret

  return {
    code: TEST_PROVIDER_CODE,

    getReadiness(): PaymentProviderReadiness {
      return { configured: true, operational: true, providerCode: TEST_PROVIDER_CODE, blockers: [] }
    },

    async createPayment(input: ProviderCreatePaymentInput): Promise<ProviderCreatePaymentResult> {
      const scenario = resolver({
        idempotencyKey: input.idempotencyKey,
        merchantReference: input.merchantReference,
      })

      if (scenario === 'indeterminate') {
        // Network timeout / ambiguous response simulation — recoverable later
        // via getPaymentStatus using the durable attempt identity, never a
        // fresh createPayment call with the same key.
        return { outcome: 'indeterminate', reason: 'test: simulated indeterminate response' }
      }

      const providerPaymentId = await digestTestPaymentId(input.idempotencyKey, scenario)

      if (scenario === 'failed' || scenario === 'expired') {
        return { outcome: 'definitive_failure', status: scenario, providerPaymentId }
      }
      if (scenario === 'unknown') {
        // A provider never returns "unknown" from creation itself — treat as
        // indeterminate (defensive; scenario space intended for lookup only).
        return { outcome: 'indeterminate', providerPaymentId, reason: 'test: unknown at creation' }
      }

      if (scenario === 'succeeded') {
        // Simulated authoritative confirmation (§2/§3) — legitimate ONLY for
        // a TEST double; a real adapter must never echo the caller's amount.
        return {
          outcome: 'created',
          providerPaymentId,
          redirectUrl: `https://test-provider.invalid/pay/${providerPaymentId}`,
          status: 'succeeded',
          amountMinor: input.amountMinor,
          currency: input.currency,
        }
      }

      return {
        outcome: 'created',
        providerPaymentId,
        redirectUrl: `https://test-provider.invalid/pay/${providerPaymentId}`,
        status: 'pending',
      }
    },

    async getPaymentStatus(
      input: ProviderPaymentLookupInput,
    ): Promise<ProviderPaymentLookupResult> {
      // Always re-derive from the durable attempt identity — never by
      // decoding the (now non-reversible) opaque id. This is the same code
      // path whether providerPaymentId is present or not (unknown-init
      // recovery, §11/§22), so a real adapter's asymmetry between "have the
      // id" and "recovering without it" is deliberately not modelled here.
      const scenario = resolver({
        idempotencyKey: input.idempotencyKey,
        merchantReference: input.merchantReference,
      })
      if (scenario === 'indeterminate') {
        return { status: 'unknown' }
      }

      const providerPaymentId = await digestTestPaymentId(input.idempotencyKey, scenario)
      const status = scenarioToLookupStatus(scenario)

      if (
        status === 'succeeded' &&
        typeof input.expectedAmountMinor === 'number' &&
        typeof input.expectedCurrency === 'string'
      ) {
        return {
          status,
          providerPaymentId,
          amountMinor: input.expectedAmountMinor,
          currency: input.expectedCurrency,
        }
      }
      return { status, providerPaymentId }
    },

    async verifyWebhook(input: ProviderWebhookVerificationInput): Promise<boolean> {
      if (webhookSecret === undefined || webhookSecret.length === 0) return false
      const provided = input.headers[TEST_SIGNATURE_HEADER]
      if (typeof provided !== 'string' || provided.length === 0) return false
      const expected = await hmacSha256Hex(webhookSecret, input.rawBody)
      return timingSafeEqualHex(provided, expected)
    },

    async parseWebhook(input: ProviderWebhookParseInput): Promise<NormalizedProviderEvent> {
      // Deterministic TEST payload shape: { eventId, providerPaymentId, type,
      // status, amountMinor, currency }. No provider-specific fields escape.
      let body: {
        eventId?: unknown
        providerPaymentId?: unknown
        type?: unknown
        status?: unknown
        amountMinor?: unknown
        currency?: unknown
      }
      try {
        body = JSON.parse(input.rawBody)
      } catch {
        throw new Error('test provider: malformed webhook body')
      }
      return {
        providerEventId: typeof body.eventId === 'string' ? body.eventId : 'unknown-event',
        providerPaymentId:
          typeof body.providerPaymentId === 'string' ? body.providerPaymentId : null,
        eventType: typeof body.type === 'string' ? body.type : 'unknown',
        paymentStatus: providerPaymentStatusOrUnknown(body.status),
        amountMinor: typeof body.amountMinor === 'number' ? body.amountMinor : null,
        currency: typeof body.currency === 'string' ? body.currency : null,
      }
    },
  }
}

/** Test helper: compute the signature `verifyWebhook` expects for a body. */
export function signTestWebhookBody(secret: string, rawBody: string): Promise<string> {
  return hmacSha256Hex(secret, rawBody)
}

function providerPaymentStatusOrUnknown(value: unknown): ProviderPaymentStatus {
  const statuses: readonly ProviderPaymentStatus[] = [
    'pending',
    'succeeded',
    'failed',
    'expired',
    'unknown',
  ]
  return typeof value === 'string' && (statuses as readonly string[]).includes(value)
    ? (value as ProviderPaymentStatus)
    : 'unknown'
}
