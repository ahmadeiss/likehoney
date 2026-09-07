/**
 * Supplier service: soft-disable safety, audit trail. Suppliers are never
 * deleted once products reference them (suppliers.supplier_id RESTRICT).
 */
import {
  ConflictError,
  NotFoundError,
  type SupplierCreateInput,
  type SupplierListQuery,
  type SupplierUpdateInput,
} from '@likehoney/shared'
import {
  countProductsBySupplier,
  createSupplier,
  getSupplier,
  listSuppliers,
  removeSupplier,
  updateSupplier,
  type DbClient,
} from '@likehoney/db'

import { recordAudit, type AuditActor } from './audit'

export async function listSuppliersService(db: DbClient, query: SupplierListQuery) {
  const { rows, total } = await listSuppliers(db, query)
  return { data: rows, meta: { page: query.page, pageSize: query.pageSize, total } }
}

export async function getSupplierService(db: DbClient, supplierId: string) {
  const supplier = await getSupplier(db, supplierId)
  if (supplier === undefined) throw new NotFoundError('supplier not found')
  return supplier
}

export async function createSupplierService(
  db: DbClient,
  input: SupplierCreateInput,
  actor: AuditActor,
) {
  const supplier = await createSupplier(db, {
    nameAr: input.nameAr,
    nameEn: input.nameEn ?? null,
    contactName: input.contactName ?? null,
    contactPhone: input.contactPhone ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    status: input.status ?? 'active',
  })
  await recordAudit(db, actor, 'supplier.created', 'supplier', supplier.id)
  return supplier
}

export async function updateSupplierService(
  db: DbClient,
  supplierId: string,
  input: SupplierUpdateInput,
  actor: AuditActor,
) {
  const existing = await getSupplier(db, supplierId)
  if (existing === undefined) throw new NotFoundError('supplier not found')

  const supplier = await updateSupplier(db, supplierId, {
    nameAr: input.nameAr,
    nameEn: input.nameEn,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    address: input.address,
    notes: input.notes,
    status: input.status,
  })
  if (supplier === undefined) throw new NotFoundError('supplier not found')

  await recordAudit(db, actor, 'supplier.updated', 'supplier', supplier.id)
  return supplier
}

export async function removeSupplierService(db: DbClient, supplierId: string, actor: AuditActor) {
  const existing = await getSupplier(db, supplierId)
  if (existing === undefined) throw new NotFoundError('supplier not found')

  const productCount = await countProductsBySupplier(db, supplierId)
  if (productCount > 0) {
    throw new ConflictError('supplier has products; set status inactive instead', {
      productCount,
    })
  }

  const removed = await removeSupplier(db, supplierId)
  if (removed === undefined) throw new NotFoundError('supplier not found')
  await recordAudit(db, actor, 'supplier.deleted', 'supplier', removed.id)
  return removed
}
