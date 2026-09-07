/**
 * Internal CRM customer identity — data access.
 *
 * Gate C: a `customers` row is the durable business identity for a phone
 * number, independent of any consent flag (see `schema/customers.ts`).
 */
import { and, count, eq, ne, sql } from 'drizzle-orm'

import type { DbClient } from '../client'
import { customers, orders, storeSales } from '../schema'

export type CustomerRow = typeof customers.$inferSelect
export type CustomerNew = typeof customers.$inferInsert

export async function getCustomerByPhone(
  db: DbClient,
  phoneNormalized: string,
): Promise<CustomerRow | undefined> {
  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.phoneNormalized, phoneNormalized))
    .limit(1)
  return rows[0]
}

export async function getCustomerById(db: DbClient, id: string): Promise<CustomerRow | undefined> {
  const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1)
  return rows[0]
}

export interface ResolveCustomerInput {
  phoneNormalized: string
  /** Current transaction's name/city/address — becomes the profile's new
   *  CURRENT value only when non-empty; never clears a known value with an
   *  empty one from a later, less-complete transaction. */
  nameEn?: string | null
  nameAr?: string | null
  cityEn?: string | null
  cityAr?: string | null
  addressEn?: string | null
  addressAr?: string | null
  /** Explicit opt-in signals from THIS transaction; consent is a monotonic
   *  OR across every transaction — never revoked by a later transaction
   *  simply omitting it. */
  consentToStoreData?: boolean
  consentToContact?: boolean
  seenAt: Date
}

/**
 * Concurrency-safe resolve-or-create (§7): a single `INSERT ... ON CONFLICT
 * (phone_normalized) DO UPDATE` statement — the database's own unique
 * constraint is the race guard, not a SELECT-then-INSERT/UPDATE round trip
 * (which two concurrent checkouts for the same new phone could both pass the
 * SELECT half of, produce two INSERTs, and have one fail — or worse, if the
 * constraint were absent, two rows). `updatedAt`/`lastSeenAt` always advance;
 * `firstSeenAt` is COALESCEd so it only ever gets set once, on true creation.
 * `status` is never touched here — a resolve/link action never silently
 * revives an Admin-archived profile.
 */
export async function resolveCustomerByPhone(
  db: DbClient,
  input: ResolveCustomerInput,
): Promise<CustomerRow> {
  const rows = await db
    .insert(customers)
    .values({
      phoneNormalized: input.phoneNormalized,
      firstNameEn: input.nameEn ?? null,
      firstNameAr: input.nameAr ?? null,
      cityEn: input.cityEn ?? null,
      cityAr: input.cityAr ?? null,
      addressEn: input.addressEn ?? null,
      addressAr: input.addressAr ?? null,
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
      consentToStoreData: input.consentToStoreData ?? false,
      consentToContact: input.consentToContact ?? false,
      consentGivenAt: input.consentToStoreData || input.consentToContact ? input.seenAt : null,
    })
    .onConflictDoUpdate({
      target: customers.phoneNormalized,
      set: {
        // "Latest non-empty wins" (§8): COALESCE the incoming value with the
        // existing column so a transaction that didn't collect e.g. an
        // address never blanks out an address a prior transaction did.
        firstNameEn: sql`coalesce(nullif(excluded.first_name_en, ''), ${customers.firstNameEn})`,
        firstNameAr: sql`coalesce(nullif(excluded.first_name_ar, ''), ${customers.firstNameAr})`,
        cityEn: sql`coalesce(nullif(excluded.city_en, ''), ${customers.cityEn})`,
        cityAr: sql`coalesce(nullif(excluded.city_ar, ''), ${customers.cityAr})`,
        addressEn: sql`coalesce(nullif(excluded.address_en, ''), ${customers.addressEn})`,
        addressAr: sql`coalesce(nullif(excluded.address_ar, ''), ${customers.addressAr})`,
        firstSeenAt: sql`coalesce(${customers.firstSeenAt}, excluded.first_seen_at)`,
        lastSeenAt: sql`excluded.last_seen_at`,
        consentToStoreData: sql`${customers.consentToStoreData} OR excluded.consent_to_store_data`,
        consentToContact: sql`${customers.consentToContact} OR excluded.consent_to_contact`,
        consentGivenAt: sql`coalesce(${customers.consentGivenAt}, excluded.consent_given_at)`,
        updatedAt: sql`now()`,
      },
    })
    .returning()
  return rows[0] as CustomerRow
}

export interface CustomerListQuery {
  page: number
  pageSize: number
  search?: string
  status?: 'active' | 'inactive'
  /** Derived from linked COMPLETED transaction history (§Gate C). */
  channel?: 'online' | 'store' | 'both'
  /**
   * Purchase-behaviour classification (§Gate C final):
   *  `no_purchase` = 0 completed transactions · `new` = exactly 1 ·
   *  `returning` = ≥2. Zero and one are never merged.
   */
  type?: 'new' | 'returning' | 'no_purchase'
  /** Has a completed transaction whose LAST one is older than N days.
   *  Never-buyers are excluded (they are `type=no_purchase`). */
  inactiveDays?: number
}

export interface CustomerListRow {
  id: string
  phoneNormalized: string
  firstNameEn: string | null
  firstNameAr: string | null
  cityEn: string | null
  cityAr: string | null
  status: 'active' | 'inactive'
  firstSeenAt: Date | null
  lastSeenAt: Date | null
}

/**
 * Directory listing with SERVER-SIDE operational filters (Gate C final).
 * Channel / new-returning / inactivity all derive from the customer's linked
 * COMPLETED transactions — online orders with `status = 'completed'` plus
 * every store sale (the register has no pending state). Cancelled, pending
 * and failed never count. Anonymous POS sales carry no `customer_id`, so they
 * never produce a directory row. One SQL statement; never a client-side pass.
 */
export async function listCustomers(
  db: DbClient,
  query: CustomerListQuery,
): Promise<{ rows: CustomerListRow[]; total: number }> {
  const filters: ReturnType<typeof sql>[] = []
  if (query.status !== undefined) filters.push(sql`c.status = ${query.status}`)
  if (query.search !== undefined && query.search.length > 0) {
    const like = `%${query.search}%`
    filters.push(
      sql`(c.phone_normalized ILIKE ${like} OR c.first_name_ar ILIKE ${like} OR c.first_name_en ILIKE ${like} OR c.last_name_ar ILIKE ${like} OR c.last_name_en ILIKE ${like})`,
    )
  }
  if (query.channel === 'online') filters.push(sql`(a.online_completed > 0 AND a.store_count = 0)`)
  else if (query.channel === 'store')
    filters.push(sql`(a.store_count > 0 AND a.online_completed = 0)`)
  else if (query.channel === 'both')
    filters.push(sql`(a.online_completed > 0 AND a.store_count > 0)`)

  // Purchase-behaviour: 0 (no_purchase) / exactly 1 (new) / ≥2 (returning) —
  // zero and one are NEVER merged.
  if (query.type === 'no_purchase') filters.push(sql`(a.online_completed + a.store_count) = 0`)
  else if (query.type === 'new') filters.push(sql`(a.online_completed + a.store_count) = 1`)
  else if (query.type === 'returning') filters.push(sql`(a.online_completed + a.store_count) >= 2`)

  if (query.inactiveDays !== undefined) {
    // Only customers who HAVE completed a purchase but not recently — a
    // never-buyer is not "inactive for N days", they belong to no_purchase.
    const cutoff = new Date(Date.now() - query.inactiveDays * 86_400_000)
    filters.push(sql`(a.last_completed_at IS NOT NULL AND a.last_completed_at < ${cutoff})`)
  }

  const whereClause = filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``

  const fromClause = sql`
    FROM customers c
    JOIN LATERAL (
      SELECT
        (SELECT count(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') AS online_completed,
        (SELECT count(*) FROM store_sales s WHERE s.customer_id = c.id) AS store_count,
        greatest(
          (SELECT max(o.completed_at) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed'),
          (SELECT max(s.created_at) FROM store_sales s WHERE s.customer_id = c.id)
        ) AS last_completed_at
    ) a ON true
    ${whereClause}
  `

  const totalRes = await db.execute(sql`SELECT count(*)::int AS n ${fromClause}`)
  const total = Number(
    ((totalRes as unknown as { rows?: Record<string, unknown>[] }).rows ?? [])[0]?.n ?? 0,
  )

  const rowsRes = await db.execute(sql`
    SELECT c.id, c.phone_normalized, c.first_name_en, c.first_name_ar,
      c.city_en, c.city_ar, c.status, c.first_seen_at, c.last_seen_at
    ${fromClause}
    ORDER BY c.last_seen_at DESC NULLS LAST
    LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
  `)
  const raw = (rowsRes as unknown as { rows?: Record<string, unknown>[] }).rows ?? []

  const rows: CustomerListRow[] = raw.map((r) => ({
    id: String(r.id),
    phoneNormalized: String(r.phone_normalized),
    firstNameEn: (r.first_name_en as string | null) ?? null,
    firstNameAr: (r.first_name_ar as string | null) ?? null,
    cityEn: (r.city_en as string | null) ?? null,
    cityAr: (r.city_ar as string | null) ?? null,
    status: r.status as 'active' | 'inactive',
    firstSeenAt: r.first_seen_at ? new Date(r.first_seen_at as string) : null,
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string) : null,
  }))

  return { rows, total }
}

/**
 * Server-computed new-vs-returning classification for a Customer card
 * (§54/§58, refined §Gate C final): `true` when this identity has at least
 * one OTHER **completed** commercial transaction besides the one being
 * viewed — a completed online order (`status = 'completed'`) or any store
 * sale (always completed). An in-progress / cancelled order is NOT a prior
 * purchase, so viewing a customer whose only other order is still processing
 * yields `false` ("new"), which is the honest answer. Never client-side,
 * never a cached counter.
 */
export async function customerHasOtherTransactions(
  db: DbClient,
  customerId: string,
  exclude: { orderId?: string; storeSaleId?: string } = {},
): Promise<boolean> {
  const orderWhere = and(
    eq(orders.customerId, customerId),
    eq(orders.status, 'completed'),
    exclude.orderId !== undefined ? ne(orders.id, exclude.orderId) : undefined,
  )
  const saleWhere = and(
    eq(storeSales.customerId, customerId),
    exclude.storeSaleId !== undefined ? ne(storeSales.id, exclude.storeSaleId) : undefined,
  )
  const [orderRows, saleRows] = await Promise.all([
    db.select({ id: orders.id }).from(orders).where(orderWhere).limit(1),
    db.select({ id: storeSales.id }).from(storeSales).where(saleWhere).limit(1),
  ])
  return orderRows.length > 0 || saleRows.length > 0
}

// ---------------------------------------------------------------------------
// Customer 360 — commercial summary + cross-channel timeline
// ---------------------------------------------------------------------------

export interface CustomerCommercialSummaryRow {
  completedOrdersCount: number
  completedSalesCount: number
  lifetimeSpendMinor: number
  firstTransactionAt: Date | null
  lastTransactionAt: Date | null
}

/**
 * Derived entirely from transactions at read time (§Gate C: "lifetime
 * metrics should be derived from transactions", never a cached counter on
 * the customer row). "Completed" online orders only — cancelled/pending/
 * processing/delivering are excluded, matching the strict completed-sales
 * definition used across Gate C reporting. Every store sale is instant (the
 * register has no partial/pending state), so all of them count. The spend
 * figure is what the customer actually paid (subtotal + delivery for
 * orders) — a customer-facing total, not a margin/revenue metric, so it is
 * NOT subject to the "never call it صافي الربح" labeling rule.
 */
export async function getCustomerCommercialSummary(
  db: DbClient,
  customerId: string,
): Promise<CustomerCommercialSummaryRow> {
  const [orderAgg] = await db
    .select({
      n: count(),
      spend: sql<string>`coalesce(sum(${orders.totalMinor}), 0)`,
      first: sql<Date | null>`min(${orders.createdAt})`,
      last: sql<Date | null>`max(${orders.createdAt})`,
    })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), eq(orders.status, 'completed')))

  const [saleAgg] = await db
    .select({
      n: count(),
      spend: sql<string>`coalesce(sum(${storeSales.totalMinor}), 0)`,
      first: sql<Date | null>`min(${storeSales.createdAt})`,
      last: sql<Date | null>`max(${storeSales.createdAt})`,
    })
    .from(storeSales)
    .where(eq(storeSales.customerId, customerId))

  // The neon driver returns aggregate timestamps as ISO strings, not `Date`s —
  // normalize before comparing (a `Date` also survives `new Date(...)`).
  const toMs = (d: Date | string | null | undefined): number | null =>
    d === null || d === undefined ? null : new Date(d).getTime()
  const firstMs = [toMs(orderAgg?.first), toMs(saleAgg?.first)].filter(
    (n): n is number => n !== null && !Number.isNaN(n),
  )
  const lastMs = [toMs(orderAgg?.last), toMs(saleAgg?.last)].filter(
    (n): n is number => n !== null && !Number.isNaN(n),
  )

  return {
    completedOrdersCount: orderAgg?.n ?? 0,
    completedSalesCount: saleAgg?.n ?? 0,
    lifetimeSpendMinor: Number(orderAgg?.spend ?? 0) + Number(saleAgg?.spend ?? 0),
    firstTransactionAt: firstMs.length > 0 ? new Date(Math.min(...firstMs)) : null,
    lastTransactionAt: lastMs.length > 0 ? new Date(Math.max(...lastMs)) : null,
  }
}

export interface CustomerTimelineRow {
  channel: 'online' | 'store'
  id: string
  number: string
  createdAt: Date
  totalMinor: number
  currency: string
  status: string | null
}

/** Cross-channel purchase timeline, newest first — every order/sale status,
 *  not filtered to "completed" (§Gate C: the timeline is a history view, the
 *  commercial summary above is what applies the strict completed-sales
 *  filter). Bounded by `limit` — never an unbounded client-side fetch. */
export async function getCustomerTimeline(
  db: DbClient,
  customerId: string,
  limit: number,
): Promise<CustomerTimelineRow[]> {
  const [orderRows, saleRows] = await Promise.all([
    db
      .select({
        id: orders.id,
        number: orders.number,
        createdAt: orders.createdAt,
        totalMinor: orders.totalMinor,
        currency: orders.currency,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(sql`${orders.createdAt} DESC`)
      .limit(limit),
    db
      .select({
        id: storeSales.id,
        number: storeSales.number,
        createdAt: storeSales.createdAt,
        totalMinor: storeSales.totalMinor,
        currency: storeSales.currency,
      })
      .from(storeSales)
      .where(eq(storeSales.customerId, customerId))
      .orderBy(sql`${storeSales.createdAt} DESC`)
      .limit(limit),
  ])

  const merged: CustomerTimelineRow[] = [
    ...orderRows.map((r) => ({ channel: 'online' as const, ...r })),
    ...saleRows.map((r) => ({ channel: 'store' as const, ...r, status: null })),
  ]
  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return merged.slice(0, limit)
}

export async function setCustomerStatus(
  db: DbClient,
  id: string,
  status: 'active' | 'inactive',
): Promise<CustomerRow | undefined> {
  const rows = await db
    .update(customers)
    .set({ status, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning()
  return rows[0]
}
