/**
 * Canonical RBAC defaults for the seed + bootstrap scripts.
 *
 * ONE source of truth for:
 *  - the bilingual label of every permission code
 *  - the built-in "admin" (owner) role permission set
 *  - the default "employee" permission set
 *
 * The permission CODES themselves are defined by `PERMISSION_CODES` in
 * `@likehoney/shared` (used for the API type + Zod schema). `PERMISSION_LABELS`
 * below MUST list exactly those codes — `_b2_*` verification asserts the DB set
 * after bootstrap matches, so drift is caught.
 *
 * Production role bootstrap (`bootstrap-admin.mjs`) applies `ADMIN_ROLE_PERMISSIONS`
 * deterministically to the built-in `admin` role, regardless of migration order.
 * Employee roles are not part of production bootstrap — an Admin provisions them
 * via staff management; `EMPLOYEE_DEFAULT_PERMISSIONS` is the canonical default
 * such provisioning (and `seed-dev.mjs`) uses.
 */

export const PERMISSION_LABELS = {
  'catalog:read': ['قراءة الكتالوج', 'Catalog read'],
  'catalog:write': ['تعديل الكتالوج', 'Catalog write'],
  'inventory:read': ['قراءة المخزون', 'Inventory read'],
  'inventory:write': ['تعديل المخزون', 'Inventory write'],
  'suppliers:write': ['تعديل الموردين', 'Suppliers write'],
  'settings:write': ['تعديل الإعدادات', 'Settings write'],
  'staff:write': ['تعديل الموظفين', 'Staff write'],
  'reports:read': ['قراءة التقارير', 'Reports read'],
  'store-sales:read': ['عرض مبيعات المحل', 'In-store sales read'],
  'store-sales:write': ['تسجيل مبيعات المحل', 'In-store sales write'],
  'orders:read': ['عرض الطلبات', 'Orders read'],
  'orders:write': ['إدارة تنفيذ الطلبات', 'Orders fulfillment'],
  'orders:cancel': ['إلغاء الطلبات', 'Orders cancel'],
  'customers:read': ['دليل العملاء وملف العميل 360', 'Customer directory + 360'],
  'reviews:moderate': ['إدارة تقييمات العملاء', 'Customer reviews moderation'],
  'catalog-cost:read': ['عرض تكلفة الشراء', 'Acquisition cost read'],
  'catalog-cost:write': ['تعديل تكلفة الشراء', 'Acquisition cost write'],
}

/** Every permission — the owner/admin tier. */
export const ADMIN_ROLE_PERMISSIONS = Object.keys(PERMISSION_LABELS)

/**
 * Default employee: read the catalog + inventory, run the register, and handle
 * order fulfillment. NOT settings/staff/suppliers, and NOT `orders:cancel`
 * (cancellation is an explicit escalation an Admin grants per employee).
 */
export const EMPLOYEE_DEFAULT_PERMISSIONS = [
  'catalog:read',
  'inventory:read',
  'store-sales:read',
  'store-sales:write',
  'orders:read',
  'orders:write',
]
