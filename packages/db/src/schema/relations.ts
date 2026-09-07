/**
 * Drizzle relations graph. Kept in its own file so domain files import
 * cleanly without circular import cycles.
 */
import { relations } from 'drizzle-orm'

import { auditLogs } from './audit'
import { categories, productMedia, products } from './catalog'
import { checkoutClaims } from './checkout-claims'
import { contentPages } from './content'
import { customers } from './customers'
import { inventoryBalances, inventoryMovements } from './inventory'
import { orderItems, orders } from './orders'
import { orderStockReturnItems, orderStockReturns } from './order-stock-returns'
import { paymentEvents, payments, stockReservations } from './payments'
import {
  productOptionValues,
  productOptions,
  productVariantOptions,
  productVariants,
} from './product-options'
import { storeReviews } from './reviews'
import { deliveryZones, storeSettings } from './settings'
import { permissions, rolePermissions, roles, staffRoles, staffSessions, staffUsers } from './staff'
import { storeSaleItems, storeSales } from './store-sales'
import { supplierPaymentEntries, suppliers } from './suppliers'

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}))

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  products: many(products),
  paymentEntries: many(supplierPaymentEntries),
}))

export const supplierPaymentEntriesRelations = relations(supplierPaymentEntries, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [supplierPaymentEntries.supplierId],
    references: [suppliers.id],
  }),
  recordedBy: one(staffUsers, {
    fields: [supplierPaymentEntries.recordedByStaffId],
    references: [staffUsers.id],
  }),
}))

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  supplier: one(suppliers, { fields: [products.supplierId], references: [suppliers.id] }),
  media: many(productMedia),
  options: many(productOptions),
  variants: many(productVariants),
  orderItems: many(orderItems),
  storeSaleItems: many(storeSaleItems),
}))

export const productMediaRelations = relations(productMedia, ({ one }) => ({
  product: one(products, { fields: [productMedia.productId], references: [products.id] }),
}))

export const productOptionsRelations = relations(productOptions, ({ one, many }) => ({
  product: one(products, { fields: [productOptions.productId], references: [products.id] }),
  values: many(productOptionValues),
  variants: many(productVariantOptions),
}))

export const productOptionValuesRelations = relations(productOptionValues, ({ one, many }) => ({
  option: one(productOptions, {
    fields: [productOptionValues.optionId],
    references: [productOptions.id],
  }),
  variants: many(productVariantOptions),
}))

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  optionValues: many(productVariantOptions),
  balance: one(inventoryBalances),
  movements: many(inventoryMovements),
  orderItems: many(orderItems),
  storeSaleItems: many(storeSaleItems),
}))

export const productVariantOptionsRelations = relations(productVariantOptions, ({ one }) => ({
  variant: one(productVariants, {
    fields: [productVariantOptions.variantId],
    references: [productVariants.id],
  }),
  optionValue: one(productOptionValues, {
    fields: [productVariantOptions.optionValueId],
    references: [productOptionValues.id],
  }),
}))

export const inventoryBalancesRelations = relations(inventoryBalances, ({ one }) => ({
  variant: one(productVariants, {
    fields: [inventoryBalances.variantId],
    references: [productVariants.id],
  }),
}))

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  variant: one(productVariants, {
    fields: [inventoryMovements.variantId],
    references: [productVariants.id],
  }),
  order: one(orders, { fields: [inventoryMovements.orderId], references: [orders.id] }),
  storeSale: one(storeSales, {
    fields: [inventoryMovements.storeSaleId],
    references: [storeSales.id],
  }),
  staff: one(staffUsers, { fields: [inventoryMovements.staffId], references: [staffUsers.id] }),
}))

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
  storeSales: many(storeSales),
}))

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  deliveryZone: one(deliveryZones, {
    fields: [orders.deliveryZoneId],
    references: [deliveryZones.id],
  }),
  cancelledBy: one(staffUsers, {
    fields: [orders.cancelledByStaffId],
    references: [staffUsers.id],
  }),
  items: many(orderItems),
  inventoryMovements: many(inventoryMovements),
  linkedStoreSales: many(storeSales),
  payments: many(payments),
  stockReservations: many(stockReservations),
}))

export const checkoutClaimsRelations = relations(checkoutClaims, ({ one }) => ({
  order: one(orders, { fields: [checkoutClaims.orderId], references: [orders.id] }),
}))

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  events: many(paymentEvents),
}))

export const paymentEventsRelations = relations(paymentEvents, ({ one }) => ({
  payment: one(payments, { fields: [paymentEvents.paymentId], references: [payments.id] }),
}))

export const stockReservationsRelations = relations(stockReservations, ({ one }) => ({
  order: one(orders, { fields: [stockReservations.orderId], references: [orders.id] }),
  variant: one(productVariants, {
    fields: [stockReservations.variantId],
    references: [productVariants.id],
  }),
}))

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}))

export const orderStockReturnsRelations = relations(orderStockReturns, ({ one, many }) => ({
  order: one(orders, { fields: [orderStockReturns.orderId], references: [orders.id] }),
  receivedBy: one(staffUsers, {
    fields: [orderStockReturns.receivedByStaffId],
    references: [staffUsers.id],
  }),
  items: many(orderStockReturnItems),
}))

export const orderStockReturnItemsRelations = relations(orderStockReturnItems, ({ one }) => ({
  return: one(orderStockReturns, {
    fields: [orderStockReturnItems.returnId],
    references: [orderStockReturns.id],
  }),
  orderItem: one(orderItems, {
    fields: [orderStockReturnItems.orderItemId],
    references: [orderItems.id],
  }),
  variant: one(productVariants, {
    fields: [orderStockReturnItems.variantId],
    references: [productVariants.id],
  }),
}))

export const storeSalesRelations = relations(storeSales, ({ one, many }) => ({
  staff: one(staffUsers, { fields: [storeSales.staffId], references: [staffUsers.id] }),
  customer: one(customers, { fields: [storeSales.customerId], references: [customers.id] }),
  order: one(orders, { fields: [storeSales.orderId], references: [orders.id] }),
  items: many(storeSaleItems),
  inventoryMovements: many(inventoryMovements),
}))

export const storeSaleItemsRelations = relations(storeSaleItems, ({ one }) => ({
  storeSale: one(storeSales, { fields: [storeSaleItems.storeSaleId], references: [storeSales.id] }),
  product: one(products, { fields: [storeSaleItems.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [storeSaleItems.variantId],
    references: [productVariants.id],
  }),
}))

export const staffUsersRelations = relations(staffUsers, ({ many }) => ({
  roles: many(staffRoles),
  sessions: many(staffSessions),
  storeSales: many(storeSales),
  inventoryMovements: many(inventoryMovements),
  auditLogs: many(auditLogs),
  supplierPaymentEntries: many(supplierPaymentEntries),
}))

export const staffSessionsRelations = relations(staffSessions, ({ one }) => ({
  staff: one(staffUsers, { fields: [staffSessions.staffId], references: [staffUsers.id] }),
}))

export const rolesRelations = relations(roles, ({ many }) => ({
  staffMembers: many(staffRoles),
  permissions: many(rolePermissions),
}))

export const permissionsRelations = relations(permissions, ({ many }) => ({
  roles: many(rolePermissions),
}))

export const staffRolesRelations = relations(staffRoles, ({ one }) => ({
  staff: one(staffUsers, { fields: [staffRoles.staffId], references: [staffUsers.id] }),
  role: one(roles, { fields: [staffRoles.roleId], references: [roles.id] }),
}))

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}))

export const contentPagesRelations = relations(contentPages, () => ({}))

export const storeReviewsRelations = relations(storeReviews, ({ one }) => ({
  /** Best-effort CRM link (verification evidence); may be null. */
  customer: one(customers, {
    fields: [storeReviews.customerId],
    references: [customers.id],
  }),
  moderatedBy: one(staffUsers, {
    fields: [storeReviews.moderatedByStaffId],
    references: [staffUsers.id],
  }),
}))

export const deliveryZonesRelations = relations(deliveryZones, ({ many }) => ({
  orders: many(orders),
}))

export const storeSettingsRelations = relations(storeSettings, () => ({}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(staffUsers, { fields: [auditLogs.actorStaffId], references: [staffUsers.id] }),
}))
