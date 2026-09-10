import type { StorefrontLang } from './locale'

/**
 * Storefront UI strings, fully bilingual (Arabic default / English secondary).
 *
 * `ar` / `en` dictionaries mirror each other. Commerce values that already carry
 * `*_ar` / `*_en` in the catalog are resolved from API data via the locale
 * context, not duplicated here; this file covers the UI chrome, statuses and
 * validation/errors only.
 */

interface CopyShape {
  langName: string
  nav: {
    home: string
    catalog: string
    cart: string
    cartLabel: string
    search: string
    searchPlaceholder: string
    switchTo: string
    menu: string
    close: string
    browseStore: string
    skipToContent: string
  }
  footer: {
    about: string
    explore: string
    help: string
    contact: string
    exploreLinks: string[]
    helpLinks: string[]
    rights: string
  }
  home: {
    /** Scene 1 — the cinematic entrance (brand + bee, minimal copy). */
    entrance: {
      kicker: string
      titleA: string
      titleB: string
      lead: string
      scrollHint: string
    }
    /** Scenes 2–5 — one per merchandise world the bee guides the visitor through. */
    scenes: {
      key: 'clothing' | 'shoesBags' | 'toysAccessories' | 'babyGifts'
      /** Primary category `code` used to resolve the live catalog slug for the CTA. */
      categoryCode: string
      kicker: string
      title: string
      lead: string
      cta: string
    }[]
    /** Final scene — the hand-off from storytelling into commerce. */
    finale: {
      kicker: string
      title: string
      lead: string
      cta: string
    }
  }
  availability: {
    inStock: string
    outOfStock: string
    new: string
  }
  catalog: {
    subtitle: string
    all: string
    emptyTitle: string
    emptyBody: string
    searchCount: string
  }
  product: {
    backToCatalog: string
    quantity: string
    addToCart: string
    added: string
    viewCart: string
    soldOut: string
    selectRequired: string
    from: string
    chooseVariant: string
    addShort: string
    limitedStock: string
    whatYouGet: string
  }
  cart: {
    title: string
    emptyTitle: string
    emptyBody: string
    browse: string
    subtotal: string
    deliveryHint: string
    checkout: string
    continueShopping: string
    remove: string
    increase: string
    decrease: string
    count: string
    items: string
    summary: string
    inCart: string
    qtyAdjusted: string
    itemRemoved: string
  }
  /** Persistent cart dock — the minimal summary bar pinned while browsing. */
  dock: {
    count: string
    items: string
    subtotal: string
    viewCart: string
  }
  checkout: {
    title: string
    subtitle: string
    customer: string
    delivery: string
    review: string
    payment: string
    name: string
    phone: string
    city: string
    addressLine1: string
    addressLine2: string
    note: string
    zone: string
    consent: string
    codLabel: string
    codBody: string
    submit: string
    submitting: string
    orderSummary: string
    deliveryFee: string
    totalLabel: string
    amountsDue: string
    trustNote: string
    methodElectronic: string
    methodElectronicBody: string
    methodUnavailable: string
    stepCustomer: string
    stepDelivery: string
    stepPayment: string
    stepSummary: string
  }
  success: {
    title: string
    subtitle: string
    orderNumber: string
    statusProcessing: string
    codUnpaid: string
    codPaid: string
    codLabel: string
    total: string
    browse: string
    status: string
    payment: string
    delivery: string
    loading: string
    methodElectronic: string
    electronicPaidTitle: string
    electronicPaidBody: string
    electronicPendingTitle: string
    electronicPendingBody: string
    electronicExpiredTitle: string
    electronicExpiredBody: string
  }
  errors: {
    network: string
    notFound: string
    loadFailed: string
    insufficientStock: string
    validation: string
    checkoutUnavailable: string
    cartInvalid: string
    totalsChanged: string
    idempotencyConflict: string
    paymentMethodDisabled: string
    paymentProviderUnavailable: string
    paymentReconciliationPending: string
    itemNoLongerAvailable: string
  }
  /** New composed Home (hero / discovery / picks / trust) — Gate: storefront rebuild Phase 1. */
  hero: {
    kicker: string
    titleA: string
    titleB: string
    lead: string
    ctaPrimary: string
    ctaSecondary: string
  }
  discovery: {
    title: string
    sub: string
  }
  picks: {
    title: string
    sub: string
    viewAll: string
  }
  banner: {
    kicker: string
    titleA: string
    titleB: string
    lead: string
    cta: string
  }
  trust: {
    codTitle: string
    codBody: string
    careTitle: string
    careBody: string
    curatedTitle: string
    curatedBody: string
  }
  card: {
    add: string
    choose: string
    outOfStock: string
    from: string
    noImage: string
  }
  shopPage: {
    title: string
    sub: string
    allCategories: string
    resultsCount: string
    prev: string
    next: string
    pageOf: string
    emptyTitle: string
    emptyBody: string
    resetFilters: string
  }
  sheet: {
    title: string
    availability: string
    close: string
  }
  stage: {
    kicker: string
    cta: string
    prev: string
    next: string
  }
}

const ar: CopyShape = {
  langName: 'English',
  nav: {
    home: 'الرئيسية',
    catalog: 'المتجر',
    cart: 'السلة',
    cartLabel: 'سلة التسوق',
    search: 'البحث',
    searchPlaceholder: 'ابحث في المتجر…',
    switchTo: 'English',
    menu: 'القائمة',
    close: 'إغلاق',
    browseStore: 'تصفّح المتجر',
    skipToContent: 'تخطَّ إلى المحتوى',
  },
  footer: {
    about:
      'متجرٌ فلسطيني راقٍ لملابس وأحذية وحقائب وألعاب ومستلزمات الأطفال — اختيارٌ موجَّه بعناية، لأيامٍ أجمل.',
    explore: 'استكشاف',
    help: 'خدمة العملاء',
    contact: 'تواصل معنا',
    exploreLinks: ['المتجر', 'الأقسام', 'التشكيلة', 'قصتنا'],
    helpLinks: ['سياسة الاستبدال', 'الشحن والدفع', 'الأسئلة الشائعة', 'تواصل معنا'],
    rights: '© ٢٠٢٦ زي العسل — جميع الحقوق محفوظة',
  },
  home: {
    entrance: {
      kicker: 'من جنين إليكم',
      titleA: 'كل عالمٍ صغير',
      titleB: 'يبدأ من هون',
      lead: 'ملابس، أحذية، حقائب، ألعابٌ وهدايا — كل قطعةٍ نختارها بعنايةٍ لأيامٍ صغارٍ أجمل.',
      scrollHint: 'اكتشف المزيد',
    },
    scenes: [
      {
        key: 'clothing',
        categoryCode: 'clothing',
        kicker: 'الفصل الأول',
        title: 'عالم الملابس',
        lead: 'أثوابٌ وقطعٌ يوميةٌ ناعمة، مختارةٌ لتلائم حركتهم وأيامهم.',
        cta: 'تسوّق الملابس',
      },
      {
        key: 'shoesBags',
        categoryCode: 'shoes',
        kicker: 'الفصل الثاني',
        title: 'أحذيةٌ وحقائب',
        lead: 'خطواتٌ مرنة، وحقائبُ تشاركهم يومهم من المدرسة إلى النزهة.',
        cta: 'تسوّق الأحذية والحقائب',
      },
      {
        key: 'toysAccessories',
        categoryCode: 'toys',
        kicker: 'الفصل الثالث',
        title: 'ألعابٌ وإكسسوارات',
        lead: 'تفاصيلُ صغيرة تصنع فرحاً كبيراً — للعب وللإطلالة معاً.',
        cta: 'تصفّح الألعاب والإكسسوارات',
      },
      {
        key: 'babyGifts',
        categoryCode: 'baby',
        kicker: 'الفصل الرابع',
        title: 'للرضّع وللمناسبات',
        lead: 'مستلزمات رضّعٍ ناعمة، وهدايا تُختار بمحبة لكل مناسبة.',
        cta: 'تسوّق مستلزمات الرضّع والهدايا',
      },
    ],
    finale: {
      kicker: 'زي العسل',
      title: 'كل شيء بانتظارك في المتجر',
      lead: 'كل عالمٍ صغير بانتظارك — تصفّح التشكيلة كاملة.',
      cta: 'إلى المتجر',
    },
  },
  availability: {
    inStock: 'متوفر',
    outOfStock: 'نفذ',
    new: 'جديد',
  },
  product: {
    backToCatalog: 'المتجر',
    quantity: 'الكمية',
    addToCart: 'أضف إلى السلة',
    added: 'أُضيف إلى السلة ✓',
    viewCart: 'عرض السلة',
    soldOut: 'نفدت الكمية',
    selectRequired: 'اختر الخيار للمتابعة',
    from: 'ابتداءً من',
    chooseVariant: 'اختيار الخيار',
    addShort: 'أضف',
    limitedStock: 'متبقي عدد محدود',
    whatYouGet: 'ماذا يتضمّن المنتج',
  },
  catalog: {
    subtitle: 'ملابس وأحذية، حقائب، ألعاب وإكسسوارات للرضّع والأطفال.',
    all: 'الكل',
    emptyTitle: 'لا توجد منتجات مطابقة',
    emptyBody: 'جرّب تعديل البحث أو تصفّح قسمًا آخر.',
    searchCount: 'نتيجة',
  },
  cart: {
    title: 'سلة التسوق',
    emptyTitle: 'سلة فارغة',
    emptyBody: 'لا قطع في السلة بعد — ابدأ من المتجر.',
    browse: 'تصفّح المتجر',
    subtotal: 'المجموع الفرعي',
    deliveryHint: 'تُضاف رسوم التوصيل عند إتمام الطلب حسب المنطقة.',
    checkout: 'إتمام الطلب',
    continueShopping: 'مواصلة التسوق',
    remove: 'إزالة',
    increase: 'زيادة',
    decrease: 'تقليص',
    count: 'قطعة',
    items: 'قطع',
    summary: 'ملخص السلة',
    inCart: 'في السلة',
    qtyAdjusted: 'تم تعديل الكمية حسب المتوفر من المخزون.',
    itemRemoved: 'لم يعد أحد المنتجات متوفرًا، وتم إزالته من السلة.',
  },
  dock: {
    count: 'قطعة',
    items: 'قطع',
    subtotal: 'المجموع الفرعي',
    viewCart: 'عرض السلة',
  },
  checkout: {
    title: 'إتمام الطلب',
    subtitle: 'أكمل بياناتك، واختر منطقة التوصيل، وراجع طلبك قبل التأكيد.',
    customer: 'بياناتك',
    delivery: 'التوصيل والمنطقة',
    review: 'مراجعة الطلب',
    payment: 'الدفع',
    name: 'الاسم الكامل',
    phone: 'رقم الهاتف',
    city: 'المدينة',
    addressLine1: 'العنوان',
    addressLine2: 'تفاصيل إضافية (اختياري)',
    note: 'ملاحظة (اختياري)',
    zone: 'منطقة التوصيل',
    consent: 'أوافق على الاحتفاظ ببياناتي للتواصل حول هذا الطلب.',
    codLabel: 'الدفع عند الاستلام',
    codBody: 'الدفع نقداً عند استلام الطلب — عند التوصيل أو من المتجر.',
    submit: 'تأكيد الطلب',
    submitting: 'جارٍ إتمام الطلب…',
    orderSummary: 'ملخص الطلب',
    deliveryFee: 'التوصيل',
    totalLabel: 'الإجمالي',
    amountsDue: 'مستحق عند الاستلام',
    trustNote: 'نراجع طلبك معك قبل التوصيل، ونؤكد المنطقة والمبلغ عبر الهاتف.',
    methodElectronic: 'الدفع الإلكتروني',
    methodElectronicBody: 'دفع إلكتروني آمن لإتمام الطلب.',
    methodUnavailable: 'غير متاح حاليًا',
    stepCustomer: 'بياناتك',
    stepDelivery: 'التوصيل',
    stepPayment: 'طريقة الدفع',
    stepSummary: 'ملخص الطلب',
  },
  success: {
    title: 'شكراً لك!',
    subtitle: 'تم استلام طلبك بنجاح وسنتواصل معك قريباً لتأكيد التوصيل.',
    orderNumber: 'رقم الطلب',
    statusProcessing: 'قيد التجهيز',
    codUnpaid: 'غير مدفوع',
    codPaid: 'مدفوع',
    codLabel: 'الدفع عند الاستلام',
    total: 'الإجمالي',
    browse: 'تصفّح المتجر',
    status: 'الحالة',
    payment: 'الدفع',
    delivery: 'التوصيل',
    loading: 'جارٍ تحميل تفاصيل الطلب…',
    methodElectronic: 'الدفع الإلكتروني',
    electronicPaidTitle: 'تم تأكيد الدفع!',
    electronicPaidBody: 'تم تأكيد الدفع واستلام طلبك بنجاح.',
    electronicPendingTitle: 'جارٍ التحقق من حالة الدفع',
    electronicPendingBody: 'استلمنا طلبك، ونتحقق الآن من حالة الدفع — سنؤكد لك عند الانتهاء.',
    electronicExpiredTitle: 'تعذّر إكمال الدفع',
    electronicExpiredBody: 'انتهت مهلة عملية الدفع لهذا الطلب. يمكنك المحاولة من جديد من المتجر.',
  },
  errors: {
    network: 'تعذّر الاتصال، يرجى المحاولة مجدداً.',
    notFound: 'لم نعثر على ما تبحث عنه.',
    loadFailed: 'تعذّر تحميل المحتوى، يرجى المحاولة مجدداً.',
    insufficientStock: 'عذراً، الكمية المطلوبة غير متوفرة في المخزون.',
    validation: 'يرجى التأكد من إدخال البيانات بشكل صحيح.',
    checkoutUnavailable: 'الدفع عند الاستلام غير متاح حالياً.',
    cartInvalid: 'أحد عناصر السلة لم يعد متوفراً.',
    totalsChanged:
      'تغيّر إجمالي الطلب حسب الأسعار الحالية، تمت مراجعة السلة تلقائيًا — يرجى التأكيد مجددًا.',
    idempotencyConflict: 'حدث تعارض أثناء إرسال الطلب. يرجى إعادة المحاولة.',
    paymentMethodDisabled: 'طريقة الدفع هذه غير متاحة حاليًا.',
    paymentProviderUnavailable: 'الدفع الإلكتروني غير متاح حاليًا، يرجى اختيار الدفع عند الاستلام.',
    paymentReconciliationPending: 'جارٍ التحقق من حالة الدفع.',
    itemNoLongerAvailable: 'أحد المنتجات لم يعد متوفرًا وتمت إزالته من السلة.',
  },
  hero: {
    kicker: 'من جنين إليكم',
    titleA: 'فرحةٌ صغيرة،',
    titleB: 'بعنايةٍ كبيرة',
    lead: 'نختار كل قطعة بعناية — ملابس، ألعاب وهدايا تلائم أيامهم الصغيرة.',
    ctaPrimary: 'ابدأ التسوق',
    ctaSecondary: 'استكشاف المجموعة',
  },
  discovery: {
    title: 'تسوّق حسب القسم',
    sub: 'كل قسمٍ عالمٌ صغير — اختر نقطة البداية.',
  },
  picks: {
    title: 'مختارات زي العسل',
    sub: 'تشكيلةٌ نحبها هذا الأسبوع، اخترناها بعناية.',
    viewAll: 'عرض الكل',
  },
  banner: {
    kicker: 'زي العسل',
    titleA: 'تفاصيل صغيرة',
    titleB: 'لأيام أجمل',
    lead: 'كل قطعة نختارها بعناية، لترافق أيامهم وتضيف لها لمسة أجمل.',
    cta: 'تصفّح المتجر',
  },
  trust: {
    codTitle: 'الدفع عند الاستلام',
    codBody: 'الدفع عند استلام الطلب — بلا حاجة لبطاقة.',
    careTitle: 'نتابع طلبك بأنفسنا',
    careBody: 'نراجع الطلب معك ونؤكد التفاصيل عبر الهاتف قبل التوصيل.',
    curatedTitle: 'اختيارٌ موجَّه بعناية',
    curatedBody: 'كل قطعة في المتجر مُختارة بعناية، لا مجرد مخزون.',
  },
  card: {
    add: 'أضف للسلة',
    choose: 'اختيار الخيار',
    outOfStock: 'نفدت الكمية',
    from: 'ابتداءً من',
    noImage: 'صورة قريبًا',
  },
  shopPage: {
    title: 'المتجر',
    sub: 'ملابس وأحذية وحقائب وألعاب ومستلزمات للرضّع والأطفال.',
    allCategories: 'كل الأقسام',
    resultsCount: 'نتيجة',
    prev: 'السابق',
    next: 'التالي',
    pageOf: 'صفحة {page} من {total}',
    emptyTitle: 'لا توجد منتجات مطابقة',
    emptyBody: 'جرّب تعديل البحث أو اختيار قسمٍ آخر.',
    resetFilters: 'إعادة ضبط عوامل التصفية',
  },
  sheet: {
    title: 'اختيار الخيار',
    availability: 'المتوفر',
    close: 'إغلاق',
  },
  stage: {
    kicker: 'لمحة قريبة',
    cta: 'عرض التفاصيل',
    prev: 'السابق',
    next: 'التالي',
  },
}

const en: CopyShape = {
  langName: 'العربية',
  nav: {
    home: 'Home',
    catalog: 'Shop',
    cart: 'Cart',
    cartLabel: 'Your cart',
    search: 'Search',
    searchPlaceholder: 'Search the store…',
    switchTo: 'العربية',
    menu: 'Menu',
    close: 'Close',
    browseStore: 'Browse the store',
    skipToContent: 'Skip to content',
  },
  footer: {
    about:
      'A refined Palestinian children\u2019s store for clothing, shoes, bags, toys and baby essentials — curated with care, for brighter days.',
    explore: 'Explore',
    help: 'Support',
    contact: 'Contact',
    exploreLinks: ['Shop', 'Categories', 'Collection', 'Our story'],
    helpLinks: ['Exchange policy', 'Shipping & payment', 'FAQ', 'Contact us'],
    rights: '© 2026 Like Honey — All rights reserved',
  },
  home: {
    entrance: {
      kicker: 'The Palestinian kids store',
      titleA: 'Every little world',
      titleB: 'starts right here',
      lead: 'Clothing, shoes, bags, toys and gifts — every piece chosen with care for brighter little days.',
      scrollHint: 'Scroll to explore',
    },
    scenes: [
      {
        key: 'clothing',
        categoryCode: 'clothing',
        kicker: 'Chapter one',
        title: 'The clothing world',
        lead: 'Soft everyday pieces, chosen to move with them.',
        cta: 'Shop clothing',
      },
      {
        key: 'shoesBags',
        categoryCode: 'shoes',
        kicker: 'Chapter two',
        title: 'Shoes & bags',
        lead: 'Flexible steps, and bags that go with them from school to play.',
        cta: 'Shop shoes & bags',
      },
      {
        key: 'toysAccessories',
        categoryCode: 'toys',
        kicker: 'Chapter three',
        title: 'Toys & accessories',
        lead: 'Small details that make big joy — for play and for style.',
        cta: 'Shop toys & accessories',
      },
      {
        key: 'babyGifts',
        categoryCode: 'baby',
        kicker: 'Chapter four',
        title: 'Baby & gifting',
        lead: 'Soft baby essentials, and gifts chosen with love for every occasion.',
        cta: 'Shop baby & gifts',
      },
    ],
    finale: {
      kicker: 'Like Honey',
      title: 'Ready to see it all?',
      lead: 'Every little world is waiting in the shop — browse the full collection.',
      cta: 'Enter the store',
    },
  },
  availability: {
    inStock: 'In stock',
    outOfStock: 'Sold out',
    new: 'New',
  },
  product: {
    backToCatalog: 'Shop',
    quantity: 'Quantity',
    addToCart: 'Add to cart',
    added: 'Added to cart ✓',
    viewCart: 'View cart',
    soldOut: 'Sold out',
    selectRequired: 'Choose an option to continue',
    from: 'From',
    chooseVariant: 'Choose',
    addShort: 'Add',
    limitedStock: 'Limited stock left',
    whatYouGet: "What you'll get",
  },
  catalog: {
    subtitle: 'Clothing, shoes, bags, toys and accessories for babies and kids.',
    all: 'All',
    emptyTitle: 'No matching products',
    emptyBody: 'Try adjusting your search or browsing another section.',
    searchCount: 'results',
  },
  cart: {
    title: 'Your cart',
    emptyTitle: 'Your cart is empty',
    emptyBody: 'You haven\u2019t added anything yet — start from the shop.',
    browse: 'Browse the shop',
    subtotal: 'Subtotal',
    deliveryHint: 'Delivery fees are added at checkout depending on your zone.',
    checkout: 'Checkout',
    continueShopping: 'Continue shopping',
    remove: 'Remove',
    increase: 'Increase',
    decrease: 'Decrease',
    count: 'item',
    items: 'items',
    summary: 'Cart summary',
    inCart: 'in your cart',
    qtyAdjusted: 'Quantity adjusted to what is currently in stock.',
    itemRemoved: 'One item is no longer available and was removed from your cart.',
  },
  dock: {
    count: 'item',
    items: 'items',
    subtotal: 'Subtotal',
    viewCart: 'View cart',
  },
  checkout: {
    title: 'Checkout',
    subtitle:
      'Enter your details, choose your delivery area, and review your order before confirming.',
    customer: 'Your details',
    delivery: 'Delivery & zone',
    review: 'Order review',
    payment: 'Payment',
    name: 'Full name',
    phone: 'Phone number',
    city: 'City',
    addressLine1: 'Address',
    addressLine2: 'Extra details (optional)',
    note: 'Note (optional)',
    zone: 'Delivery zone',
    consent: 'I agree to store my details to be contacted about this order.',
    codLabel: 'Cash on Delivery',
    codBody: 'Receive your order, then pay — cash on delivery or on in-store pickup.',
    submit: 'Confirm order',
    submitting: 'Placing order…',
    orderSummary: 'Order summary',
    deliveryFee: 'Delivery',
    totalLabel: 'Total',
    amountsDue: 'Due on delivery',
    trustNote:
      'We review your order with you before delivery and confirm the zone and amount by phone.',
    methodElectronic: 'Electronic Payment',
    methodElectronicBody: 'Pay securely online to complete your order.',
    methodUnavailable: 'Not available right now',
    stepCustomer: 'Your details',
    stepDelivery: 'Delivery',
    stepPayment: 'Payment method',
    stepSummary: 'Order summary',
  },
  success: {
    title: 'Thank you!',
    subtitle:
      'Your order was received successfully. We\u2019ll be in touch shortly to confirm delivery.',
    orderNumber: 'Order number',
    statusProcessing: 'Processing',
    codUnpaid: 'Unpaid',
    codPaid: 'Paid',
    codLabel: 'Cash on Delivery',
    total: 'Total',
    browse: 'Browse the shop',
    status: 'Status',
    payment: 'Payment',
    delivery: 'Delivery',
    loading: 'Loading order…',
    methodElectronic: 'Electronic Payment',
    electronicPaidTitle: 'Payment confirmed!',
    electronicPaidBody: 'Your payment was confirmed and your order was received.',
    electronicPendingTitle: 'Checking payment status',
    electronicPendingBody:
      "We've received your order and are checking the payment status now — we'll confirm shortly.",
    electronicExpiredTitle: "Payment couldn't be completed",
    electronicExpiredBody: 'This payment attempt has expired. You can try again from the shop.',
  },
  errors: {
    network: 'Connection failed. Please try again.',
    notFound: 'We couldn\u2019t find what you asked for.',
    loadFailed: 'Couldn\u2019t load this content. Please try again.',
    insufficientStock: 'Sorry, the requested quantity is not in stock.',
    validation: 'Please check your details and try again.',
    checkoutUnavailable: 'Cash on Delivery is not available right now.',
    cartInvalid: 'One of the cart items is no longer available.',
    totalsChanged:
      'The order total changed based on current pricing — your cart was refreshed automatically. Please confirm again.',
    idempotencyConflict: 'There was a conflict submitting your order. Please try again.',
    paymentMethodDisabled: 'This payment method is not available right now.',
    paymentProviderUnavailable:
      'Electronic payment is not available right now — please choose Cash on Delivery.',
    paymentReconciliationPending: 'Checking payment status.',
    itemNoLongerAvailable: 'One item is no longer available and was removed from your cart.',
  },
  hero: {
    kicker: 'The Palestinian kids store',
    titleA: 'Small joys,',
    titleB: 'chosen with care',
    lead: 'Clothing, toys and gifts we choose piece by piece, for their small days.',
    ctaPrimary: 'Start shopping',
    ctaSecondary: 'See our picks',
  },
  discovery: {
    title: 'Shop by category',
    sub: 'Every category is a little world — pick where to start.',
  },
  picks: {
    title: 'Like Honey Picks',
    sub: 'A collection we love this week, chosen for you with care.',
    viewAll: 'View all',
  },
  banner: {
    kicker: 'Like Honey',
    titleA: 'Small details,',
    titleB: 'brighter days',
    lead: 'Each piece is chosen with care, to be part of their days and add a little more joy to them.',
    cta: 'Browse the shop',
  },
  trust: {
    codTitle: 'Cash on Delivery',
    codBody: 'Receive your order, then pay — no card needed.',
    careTitle: 'We follow up personally',
    careBody: 'We review your order and confirm details by phone before delivery.',
    curatedTitle: 'Thoughtfully curated',
    curatedBody: 'Every piece in the shop is chosen with care, not just stocked.',
  },
  card: {
    add: 'Add to cart',
    choose: 'Choose option',
    outOfStock: 'Sold out',
    from: 'From',
    noImage: 'Image coming soon',
  },
  shopPage: {
    title: 'Shop',
    sub: 'Clothing, shoes, bags, toys and essentials for babies and kids.',
    allCategories: 'All categories',
    resultsCount: 'results',
    prev: 'Previous',
    next: 'Next',
    pageOf: 'Page {page} of {total}',
    emptyTitle: 'No matching products',
    emptyBody: 'Try adjusting your search or choosing another category.',
    resetFilters: 'Reset filters',
  },
  sheet: {
    title: 'Choose an option',
    availability: 'Available',
    close: 'Close',
  },
  stage: {
    kicker: 'A closer look',
    cta: 'See the details',
    prev: 'Previous',
    next: 'Next',
  },
}

export const copy: Record<StorefrontLang, CopyShape> = { ar, en }
export type { CopyShape }
