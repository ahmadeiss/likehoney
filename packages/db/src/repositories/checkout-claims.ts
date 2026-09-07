/**
 * Checkout idempotency claim data access.
 *
 * `claimCheckout` uses the non-error conflict path (`ON CONFLICT DO NOTHING
 * RETURNING`): a returned row means THIS transaction owns the logical checkout;
 * no row means the key already exists (the caller then loads the committed claim
 * and compares fingerprints). A concurrent duplicate INSERT blocks on the unique
 * `claim_key` until the owning transaction commits or rolls back — the guarantee
 * is PostgreSQL's, so it holds across Worker isolates. Never catch a UNIQUE
 * violation inside the transaction (that would abort it).
 */
import { eq, sql } from 'drizzle-orm'

import type { DbClient } from '../client'
import { checkoutClaims } from '../schema'

export type CheckoutClaimRow = typeof checkoutClaims.$inferSelect

/**
 * `SET LOCAL lock_timeout` for the current transaction. A concurrent duplicate
 * checkout whose claim INSERT waits longer than this raises `55P03`, which the
 * service maps to a retryable `checkout_processing`. `value` is a trusted
 * literal (e.g. `'5s'`), never user input.
 */
export async function setLocalLockTimeout(db: DbClient, value: string): Promise<void> {
  await db.execute(sql.raw(`SET LOCAL lock_timeout = '${value}'`))
}

/**
 * Try to claim `claimKey` for this transaction. Returns the new row when this
 * caller is the owner, or `undefined` when the key already exists.
 */
export async function claimCheckout(
  db: DbClient,
  claimKey: string,
  requestFingerprint: string,
): Promise<CheckoutClaimRow | undefined> {
  const rows = await db
    .insert(checkoutClaims)
    .values({ claimKey, requestFingerprint, status: 'in_progress' })
    .onConflictDoNothing({ target: checkoutClaims.claimKey })
    .returning()
  return rows[0]
}

export async function getCheckoutClaim(
  db: DbClient,
  claimKey: string,
): Promise<CheckoutClaimRow | undefined> {
  const rows = await db
    .select()
    .from(checkoutClaims)
    .where(eq(checkoutClaims.claimKey, claimKey))
    .limit(1)
  return rows[0]
}

/** Mark an owned claim completed with its order + safe replay payload. */
export async function completeCheckoutClaim(
  db: DbClient,
  claimKey: string,
  orderId: string,
  resultJson: string,
): Promise<void> {
  await db
    .update(checkoutClaims)
    .set({ status: 'completed', orderId, resultJson, updatedAt: new Date() })
    .where(eq(checkoutClaims.claimKey, claimKey))
}
