/**
 * Admin Customer Directory + Customer 360 — Gate C.
 *
 * Owner/admin-only (`customers:read`). Never confused with the minimal POS
 * phone lookup under `store-sales:write` (see `store-sales.ts`'s
 * `lookupStoreSaleCustomerService`) — that returns one card for completing a
 * sale; this returns the full directory + lifetime commercial history.
 */
import {
  NotFoundError,
  type Customer360Detail,
  type CustomerListItem,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerTimelineEntry,
} from '@likehoney/shared'
import {
  getCustomerById,
  getCustomerCommercialSummary,
  getCustomerTimeline,
  listCustomers,
  setCustomerStatus,
  type DbClient,
} from '@likehoney/db'

const TIMELINE_LIMIT = 50

export async function listCustomersService(
  db: DbClient,
  query: CustomerListQuery,
): Promise<CustomerListResponse> {
  const { rows, total } = await listCustomers(db, {
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
    status: query.status,
    channel: query.channel,
    type: query.type,
    inactiveDays: query.inactiveDays,
  })

  const data: CustomerListItem[] = rows.map((r) => ({
    id: r.id,
    phoneNormalized: r.phoneNormalized,
    nameEn: r.firstNameEn,
    nameAr: r.firstNameAr,
    cityEn: r.cityEn,
    cityAr: r.cityAr,
    status: r.status,
    firstSeenAt: r.firstSeenAt?.toISOString() ?? null,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
  }))

  return { data, meta: { page: query.page, pageSize: query.pageSize, total } }
}

export async function getCustomer360Service(
  db: DbClient,
  customerId: string,
): Promise<Customer360Detail> {
  const customer = await getCustomerById(db, customerId)
  if (customer === undefined) throw new NotFoundError('customer not found')

  const [summary, timelineRows] = await Promise.all([
    getCustomerCommercialSummary(db, customerId),
    getCustomerTimeline(db, customerId, TIMELINE_LIMIT),
  ])

  const timeline: CustomerTimelineEntry[] = timelineRows.map((r) => ({
    channel: r.channel,
    id: r.id,
    number: r.number,
    createdAt: r.createdAt.toISOString(),
    totalMinor: r.totalMinor,
    currency: r.currency,
    status: r.status as CustomerTimelineEntry['status'],
  }))

  return {
    id: customer.id,
    phoneNormalized: customer.phoneNormalized,
    nameEn: customer.firstNameEn,
    nameAr: customer.firstNameAr,
    cityEn: customer.cityEn,
    cityAr: customer.cityAr,
    addressEn: customer.addressEn,
    addressAr: customer.addressAr,
    status: customer.status,
    consentToContact: customer.consentToContact,
    firstSeenAt: customer.firstSeenAt?.toISOString() ?? null,
    lastSeenAt: customer.lastSeenAt?.toISOString() ?? null,
    note: customer.note,
    commercial: {
      completedOrdersCount: summary.completedOrdersCount,
      completedSalesCount: summary.completedSalesCount,
      lifetimeSpendMinor: summary.lifetimeSpendMinor,
      currency: 'ILS',
      firstTransactionAt: summary.firstTransactionAt?.toISOString() ?? null,
      lastTransactionAt: summary.lastTransactionAt?.toISOString() ?? null,
    },
    timeline,
  }
}

export async function setCustomerStatusService(
  db: DbClient,
  customerId: string,
  status: 'active' | 'inactive',
) {
  const updated = await setCustomerStatus(db, customerId, status)
  if (updated === undefined) throw new NotFoundError('customer not found')
  return {
    id: updated.id,
    status: updated.status,
  }
}
