/**
 * Bounded retry for a whole transaction on a PostgreSQL serialization/deadlock
 * failure (`40P01 deadlock_detected`, `40001 serialization_failure`).
 *
 * Deterministic per-transaction lock ordering (dedup + sort lines by
 * `variant_id` ASC before touching `inventory_balances`) is the real defence and
 * makes 40P01 unreachable for the current commerce paths. This is a thin safety
 * net for unforeseen future contention: the callback here is a full
 * `db.transaction(...)` that has already rolled back on failure, and every
 * commerce transaction is safe to re-run (checkout is idempotency-keyed; a
 * store sale that fully rolled back leaves nothing behind). It never retries
 * business errors — only the two transient SQLSTATEs — and only twice.
 */
const RETRYABLE_SQLSTATES = new Set(['40P01', '40001'])
const MAX_ATTEMPTS = 3

function isRetryable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string' &&
    RETRYABLE_SQLSTATES.has((err as { code: string }).code)
  )
}

export async function withDeadlockRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run()
    } catch (err) {
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) throw err
      lastErr = err
      // small randomized backoff so contending transactions desynchronize
      await new Promise((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 45)))
    }
  }
  throw lastErr
}
