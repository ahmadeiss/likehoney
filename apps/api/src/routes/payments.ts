/**
 * Gate B4 Stage 4 — server-to-server payment webhook boundary (§30/§31).
 *
 * `POST /api/v1/payments/webhooks/:provider`. The provider is resolved from
 * the ROUTE segment through `resolveProviderByCode` (historical/lineage
 * resolution — never the currently-configured `PAYMENT_PROVIDER`; §4/§30).
 *
 * Order, strictly: raw body → resolve provider → verifyWebhook → ONLY IF
 * verified: parseWebhook → hash → claim (Phase A) → business processing
 * (Phase B, `processPaymentEventService`). An invalid signature never
 * reaches `payment_events` — no row, no mutation, a safe 4xx, and a log line
 * only (never a stack trace / secret / raw body).
 *
 * No public retry/status endpoint lives here — see `services/payments/retry.ts`.
 */
import { Hono } from 'hono'
import { sha256Hex } from '@likehoney/shared'
import { claimEvent, getEvent } from '@likehoney/db'

import type { AppEnv } from '../env'
import { auditActor, auditMeta, recordAudit } from '../services/audit'
import { getDatabase } from '../services/db'
import { resolveProviderByCode } from '../services/payments/registry'
import { processPaymentEventService } from '../services/payments/webhook'

export const paymentsRouter = new Hono<AppEnv>()

const SYSTEM_ACTOR = auditActor(undefined)

paymentsRouter.post('/webhooks/:provider', async (c) => {
  const providerCode = c.req.param('provider')

  const { provider } = resolveProviderByCode(providerCode, c.env)
  if (provider === null) {
    // Unknown / not-allowed provider — reject safely, nothing persisted.
    return c.json(
      { error: { code: 'payment_provider_unavailable', message: 'unknown provider' } },
      400,
    )
  }

  const rawBody = await c.req.text()
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value
  })

  const verified = await provider.verifyWebhook({ rawBody, headers })
  if (!verified) {
    // Security log only — never the raw body, never a stack trace, never
    // reaches payment_events / any business mutation.
    console.warn(`webhook signature verification failed (provider=${providerCode})`)
    return c.json(
      { error: { code: 'invalid_signature', message: 'signature verification failed' } },
      400,
    )
  }

  const normalized = await provider.parseWebhook({ rawBody, headers })
  const payloadHash = await sha256Hex(rawBody)
  const db = getDatabase(c.env)

  // Phase A — short receipt transaction (INSERT ... ON CONFLICT DO NOTHING).
  const claimed = await claimEvent(db, {
    provider: providerCode,
    providerEventId: normalized.providerEventId,
    providerPaymentId: normalized.providerPaymentId,
    type: normalized.eventType,
    payloadHash,
    amountMinor: normalized.amountMinor,
    currency: normalized.currency,
    paymentStatus: normalized.paymentStatus,
  })

  let event = claimed
  if (event === undefined) {
    // §35/§36 — duplicate transport delivery of the same (provider, event id).
    const existing = await getEvent(db, providerCode, normalized.providerEventId)
    if (existing === undefined) {
      return c.json({ error: { code: 'internal_error', message: 'internal server error' } }, 500)
    }
    if (existing.payloadHash !== payloadHash) {
      // Same event id, different payload — integrity anomaly. No mutation,
      // original event untouched, safe controlled response.
      await recordAudit(
        db,
        SYSTEM_ACTOR,
        'payment.webhook_event_conflict',
        'payment_event',
        existing.id,
        auditMeta({ provider: providerCode, providerEventId: normalized.providerEventId }),
      )
      return c.json({ ok: true, conflict: true }, 200)
    }
    if (existing.processedAt !== null) {
      // Already processed — safe idempotent acknowledgement, zero mutation.
      return c.json({ ok: true, duplicate: true }, 200)
    }
    event = existing
  }

  // Phase B — business processing, its own transaction(s), order-lock-first.
  const outcome = await processPaymentEventService(db, event)
  return c.json({ ok: true, outcome })
})
