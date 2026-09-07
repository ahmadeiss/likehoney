/**
 * Like Honey data access.
 *
 * The Drizzle schema (packages/db/src/schema) is the single source of truth
 * for the Like Honey V1 PostgreSQL model — see docs/architecture/DATA_MODEL.md.
 * This package also owns the client factory and the repository layer (service
 * code in apps/api imports repositories, never raw SQL).
 *
 * The browser must never reach Neon directly: this package is only imported
 * from backend code (apps/api).
 */
export * from './client'
export * from './tx-retry'
export * from './schema'
export * from './repositories'
