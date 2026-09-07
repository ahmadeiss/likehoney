'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { LocalizedText } from '@likehoney/shared'

import {
  readAdminLang,
  writeAdminLang,
  applyDocumentDirection,
  type AdminLang,
  type AdminDir,
} from '../../components/document-direction'

/**
 * Static UI copy dictionary for the Admin area. Every user-facing string is
 * bilingual (Arabic-first, English follows); technical values (SKUs, codes,
 * enums, UUIDs) are language-neutral and come from the API/domain labels.
 */
export const dict = {
  // ---------------------------------------------------------------------------
  // Brand / shell
  // ---------------------------------------------------------------------------
  'brand.name': { ar: 'زي العسل', en: 'Like Honey' },
  'brand.admin': { ar: 'لوحة الإدارة', en: 'Admin Console' },
  'shell.nav.dashboard': { ar: 'لوحة التحكم', en: 'Dashboard' },
  'shell.nav.products': { ar: 'المنتجات', en: 'Products' },
  'shell.nav.categories': { ar: 'التصنيفات', en: 'Categories' },
  'shell.nav.suppliers': { ar: 'الموردون', en: 'Suppliers' },
  'shell.nav.inventory': { ar: 'المخزون', en: 'Inventory' },
  'shell.nav.settings': { ar: 'الإعدادات', en: 'Settings' },
  'shell.nav.staff': { ar: 'الموظفون', en: 'Staff' },
  'shell.nav.main': { ar: 'العمليات', en: 'Operations' },
  'shell.nav.system': { ar: 'النظام', en: 'System' },
  'shell.mainNav': { ar: 'القائمة الرئيسية', en: 'Main menu' },
  'shell.menu': { ar: 'القائمة', en: 'Menu' },
  'shell.switchLang': { ar: 'التبديل إلى الإنجليزية', en: 'Switch to Arabic' },
  'shell.storefront': { ar: 'عرض المتجر', en: 'View storefront' },
  'shell.identity.dev': { ar: 'وضع التطوير', en: 'Development mode' },
  'shell.identity.label': {
    ar: 'اختيار حساب للتطوير',
    en: 'Select a development account',
  },
  'shell.identity.select': {
    ar: 'اختر موظفًا لاختبار الصلاحيات',
    en: 'Choose a user to test permissions',
  },
  'shell.identity.manual': { ar: 'إدخال يدوي', en: 'Manual entry' },
  'shell.identity.manualHint': {
    ar: 'الصق المعرف التقني للموظف لبدء الاختبار.',
    en: 'Paste the staff member’s technical identifier to begin.',
  },
  'shell.identity.paste': { ar: 'المعرف التقني...', en: 'Technical ID…' },
  'shell.identity.apply': { ar: 'تطبيق', en: 'Apply' },
  'shell.identity.clear': { ar: 'مسح الحساب', en: 'Clear account' },
  'shell.identity.current': { ar: 'الحساب الحالي', en: 'Current account' },
  'shell.identity.none': { ar: 'غير محددة', en: 'Not set' },
  'shell.identity.notLoadable': {
    ar: 'لا يمكن عرض قائمة الموظفين بدون صلاحية إدارة الموظفين.',
    en: 'The staff list is unavailable without the manage-staff permission on the current account.',
  },
  'shell.identity.loading': { ar: 'جارٍ تحميل الموظفين...', en: 'Loading staff…' },
  'shell.identity.switch': { ar: 'تبديل الحساب', en: 'Switch account' },
  'shell.identity.roles': { ar: 'الأدوار', en: 'Roles' },
  'shell.identity.optionsUnavailable': {
    ar: 'تعذّر جلب قائمة حسابات التطوير.',
    en: 'Could not load the development account options.',
  },
  'shell.identity.advanced': {
    ar: 'تفاصيل تقنية (لتجربة التطوير)',
    en: 'Technical details (for development)',
  },
  'shell.identity.uuidInvalid': {
    ar: 'أدخل معرّف موظف صالحًا — الأسماء غير مقبولة هنا.',
    en: 'Enter a valid staff identifier — names are not accepted here.',
  },
  'shell.identity.devBadge': {
    ar: 'هذا الخيار متاح في بيئة التطوير فقط',
    en: 'Available in development only',
  },
  'shell.viewStore': { ar: 'عرض المتجر', en: 'View store' },
  'shell.goHome': { ar: 'الصفحة الرئيسية', en: 'Home' },
  'shell.session.signedIn': { ar: 'مسجّل الدخول', en: 'Signed in as' },
  'shell.session.checking': { ar: 'جارٍ التحقق من الجلسة...', en: 'Checking your session…' },
  'shell.logout': { ar: 'تسجيل الخروج', en: 'Sign out' },

  // ---------------------------------------------------------------------------
  // Auth / sign-in
  // ---------------------------------------------------------------------------
  'auth.brand': { ar: 'لوحة إدارة زي العسل', en: 'Like Honey Admin' },
  'auth.subtitle': {
    ar: 'تسجيل دخول الموظفين فقط',
    en: 'Staff sign-in only',
  },
  'auth.identifier': { ar: 'البريد الإلكتروني أو الهاتف', en: 'Email or phone' },
  'auth.identifierPlaceholder': {
    ar: 'name@example.com أو 0599xxxxxx',
    en: 'name@example.com or 0599xxxxxx',
  },
  'auth.password': { ar: 'كلمة المرور', en: 'Password' },
  'auth.passwordPlaceholder': { ar: '••••••••', en: '••••••••' },
  'auth.signIn': { ar: 'تسجيل الدخول', en: 'Sign in' },
  'auth.signingIn': { ar: 'جارٍ تسجيل الدخول...', en: 'Signing in…' },
  'auth.invalidCredentials': {
    ar: 'بيانات الدخول غير صحيحة.',
    en: 'The email/phone or password is incorrect.',
  },
  'auth.accountInactive': {
    ar: 'هذا الحساب غير نشط حاليًا.',
    en: 'This account is currently inactive.',
  },
  'auth.forceChange': {
    ar: 'يجب تغيير كلمة المرور قبل المتابعة.',
    en: 'You must change your password before continuing.',
  },
  'auth.genericError': {
    ar: 'تعذّر تسجيل الدخول. حاول مرة أخرى.',
    en: 'Could not sign in. Please try again.',
  },
  'auth.identifierRequired': { ar: 'أدخل بريدك أو هاتفك.', en: 'Enter your email or phone.' },
  'auth.passwordRequired': { ar: 'أدخل كلمة المرور.', en: 'Enter your password.' },
  'auth.sessionExpired': {
    ar: 'انتهت جلستك — سجّل الدخول من جديد.',
    en: 'Your session has expired — please sign in again.',
  },
  'auth.devNote': {
    ar: 'وضع التطوير النشط',
    en: 'Development mode active',
  },
  'auth.devHint': {
    ar: 'هذا الخيار متاح في بيئة التطوير فقط.',
    en: 'This option is available in development only.',
  },
  'auth.devAccount': {
    ar: 'اختيار حساب للتطوير',
    en: 'Choose a development account',
  },

  // ---------------------------------------------------------------------------
  // Forced password change
  // ---------------------------------------------------------------------------
  'password.title': { ar: 'تغيير كلمة المرور', en: 'Change your password' },
  'password.subtitle': {
    ar: 'ستحتاج إلى تحديد كلمة مرور جديدة قبل الدخول إلى لوحة الإدارة.',
    en: 'You must set a new password before accessing the Admin.',
  },
  'password.current': { ar: 'كلمة المرور الحالية', en: 'Current password' },
  'password.currentPlaceholder': { ar: 'كلمة المرور المؤقتة', en: 'Temporary password' },
  'password.new': { ar: 'كلمة المرور الجديدة', en: 'New password' },
  'password.confirm': { ar: 'تأكيد كلمة المرور', en: 'Confirm password' },
  'password.submit': { ar: 'تحديث كلمة المرور', en: 'Update password' },
  'password.submitting': { ar: 'جارٍ التحديث...', en: 'Updating…' },
  'password.newRequired': { ar: 'أدخل كلمة مرور جديدة.', en: 'Enter a new password.' },
  'password.minLength': {
    ar: 'كلمة المرور لا تقل عن 8 أحرف.',
    en: 'Password must be at least 8 characters.',
  },
  'password.mismatch': { ar: 'كلمتا المرور غير متطابقتين.', en: 'Passwords do not match.' },
  'password.currentWrong': {
    ar: 'كلمة المرور الحالية غير صحيحة.',
    en: 'The current password is incorrect.',
  },
  'password.changedError': {
    ar: 'تعذّر تغيير كلمة المرور. حاول مرة أخرى.',
    en: 'Could not change the password. Please try again.',
  },
  'password.newMismatchCurrent': {
    ar: 'يجب أن تختلف كلمة المرور الجديدة عن الحالية.',
    en: 'The new password must differ from the current one.',
  },

  // ---------------------------------------------------------------------------
  // Common actions / labels
  // ---------------------------------------------------------------------------
  'common.save': { ar: 'حفظ', en: 'Save' },
  'common.saving': { ar: 'جارٍ الحفظ...', en: 'Saving…' },
  'common.cancel': { ar: 'إلغاء', en: 'Cancel' },
  'common.close': { ar: 'إغلاق', en: 'Close' },
  'common.create': { ar: 'إنشاء', en: 'Create' },
  'common.creating': { ar: 'جارٍ الإنشاء...', en: 'Creating…' },
  'common.edit': { ar: 'تعديل', en: 'Edit' },
  'common.delete': { ar: 'حذف', en: 'Delete' },
  'common.remove': { ar: 'إزالة', en: 'Remove' },
  'common.back': { ar: 'رجوع', en: 'Back' },
  'common.retry': { ar: 'إعادة المحاولة', en: 'Retry' },
  'common.show': { ar: 'إظهار', en: 'Show' },
  'common.hide': { ar: 'إخفاء', en: 'Hide' },
  'common.search': { ar: 'بحث', en: 'Search' },
  'common.searchPlaceholder': { ar: 'ابحث...', en: 'Search…' },
  'common.loading': { ar: 'جارٍ التحميل...', en: 'Loading…' },
  'common.actions': { ar: 'إجراءات', en: 'Actions' },
  'common.status': { ar: 'الحالة', en: 'Status' },
  'common.name': { ar: 'الاسم', en: 'Name' },
  'common.code': { ar: 'الرمز', en: 'Code' },
  'common.createdAt': { ar: 'تاريخ الإنشاء', en: 'Created at' },
  'common.updatedAt': { ar: 'آخر تحديث', en: 'Updated at' },
  'common.optional': { ar: 'اختياري', en: 'Optional' },
  'common.required': { ar: 'مطلوب', en: 'Required' },
  'common.all': { ar: 'الكل', en: 'All' },
  'common.active': { ar: 'نشط', en: 'Active' },
  'common.inactive': { ar: 'غير نشط', en: 'Inactive' },
  'common.enabled': { ar: 'مفعّل', en: 'Enabled' },
  'common.disabled': { ar: 'معطّل', en: 'Disabled' },
  'common.none': { ar: '—', en: '—' },
  'common.arabic': { ar: 'العربية', en: 'Arabic' },
  'common.english': { ar: 'English', en: 'English' },
  'common.confirmDeleteTitle': { ar: 'تأكيد الحذف', en: 'Confirm deletion' },
  'common.confirmDelete': { ar: 'هل أنت متأكد؟', en: 'Are you sure?' },
  'common.confirm': { ar: 'تأكيد', en: 'Confirm' },
  'common.saved': { ar: 'تم الحفظ', en: 'Saved' },
  'common.createdSuccess': { ar: 'تم الإنشاء بنجاح', en: 'Created successfully' },
  'common.updated': { ar: 'تم التحديث', en: 'Updated' },
  'common.deleted': { ar: 'تم الحذف', en: 'Deleted' },
  'common.notInScope': { ar: 'خارج نطاق هذه المرحلة', en: 'Out of scope for this phase' },
  'common.previous': { ar: 'السابق', en: 'Previous' },
  'common.next': { ar: 'التالي', en: 'Next' },
  'common.pageOf': { ar: 'صفحة {page} من {total}', en: 'Page {page} of {total}' },
  'common.resultsOf': { ar: '{count} نتيجة', en: '{count} results' },
  'common.errorsBelow': {
    ar: 'يرجى مراجعة الحقول المحددة.',
    en: 'Please review the highlighted fields.',
  },
  'common.underConstruction': { ar: 'قيد الإنشاء', en: 'Under construction' },

  // ---------------------------------------------------------------------------
  // Error / status feedback
  // ---------------------------------------------------------------------------
  'error.unauthorized': {
    ar: 'يلزم تسجيل الدخول — اختر حسابًا.',
    en: 'Authentication required — choose an account.',
  },
  'error.forbidden': {
    ar: 'ليس لديك صلاحية لهذه العملية.',
    en: 'You do not have permission for this action.',
  },
  'error.invalid': { ar: 'البيانات المدخلة غير صحيحة.', en: 'Invalid input.' },
  'error.validation': {
    ar: 'يرجى تصحيح البيانات المدخلة.',
    en: 'Please correct the submitted data.',
  },
  'error.conflict': {
    ar: 'العملية تتعارض مع بيانات موجودة.',
    en: 'Operation conflicts with existing data.',
  },
  'error.insufficientStock': {
    ar: 'الكمية المتوفرة غير كافية.',
    en: 'Insufficient quantity available.',
  },
  'error.notFound': { ar: 'لم يتم العثور على المورد.', en: 'The resource was not found.' },
  'error.network': {
    ar: 'تعذّر الاتصال بخادم Like Honey.',
    en: 'Could not reach the Like Honey API.',
  },
  'error.server': { ar: 'حدث خطأ في الخادم.', en: 'Something went wrong on the server.' },
  'error.generic': { ar: 'حدث خطأ غير متوقع.', en: 'An unexpected error occurred.' },
  'error.duplicate': {
    ar: 'توجد بيانات مكررة بنفس هذا الاسم.',
    en: 'An item with the same name already exists.',
  },
  'error.orderMovedByOther': {
    ar: 'تم تحديث هذا الطلب من موظف آخر. تم تحميل حالته الحالية.',
    en: 'Another staff member updated this order. Its current state has been loaded.',
  },
  'error.orderAlreadyCancelled': {
    ar: 'هذا الطلب ملغى بالفعل.',
    en: 'This order is already cancelled.',
  },
  'error.orderNotCancellable': {
    ar: 'لا يمكن إلغاء هذا الطلب في حالته الحالية.',
    en: 'This order cannot be cancelled in its current state.',
  },
  'error.paymentStateConflict': {
    ar: 'تعذّر تنفيذ الإجراء لأن حالة الدفع الحالية لا تتوافق مع حالة الطلب. يرجى مراجعة الدعم.',
    en: 'The action could not be completed because the current payment state is inconsistent with the order state. Please contact support.',
  },
  'error.orderNotReturnEligible': {
    ar: 'لا يمكن تسجيل رجوع منتجات إلا لطلب ملغى.',
    en: 'Only a cancelled order can have stock recorded as returned.',
  },
  'error.returnQuantityExceedsRemaining': {
    ar: 'الكمية المدخلة أكبر من الكمية المتبقية. حدّث الصفحة وحاول مرة أخرى.',
    en: 'The entered quantity exceeds what remains outstanding. Refresh and try again.',
  },
  'error.returnIdempotencyConflict': {
    ar: 'حدث تعارض أثناء الحفظ. يرجى إعادة تحميل الصفحة والمحاولة من جديد.',
    en: 'A conflict occurred while saving. Please reload the page and try again.',
  },
  'error.noOutstandingReturn': {
    ar: 'لا توجد كميات بانتظار الرجوع لهذا الطلب.',
    en: 'There is nothing outstanding to return for this order.',
  },
  'error.retry': { ar: 'إعادة المحاولة', en: 'Try again' },

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  'dashboard.title': { ar: 'لوحة التحكم', en: 'Dashboard' },
  'dashboard.description': {
    ar: 'نظرة عامة على متجرك.',
    en: 'An overview of your store.',
  },
  'dashboard.productsTotal': { ar: 'المنتجات', en: 'Products' },
  'dashboard.categoriesTotal': { ar: 'التصنيفات', en: 'Categories' },
  'dashboard.suppliersTotal': { ar: 'الموردون', en: 'Suppliers' },
  'dashboard.variantsTotal': { ar: 'الأصناف', en: 'Items' },
  'dashboard.recentMovements': { ar: 'آخر تحديثات الكمية', en: 'Recent quantity updates' },
  'dashboard.recentMovementsHint': {
    ar: 'أحدث التغييرات في سجل المخزون.',
    en: 'The latest changes in the inventory ledger.',
  },
  'dashboard.viewAll': { ar: 'عرض الكل', en: 'View all' },
  'dashboard.quantityAfter': { ar: 'الكمية بعد', en: 'Quantity after' },
  'dashboard.filterByStatus': { ar: 'تصفية حسب الحالة', en: 'Filter by status' },
  'dashboard.overview': { ar: 'نظرة عامة', en: 'Overview' },
  'dashboard.catalog': { ar: 'الكتالوج', en: 'Catalog' },
  'dashboard.primaryMetric': { ar: 'عدد المنتجات', en: 'Products' },
  'dashboard.errorTitle': { ar: 'تعذر تحميل البيانات', en: 'Could not load data' },
  'dashboard.errorHint': {
    ar: 'اختر حسابًا للمتابعة. يجب أن يملك الموظف الصلاحيات المناسبة لعرض هذه البيانات.',
    en: 'Choose an account to continue. The staff member needs the right permissions to view this data.',
  },
  'dashboard.pickIdentity': { ar: 'اختيار الحساب', en: 'Choose account' },
  'dashboard.loadingHint': { ar: 'جارٍ تجهيز البيانات...', en: 'Preparing data…' },
  'dashboard.noIdentityTitle': {
    ar: 'اختر حسابًا للمتابعة',
    en: 'Choose an account to continue',
  },
  'dashboard.noIdentityHint': {
    ar: 'لم يُحدَّد حساب بعد. استخدم «تبديل الهوية» في الشريط الجانبي لاختيار موظف.',
    en: 'No account selected yet. Use “Switch identity” in the sidebar to pick a staff member.',
  },
  'dashboard.invalidIdentityTitle': {
    ar: 'الحساب المحدد غير صالح أو غير متاح',
    en: 'The selected account is invalid or unavailable',
  },
  'dashboard.invalidIdentityHint': {
    ar: 'رُفض الطلب. أعد اختيار موظف صالح من قائمة الحسابات.',
    en: 'The request was rejected. Re-choose a valid staff member from the accounts list.',
  },
  'dashboard.forbiddenTitle': {
    ar: 'الحساب الحالي بلا صلاحية لعرض هذه البيانات',
    en: 'The current account lacks permission to view this data',
  },
  'dashboard.forbiddenHint': {
    ar: 'الموظف المحدد موجود لكن لا يملك الصلاحيات المطلوبة. اختر حسابًا آخر بصلاحيات مناسبة.',
    en: 'The selected staff member exists but lacks the required permission. Choose an account with the right permissions.',
  },
  'dashboard.attentionTitle': { ar: 'بحاجة انتباهك', en: 'Needs your attention' },
  'dashboard.reorderTitle': { ar: 'منتجات تحتاج إعادة طلب', en: 'Products to reorder' },
  'dashboard.emptyHint': {
    ar: 'لم تتم إضافة منتجات بعد — ابدأ بإضافة أول منتج.',
    en: 'No products yet — start by adding your first product.',
  },
  'dashboard.newProductCta': { ar: 'إضافة أول منتج', en: 'Add your first product' },
  'dashboard.greetingMorning': { ar: 'صباح الخير', en: 'Good morning' },
  'dashboard.greetingAfternoon': { ar: 'مساء الخير', en: 'Good afternoon' },
  'dashboard.greetingEvening': { ar: 'مساء الخير', en: 'Good evening' },
  'dashboard.welcomeBack': {
    ar: 'مرحبًا بعودتك. إليك ملخص متجرك اليوم.',
    en: 'Welcome back. Here is your store at a glance.',
  },
  'dashboard.attentionEmpty': {
    ar: 'لا شيء يحتاج انتباهك الآن — جميع الأصناف متوفرة.',
    en: 'Nothing needs your attention — all items are in stock.',
  },
  'dashboard.outNow': { ar: 'نافد الآن', en: 'Out of stock' },
  'dashboard.lowNow': { ar: 'مخزون منخفض', en: 'Low stock' },
  'dashboard.attentionViewInventory': { ar: 'عرض المخزون', en: 'Open inventory' },
  'dashboard.inventoryHealth': { ar: 'صحة المخزون', en: 'Stock health' },
  'dashboard.availableItems': { ar: 'صنف متوفر', en: 'item in stock' },
  'dashboard.availableItemsMany': { ar: 'صنف متوفر', en: 'items in stock' },
  'dashboard.lowItems': { ar: 'صنف منخفض', en: 'item low' },
  'dashboard.lowItemsMany': { ar: 'صنف منخفض', en: 'items low' },
  'dashboard.outItems': { ar: 'صنف نافد', en: 'item out' },
  'dashboard.outItemsMany': { ar: 'صنف نافد', en: 'items out' },
  'dashboard.stockSummaryHint': {
    ar: 'إجمالي القطع المتوفرة في فرعك وجميع الأصناف فوقها حسب حالتها.',
    en: 'Total units on hand across every active item, split by stock level.',
  },
  'dashboard.totalUnits': { ar: 'قطعة في المخزون', en: 'units in stock' },
  'dashboard.totalItems': { ar: 'صنف', en: 'items' },
  'dashboard.activeProducts': { ar: 'منتج مفعّل', en: 'active product' },
  'dashboard.activeProductsMany': { ar: 'منتج مفعّل', en: 'active products' },
  'dashboard.suppliersCount': { ar: 'مورد', en: 'supplier' },
  'dashboard.suppliersCountMany': { ar: 'موردون', en: 'suppliers' },
  'dashboard.categoriesCount': { ar: 'تصنيف', en: 'category' },
  'dashboard.categoriesCountMany': { ar: 'تصنيفات', en: 'categories' },
  'dashboard.supplierReorder': { ar: 'إعادة طلب من المورد', en: 'Supplier reorder' },
  'dashboard.supplierReorderHint': {
    ar: 'موردون لديهم أصناف نافدة أو منخفضة المخزون.',
    en: 'Suppliers with out-of-stock or low-stock items.',
  },
  'dashboard.lowAndOut': { ar: 'منخفض / نافد', en: 'low / out' },
  'dashboard.productsCta': { ar: 'إدارة الكتالوج', en: 'Open catalog' },
  'dashboard.quickActions': { ar: 'إجراءات سريعة', en: 'Quick actions' },

  // ---------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------
  'products.title': { ar: 'المنتجات', en: 'Products' },
  'products.description': {
    ar: 'إدارة منتجات متجر الأطفال.',
    en: 'Manage the children’s store catalog.',
  },
  'products.new': { ar: 'منتج جديد', en: 'New product' },
  'products.empty': { ar: 'لا توجد منتجات بعد', en: 'No products yet' },
  'products.emptyHint': {
    ar: 'أنشئ أول منتج لافتتاح الكتالوج.',
    en: 'Create the first product to open the catalog.',
  },
  'products.searchPlaceholder': {
    ar: 'ابحث بالاسم العربي أو الإنجليزي...',
    en: 'Search by Arabic or English name…',
  },
  'products.statusFilter': { ar: 'حالة المنتج', en: 'Product status' },
  'products.nameColumn': { ar: 'المنتج', en: 'Product' },
  'products.skuColumn': { ar: 'رمز المنتج', en: 'Product code' },
  'products.categoryColumn': { ar: 'التصنيف', en: 'Category' },
  'products.statusColumn': { ar: 'الحالة', en: 'Status' },
  'products.supplierColumn': { ar: 'المورد', en: 'Supplier' },
  'products.priceColumn': { ar: 'السعر', en: 'Price' },
  'products.availableColumn': { ar: 'المتوفر', en: 'Available' },
  'products.filterAll': { ar: 'كل الحالات', en: 'All statuses' },
  'products.filterDraft': { ar: 'مسودة', en: 'Draft' },
  'products.filterArchived': { ar: 'مؤرشف', en: 'Archived' },
  'products.unassigned': { ar: 'بدون تصنيف', en: 'Uncategorized' },
  'products.categoryAll': { ar: 'كل التصنيفات', en: 'All categories' },
  'products.resultCount': {
    ar: '{count} منتج',
    en: '{count} products',
  },
  'products.availInStock': { ar: 'متوفر', en: 'In stock' },
  'products.availLow': { ar: 'مخزون منخفض', en: 'Low stock' },
  'products.availOut': { ar: 'نفد من المخزون', en: 'Out of stock' },
  'products.availNoData': { ar: 'لا بيانات', en: 'No data' },

  // payload builder
  'products.form.title': { ar: 'بيانات المنتج', en: 'Product details' },
  'products.form.railTitle': { ar: 'بيانات المنتج', en: 'Product details' },
  'products.form.railFields': { ar: 'الحقول المطلوبة', en: 'Required fields' },
  'products.form.railSummary': { ar: 'ملخص', en: 'Summary' },
  'products.form.railNoName': { ar: 'منتج بدون اسم بعد', en: 'Product without a name yet' },
  'products.form.railDone': { ar: 'جاهز', en: 'Ready' },
  'products.form.sectionBasic': { ar: 'البيانات الأساسية', en: 'Basics' },
  'products.form.sectionCommerce': { ar: 'التصنيف والمورد', en: 'Category & supplier' },
  'products.form.sectionBlurb': { ar: 'الوصف والنص المختصر', en: 'Description & blurb' },
  'products.form.sectionStatus': { ar: 'الحالة', en: 'Status' },
  'products.form.sectionPricing': { ar: 'التسعير', en: 'Pricing' },
  'products.form.sectionOptions': { ar: 'الخيارات (مقاس/لون)', en: 'Options (size/color)' },
  'products.form.sectionBasicHint': {
    ar: 'اسم واضح يظهر للوالدين في الواجهة.',
    en: 'A clear name families see on the storefront.',
  },
  'products.form.sectionCommerceHint': {
    ar: 'اختياري — يساعد في عرض المنتج ضمن الأقسام.',
    en: 'Optional — helps surface the product within sections.',
  },
  'products.form.requiredNames': { ar: 'الاسم بالعربية والإنجليزية', en: 'Arabic + English name' },
  'products.form.nameArRequired': {
    ar: 'اسم المنتج بالعربية مطلوب.',
    en: 'Product name in Arabic is required.',
  },
  'products.form.nameEnRequired': {
    ar: 'الاسم بالإنجليزية مطلوب.',
    en: 'Name in English is required.',
  },
  'products.form.priceInvalid': {
    ar: 'السعر غير صالح — يجب أن يكون صفرًا أو أكثر.',
    en: 'Invalid price — must be zero or greater.',
  },
  'products.form.optionNameRequired': {
    ar: 'اسم الخيار بالعربية والإنجليزية مطلوب.',
    en: 'Option name in Arabic and English is required.',
  },
  'products.form.optionCodeInvalid': {
    ar: 'رمز القيمة غير صالح — أحرف إنجليزية كبيرة أو أرقام (1–8).',
    en: 'Invalid value code — uppercase letters or digits (1–8).',
  },
  'products.form.nameAr': { ar: 'اسم المنتج بالعربية', en: 'Product name in Arabic' },
  'products.form.nameEn': { ar: 'الاسم بالإنجليزية', en: 'Name in English' },
  'products.form.descriptionAr': { ar: 'الوصف بالعربية', en: 'Description in Arabic' },
  'products.form.descriptionEn': { ar: 'الوصف بالإنجليزية', en: 'Description in English' },
  'products.form.blurbAr': { ar: 'النص المختصر بالعربية', en: 'Short blurb in Arabic' },
  'products.form.blurbEn': { ar: 'النص المختصر بالإنجليزية', en: 'Short blurb in English' },
  'products.form.category': { ar: 'التصنيف', en: 'Category' },
  'products.form.categoryNone': { ar: 'بدون تصنيف', en: 'No category' },
  'products.form.supplier': { ar: 'المورد', en: 'Supplier' },
  'products.form.supplierNone': { ar: 'بدون مورد', en: 'No supplier' },
  'products.form.status': { ar: 'الحالة', en: 'Status' },
  'products.form.price': { ar: 'السعر (شيكل)', en: 'Price (ILS)' },
  'products.form.pricing': { ar: 'نموذج التسعير', en: 'Pricing model' },
  'products.form.basePrice': { ar: 'السعر الأساسي', en: 'Base price' },
  'products.form.basePriceHint': {
    ar: 'يُطبَّق هذا السعر على كل التركيبات، ويمكن تعديل سعر تركيبة معيّنة لاحقًا من صفحة المنتج.',
    en: 'This price applies to every combination — you can adjust one combination’s price later from the product page.',
  },
  'products.form.sectionType': { ar: 'نوع المنتج', en: 'Product type' },
  'products.form.sectionTypeHint': {
    ar: 'هل يحتاج الزبون لاختيار شيء (مثل المقاس أو اللون) قبل الإضافة للسلة؟',
    en: 'Does the customer need to choose something (like size or color) before adding to cart?',
  },
  'products.form.simple': { ar: 'منتج بسيط (لا خيارات)', en: 'Simple product (no options)' },
  'products.form.options': {
    ar: 'منتج بمقاسات أو ألوان أو خيارات أخرى',
    en: 'Product with sizes, colors or other options',
  },
  'products.form.optionsHint': {
    ar: 'هل للمنتج مقاسات أو ألوان أو خيارات أخرى؟ اختر هذا الخيار لإضافتها.',
    en: 'Does the product have sizes, colors or other options? Choose this to add them.',
  },
  'products.form.optionNameAr': { ar: 'اسم الخيار بالعربية', en: 'Option name in Arabic' },
  'products.form.optionNameEn': { ar: 'اسم الخيار بالإنجليزية', en: 'Option name in English' },
  'products.form.addOption': { ar: 'إضافة خيار', en: 'Add option' },
  'products.form.removeOption': { ar: 'إزالة الخيار', en: 'Remove option' },
  'products.form.valueCode': { ar: 'الرمز', en: 'Code' },
  'products.form.valueAr': { ar: 'القيمة بالعربية', en: 'Value in Arabic' },
  'products.form.valueEn': { ar: 'القيمة بالإنجليزية', en: 'Value in English' },
  'products.form.addValue': { ar: 'إضافة قيمة', en: 'Add value' },
  'products.form.codeHint': {
    ar: 'حرف باللغة الإنجليزية أو رقم (1–8). يُستخدم داخل رمز المنتج ولا يمكن تغييره بعد الإنشاء.',
    en: 'An English letter or digit (1–8). Used inside the product code and cannot change later.',
  },
  'products.form.comboCount': {
    ar: 'عدد الخيارات الناتجة: {count}',
    en: 'Resulting options: {count}',
  },
  'products.form.cannotInfer': {
    ar: 'أكمل إدخال القيم لتظهر الخيارات الناتجة',
    en: 'Complete the values to show the resulting options',
  },
  'products.form.needValue': {
    ar: 'يحتاج كل خيار قيمة واحدة على الأقل',
    en: 'Each option needs at least one value',
  },
  'products.form.optionsAtLeast': {
    ar: 'أضف خيارًا واحدًا على الأقل',
    en: 'Add at least one option',
  },
  'products.form.variantPreview': { ar: 'معاينة الخيارات', en: 'Options preview' },
  'products.form.variantPreviewHint': {
    ar: 'سيُولَّد رمز المنتج تلقائيًا بعد إنشائه.',
    en: 'The product code will be generated automatically after creation.',
  },
  'products.form.codeAfterCategory': {
    ar: 'سيظهر رمز المنتج بعد اختيار التصنيف.',
    en: 'The product code will appear after you choose a category.',
  },
  'products.form.codeAuto': {
    ar: 'يتم إنشاء رمز المنتج تلقائيًا.',
    en: 'The product code is generated automatically.',
  },
  'products.form.create': { ar: 'إنشاء المنتج', en: 'Create product' },
  'products.form.creating': { ar: 'جارٍ الإنشاء...', en: 'Creating…' },
  'products.form.submitHint': {
    ar: 'بعد الإنشاء، يمكنك إضافة الصور والكمية من صفحة المنتج.',
    en: 'After creating, you can add images and quantity from the product page.',
  },
  'products.createdToast.ar': {
    ar: 'تم إنشاء المنتج. أضف الصور والكمية الآن.',
    en: 'Product created. Add images and quantity now.',
  },
  'products.detail.notFound': { ar: 'المنتج غير موجود', en: 'Product not found' },
  'products.detail.editBasic': { ar: 'تعديل البيانات الأساسية', en: 'Edit basic details' },
  'products.detail.basicInfo': { ar: 'البيانات الأساسية', en: 'Basic details' },
  'products.detail.variants': { ar: 'الخيارات (مقاس/لون)', en: 'Options (size/color)' },
  'products.detail.sellingCard': { ar: 'المخزون والبيع', en: 'Stock & selling' },
  'products.detail.sellingCardHint': {
    ar: 'سعر المنتج وكميته وجاهزيته للبيع في المحل.',
    en: 'The product’s price, quantity and readiness to sell in store.',
  },
  'products.detail.variantsHint': {
    ar: 'لكل خيار رمز وسعر وكمية خاصة به.',
    en: 'Each option has its own code, price and quantity.',
  },
  'products.detail.combosCreated': {
    ar: 'تم إنشاء {count} تركيبات.',
    en: '{count} combinations created.',
  },
  'products.detail.reviewCombosHint': {
    ar: 'راجعي التركيبات التي يبيعها المتجر فعليًا، عطّلي أي تركيبة غير متوفرة، ثم فعّلي الباقي دفعة واحدة.',
    en: 'Review which combinations the store actually sells, deactivate any that aren’t offered, then activate the rest at once.',
  },
  'products.detail.activateOffered': {
    ar: 'تفعيل التركيبات المعروضة',
    en: 'Activate offered combinations',
  },
  'products.detail.combosActivated': {
    ar: 'تم تفعيل {count} تركيبة.',
    en: '{count} combination(s) activated.',
  },
  'products.detail.option': { ar: 'الخيار', en: 'Option' },
  'products.detail.optionValue': { ar: 'الخيار', en: 'Option' },
  'products.detail.media': { ar: 'الصور والوسائط', en: 'Images & Media' },
  'products.detail.mediaHint': {
    ar: 'أدرن صور المنتج. الصورة الأساسية تُستخدم في الواجهة.',
    en: 'Manage product images; the primary one is used on the storefront.',
  },
  'products.detail.moveUp': { ar: 'تحريك لأعلى', en: 'Move up' },
  'products.detail.moveDown': { ar: 'تحريك لأسفل', en: 'Move down' },
  'products.detail.confirmDeleteMedia': {
    ar: 'تأكيد حذف هذه الصورة؟',
    en: 'Confirm deleting this image?',
  },
  'products.detail.confirmDeleteMediaYes': { ar: 'نعم، احذف', en: 'Yes, delete' },
  'products.detail.confirmDeleteMediaCancel': { ar: 'إلغاء', en: 'Cancel' },
  'products.detail.inventory': { ar: 'الكمية', en: 'Quantity' },
  'products.detail.inventoryHint': {
    ar: 'الكمية الحالية لهذا المنتج.',
    en: 'The current quantity for this product.',
  },
  'products.detail.newVariant': { ar: 'إضافة خيار', en: 'Add option' },
  'products.detail.chooseCombo': {
    ar: 'اختر قيمة من كل خيار',
    en: 'Pick one value from each option',
  },
  'products.detail.priceLabel': { ar: 'السعر (شيكل)', en: 'Price (ILS)' },
  'products.detail.stockLabel': { ar: 'الكمية', en: 'Quantity' },

  // Acquisition cost (Gate C completion — catalog-cost:read/write)
  'products.cost.label': { ar: 'تكلفة الشراء', en: 'Acquisition cost' },
  'products.cost.helper': {
    ar: 'تُستخدم في تقارير هامش البضاعة، ولا تظهر للعميل.',
    en: 'Used in gross-margin reports; never shown to the customer.',
  },
  'products.cost.unknown': { ar: 'غير محددة', en: 'Not set' },
  'products.cost.enter': { ar: 'إدخال التكلفة', en: 'Enter cost' },
  'products.cost.markUnknown': { ar: 'اجعلها غير محددة', en: 'Mark as not set' },
  'products.cost.bulkApply': {
    ar: 'تطبيق تكلفة على تركيبات متعددة',
    en: 'Apply one cost to many variants',
  },
  'products.cost.bulkApplyTo': {
    ar: 'تطبيق على {n} تركيبة',
    en: 'Apply to {n} variants',
  },
  'products.cost.bulkClear': { ar: 'مسح التكلفة من الكل', en: 'Clear cost on all' },
  'products.detail.setStock': { ar: 'تعديل الكمية', en: 'Adjust quantity' },
  'products.detail.initial': { ar: 'الكمية الأولية', en: 'Initial quantity' },
  'products.detail.skuCopied': { ar: 'تم نسخ الرمز', en: 'Code copied' },
  'products.detail.primary': { ar: 'أساسية', en: 'Primary' },
  'products.detail.setPrimary': { ar: 'تعيين كأساسية', en: 'Set as primary' },
  'products.detail.deleteMedia': { ar: 'حذف الصورة', en: 'Delete image' },
  'products.detail.addMedia': { ar: 'إضافة صورة', en: 'Add image' },
  'products.detail.uploading': { ar: 'جارٍ الرفع...', en: 'Uploading…' },
  'products.detail.altAr': { ar: 'نص بديل (عربي)', en: 'Alt text (Arabic)' },
  'products.detail.altEn': { ar: 'نص بديل (English)', en: 'Alt text (English)' },
  'products.detail.mediaEmpty': {
    ar: 'لا تُوجد صور لهذا المنتج بعد.',
    en: 'No images for this product yet.',
  },
  'products.detail.mediaEmptyHint': {
    ar: 'ارفع أول صورة لتظهر في صفحة المتجر.',
    en: 'Upload the first image to appear on the storefront.',
  },
  'products.detail.variantStatus': { ar: 'الحالة', en: 'Status' },
  'products.detail.optionValueEdit': { ar: 'قيم الخيارات', en: 'Option values' },
  'products.detail.optionValueEditHint': {
    ar: 'تعديل التسميات يُحدّث تلقائيًا تسميات الخيارات.',
    en: 'Editing labels automatically refreshes option labels.',
  },
  'products.detail.savePrice': { ar: 'حفظ السعر', en: 'Save price' },
  'products.detail.addValue': { ar: '+ إضافة قيمة', en: '+ Add value' },
  'products.detail.addValueTitle': { ar: 'إضافة قيمة جديدة', en: 'Add a new value' },
  'products.detail.addValueHint': {
    ar: 'ستُنشأ تلقائيًا كل التركيبات الجديدة الناقصة بحالة "مسودة"، جاهزة للمراجعة والتفعيل.',
    en: 'Every missing combination is generated automatically as a draft, ready to review and activate.',
  },
  'products.detail.addValueSubmit': { ar: 'إضافة', en: 'Add' },
  'products.detail.addValueSuccess': {
    ar: 'تمت إضافة القيمة وإنشاء {count} تركيبة جديدة.',
    en: 'Value added — {count} new combination(s) created.',
  },
  'products.detail.categoryImmutable': {
    ar: 'لا يمكن تغيير التصنيف بعد إضافة خيارات للمنتج.',
    en: 'The category cannot change once the product has options.',
  },
  'products.detail.compareAt': { ar: 'سعر المقارنة', en: 'Compare-at price' },

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------
  'categories.title': { ar: 'التصنيفات', en: 'Categories' },
  'categories.description': {
    ar: 'نظّم منتجاتك في أقسام يسهل على الوالدين تصفحها.',
    en: 'Organize your products into sections families can browse easily.',
  },
  'categories.new': { ar: 'تصنيف جديد', en: 'New category' },
  'categories.edit': { ar: 'تعديل التصنيف', en: 'Edit category' },
  'categories.empty': { ar: 'لا توجد تصنيفات بعد', en: 'No categories yet' },
  'categories.emptyHint': {
    ar: 'أنشئ التصنيف الأول لتنظيم الكتالوج.',
    en: 'Create the first category to organize the catalog.',
  },
  'categories.listColumn': { ar: 'التصنيف', en: 'Category' },
  'categories.codeColumn': { ar: 'الرمز', en: 'Code' },
  'categories.slugColumn': { ar: 'الرابط', en: 'Slug' },
  'categories.nameAr': { ar: 'الاسم (عربي)', en: 'Name (Arabic)' },
  'categories.nameEn': { ar: 'الاسم (English)', en: 'Name (English)' },
  'categories.slug': { ar: 'الرابط', en: 'Link' },
  'categories.code': { ar: 'الرمز (أحرف كبيرة 1–8)', en: 'Code (uppercase, 1–8)' },
  'categories.descriptionAr': { ar: 'الوصف (عربي)', en: 'Description (Arabic)' },
  'categories.descriptionEn': { ar: 'الوصف (English)', en: 'Description (English)' },
  'categories.codeImmutableHint': {
    ar: 'لا يمكن تغيير الرمز بعد ربط منتجات به.',
    en: 'The code cannot change once products reference it.',
  },
  'categories.statusHint': {
    ar: 'إيقاف التصنيف يُبقيه مخفيًا عن الواجهة دون حذف.',
    en: 'Pausing a category hides it from the storefront without deleting it.',
  },
  'categories.confirmDelete': {
    ar: 'سيُزال التصنيف نهائيًا. حرّك منتجاته أو اترك الحقل فارغًا.',
    en: 'The category will be permanently removed. Reassign or leave its products empty first.',
  },
  'categories.deleteSuccess': { ar: 'تم حذف التصنيف', en: 'Category deleted' },
  'categories.advanced': { ar: 'خيارات متقدمة', en: 'Advanced' },
  'categories.advancedHint': {
    ar: 'الرمز يكفي عادة. يستخدم داخل رمز المنتج إذا أردت تقسيم الأقسام به.',
    en: 'The code is usually all that’s needed. It’s used inside the product code.',
  },
  'categories.productCount': { ar: 'عدد المنتجات', en: 'Products' },

  // ---------------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------------
  'suppliers.title': { ar: 'الموردون', en: 'Suppliers' },
  'suppliers.description': {
    ar: 'الجهات التي تشتري منها بضاعة المتجر.',
    en: 'The companies the store buys its stock from.',
  },
  'suppliers.new': { ar: 'مورد جديد', en: 'New supplier' },
  'suppliers.edit': { ar: 'تعديل المورد', en: 'Edit supplier' },
  'suppliers.empty': { ar: 'لا يوجد موردون بعد', en: 'No suppliers yet' },
  'suppliers.emptyHint': {
    ar: 'أضف أول مورد لبدء إدارة المشتريات.',
    en: 'Add the first supplier to start managing purchases.',
  },
  'suppliers.listColumn': { ar: 'المورد', en: 'Supplier' },
  'suppliers.contact': { ar: 'جهة الاتصال', en: 'Contact' },
  'suppliers.phone': { ar: 'الهاتف', en: 'Phone' },
  'suppliers.nameAr': { ar: 'الاسم (عربي)', en: 'Name (Arabic)' },
  'suppliers.nameEn': { ar: 'الاسم (English)', en: 'Name (English, optional)' },
  'suppliers.contactName': { ar: 'اسم جهة الاتصال', en: 'Contact person' },
  'suppliers.contactPhone': { ar: 'هاتف جهة الاتصال', en: 'Contact phone' },
  'suppliers.address': { ar: 'العنوان', en: 'Address' },
  'suppliers.notes': { ar: 'ملاحظات', en: 'Notes' },
  'suppliers.confirmDelete': {
    ar: 'لا يمكن حذف مورد مرتبط بمنتجات. استخدم التعطيل بدلاً من ذلك.',
    en: 'A supplier with products cannot be deleted — disable it instead.',
  },
  'suppliers.deleteSuccess': { ar: 'تم حذف المورد', en: 'Supplier deleted' },
  'suppliers.productCount': { ar: 'عدد المنتجات', en: 'Products' },
  'suppliers.needsReorder': { ar: 'تحتاج إعادة طلب', en: 'Need reorder' },
  'suppliers.outOfStock': { ar: 'نافدة', en: 'Out of stock' },

  // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------
  'inventory.title': { ar: 'المخزون', en: 'Inventory' },
  'inventory.description': {
    ar: 'الكمية المتوفرة من كل منتج، مشتركة بين المحل والطلبات الأونلاين.',
    en: 'The quantity available for each product, shared between the store and online orders.',
  },
  'inventory.searchPlaceholder': { ar: 'ابحث بالمنتج...', en: 'Search product…' },
  'inventory.totalOnHand': { ar: 'إجمالي الكمية المتوفرة', en: 'Total available quantity' },
  'inventory.variantCount': { ar: 'أصناف', en: 'Items' },
  'inventory.skuColumn': { ar: 'رمز المنتج', en: 'Product code' },
  'inventory.productColumn': { ar: 'المنتج', en: 'Product' },
  'inventory.variantColumn': { ar: 'الخيار', en: 'Option' },
  'inventory.qohColumn': { ar: 'الكمية الحالية', en: 'Current quantity' },
  'inventory.statusColumn': { ar: 'الحالة', en: 'Status' },
  'inventory.empty': {
    ar: 'لم تتم إضافة منتجات بعد — سيظهر المخزون بعد إضافة أول منتج.',
    en: 'No products yet — inventory will appear after you add the first product.',
  },
  'inventory.newMovement': { ar: 'تعديل الكمية', en: 'Adjust quantity' },
  'inventory.variantLabel': { ar: 'المنتج', en: 'Product' },
  'inventory.movementType': { ar: 'نوع التغيير', en: 'Type of change' },
  'inventory.quantityChange': { ar: 'الكمية', en: 'Quantity' },
  'inventory.reason': { ar: 'السبب', en: 'Reason' },
  'inventory.reasonPlaceholder': { ar: 'سبب التغيير (اختياري)', en: 'Reason (optional)' },
  'inventory.quantityAfterColumn': { ar: 'بعد التعديل', en: 'After' },
  'inventory.movementsFor': { ar: 'سجل {sku}', en: 'History for {sku}' },
  'inventory.recentMovements': { ar: 'سجل المخزون', en: 'Inventory ledger' },
  'inventory.movementCreated': { ar: 'تم تحديث الكمية', en: 'Quantity updated' },
  'inventory.staffColumn': { ar: 'الموظف', en: 'Staff' },
  'inventory.allTypes': { ar: 'كل أنواع التغيير', en: 'All changes' },
  'inventory.detailButton': { ar: 'عرض السجل', en: 'View history' },
  'inventory.pickVariant': {
    ar: 'اختر المنتج الذي تريد تعديل كميته',
    en: 'Pick the product you want to adjust',
  },
  'inventory.requiresCatalog': {
    ar: 'لا يمكن عرض الكميات بدون صلاحية عرض المنتجات. اختر حسابًا بصلاحيات مناسبة.',
    en: 'Quantities cannot be shown without product-view permission. Choose an account with the right permissions.',
  },
  'inventory.manualVariantId': {
    ar: 'المعرف التقني للمنتج',
    en: 'Product technical ID',
  },
  'inventory.addQuantity': { ar: 'إضافة كمية', en: 'Add quantity' },
  'inventory.decreaseQuantity': { ar: 'إنقاص كمية', en: 'Subtract quantity' },
  'inventory.addAmountLabel': { ar: 'الكمية المضافة', en: 'Quantity to add' },
  'inventory.decreaseAmountLabel': { ar: 'الكمية المخصومة', en: 'Quantity to subtract' },
  'inventory.currentQtyLabel': { ar: 'الكمية الحالية', en: 'Current quantity' },
  'inventory.newQtyLabel': { ar: 'بعد التعديل', en: 'New quantity' },
  'inventory.reasonArrived': { ar: 'وصلت بضاعة جديدة', en: 'New stock arrived' },
  'inventory.reasonCorrection': { ar: 'تصحيح كمية', en: 'Quantity correction' },
  'inventory.reasonDamaged': { ar: 'تلف / فقدان', en: 'Damaged / lost' },
  'inventory.reasonOther': { ar: 'سبب آخر', en: 'Other reason' },
  'inventory.modeAdd': { ar: 'إضافة كمية', en: 'Add quantity' },
  'inventory.modeSubtract': { ar: 'إنقاص كمية', en: 'Subtract quantity' },
  'inventory.confirmAdd': {
    ar: 'ستصبح الكمية: {after}',
    en: 'The quantity will become: {after}',
  },
  'inventory.confirmSubtract': {
    ar: 'ستصبح الكمية: {after}',
    en: 'The quantity will become: {after}',
  },
  'inventory.qtyMustBePositive': {
    ar: 'أدخل كمية أكبر من صفر.',
    en: 'Enter a quantity greater than zero.',
  },
  'inventory.addedHuman': {
    ar: 'تمت إضافة {qty} قطعة',
    en: '{qty} pieces added',
  },
  'inventory.soldHuman': {
    ar: 'تم بيع قطعة',
    en: 'One piece sold',
  },
  'inventory.soldHumanN': {
    ar: 'تم بيع {qty} قطع',
    en: '{qty} pieces sold',
  },
  'inventory.orderDeductHuman': {
    ar: 'تم خصم {qty} قطع بسبب طلب',
    en: '{qty} pieces deducted for an order',
  },
  'inventory.orderRestoreHuman': {
    ar: 'أعيدت {qty} قطع بعد إلغاء طلب',
    en: '{qty} pieces restored after an order was cancelled',
  },
  'inventory.initialHuman': {
    ar: 'كشوط أولي',
    en: 'Initial quantity',
  },
  'inventory.storeSaleHuman': {
    ar: 'بيع من المحل ({qty} قطع)',
    en: 'Store sale ({qty} pieces)',
  },
  'inventory.damageHuman': {
    ar: 'تلف / فقدان ({qty} قطع)',
    en: 'Damaged / lost ({qty} pieces)',
  },
  'inventory.adjustmentHuman': {
    ar: 'تصحيح يدوي ({qty} قطع)',
    en: 'Manual correction ({qty} pieces)',
  },
  'inventory.returnHuman': {
    ar: 'إرجاع ({qty} قطع)',
    en: 'Returned ({qty} pieces)',
  },
  'inventory.restockHuman': {
    ar: 'إضافة ({qty} قطع)',
    en: 'Added ({qty} pieces)',
  },
  'inventory.healthTitle': { ar: 'صحة المخزون', en: 'Stock health' },
  'inventory.healthHint': {
    ar: 'كل صنف حسب الكمية المتوفرة. الأصناف النافدة أو المنخفضة تحتاج إعادة تزويد.',
    en: 'Every item by its on-hand quantity. Out-of-stock and low-stock items need restocking.',
  },
  'inventory.available': { ar: 'متوفر', en: 'In stock' },
  'inventory.lowStock': { ar: 'منخفض', en: 'Low stock' },
  'inventory.outOfStock': { ar: 'نافد', en: 'Out of stock' },
  'inventory.adjustCta': { ar: 'تعديل الكمية', en: 'Adjust quantity' },
  'inventory.allLevels': { ar: 'كل المستويات', en: 'All levels' },
  'inventory.emptyAvailable': {
    ar: 'لا توجد أصناف متوفرة حاليًا.',
    en: 'No in-stock items right now.',
  },
  'inventory.emptyLow': { ar: 'لا توجد أصناف منخفضة المخزون.', en: 'No low-stock items.' },
  'inventory.emptyOut': {
    ar: 'لا توجد أصناف نافدة حاليًا.',
    en: 'No out-of-stock items right now.',
  },
  'inventory.unitLabel': { ar: 'قطعة', en: 'piece' },
  'inventory.unitLabelMany': { ar: 'قطع', en: 'pieces' },

  // reserved stock (Gate B4 Stage 5 §28/§29/§32)
  'inventory.physicalStock': { ar: 'المخزون الفعلي', en: 'Physical stock' },
  'inventory.reservedStock': { ar: 'محجوز', en: 'Reserved' },
  'inventory.availableToSell': { ar: 'المتاح للبيع', en: 'Available to sell' },
  'inventory.reservedHint': {
    ar: 'محجوز لطلبات دفع إلكتروني قيد التأكيد — حجز تجاري، وليس خصمًا فعليًا من المخزون.',
    en: 'Held for electronic orders awaiting payment confirmation — a commercial hold, not a physical deduction.',
  },

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  'settings.title': { ar: 'الإعدادات', en: 'Settings' },
  'settings.description': {
    ar: 'إعدادات المتجر ومناطق التوصيل.',
    en: 'Store settings and delivery zones.',
  },
  'settings.store': { ar: 'بيانات المتجر', en: 'Store details' },
  'settings.settingKey': { ar: 'الإعداد', en: 'Setting' },
  'settings.deliveryZones': { ar: 'التوصيل', en: 'Delivery' },
  'settings.deliveryZonesHint': {
    ar: 'أضف مناطق التوصيل والرسوم لكل منطقة.',
    en: 'Add delivery zones and their fees.',
  },
  'settings.newZone': { ar: 'منطقة جديدة', en: 'New zone' },
  'settings.editZone': { ar: 'تعديل المنطقة', en: 'Edit zone' },
  'settings.zoneEmpty': { ar: 'لا تُوجد مناطق توصيل بعد.', en: 'No delivery zones yet.' },
  'settings.zoneEmptyHint': {
    ar: 'أضف منطقة لتمكين التوصيل عند الدفع عند الاستلام.',
    en: 'Add a zone to enable COD shipping later.',
  },
  'settings.zoneNameAr': { ar: 'اسم المنطقة (عربي)', en: 'Zone name (Arabic)' },
  'settings.zoneNameEn': { ar: 'اسم المنطقة (English)', en: 'Zone name (English)' },
  'settings.zoneCode': { ar: 'الرمز (أحرف كبيرة)', en: 'Code (uppercase)' },
  'settings.zoneFee': { ar: 'رسوم التوصيل (شيكل)', en: 'Delivery fee (ILS)' },
  'settings.zoneActive': { ar: 'التوصيل مفعّل', en: 'Delivery enabled' },
  'settings.zoneOrder': { ar: 'ترتيب العرض', en: 'Display order' },
  'settings.activeOnly': { ar: 'المفعّلة فقط', en: 'Active only' },
  'settings.confirmZoneDelete': {
    ar: 'لا يمكن حذف منطقة عليها طلبات؛ عطّل المنطقة بدلاً من ذلك.',
    en: 'A zone with orders cannot be deleted — disable it instead.',
  },
  'settings.codEnabled': { ar: 'الدفع عند الاستلام مفعّل', en: 'Cash on delivery enabled' },
  'settings.announcementAr': { ar: 'الإعلان (عربي)', en: 'Announcement (Arabic)' },
  'settings.announcementEn': { ar: 'الإعلان (English)', en: 'Announcement (English)' },
  'settings.currency': { ar: 'العملة', en: 'Currency' },
  'settings.currencyIls': { ar: 'شيكل (ILS) فقط', en: 'ILS (Israeli Shekel) only' },
  'settings.settingSaved': { ar: 'تم حفظ الإعداد', en: 'Setting saved' },
  'settings.settingEmpty': { ar: 'غير مضبوط', en: 'Not set' },

  // ---------------------------------------------------------------------------
  // Payment settings (Gate B4 Stage 5) — "طرق الدفع"
  // ---------------------------------------------------------------------------
  'payments.methodsTitle': { ar: 'طرق الدفع', en: 'Payment methods' },
  'payments.codTitle': { ar: 'الدفع عند الاستلام', en: 'Cash on Delivery' },
  'payments.electronicTitle': { ar: 'الدفع الإلكتروني', en: 'Electronic Payment' },
  'payments.preference': { ar: 'التفضيل', en: 'Preference' },
  'payments.availability': { ar: 'الحالة الفعلية', en: 'Actual availability' },
  'payments.available': { ar: 'متاح للعملاء الآن', en: 'Available to customers now' },
  'payments.unavailable': { ar: 'غير متاح حاليًا', en: 'Not available right now' },
  'payments.codHint': {
    ar: 'يدفع العميل نقدًا عند استلام الطلب من المندوب.',
    en: 'The customer pays cash when the order is delivered.',
  },
  'payments.electronicHint': {
    ar: 'يدفع العميل إلكترونيًا عبر بوابة الدفع أثناء إتمام الطلب.',
    en: 'The customer pays electronically through the payment gateway at checkout.',
  },
  'payments.codDisableBlocked': {
    ar: 'لا يمكن تعطيل الدفع عند الاستلام قبل توفر طريقة دفع أخرى.',
    en: 'Cash on Delivery cannot be disabled until another payment method is available.',
  },
  'payments.enableBlocked': {
    ar: 'تعذّر تفعيل الدفع عند الاستلام. راجع الإعدادات وحاول مرة أخرى.',
    en: 'Could not enable Cash on Delivery. Please review settings and try again.',
  },
  'payments.electronicDisableBlocked': {
    ar: 'لا يمكن تعطيل الدفع الإلكتروني قبل توفر طريقة دفع أخرى.',
    en: 'Electronic payment cannot be disabled until another payment method is available.',
  },
  'payments.blocker.payment_provider_not_configured': {
    ar: 'الدفع الإلكتروني غير جاهز بعد. يجب تهيئة بوابة الدفع أولًا.',
    en: 'Electronic payment is not ready yet. A payment gateway must be configured first.',
  },
  'payments.blocker.payment_provider_not_allowed': {
    ar: 'بوابة الدفع المحددة غير متاحة في هذه البيئة.',
    en: 'The configured payment gateway is not available in this environment.',
  },
  'payments.blocker.payment_provider_unavailable': {
    ar: 'خدمة الدفع الإلكتروني غير متاحة حاليًا.',
    en: 'The electronic payment service is not available right now.',
  },
  'payments.blocker.payment_infrastructure_not_ready': {
    ar: 'البنية التشغيلية للدفع الإلكتروني غير جاهزة بعد.',
    en: 'The electronic payment infrastructure is not ready yet.',
  },
  'payments.devProviderNote': { ar: 'بيئة اختبار', en: 'Test environment' },
  'payments.reconcileTitle': { ar: 'إعداد التحقق', en: 'Verification setting' },
  'payments.reconcileLabel': {
    ar: 'بدء التحقق من الدفعات المعلقة بعد',
    en: 'Start checking pending payments after',
  },
  'payments.reconcileMinutes': { ar: '{n} دقيقة', en: '{n} minutes' },
  'payments.reconcileHint': {
    ar: 'هذا الوقت يبدأ التحقق من حالة الدفع، ولا يلغي الطلب أو يحرر المخزون تلقائيًا.',
    en: 'This time starts checking the payment status — it does not cancel the order or release stock by itself.',
  },
  'payments.savedToast': { ar: 'تم تحديث إعدادات الدفع', en: 'Payment settings updated' },

  // ---------------------------------------------------------------------------
  // Staff / RBAC
  // ---------------------------------------------------------------------------
  'staff.title': { ar: 'الموظفون والأدوار', en: 'Staff & roles' },
  'staff.description': {
    ar: 'إدارة حسابات الموظفين وما يمكن لكل منهم القيام به.',
    en: 'Manage staff accounts and what each person can do.',
  },
  'staff.members': { ar: 'الموظفون', en: 'Staff members' },
  'staff.roles': { ar: 'الأدوار', en: 'Roles' },
  'staff.permissions': { ar: 'الصلاحيات', en: 'Permissions' },
  'staff.membersHint': {
    ar: 'الموظفون الذين يمكنهم تسجيل الدخول إلى لوحة الإدارة.',
    en: 'People who can sign in to the admin panel.',
  },
  'staff.new': { ar: 'موظف جديد', en: 'New staff member' },
  'staff.newRole': { ar: 'دور جديد', en: 'New role' },
  'staff.nameAr': { ar: 'الاسم الكامل (عربي)', en: 'Full name (Arabic)' },
  'staff.nameEn': { ar: 'الاسم (English)', en: 'Name (English)' },
  'staff.phone': { ar: 'الهاتف', en: 'Phone' },
  'staff.email': { ar: 'البريد الإلكتروني', en: 'Email' },
  'staff.notes': { ar: 'ملاحظات', en: 'Notes' },
  'staff.assignRoles': { ar: 'تعيين الأدوار', en: 'Assign roles' },
  'staff.editRoles': { ar: 'تعديل الأدوار', en: 'Edit roles' },
  'staff.empty': { ar: 'لا يوجد موظفون بعد.', en: 'No staff members yet.' },
  'staff.roleEmpty': { ar: 'لا تُوجد أدوار بعد.', en: 'No roles yet.' },
  'staff.permEmpty': { ar: 'لا تُوجد صلاحيات بعد.', en: 'No permissions yet.' },
  'staff.roleCode': { ar: 'رمز الدور (حروف صغيرة)', en: 'Role code (lowercase)' },
  'staff.roleNameAr': { ar: 'اسم الدور (عربي)', en: 'Role name (Arabic)' },
  'staff.roleNameEn': { ar: 'اسم الدور (English)', en: 'Role name (English)' },
  'staff.roleDescAr': { ar: 'وصف الدور (عربي)', en: 'Role description (Arabic)' },
  'staff.roleDescEn': { ar: 'وصف الدور (English)', en: 'Role description (English)' },
  'staff.permCode': { ar: 'الرمز التقني', en: 'Technical code' },
  'staff.permNameAr': { ar: 'اسم الصلاحية (عربي)', en: 'Permission name (Arabic)' },
  'staff.permNameEn': { ar: 'اسم الصلاحية (English)', en: 'Permission name (English)' },
  'staff.permDescAr': { ar: 'وصف الصلاحية (عربي)', en: 'Permission description (Arabic)' },
  'staff.permDescEn': { ar: 'وصف الصلاحية (English)', en: 'Permission description (English)' },
  'staff.permNew': { ar: 'صلاحية جديدة', en: 'New permission' },
  'staff.editRolePermissions': { ar: 'تعديل صلاحيات الدور', en: 'Edit role permissions' },
  'staff.rolePermissionsHint': {
    ar: 'يؤثر تغيير الصلاحيات على كل الموظفين المرتبطين بهذا الدور فورًا.',
    en: 'Changing permissions immediately affects every staff member in this role.',
  },
  'staff.saveRoles': { ar: 'حفظ الأدوار', en: 'Save roles' },
  'staff.savePermissions': { ar: 'حفظ الصلاحيات', en: 'Save permissions' },
  'staff.rolesAssigned': { ar: 'تم تحديث أدوار الموظف', en: 'Staff roles updated' },
  'staff.permissionsSet': { ar: 'تم تحديث صلاحيات الدور', en: 'Role permissions updated' },
  'staff.noRoles': { ar: 'بدون أدوار', en: 'No roles' },
  'staff.noPermissions': { ar: 'بدون صلاحيات', en: 'No permissions' },
  'staff.phoneNormalizedNote': {
    ar: 'يُطبَّع الرقم تلقائيًا عند الحفظ.',
    en: 'The phone is normalized on save.',
  },
  'staff.currentIdentity': { ar: 'حسابك الحالي', en: 'Your account' },
  'staff.setPassword': { ar: 'ضبط كلمة مرور', en: 'Set password' },
  'staff.resetPassword': { ar: 'إعادة تعيين كلمة المرور', en: 'Reset password' },
  'staff.passwordPrompt': {
    ar: 'أدخل كلمة مرور مؤقتة للموظف. سيُطلب منه تغييرها عند أول تسجيل دخول، وستُلغى كل جلساته الحالية.',
    en: 'Set a temporary password. The staff member must change it on next sign-in, and all their current sessions are revoked.',
  },
  'staff.passwordPlaceholder': {
    ar: 'كلمة مرور مؤقتة (8+ أحرف)',
    en: 'Temporary password (8+ chars)',
  },
  'staff.passwordSet': { ar: 'تم ضبط كلمة المرور', en: 'Password set' },
  'staff.passwordEmpty': { ar: 'بدون كلمة مرور', en: 'No password set' },
  'staff.permCodeLabel': { ar: 'الرمز التقني', en: 'Technical code' },
  'staff.techDetails': { ar: 'تفاصيل تقنية', en: 'Technical details' },

  // Human-readable permission names (mapped from the backend permission codes)
  'staff.perm.CATALOG_READ': { ar: 'عرض المنتجات', en: 'View products' },
  'staff.perm.CATALOG_WRITE': { ar: 'إدارة المنتجات', en: 'Manage products' },
  'staff.perm.INVENTORY_READ': { ar: 'عرض المخزون', en: 'View inventory' },
  'staff.perm.INVENTORY_WRITE': { ar: 'تعديل المخزون', en: 'Adjust inventory' },
  'staff.perm.SUPPLIERS_WRITE': { ar: 'إدارة الموردين', en: 'Manage suppliers' },
  'staff.perm.SETTINGS_WRITE': { ar: 'إدارة الإعدادات', en: 'Manage settings' },
  'staff.perm.STAFF_WRITE': { ar: 'إدارة الموظفين', en: 'Manage staff' },
  'staff.perm.REPORTS_READ': { ar: 'عرض التقارير', en: 'View reports' },

  // ---------------------------------------------------------------------------
  // Admin redesign — shell navigation (workflow groups) + role
  // ---------------------------------------------------------------------------
  'shell.group.home': { ar: 'الرئيسية', en: 'Home' },
  'shell.group.operations': { ar: 'العمليات', en: 'Operations' },
  'shell.group.insights': { ar: 'التقارير والتحليلات', en: 'Reports & insights' },
  'shell.group.catalog': { ar: 'الكتالوج', en: 'Catalog' },
  'shell.group.management': { ar: 'الإدارة', en: 'Management' },
  'shell.nav.home': { ar: 'الرئيسية', en: 'Home' },
  'shell.nav.analytics': { ar: 'التحليلات', en: 'Analytics' },
  'shell.nav.orders': { ar: 'الطلبات', en: 'Orders' },
  'shell.nav.storeSales': { ar: 'مبيعات المحل', en: 'In-store sales' },
  'shell.nav.customers': { ar: 'دليل العملاء', en: 'Customers' },
  'shell.nav.reviews': { ar: 'التقييمات', en: 'Reviews' },
  'shell.nav.reports': { ar: 'التقارير والتحليلات', en: 'Reports & insights' },
  'shell.soon': { ar: 'قريبًا', en: 'Soon' },
  'shell.role.owner': { ar: 'مالك', en: 'Owner' },
  'shell.role.employee': { ar: 'موظف', en: 'Staff' },
  'shell.openMenu': { ar: 'فتح القائمة', en: 'Open menu' },

  // Global search
  'search.placeholder': { ar: 'ابحث عن منتج، رمز، طلب…', en: 'Search product, code, order…' },
  'search.products': { ar: 'منتجات', en: 'Products' },
  'search.pages': { ar: 'صفحات', en: 'Pages' },
  'search.empty': { ar: 'لا نتائج مطابقة', en: 'No matching results' },
  'search.hint': { ar: 'اكتب للبحث في المنتجات والصفحات', en: 'Type to search products and pages' },
  'search.min': { ar: 'اكتب حرفين على الأقل', en: 'Type at least 2 characters' },
  'search.searching': { ar: 'جارٍ البحث…', en: 'Searching…' },

  // ---------------------------------------------------------------------------
  // Employee operations home
  // ---------------------------------------------------------------------------
  'home.employeeTitle': { ar: 'شو بدك تعملي اليوم؟', en: 'What would you like to do?' },
  'home.hi': { ar: 'أهلاً {name}', en: 'Hi {name}' },
  'home.sellInStore': { ar: 'بيع داخل المحل', en: 'Sell in store' },
  'home.sellInStoreSub': { ar: 'تسجيل بيع مباشر للزبون', en: 'Record a direct customer sale' },
  'home.findProduct': { ar: 'البحث عن منتج', en: 'Find a product' },
  'home.findProductSub': { ar: 'بحث سريع بالاسم أو الرمز', en: 'Quick search by name or code' },
  'home.webOrders': { ar: 'طلبات الموقع', en: 'Website orders' },
  'home.webOrdersSub': { ar: 'تجهيز طلبات المتجر الإلكتروني', en: 'Prepare online store orders' },
  'home.addProduct': { ar: 'إضافة منتج', en: 'Add a product' },
  'home.addProductSub': { ar: 'منتج جديد للكتالوج', en: 'A new product in the catalog' },
  'home.checkStock': { ar: 'فحص المخزون', en: 'Check stock' },
  'home.checkStockSub': { ar: 'الكميات المتوفرة لكل صنف', en: 'On-hand quantity for every item' },
  'home.adjustStock': { ar: 'تعديل الكمية', en: 'Adjust quantity' },
  'home.adjustStockSub': { ar: 'استلام بضاعة أو تسجيل تلف', en: 'Receive stock or log damage' },
  'home.needsAttention': { ar: 'مخزون يحتاج انتباه', en: 'Stock needs attention' },
  'home.needsAttentionSub': {
    ar: 'أصناف نافدة أو قاربت على النفاد',
    en: 'Items out or close to out',
  },
  'home.recentActivity': { ar: 'آخر الحركات', en: 'Recent activity' },
  'home.allClear': {
    ar: 'كل شيء متوفر — لا يوجد ما يحتاج انتباهك.',
    en: 'All stocked — nothing needs your attention.',
  },

  // ---------------------------------------------------------------------------
  // Owner dashboard — additions
  // ---------------------------------------------------------------------------
  'dashboard.attentionSummary': { ar: '{out} نفد · {low} منخفض', en: '{out} out · {low} low' },
  'dashboard.reorderHint': {
    ar: 'موردون لديهم أصناف نافدة أو منخفضة المخزون.',
    en: 'Suppliers with out-of-stock or low-stock items.',
  },
  'dashboard.reorderEmpty': {
    ar: 'لا يوجد مورد يحتاج تنسيقًا الآن.',
    en: 'No supplier needs coordination right now.',
  },
  'dashboard.viewSupplierProducts': { ar: 'عرض منتجات المورد', en: 'View supplier products' },
  'dashboard.catalogSnapshot': { ar: 'لمحة عن الكتالوج', en: 'Catalog at a glance' },
  'dashboard.salesTitle': { ar: 'المبيعات', en: 'Sales' },
  'dashboard.salesSoonTitle': {
    ar: 'تقارير المبيعات قيد التجهيز',
    en: 'Sales reporting is on the way',
  },
  'dashboard.salesSoonText': {
    ar: 'عند تفعيل الطلبات ومبيعات المحل ستظهر هنا مبيعات اليوم والشهر ومقارنة المحل بالموقع.',
    en: "Once orders and in-store sales are enabled, today's and this month's sales plus a store-vs-online split will show here.",
  },
  'dashboard.analyticsSoonText': {
    ar: 'صفحة التحليلات ستُفتح عند توفر بيانات الطلبات والمبيعات في الخادم.',
    en: 'The analytics page opens once orders and sales data is available from the API.',
  },
  'dashboard.remaining': { ar: 'بقي {n}', en: '{n} left' },
  'dashboard.outNowShort': { ar: 'نفد', en: 'Out' },
  'dashboard.greetingMoreOwner': {
    ar: 'هاي أهم التفاصيل في زي العسل اليوم.',
    en: 'Here is what matters at Like Honey today.',
  },

  // ---------------------------------------------------------------------------
  // Products — redesign additions
  // ---------------------------------------------------------------------------
  'products.filters': { ar: 'تصفية', en: 'Filters' },
  'products.supplierFilter': { ar: 'المورد', en: 'Supplier' },
  'products.supplierAll': { ar: 'كل الموردين', en: 'All suppliers' },
  'products.stockFilter': { ar: 'المخزون', en: 'Stock' },
  'products.stockAll': { ar: 'كل المخزون', en: 'All stock' },
  'products.stockColumn': { ar: 'المخزون', en: 'Stock' },
  'products.readinessColumn': { ar: 'جاهزية البيع', en: 'Selling readiness' },
  'products.zeroResult': { ar: 'لا نتائج مطابقة', en: 'No matching results' },
  'products.zeroResultHint': {
    ar: 'جرّب كلمة أخرى أو أزل بعض عوامل التصفية.',
    en: 'Try another term or clear some filters.',
  },
  'products.clearFilters': { ar: 'مسح التصفية', en: 'Clear filters' },
  'products.openProduct': { ar: 'فتح المنتج', en: 'Open product' },

  // ---------------------------------------------------------------------------
  // Inventory — redesign additions
  // ---------------------------------------------------------------------------
  'inventory.lowLede': { ar: 'ما الذي يحتاج تزويد؟', en: 'What needs restocking?' },
  'inventory.summaryAvailable': { ar: 'متوفر', en: 'In stock' },
  'inventory.summaryLow': { ar: 'منخفض', en: 'Low' },
  'inventory.summaryOut': { ar: 'نافد', en: 'Out' },
  'inventory.addQ': { ar: 'إضافة', en: 'Add' },
  'inventory.subQ': { ar: 'إنقاص', en: 'Subtract' },
  'inventory.historyTitle': { ar: 'آخر الحركات', en: 'Recent activity' },
  'inventory.historyHint': {
    ar: 'كل تغيير على الكميات، بلغة المحل.',
    en: 'Every quantity change, in store language.',
  },
  'inventory.historyAdvanced': { ar: 'عرض السجل التفصيلي', en: 'Show detailed ledger' },
  'inventory.historyBasic': { ar: 'إخفاء التفاصيل', en: 'Hide details' },
  'inventory.byStaff': { ar: 'بواسطة {name}', en: 'by {name}' },
  'inventory.filterLevel': { ar: 'مستوى المخزون', en: 'Stock level' },
  'inventory.itemsWord': { ar: 'صنف', en: 'items' },
  'inventory.stockColumn': { ar: 'المخزون', en: 'Stock' },
  'inventory.readinessColumn': { ar: 'جاهزية البيع', en: 'Selling readiness' },
  'inventory.readinessReason': { ar: 'السبب', en: 'Reason' },

  // ---------------------------------------------------------------------------
  // Suppliers — redesign additions
  // ---------------------------------------------------------------------------
  'suppliers.productsWord': { ar: 'منتج', en: 'products' },
  'suppliers.lowWord': { ar: 'منخفض', en: 'low' },
  'suppliers.outWord': { ar: 'نافد', en: 'out' },
  'suppliers.allGood': { ar: 'كل الأصناف متوفرة', en: 'All items in stock' },
  'suppliers.coordinate': { ar: 'يحتاج تنسيق', en: 'Needs coordination' },

  // ---------------------------------------------------------------------------
  // Categories — redesign additions
  // ---------------------------------------------------------------------------
  'categories.count': { ar: '{n} منتج', en: '{n} products' },

  // ---------------------------------------------------------------------------
  // Staff — redesign additions
  // ---------------------------------------------------------------------------
  'staff.roleColumn': { ar: 'الدور', en: 'Role' },
  'staff.noRoleAssigned': { ar: 'بدون دور', en: 'No role' },
  'staff.permGroupsHint': {
    ar: 'اختر ما يمكن لهذا الدور القيام به.',
    en: 'Choose what this role can do.',
  },
  'staff.group.catalog': { ar: 'المنتجات', en: 'Products' },
  'staff.group.inventory': { ar: 'المخزون', en: 'Inventory' },
  'staff.group.suppliers': { ar: 'الموردون', en: 'Suppliers' },
  'staff.group.settings': { ar: 'الإعدادات', en: 'Settings' },
  'staff.group.staff': { ar: 'الموظفون', en: 'Staff' },
  'staff.group.reports': { ar: 'التقارير', en: 'Reports' },
  'staff.permView': { ar: 'عرض', en: 'View' },
  'staff.permManage': { ar: 'تعديل وإدارة', en: 'Manage' },
  'staff.permManageOnly': { ar: 'إدارة', en: 'Manage' },
  'staff.techToggle': { ar: 'عرض الرموز التقنية', en: 'Show technical codes' },

  // ---------------------------------------------------------------------------
  // Settings hub — tabs
  // ---------------------------------------------------------------------------
  'settings.tab.store': { ar: 'بيانات المتجر', en: 'Store' },
  'settings.tab.delivery': { ar: 'التوصيل', en: 'Delivery' },
  'settings.tab.payment': { ar: 'طرق الدفع', en: 'Payment methods' },
  'settings.tab.content': { ar: 'المحتوى', en: 'Content' },
  'settings.tab.operations': { ar: 'التشغيل', en: 'Operations' },
  'settings.paymentHint': {
    ar: 'طرق الدفع المتاحة للزبائن عند الطلب، وحالتها الفعلية.',
    en: 'Payment methods available to customers at checkout, and their actual availability.',
  },
  'settings.contentHint': {
    ar: 'النصوص التي تظهر في واجهة المتجر.',
    en: 'Text shown on the storefront.',
  },
  'settings.operationsHint': {
    ar: 'إعدادات عامة لتشغيل المتجر.',
    en: 'General store operation settings.',
  },
  'settings.storeHint': { ar: 'المعلومات الأساسية للمتجر.', en: 'Core store information.' },

  // ---------------------------------------------------------------------------
  // Create product — calmer flow
  // ---------------------------------------------------------------------------
  'products.form.progressTitle': { ar: 'خطوات الإنشاء', en: 'Steps' },
  'products.form.reviewTitle': { ar: 'المراجعة', en: 'Review' },

  // Common additions
  'common.filters': { ar: 'تصفية', en: 'Filters' },
  'common.clear': { ar: 'مسح', en: 'Clear' },
  'common.viewAll': { ar: 'عرض الكل', en: 'View all' },
  'common.apply': { ar: 'تطبيق', en: 'Apply' },
  'common.done': { ar: 'تم', en: 'Done' },

  // ---------------------------------------------------------------------------
  // Store sales (physical register) — Gate A
  // ---------------------------------------------------------------------------
  'storeSales.title': { ar: 'مبيعات المحل', en: 'In-store sales' },
  'storeSales.description': {
    ar: 'تسجيل المبيعات المباشرة داخل المحل وتحديث المخزون فورًا.',
    en: 'Record direct sales at the shop counter; inventory updates instantly.',
  },
  'storeSales.tabRegister': { ar: 'تسجيل بيع', en: 'New sale' },
  'storeSales.tabHistory': { ar: 'السجل', en: 'History' },
  'storeSales.registerTitle': { ar: 'تسجيل بيع داخل المحل', en: 'Record an in-store sale' },
  'storeSales.registerHint': {
    ar: 'ابحث عن المنتج، اختر الخيارات والكمية، ثم أضفه إلى السلة.',
    en: 'Search for the product, choose options and quantity, then add it to the sale.',
  },
  'storeSales.searchPlaceholder': {
    ar: 'ابحث باسم المنتج أو رمز المنتج…',
    en: 'Search by product name or code…',
  },
  'storeSales.searchMin': {
    ar: 'اكتب حرفين على الأقل للبحث',
    en: 'Type at least 2 letters to search',
  },
  'storeSales.searching': { ar: 'جارٍ البحث…', en: 'Searching…' },
  'storeSales.noResults': { ar: 'لا يوجد منتج مطابق', en: 'No matching product' },
  'storeSales.pickProduct': { ar: 'اختر منتجًا لبدء البيع', en: 'Pick a product to begin' },
  'storeSales.available': { ar: 'المتوفر: {n}', en: 'Available: {n}' },
  'storeSales.availablePieces': { ar: 'المتوفر: {n} قطعة', en: 'Available: {n} pcs' },
  'storeSales.outOfStock': { ar: 'غير متوفر', en: 'Out of stock' },
  'storeSales.chooseOptions': { ar: 'اختر الخيارات', en: 'Choose options' },
  'storeSales.quantity': { ar: 'الكمية', en: 'Quantity' },
  'storeSales.addToBasket': { ar: 'إضافة إلى السلة', en: 'Add to sale' },
  'storeSales.basket': { ar: 'سلة البيع', en: 'Sale basket' },
  'storeSales.basketEmpty': { ar: 'لم تتم إضافة أي منتج بعد.', en: 'Nothing added yet.' },
  'storeSales.basketEmptyHint': {
    ar: 'ابحث عن منتج وأضفه لبدء البيع.',
    en: 'Search for a product and add it to start.',
  },
  'storeSales.product': { ar: 'المنتج', en: 'Product' },
  'storeSales.option': { ar: 'الخيار', en: 'Option' },
  'storeSales.qty': { ar: 'الكمية', en: 'Qty' },
  'storeSales.price': { ar: 'السعر', en: 'Price' },
  'storeSales.lineTotal': { ar: 'الإجمالي', en: 'Total' },
  'storeSales.total': { ar: 'الإجمالي', en: 'Total' },
  'storeSales.confirmSale': { ar: 'تأكيد البيع', en: 'Confirm sale' },
  'storeSales.saving': { ar: 'جارٍ التسجيل…', en: 'Recording…' },
  'storeSales.noteLabel': { ar: 'ملاحظة (اختياري)', en: 'Note (optional)' },
  'storeSales.notePlaceholder': { ar: 'ملاحظة على العملية', en: 'A note on this sale' },
  'storeSales.customerPhone': { ar: 'هاتف الزبون (اختياري)', en: 'Customer phone (optional)' },
  'storeSales.successTitle': { ar: 'تم تسجيل البيع', en: 'Sale recorded' },
  'storeSales.successNumber': { ar: 'رقم العملية', en: 'Sale number' },
  'storeSales.successStock': {
    ar: 'تم تحديث المخزون تلقائيًا.',
    en: 'Inventory was updated automatically.',
  },
  'storeSales.newSale': { ar: 'تسجيل بيع جديد', en: 'New sale' },
  'storeSales.viewDetails': { ar: 'عرض تفاصيل العملية', en: 'View sale details' },
  'storeSales.notEnoughStock': {
    ar: 'الكمية المطلوبة أكبر من المتوفر.',
    en: "The requested quantity exceeds what's available.",
  },
  'storeSales.alreadyInBasket': {
    ar: 'هذا الخيار موجود في السلة — عدّل الكمية من هناك.',
    en: 'This option is already in the basket — adjust the quantity there.',
  },
  'storeSales.saleFailed': {
    ar: 'تعذّر تسجيل البيع. حاول مرة أخرى.',
    en: 'Could not record the sale. Try again.',
  },
  'storeSales.requiresCatalog': {
    ar: 'يلزم صلاحية عرض المنتجات لاستخدام سجل البيع.',
    en: 'Viewing products is required to use the register.',
  },
  'storeSales.remove': { ar: 'إزالة', en: 'Remove' },
  'storeSales.historyTitle': { ar: 'سجل مبيعات المحل', en: 'In-store sales history' },
  'storeSales.historySearchPlaceholder': {
    ar: 'ابحث برقم العملية أو اسم الموظف…',
    en: 'Search by sale number or staff name…',
  },
  'storeSales.historyEmpty': { ar: 'لا توجد مبيعات محل بعد.', en: 'No in-store sales yet.' },
  'storeSales.numberColumn': { ar: 'رقم العملية', en: 'Sale' },
  'storeSales.staffColumn': { ar: 'الموظف', en: 'Staff' },
  'storeSales.itemsColumn': { ar: 'الأصناف', en: 'Items' },
  'storeSales.totalColumn': { ar: 'الإجمالي', en: 'Total' },
  'storeSales.timeColumn': { ar: 'الوقت', en: 'Time' },
  'storeSales.detailsTitle': { ar: 'تفاصيل العملية', en: 'Sale details' },
  'storeSales.itemsCount': { ar: '{n} صنف', en: '{n} items' },
  'storeSales.unitsCount': { ar: '{n} قطعة', en: '{n} pcs' },

  // POS phone-first customer capture (Gate C §14-§17)
  'storeSales.customerSection': { ar: 'بيانات العميل', en: 'Customer' },
  'storeSales.customerLookupHint': {
    ar: 'اكتب رقم الهاتف — إذا كان العميل مسجّلًا ستظهر بياناته.',
    en: 'Type the phone — if the customer exists, their details appear.',
  },
  'storeSales.customerPhoneLabel': { ar: 'رقم الهاتف', en: 'Phone number' },
  'storeSales.customerNameLabel': { ar: 'اسم العميل', en: 'Customer name' },
  'storeSales.customerCityLabel': { ar: 'المدينة', en: 'City' },
  'storeSales.customerAddressLabel': { ar: 'العنوان', en: 'Address' },
  'storeSales.customerMatched': {
    ar: 'عميل مسجّل — تم جلب بياناته',
    en: 'Existing customer — details loaded',
  },
  'storeSales.customerNew': {
    ar: 'عميل جديد — أدخل بياناته (اختياري)',
    en: 'New customer — enter details (optional)',
  },
  'storeSales.customerLookupError': {
    ar: 'تعذّر البحث عن العميل',
    en: 'Could not look up the customer',
  },
  'storeSales.skipCustomer': { ar: 'بيع بدون بيانات عميل', en: 'Sell without customer details' },
  'storeSales.withCustomer': { ar: 'إضافة بيانات عميل', en: 'Add customer details' },
  'storeSales.customerCardTitle': { ar: 'العميل', en: 'Customer' },

  // ---------------------------------------------------------------------------
  // Customer card (shared: order detail, store-sale detail, POS lookup)
  // ---------------------------------------------------------------------------
  'customerCard.new': { ar: 'عميل جديد', en: 'New customer' },
  'customerCard.returning': { ar: 'عميل عائد', en: 'Returning' },
  'customerCard.noName': { ar: 'بدون اسم', en: 'No name' },
  'customerCard.view360': { ar: 'عرض ملف العميل 360', en: 'Open Customer 360' },
  'customerCard.viewShort': { ar: 'عرض الملف', en: 'View profile' },
  'customerCard.title': { ar: 'العميل', en: 'Customer' },
  'customerCard.notLinked': {
    ar: 'لا يوجد ملف عميل مرتبط بهذه العملية.',
    en: 'No customer profile is linked to this transaction.',
  },

  // ---------------------------------------------------------------------------
  // Customer Directory + Customer 360 (Gate C)
  // ---------------------------------------------------------------------------
  'customers.title': { ar: 'دليل العملاء', en: 'Customer directory' },
  'customers.description': {
    ar: 'سجل داخلي لهوية العملاء وتاريخهم الشرائي عبر القنوات. ليست حسابات دخول.',
    en: 'An internal record of customer identity and cross-channel purchase history. Not login accounts.',
  },
  'customers.searchPlaceholder': {
    ar: 'ابحث بالاسم أو رقم الهاتف…',
    en: 'Search by name or phone…',
  },
  'customers.filterStatus': { ar: 'الحالة', en: 'Status' },
  'customers.filterAll': { ar: 'الكل', en: 'All' },
  'customers.filterChannel': { ar: 'القناة', en: 'Channel' },
  'customers.channelAll': { ar: 'كل القنوات', en: 'All channels' },
  'customers.channelOnline': { ar: 'الموقع فقط', en: 'Online only' },
  'customers.channelStore': { ar: 'المحل فقط', en: 'Store only' },
  'customers.channelBoth': { ar: 'الموقع + المحل', en: 'Online + store' },
  'customers.filterType': { ar: 'نوع العميل', en: 'Customer type' },
  'customers.typeAll': { ar: 'الكل', en: 'All' },
  'customers.typeNew': { ar: 'عميل جديد', en: 'New customer' },
  'customers.typeReturning': { ar: 'عميل متكرر', en: 'Returning customer' },
  'customers.typeNoPurchase': { ar: 'بدون شراء مكتمل', en: 'No completed purchase' },
  'customers.filterInactive': { ar: 'لم يشترِ منذ', en: 'Inactive for' },
  'customers.inactiveAll': { ar: 'الكل', en: 'Any' },
  'customers.inactiveDays': { ar: '{n} يوم', en: '{n} days' },
  'customers.statusActive': { ar: 'نشط', en: 'Active' },
  'customers.statusInactive': { ar: 'مؤرشف', en: 'Archived' },
  'customers.empty': { ar: 'لا يوجد عملاء مطابقون.', en: 'No matching customers.' },
  'customers.colName': { ar: 'الاسم', en: 'Name' },
  'customers.colPhone': { ar: 'الهاتف', en: 'Phone' },
  'customers.colCity': { ar: 'المدينة', en: 'City' },
  'customers.colStatus': { ar: 'الحالة', en: 'Status' },
  'customers.colLastSeen': { ar: 'آخر ظهور', en: 'Last seen' },
  'customers.noName': { ar: 'بدون اسم', en: 'No name' },
  'customers.360Title': { ar: 'ملف العميل 360', en: 'Customer 360' },
  'customers.back': { ar: 'رجوع إلى الدليل', en: 'Back to directory' },
  'customers.section.profile': { ar: 'البيانات الحالية', en: 'Current details' },
  'customers.section.commercial': { ar: 'الملخص التجاري', en: 'Commercial summary' },
  'customers.section.timeline': {
    ar: 'سجل الشراء عبر القنوات',
    en: 'Cross-channel purchase history',
  },
  'customers.field.phone': { ar: 'رقم الهاتف', en: 'Phone' },
  'customers.field.city': { ar: 'المدينة', en: 'City' },
  'customers.field.address': { ar: 'العنوان', en: 'Address' },
  'customers.field.firstSeen': { ar: 'أول ظهور', en: 'First seen' },
  'customers.field.lastSeen': { ar: 'آخر ظهور', en: 'Last seen' },
  'customers.field.consent': { ar: 'موافقة التواصل التسويقي', en: 'Marketing contact consent' },
  'customers.field.note': { ar: 'ملاحظة', en: 'Note' },
  'customers.consentYes': { ar: 'نعم', en: 'Yes' },
  'customers.consentNo': { ar: 'لا', en: 'No' },
  'customers.metric.completedOrders': {
    ar: 'طلبات مكتملة (الموقع)',
    en: 'Completed online orders',
  },
  'customers.metric.completedSales': { ar: 'مبيعات المحل', en: 'In-store sales' },
  'customers.metric.lifetimeSpend': { ar: 'إجمالي ما دفعه العميل', en: 'Total customer spend' },
  'customers.metric.firstTx': { ar: 'أول عملية', en: 'First transaction' },
  'customers.metric.lastTx': { ar: 'آخر عملية', en: 'Last transaction' },
  'customers.spendHint': {
    ar: 'إجمالي ما دفعه العميل فعليًا (شامل التوصيل) — ليس ربحًا.',
    en: 'What the customer actually paid (delivery included) — not profit.',
  },
  'customers.completedHint': {
    ar: 'المكتمل فقط — لا يشمل الطلبات الملغاة أو قيد التجهيز.',
    en: 'Completed only — cancelled or in-progress orders are excluded.',
  },
  'customers.timelineEmpty': { ar: 'لا توجد عمليات شراء بعد.', en: 'No purchases yet.' },
  'customers.channel.online': { ar: 'طلب موقع', en: 'Online order' },
  'customers.channel.store': { ar: 'بيع محل', en: 'In-store sale' },
  'customers.archive': { ar: 'أرشفة العميل', en: 'Archive customer' },
  'customers.unarchive': { ar: 'إلغاء الأرشفة', en: 'Unarchive' },
  'customers.archiveHint': {
    ar: 'الأرشفة تخفي العميل من الدليل النشط دون حذف تاريخه.',
    en: 'Archiving hides the customer from the active directory without deleting history.',
  },
  'customers.forbidden': {
    ar: 'يلزم صلاحية "دليل العملاء" لعرض هذه الصفحة.',
    en: 'The "Customer directory" permission is required to view this page.',
  },

  // ---------------------------------------------------------------------------
  // Store reviews moderation (Reviews Gate)
  // ---------------------------------------------------------------------------
  'reviews.title': { ar: 'تقييمات العملاء', en: 'Customer reviews' },
  'reviews.description': {
    ar: 'مراجعة تقييمات تجربة التسوق قبل نشرها. لا يظهر أي تقييم للعامة إلا بعد اعتماده هنا.',
    en: 'Review shopping-experience feedback before it goes live. Nothing is shown publicly until it is approved here.',
  },
  'reviews.forbidden': {
    ar: 'يلزم صلاحية "إدارة تقييمات العملاء" لعرض هذه الصفحة.',
    en: 'The "Customer reviews moderation" permission is required to view this page.',
  },
  'reviews.filter.status': { ar: 'الحالة', en: 'Status' },
  'reviews.filter.all': { ar: 'الكل', en: 'All' },
  'reviews.status.pending': { ar: 'بانتظار المراجعة', en: 'Pending' },
  'reviews.status.approved': { ar: 'معتمد', en: 'Approved' },
  'reviews.status.rejected': { ar: 'مرفوض', en: 'Rejected' },
  'reviews.empty': { ar: 'لا توجد تقييمات مطابقة.', en: 'No matching reviews.' },
  'reviews.col.name': { ar: 'الاسم المعروض', en: 'Display name' },
  'reviews.col.rating': { ar: 'التقييم', en: 'Rating' },
  'reviews.col.excerpt': { ar: 'مقتطف', en: 'Excerpt' },
  'reviews.col.status': { ar: 'الحالة', en: 'Status' },
  'reviews.col.verified': { ar: 'شراء موثّق', en: 'Verified' },
  'reviews.col.submitted': { ar: 'تاريخ الإرسال', en: 'Submitted' },
  'reviews.verified.yes': { ar: 'موثّق', en: 'Verified' },
  'reviews.verified.no': { ar: 'غير موثّق', en: 'Unverified' },
  'reviews.linkedCustomer': { ar: 'مرتبط بعميل', en: 'Linked customer' },
  'reviews.back': { ar: 'رجوع إلى القائمة', en: 'Back to list' },
  'reviews.detail.title': { ar: 'تفاصيل التقييم', en: 'Review detail' },
  'reviews.detail.review': { ar: 'نص التقييم', en: 'Review text' },
  'reviews.detail.rating': { ar: 'التقييم', en: 'Rating' },
  'reviews.detail.status': { ar: 'الحالة', en: 'Status' },
  'reviews.detail.verified': { ar: 'شراء موثّق', en: 'Verified purchase' },
  'reviews.detail.verifiedSource': { ar: 'مصدر التوثيق', en: 'Verification source' },
  'reviews.detail.submittedPhone': {
    ar: 'هاتف مُدخَل (إداري فقط)',
    en: 'Submitted phone (admin only)',
  },
  'reviews.detail.submittedReference': {
    ar: 'مرجع الطلب المُدخَل',
    en: 'Submitted order reference',
  },
  'reviews.detail.linkedCustomer': { ar: 'العميل المرتبط', en: 'Linked customer' },
  'reviews.detail.viewCustomer': { ar: 'فتح ملف العميل 360', en: 'Open Customer 360' },
  'reviews.detail.submitted': { ar: 'أُرسل في', en: 'Submitted' },
  'reviews.detail.moderatedAt': { ar: 'تمت المراجعة في', en: 'Moderated' },
  'reviews.detail.note': {
    ar: 'ملاحظة داخلية (لا تظهر للعامة)',
    en: 'Internal note (never shown publicly)',
  },
  'reviews.detail.notePlaceholder': {
    ar: 'سبب الرفض أو ملاحظة للفريق…',
    en: 'Rejection reason or a note for the team…',
  },
  'reviews.detail.none': { ar: '—', en: '—' },
  'reviews.action.approve': { ar: 'اعتماد التقييم', en: 'Approve review' },
  'reviews.action.reject': { ar: 'رفض التقييم', en: 'Reject review' },
  'reviews.action.approved': { ar: 'تم الاعتماد ✓', en: 'Approved ✓' },
  'reviews.action.rejected': { ar: 'تم الرفض', en: 'Rejected' },
  'reviews.action.hintApprove': {
    ar: 'سيظهر هذا التقييم في الصفحة الرئيسية فور الاعتماد.',
    en: 'This review appears on the storefront home as soon as it is approved.',
  },
  'reviews.action.hintReject': {
    ar: 'لن يظهر التقييم للعامة. لا يمكن للإدارة تعديل نص العميل — فقط الاعتماد أو الرفض.',
    en: 'A rejected review is never shown publicly. Admins cannot edit the customer’s words — only approve or reject.',
  },
  'reviews.noModeratorNeeded': {
    ar: 'لا حاجة لإجراء — التقييم في حالته النهائية.',
    en: 'No action needed — already in a final state.',
  },

  // ---------------------------------------------------------------------------
  // Reports & Insights (Gate C)
  // ---------------------------------------------------------------------------
  'reports.title': { ar: 'التقارير والتحليلات', en: 'Reports & insights' },
  'reports.description': {
    ar: 'أرقام العمل الحقيقية — المبيعات المكتملة بتوقيت المتجر (Asia/Hebron)، مع مقارنة بالفترة السابقة.',
    en: 'Real business numbers — completed sales in store time (Asia/Hebron), compared to the previous period.',
  },
  'reports.forbidden': {
    ar: 'يلزم صلاحية التقارير لعرض هذه الصفحة.',
    en: 'The reports permission is required to view this page.',
  },
  'reports.periodLabel': { ar: 'الفترة', en: 'Period' },
  'reports.mode.day': { ar: 'يومي', en: 'Daily' },
  'reports.mode.week': { ar: 'أسبوعي', en: 'Weekly' },
  'reports.mode.month': { ar: 'شهري', en: 'Monthly' },
  'reports.mode.custom': { ar: 'مخصص', en: 'Custom' },
  'reports.pickDay': { ar: 'اليوم', en: 'Day' },
  'reports.pickWeekDay': { ar: 'أي يوم في الأسبوع', en: 'Any day in the week' },
  'reports.pickMonth': { ar: 'الشهر', en: 'Month' },
  'reports.from': { ar: 'من', en: 'From' },
  'reports.to': { ar: 'إلى', en: 'To' },
  'reports.vsPrev': { ar: 'مقارنة بالفترة السابقة', en: 'vs previous period' },
  'reports.noBaseline': { ar: 'لا توجد فترة سابقة للمقارنة', en: 'no previous period to compare' },

  'reports.tab.overview': { ar: 'نظرة عامة', en: 'Overview' },
  'reports.tab.sales': { ar: 'المبيعات', en: 'Sales' },
  'reports.tab.products': { ar: 'المنتجات والمخزون', en: 'Products & inventory' },
  'reports.tab.suppliers': { ar: 'الموردون', en: 'Suppliers' },
  'reports.tab.customers': { ar: 'العملاء', en: 'Customers' },
  'reports.tab.regions': { ar: 'المناطق', en: 'Regions' },

  'reports.section.channelFinancial': { ar: 'القنوات والوضع المالي', en: 'Channels & financials' },
  'reports.section.customersGlance': { ar: 'العملاء بلمحة', en: 'Customers at a glance' },

  'reports.kpi.merchandise': { ar: 'مبيعات البضاعة', en: 'Merchandise sales' },
  'reports.kpi.merchandiseHint': {
    ar: 'قيمة البضاعة فقط — لا تشمل رسوم التوصيل.',
    en: 'Goods only — delivery fees not included.',
  },
  'reports.kpi.deliveryFees': { ar: 'رسوم التوصيل', en: 'Delivery fees' },
  'reports.kpi.deliveryFeesHint': {
    ar: 'محصّلة بشكل منفصل عن مبيعات البضاعة.',
    en: 'Collected separately from merchandise sales.',
  },
  'reports.kpi.grossMargin': { ar: 'هامش البضاعة', en: 'Gross margin' },
  'reports.kpi.grossMarginHint': {
    ar: 'المبيعات ناقص تكلفة الشراء المسجّلة. ليس "صافي الربح".',
    en: 'Sales minus recorded acquisition cost. Not net profit.',
  },
  'reports.kpi.coveredMargin': {
    ar: 'هامش المبيعات المغطاة بالتكلفة',
    en: 'Cost-covered sales margin',
  },
  'reports.kpi.coveredMarginNote': {
    ar: 'محسوب على {pct}% من قيمة المبيعات التي تتوفر لها تكلفة شراء. التكلفة غير المعروفة لا تُقدَّر ولا تُحتسب صفرًا.',
    en: 'Computed on {pct}% of sales value that has an acquisition cost. Unknown cost is never estimated or treated as zero.',
  },
  'reports.kpi.marginUnavailable': { ar: 'غير متاح', en: 'Unavailable' },
  'reports.kpi.marginUnavailableNote': {
    ar: 'لا تتوفر تكلفة شراء لأي من مبيعات هذه الفترة.',
    en: 'No acquisition cost is recorded for any of this period’s sales.',
  },
  'reports.kpi.costCoverage': { ar: 'تغطية بيانات التكلفة', en: 'Cost-data coverage' },
  'reports.kpi.costCoverageHint': {
    ar: 'نسبة قيمة المبيعات التي لها تكلفة شراء مسجّلة.',
    en: 'Share of sales VALUE with a recorded acquisition cost.',
  },
  'reports.kpi.completedOrders': { ar: 'طلبات مكتملة', en: 'Completed orders' },
  'reports.kpi.completedSales': { ar: 'مبيعات المحل', en: 'In-store sales' },
  'reports.kpi.completedTx': { ar: 'عمليات مكتملة', en: 'Completed transactions' },
  'reports.kpi.unitsSold': { ar: 'قطع مباعة', en: 'Units sold' },
  'reports.kpi.avgBasket': { ar: 'متوسط قيمة العملية', en: 'Average basket' },
  'reports.kpi.channelOnline': { ar: 'مبيعات الموقع', en: 'Online sales' },
  'reports.kpi.channelStore': { ar: 'مبيعات المحل', en: 'In-store sales' },
  'reports.kpi.uniqueCustomers': { ar: 'عملاء نشطون', en: 'Active customers' },
  'reports.kpi.purchasingCustomers': { ar: 'العملاء المشترون', en: 'Purchasing customers' },
  'reports.kpi.newCustomers': { ar: 'عملاء جدد', en: 'New customers' },
  'reports.kpi.returningCustomers': { ar: 'عملاء عائدون', en: 'Returning customers' },
  'reports.kpi.repeatPurchasers': { ar: 'كرروا الشراء', en: 'Repeat purchasers' },
  'reports.kpi.repeatPurchaseRate': { ar: 'نسبة تكرار الشراء', en: 'Repeat purchase rate' },

  'reports.pipeline.title': { ar: 'قيد التشغيل الآن', en: 'Operational pipeline' },
  'reports.pipeline.hint': {
    ar: 'حالة تشغيلية حالية — ليست ضمن المبيعات المكتملة.',
    en: 'Current operational state — not part of completed sales.',
  },
  'reports.pipeline.processing': { ar: 'قيد التجهيز', en: 'Preparing' },
  'reports.pipeline.delivering': { ar: 'قيد التوصيل', en: 'Out for delivery' },

  'reports.insights.title': { ar: 'أهم ما يحدث الآن', en: "What's happening now" },
  'reports.insights.empty': {
    ar: 'لا توجد ملاحظات لهذه الفترة.',
    en: 'Nothing notable for this period.',
  },

  'reports.sales.colDate': { ar: 'التاريخ', en: 'Date' },
  'reports.sales.colOnline': { ar: 'الموقع', en: 'Online' },
  'reports.sales.colStore': { ar: 'المحل', en: 'Store' },
  'reports.sales.colTotal': { ar: 'الإجمالي', en: 'Total' },
  'reports.sales.colOrders': { ar: 'عمليات', en: 'Transactions' },
  'reports.sales.prevTotal': { ar: 'إجمالي الفترة السابقة', en: 'Previous period total' },
  'reports.sales.empty': {
    ar: 'لا مبيعات مكتملة في هذه الفترة.',
    en: 'No completed sales in this period.',
  },

  'reports.products.topTitle': { ar: 'الأكثر مبيعًا', en: 'Best sellers' },
  'reports.products.stagnantTitle': { ar: 'بطيء الحركة / راكد', en: 'Slow movers' },
  'reports.products.stagnantHint': {
    ar: 'أصناف متوفرة للبيع (المتاح فعليًا = المخزون ناقص المحجوز) بلا بيع خلال المدة المحددة.',
    en: 'In-stock items (available = on-hand minus reserved) with no sale within the chosen window.',
  },
  'reports.products.colProduct': { ar: 'المنتج', en: 'Product' },
  'reports.products.colUnits': { ar: 'القطع المباعة', en: 'Units sold' },
  'reports.products.colRevenue': { ar: 'الإيراد', en: 'Revenue' },
  'reports.products.colAvailable': { ar: 'المتاح للبيع', en: 'Available' },
  'reports.products.colDaysIdle': { ar: 'أيام بلا بيع', en: 'Days idle' },
  'reports.products.colLastSold': { ar: 'آخر بيع', en: 'Last sold' },
  'reports.products.colCapital': { ar: 'رأس مال مقدّر', en: 'Est. capital' },
  'reports.products.colPeriodUnits': { ar: 'مبيع الفترة', en: 'Units this period' },
  'reports.products.daysUnit': { ar: 'يوم', en: 'days' },
  'reports.products.capitalHint': {
    ar: 'تقدير لقيمة المخزون الحالي = المتاح للبيع × تكلفة الشراء الحالية (حيث توجد تكلفة مسجّلة).',
    en: 'Current inventory value estimate = available × current acquisition cost (where a cost is recorded).',
  },
  'reports.products.daysFilter': { ar: 'مدة الركود', en: 'Idle window' },
  'reports.products.daysOption': { ar: '{n} يومًا', en: '{n} days' },
  'reports.products.categoryFilter': { ar: 'التصنيف', en: 'Category' },
  'reports.products.supplierFilter': { ar: 'المورد', en: 'Supplier' },
  'reports.products.allCategories': { ar: 'كل التصنيفات', en: 'All categories' },
  'reports.products.allSuppliers': { ar: 'كل الموردين', en: 'All suppliers' },
  'reports.products.withStockOnly': { ar: 'المتوفر فقط', en: 'With stock only' },
  'reports.products.neverSoldOnly': { ar: 'لم يُبَع مطلقًا', en: 'Never sold only' },
  'reports.products.searchPlaceholder': { ar: 'ابحث بالاسم أو الرمز…', en: 'Search name or SKU…' },
  'reports.products.neverSold': { ar: 'لم يُبَع', en: 'Never sold' },
  'reports.products.empty': { ar: 'لا بيانات.', en: 'No data.' },

  'reports.breakdown.colName': { ar: 'المورّد', en: 'Supplier' },
  'reports.breakdown.colUnits': { ar: 'قطع مباعة', en: 'Units sold' },
  'reports.breakdown.colRevenue': { ar: 'الإيراد', en: 'Revenue' },
  'reports.breakdown.colMargin': { ar: 'هامش البضاعة', en: 'Gross margin' },
  'reports.breakdown.colCoverage': { ar: 'تغطية التكلفة', en: 'Cost coverage' },
  'reports.breakdown.colInventory': { ar: 'المخزون الحالي', en: 'Current stock' },
  'reports.breakdown.colStagnant': { ar: 'أصناف راكدة', en: 'Stagnant SKUs' },
  'reports.breakdown.unattributed': {
    ar: 'إيراد بلا مورّد مسجّل وقت البيع (غير محدد): {amount}',
    en: 'Revenue with no supplier recorded at sale time (unattributed): {amount}',
  },
  'reports.breakdown.empty': { ar: 'لا بيانات لهذه الفترة.', en: 'No data for this period.' },
  'reports.breakdown.na': { ar: 'غير متاح', en: 'n/a' },
  'reports.breakdown.covered': { ar: 'مغطاة', en: 'covered' },
  'reports.breakdown.drilldown': { ar: 'عرض المنتجات', en: 'View products' },
  'reports.breakdown.drilldownEmpty': {
    ar: 'لا مبيعات مكتملة لهذا المورد في هذه الفترة.',
    en: 'No completed sales for this supplier in this period.',
  },
  'reports.breakdown.noLongerSupplied': { ar: 'لم يعد لدى هذا المورد', en: 'moved supplier' },
  'reports.breakdown.noLongerSuppliedHint': {
    ar: 'المبيعات التاريخية تبقى منسوبة لهذا المورد، لكن المخزون الحالي لهذا المنتج أصبح لدى مورد آخر.',
    en: "Historical sales stay attributed here, but this product's current stock now belongs to another supplier.",
  },
  'reports.breakdown.groupHistorical': { ar: 'الأداء التاريخي', en: 'Historical performance' },
  'reports.breakdown.groupCurrent': { ar: 'الوضع الحالي', en: 'Current state' },
  'reports.breakdown.drilldownSplitHint': {
    ar: 'الأداء التاريخي محسوب على المورّد وقت البيع. الوضع الحالي يعكس علاقة المورّد الحالية فقط.',
    en: 'Historical performance is by the supplier at sale time. Current state reflects only the present supplier relationship.',
  },

  'reports.customers.topTitle': { ar: 'أعلى العملاء إنفاقًا', en: 'Top customers by spend' },
  'reports.customers.repeatRate': { ar: 'نسبة العملاء العائدين', en: 'Repeat rate' },
  'reports.customers.channelBoth': { ar: 'اشترى من القناتين', en: 'Both channels' },
  'reports.customers.channelSplit': { ar: 'موقع فقط / محل فقط', en: 'Online only / store only' },
  'reports.customers.channelSplitHint': {
    ar: 'عدد العملاء لكل قناة حصريًا.',
    en: 'Customers exclusive to each channel.',
  },
  'reports.customers.purchaserNote': {
    ar: 'كل الأرقام أدناه تحتسب العمليات المكتملة فقط. العملاء بلا شراء مكتمل غير محتسبين.',
    en: 'All figures below count completed transactions only. Contacts with no completed purchase are excluded.',
  },
  'reports.customers.noPurchase': {
    ar: 'جهات اتصال بدون شراء مكتمل',
    en: 'Contacts with no completed purchase',
  },
  'reports.customers.noPurchaseHint': {
    ar: 'هويات أُنشئت من محاولات شراء لم تكتمل — ليست ضمن مؤشرات العملاء المشترين. (إجمالي، وليس ضمن الفترة)',
    en: 'Identities created from checkout attempts that never completed — not part of the purchaser KPIs. (All-time, not windowed.)',
  },
  'reports.customers.returnedFromPrev': {
    ar: 'عادوا من فترة سابقة',
    en: 'Returned from a previous period',
  },
  'reports.customers.returnedFromPrevHint': {
    ar: 'عملاء نشطون في هذه الفترة وكان لهم شراء مكتمل قبلها. مفهوم تحليلي منفصل عن "كرروا الشراء".',
    en: 'Customers active this period who had a completed purchase before it. A separate analytical concept from "repeat purchasers".',
  },
  'reports.customers.linkCoverageTitle': {
    ar: 'تغطية ربط العمليات بالعملاء',
    en: 'Customer-link coverage',
  },
  'reports.customers.linkCoverageValue': {
    ar: '{linked} من {total} عملية مكتملة مرتبطة بملف عميل ({pct}%)',
    en: '{linked} of {total} completed transactions linked to a customer profile ({pct}%)',
  },
  'reports.customers.linkCoverageNote': {
    ar: 'العمليات غير المرتبطة تشمل المبيعات بدون بيانات عميل والسجلات التاريخية التي لا تحتوي على هوية عميل.',
    en: 'Unlinked transactions include sales with no customer data and historical records that carry no customer identity.',
  },
  'reports.customers.covOnlineLinked': { ar: 'موقع · مرتبط', en: 'Online · linked' },
  'reports.customers.covOnlineUnlinked': { ar: 'موقع · غير مرتبط', en: 'Online · unlinked' },
  'reports.customers.covStoreLinked': { ar: 'محل · مرتبط', en: 'Store · linked' },
  'reports.customers.covStoreUnlinked': { ar: 'محل · غير مرتبط', en: 'Store · unlinked' },
  'reports.customers.colCustomer': { ar: 'العميل', en: 'Customer' },
  'reports.customers.colOrders': { ar: 'طلبات', en: 'Orders' },
  'reports.customers.colStore': { ar: 'مبيعات محل', en: 'Store' },
  'reports.customers.colSpend': { ar: 'الإنفاق', en: 'Spend' },
  'reports.customers.empty': {
    ar: 'لا عملاء نشطون في هذه الفترة.',
    en: 'No active customers this period.',
  },

  'reports.regions.colRegion': { ar: 'المنطقة', en: 'Region' },
  'reports.regions.colOrders': { ar: 'طلبات', en: 'Orders' },
  'reports.regions.colCustomers': { ar: 'عملاء', en: 'Customers' },
  'reports.regions.colRevenue': { ar: 'الإيراد', en: 'Revenue' },
  'reports.regions.colBasket': { ar: 'متوسط العملية', en: 'Avg basket' },
  'reports.regions.colLast': { ar: 'آخر نشاط', en: 'Last activity' },
  'reports.regions.unknown': { ar: 'غير محدد', en: 'Unspecified' },
  'reports.regions.empty': {
    ar: 'لا طلبات مكتملة بمنطقة توصيل في هذه الفترة.',
    en: 'No completed orders with a delivery region this period.',
  },

  // ---------------------------------------------------------------------------
  // Orders (Gate B3)
  // ---------------------------------------------------------------------------
  'orders.title': { ar: 'الطلبات', en: 'Orders' },
  'orders.description': {
    ar: 'إدارة طلبات الموقع ومتابعة تجهيزها وتسليمها.',
    en: 'Manage online orders and track preparation and delivery.',
  },
  'orders.queue.processing': { ar: 'قيد التجهيز', en: 'Preparing' },
  'orders.queue.delivering': { ar: 'قيد التوصيل', en: 'Delivering' },
  'orders.queue.completed': { ar: 'مكتمل', en: 'Completed' },
  'orders.queue.cancelled': { ar: 'ملغي', en: 'Cancelled' },
  'orders.queue.all': { ar: 'الكل', en: 'All' },
  'orders.searchPlaceholder': {
    ar: 'ابحث برقم الطلب أو اسم العميل أو الهاتف',
    en: 'Search by order number, customer name, or phone',
  },
  'orders.filters': { ar: 'تصفية', en: 'Filters' },
  'orders.filters.title': { ar: 'تصفية الطلبات', en: 'Filter orders' },
  'orders.filters.paymentMethod': { ar: 'طريقة الدفع', en: 'Payment method' },
  'orders.filters.paymentStatus': { ar: 'حالة الدفع', en: 'Payment status' },
  'orders.filters.date': { ar: 'التاريخ', en: 'Date' },
  'orders.filters.dateFrom': { ar: 'من تاريخ', en: 'From date' },
  'orders.filters.dateTo': { ar: 'إلى تاريخ', en: 'To date' },
  'orders.filters.any': { ar: 'الكل', en: 'Any' },
  'orders.filters.apply': { ar: 'تطبيق', en: 'Apply' },
  'orders.filters.clear': { ar: 'مسح التصفية', en: 'Clear filters' },
  'orders.filters.activeNote': { ar: 'تصفية مُفعّلة', en: 'Filters active' },
  'orders.filters.dateNote': {
    ar: 'التواريخ محسوبة بتوقيت المتجر (فلسطين).',
    en: 'Dates use the store’s local business time (Palestine).',
  },
  'orders.loadMore': { ar: 'تحميل المزيد', en: 'Load more' },
  'orders.col.order': { ar: 'الطلب', en: 'Order' },
  'orders.col.customer': { ar: 'العميل', en: 'Customer' },
  'orders.col.location': { ar: 'الموقع', en: 'Location' },
  'orders.col.items': { ar: 'القطع', en: 'Items' },
  'orders.col.total': { ar: 'الإجمالي', en: 'Total' },
  'orders.col.payment': { ar: 'الدفع', en: 'Payment' },
  'orders.col.status': { ar: 'الحالة', en: 'Status' },
  'orders.col.action': { ar: 'الإجراء', en: 'Action' },
  'orders.itemsCount': { ar: '{n} قطع', en: '{n} pcs' },
  'orders.viewDetails': { ar: 'عرض التفاصيل', en: 'View details' },
  'orders.empty.processing': {
    ar: 'لا توجد طلبات بانتظار التجهيز.',
    en: 'No orders awaiting preparation.',
  },
  'orders.empty.delivering': {
    ar: 'لا توجد طلبات قيد التوصيل.',
    en: 'No orders out for delivery.',
  },
  'orders.empty.completed': {
    ar: 'لا توجد طلبات مكتملة ضمن هذا العرض.',
    en: 'No completed orders in this view.',
  },
  'orders.empty.cancelled': {
    ar: 'لا توجد طلبات ملغاة ضمن هذا العرض.',
    en: 'No cancelled orders in this view.',
  },
  'orders.empty.all': { ar: 'لا توجد طلبات ضمن هذا العرض.', en: 'No orders in this view.' },
  'orders.empty.search': { ar: 'لا يوجد طلب مطابق لبحثك.', en: 'No order matches your search.' },
  'orders.search.allResults': {
    ar: 'نتائج البحث في جميع الطلبات.',
    en: 'Searching across all orders.',
  },

  // actions
  'orders.action.startDelivery': { ar: 'جاهز للتوصيل', en: 'Ready for delivery' },
  'orders.action.complete': { ar: 'تم التسليم', en: 'Delivered' },
  'orders.action.cancel': { ar: 'إلغاء الطلب', en: 'Cancel order' },
  'orders.action.pending': { ar: 'جارٍ التنفيذ…', en: 'Working…' },

  // action feedback
  'orders.done.startDelivery': {
    ar: 'تم نقل الطلب إلى قيد التوصيل.',
    en: 'Order moved to out for delivery.',
  },
  'orders.done.complete': { ar: 'تم تسجيل الطلب كمكتمل.', en: 'Order recorded as completed.' },
  'orders.done.cancelRestocked': {
    ar: 'تم إلغاء الطلب وإعادة المنتجات إلى المخزون.',
    en: 'Order cancelled and items returned to stock.',
  },
  'orders.done.cancelNoRestock': {
    ar: 'تم إلغاء الطلب دون تعديل المخزون.',
    en: 'Order cancelled without changing stock.',
  },

  // payment presentation
  'orders.payment.method': { ar: 'طريقة الدفع', en: 'Payment method' },
  'orders.payment.status': { ar: 'الحالة', en: 'Status' },
  'orders.method.cod': { ar: 'الدفع عند الاستلام', en: 'Cash on delivery' },
  'orders.collect.pending': { ar: 'لم يُحصّل بعد', en: 'Not yet collected' },
  'orders.collect.collected': { ar: 'تم التحصيل', en: 'Collected' },

  // electronic payment section (order detail)
  'orders.payment.electronicPendingNote': {
    ar: 'بانتظار تأكيد عملية الدفع. لا يتم تجهيز الطلب كطلب مدفوع قبل تأكيد الدفع.',
    en: 'Waiting for payment confirmation. The order is not treated as paid until payment is confirmed.',
  },
  'orders.payment.electronicExpiredNote': {
    ar: 'تم إلغاء الطلب تلقائيًا بعد التأكد من عدم وجود عملية دفع قابلة للاكتمال.',
    en: 'The order was cancelled automatically after confirming no payment could be completed.',
  },
  'orders.payment.electronicPaidNote': {
    ar: 'تم تأكيد الدفع لهذا الطلب.',
    en: 'Payment for this order has been confirmed.',
  },
  'orders.payment.noActionElectronic': {
    ar: 'لا إجراءات يدوية متاحة على طلبات الدفع الإلكتروني في هذه المرحلة.',
    en: 'No manual actions are available on electronic-payment orders at this stage.',
  },
  'orders.payment.electronicPaidFulfillmentNote': {
    ar: 'يمكن متابعة تجهيز الطلب وتوصيله بشكل عادي — لا حاجة لأي إجراء دفع إضافي.',
    en: 'Fulfillment can continue normally — no additional payment action is needed.',
  },

  // detail
  'orders.detail.customer': { ar: 'بيانات العميل', en: 'Customer' },
  'orders.detail.customerName': { ar: 'الاسم', en: 'Name' },
  'orders.detail.customerPhone': { ar: 'الهاتف', en: 'Phone' },
  'orders.detail.customerCity': { ar: 'المدينة', en: 'City' },
  'orders.detail.customerAddress': { ar: 'العنوان', en: 'Address' },
  'orders.detail.customerNote': { ar: 'ملاحظة العميل', en: 'Customer note' },
  'orders.detail.customerSnapshot': {
    ar: 'بيانات هذا الطلب كما أُدخلت وقت الشراء',
    en: 'This order’s details as entered at purchase time',
  },
  'orders.detail.delivery': { ar: 'التوصيل', en: 'Delivery' },
  'orders.detail.deliveryZone': { ar: 'منطقة التوصيل', en: 'Delivery zone' },
  'orders.detail.deliveryFee': { ar: 'رسوم التوصيل', en: 'Delivery fee' },
  'orders.detail.items': { ar: 'الأصناف', en: 'Items' },
  'orders.detail.unitPrice': { ar: 'سعر القطعة', en: 'Unit price' },
  'orders.detail.qty': { ar: 'الكمية', en: 'Qty' },
  'orders.detail.lineTotal': { ar: 'إجمالي السطر', en: 'Line total' },
  'orders.detail.totals': { ar: 'المجموع', en: 'Totals' },
  'orders.detail.subtotal': { ar: 'المجموع الفرعي', en: 'Subtotal' },
  'orders.detail.tax': { ar: 'الضريبة', en: 'Tax' },
  'orders.detail.grandTotal': { ar: 'الإجمالي', en: 'Total' },
  'orders.detail.payment': { ar: 'الدفع', en: 'Payment' },
  'orders.detail.fulfillment': { ar: 'التتبّع', en: 'Fulfillment' },
  'orders.detail.activity': { ar: 'سجل النشاط', en: 'Activity' },
  'orders.detail.vendorNote': { ar: 'ملاحظة داخلية', en: 'Internal note' },
  'orders.detail.back': { ar: 'رجوع إلى الطلبات', en: 'Back to orders' },
  'orders.detail.notFound': { ar: 'الطلب غير موجود.', en: 'Order not found.' },

  // fulfillment events / timeline
  'orders.event.created': { ar: 'تم إنشاء الطلب', en: 'Order created' },
  'orders.event.deliveryStarted': { ar: 'بدأ التوصيل', en: 'Delivery started' },
  'orders.event.completed': { ar: 'تم التسليم', en: 'Delivered' },
  'orders.event.cancelled': { ar: 'تم إلغاء الطلب', en: 'Order cancelled' },
  'orders.event.by': { ar: 'بواسطة {name}', en: 'by {name}' },
  'orders.event.restocked': { ar: 'أُعيدت المنتجات إلى المخزون', en: 'Items returned to stock' },
  'orders.event.notRestocked': {
    ar: 'لم تُعد المنتجات إلى المخزون',
    en: 'Items not returned to stock',
  },
  'orders.event.stockReturned': {
    ar: 'استلام منتجات ملغاة إلى المخزون',
    en: 'Cancelled-order stock received',
  },
  'orders.event.stockReturnedQty': {
    ar: 'تم تسجيل وصول {n} قطعة إلى مخزون المحل.',
    en: '{n} piece(s) recorded as arrived at the store.',
  },
  'orders.timeline.empty': { ar: 'لا يوجد نشاط مسجّل بعد.', en: 'No recorded activity yet.' },

  // delayed physical stock return (cancelled orders)
  'orders.return.sectionTitle': { ar: 'حالة رجوع المنتجات', en: 'Stock return status' },
  'orders.return.fullyRestored': {
    ar: 'تمت إعادة جميع الكميات للمخزون.',
    en: 'All quantities have been returned to stock.',
  },
  'orders.return.outstandingIntro': {
    ar: 'الطلب ملغي، والمنتجات لم تُسجل كعائدة للمحل بعد.',
    en: 'The order is cancelled, and the items have not yet been recorded as returned to the store.',
  },
  'orders.return.partialIntro': {
    ar: 'تمت إعادة بعض الكميات للمخزون؛ ما زال هناك كميات بانتظار الرجوع.',
    en: 'Some quantities have been returned to stock; some are still awaiting return.',
  },
  'orders.return.action': { ar: 'تسجيل وصول المنتجات للمحل', en: 'Record items arrived at store' },
  'orders.return.lineOrdered': { ar: 'الكمية المطلوبة', en: 'Ordered' },
  'orders.return.lineReturned': { ar: 'أُعيدت سابقًا', en: 'Already returned' },
  'orders.return.lineRemaining': { ar: 'متبقٍّ', en: 'Remaining' },
  'orders.return.lineReceivingNow': { ar: 'الكمية المستلمة الآن', en: 'Receiving now' },
  'orders.return.dialogTitle': {
    ar: 'تسجيل وصول المنتجات للمحل — {number}',
    en: 'Record items arrived at store — {number}',
  },
  'orders.return.dialogWarning': {
    ar: 'سجّل فقط المنتجات التي وصلت فعليًا إلى المحل. سيتم إضافتها إلى المخزون فور التأكيد.',
    en: 'Only record items that have actually arrived at the store. They will be added to stock as soon as you confirm.',
  },
  'orders.return.confirm': {
    ar: 'تأكيد وصول المنتجات وإضافتها للمخزون',
    en: 'Confirm arrival and add to stock',
  },
  'orders.return.cancelDialog': { ar: 'إلغاء', en: 'Cancel' },
  'orders.return.receiptsTitle': { ar: 'سجل استلام المنتجات', en: 'Receipt history' },
  'orders.return.receiptBy': { ar: 'استلمها {name}', en: 'Received by {name}' },
  'orders.return.done': {
    ar: 'تم تسجيل وصول المنتجات وإضافتها للمخزون.',
    en: 'Item arrival recorded and added to stock.',
  },
  'orders.return.pendingBadge': { ar: 'بانتظار رجوع المنتجات', en: 'Awaiting stock return' },
  'orders.return.noneEligible': {
    ar: 'لا توجد أصناف بانتظار الرجوع حاليًا.',
    en: 'No items are currently awaiting return.',
  },

  // cancelled detail
  'orders.cancelled.reason': { ar: 'سبب الإلغاء', en: 'Cancellation reason' },
  'orders.cancelled.at': { ar: 'وقت الإلغاء', en: 'Cancelled at' },
  'orders.cancelled.by': { ar: 'ألغاه', en: 'Cancelled by' },
  'orders.cancelled.restockedYes': {
    ar: 'أُعيدت المنتجات إلى المخزون عند الإلغاء',
    en: 'Items were returned to stock on cancellation',
  },
  'orders.cancelled.restockedNo': {
    ar: 'لم تُعد المنتجات إلى المخزون عند الإلغاء',
    en: 'Items were not returned to stock on cancellation',
  },

  // cancel dialog
  'orders.cancel.title': { ar: 'إلغاء الطلب {number}؟', en: 'Cancel order {number}?' },
  'orders.cancel.reasonLabel': { ar: 'سبب الإلغاء', en: 'Cancellation reason' },
  'orders.cancel.reasonPlaceholder': {
    ar: 'اكتب سبب الإلغاء…',
    en: 'Write the reason for cancelling…',
  },
  'orders.cancel.reasonRequired': { ar: 'سبب الإلغاء مطلوب.', en: 'A reason is required.' },
  'orders.cancel.processingNote': {
    ar: 'سيتم إلغاء الطلب وإعادة المنتجات إلى المخزون تلقائيًا.',
    en: 'The order will be cancelled and its items returned to stock automatically.',
  },
  'orders.cancel.deliveringQuestion': {
    ar: 'هل عادت المنتجات فعليًا إلى مخزون المحل؟',
    en: 'Have the items physically returned to the store’s stock?',
  },
  'orders.cancel.returnedYes': { ar: 'نعم، عادت المنتجات', en: 'Yes, items returned' },
  'orders.cancel.returnedNo': { ar: 'لا، لم تعد بعد', en: 'No, not returned yet' },
  'orders.cancel.yesNote': {
    ar: 'سيتم إلغاء الطلب وإعادة الكميات إلى المخزون.',
    en: 'The order will be cancelled and the quantities returned to stock.',
  },
  'orders.cancel.noNote': {
    ar: 'سيتم إلغاء الطلب دون تعديل المخزون. يمكنك تسجيل عودة المنتجات لاحقًا عند وصولها فعليًا.',
    en: 'The order will be cancelled without changing stock. You can record the items’ return later when they physically arrive.',
  },
  'orders.cancel.confirm': { ar: 'تأكيد الإلغاء', en: 'Confirm cancellation' },
  'orders.cancel.back': { ar: 'رجوع', en: 'Back' },
  'orders.cancel.dismiss': { ar: 'تراجع', en: 'Keep order' },
  'orders.cancel.nowDelivering': {
    ar: 'تم تحديث حالة الطلب إلى "قيد التوصيل". نحتاج معرفة ما إذا كانت المنتجات قد عادت للمخزون قبل الإلغاء.',
    en: 'The order is now "Out for delivery". We need to know whether the items returned to stock before cancelling.',
  },
} as const satisfies Record<string, LocalizedText>

export type DictKey = keyof typeof dict

export type { AdminLang }

interface LangContextValue {
  lang: AdminLang
  dir: AdminDir
  setLang: (lang: AdminLang) => void
  t: (key: DictKey, params?: Record<string, string | number>) => string
}

const LangContext = createContext<LangContextValue | null>(null)

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  )
}

export function LangProvider({ children }: { children: ReactNode }) {
  // Always starts at the SSR-safe default ('ar') so the very first client
  // render matches the server-rendered HTML exactly — `readAdminLang()`
  // cannot run during that render (it depends on `localStorage`, which the
  // server never sees). The real persisted preference is applied one tick
  // later, in the mount-only effect below, as an ordinary state update
  // rather than a hydration diff.
  const [lang, setLangState] = useState<AdminLang>('ar')

  const setLang = useCallback((next: AdminLang) => {
    setLangState(next)
  }, [])

  // Mount-only: adopt the real persisted language once the client is live.
  // A one-time state adoption from `localStorage` (unreadable during SSR) is
  // the standard, deliberate exception to "don't setState in an effect" —
  // React bails out of the re-render entirely when the value is unchanged.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLangState(readAdminLang())
  }, [])

  useEffect(() => {
    writeAdminLang(lang)
    applyDocumentDirection(lang)
  }, [lang])

  const t = useCallback(
    (key: DictKey, params?: Record<string, string | number>) => {
      const entry = dict[key]
      if (entry === undefined) return key
      return interpolate(entry[lang], params)
    },
    [lang],
  )

  const value = useMemo<LangContextValue>(
    () => ({ lang, dir: lang === 'ar' ? 'rtl' : 'ltr', setLang, t }),
    [lang, setLang, t],
  )

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext)
  if (ctx === null) throw new Error('useLang must be used within LangProvider')
  return ctx
}

export function useT() {
  return useLang().t
}

export function useLocale() {
  return useLang().lang
}
