/**
 * Worker environment contract. Bindings and secrets are read from the Wrangler
 * configuration / `.dev.vars` at runtime — never hard-coded.
 *
 * - `DATABASE_URL` is a secret read by `packages/db` (Neon). When absent the
 *   API answers 503 `db_unavailable` for any DB-backed endpoint.
 * - `MEDIA_BUCKET` is the R2 binding declared in `wrangler.jsonc`.
 * - `APP_ENV` marks the development environment; development-only behavior
 *   (the dev identity fallback and the staff-options bootstrap) is served only
 *   when it is exactly `development` (fail-closed otherwise).
 */
export interface Env {
  DATABASE_URL?: string
  MEDIA_BUCKET?: R2Bucket
  /**
   * Deployment environment marker. Must be exactly `development` for any
   * development-only behavior (dev identity fallback, staff-options bootstrap),
   * and never set for production deploys so those paths fail closed.
   */
  APP_ENV?: string
  /** Session lifetime in hours (default 12). Development override allowed. */
  SESSION_HOURS?: string
  /**
   * Whether session cookies must be marked Secure. Defaults to `true` except in
   * development (where local hosts are plain HTTP). Production should leave it
   * unset (Secure on).
   */
  SECURE_COOKIES?: string
  /**
   * Gate B4 Stage 3 — the configured electronic payment provider code (e.g.
   * `test` in development; a real gateway slug from B5 onward). Absent ⇒ no
   * provider configured. The provider registry (not scattered `if` checks) is
   * the only place this is read. `test` is refused whenever `APP_ENV` is not
   * exactly `development` — fail-closed, mirrors the dev-identity pattern.
   */
  PAYMENT_PROVIDER?: string
  /**
   * Development-only TEST provider controls. Never a real provider secret —
   * used only to prove the generic webhook-verification contract locally.
   */
  TEST_PAYMENT_WEBHOOK_SECRET?: string
  /**
   * Development-only: the TEST provider's default scenario
   * (`pending|succeeded|failed|expired|unknown|indeterminate`) when a caller
   * doesn't encode one into the idempotency key. Defaults to `succeeded`.
   */
  TEST_PAYMENT_DEFAULT_SCENARIO?: string
}

/** Hono environment tuple for typed bindings across every router. */
export type AppEnv = { Bindings: Env }

/** The exact marker that enables development-only behavior. */
export const DEV_APP_ENV = 'development'

/** The name of the HttpOnly staff session cookie. */
export const SESSION_COOKIE_NAME = 'lh_staff_session'
