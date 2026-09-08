/**
 * API versioning contract.
 *
 * Production endpoints will be served under the versioned prefix defined here
 * so that clients and services share a single source of truth.
 */
export const API_VERSION = 'v1' as const

export const API_PREFIX = `/api/${API_VERSION}` as const

// Domain contracts: identifiers, money, SKU, phone and bilingual-label rules
// shared by the storefront, the API and the database layer. Pure helpers only —
// no database imports; database lives in packages/db.
export * from './domain/customer-analytics'
export * from './domain/category-icons'
export * from './domain/errors'
export * from './domain/fingerprint'
export * from './domain/identifiers'
export * from './domain/inventory-availability'
export * from './domain/localization'
export * from './domain/margin'
export * from './domain/money'
export * from './domain/payments'
export * from './domain/phone'
export * from './domain/provider-payments'
export * from './domain/safe-label'
export * from './domain/sellability'
export * from './domain/sku'
export * from './domain/slugs'
export * from './domain/time'

// Wire contracts: Zod schemas validating every API request input shape.
export * from './contracts'
