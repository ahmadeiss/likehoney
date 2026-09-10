/**
 * Production catalog seed — pure, dependency-free core.
 *
 * This module holds everything the one-time production catalog seed needs
 * EXCEPT the live connection and the CLI plumbing in
 * `../seed-production-catalog.mjs`:
 *
 *   - the 100-row authored bilingual catalog table (children's retail —
 *     from LIKE HONEY the store, never honey products),
 *   - the deterministic plan generator (product → option definitions →
 *     variant combinations → per-variant stock & acquisition cost),
 *   - the runtime category / supplier resolver against the EXISTING
 *     production categories and suppliers,
 *   - pure invariant validation (statuses, SKU grammar, variant cap,
 *     coverage letters A–E, stock mix, cost bounds, biliteracy),
 *   - the parameterized SQL statement builder the CLI executes inside ONE
 *     atomic transaction per product.
 *
 * Design rules honored here (see AGENTS.md + SKU_STANDARD.md):
 *   - SKUs are `LH-{CATEGORY_CODE}-{SEQUENCE:6}-{SUFFIX}`; the sequence is
 *     the identity-generated `products.sequence`, so SKU strings are built
 *     IN SQL from the inserted row (subselect) — never precomputed in JS.
 *   - Option value codes match `^[A-Z0-9]{1,8}$`; variant suffixes join
 *     one or more codes with `-`.
 *   - Every product carries exactly ONE primary image (media row + R2
 *     object); inventory writes balance + INITIAL_STOCK movement in the
 *     same transaction (zero-stock variants get a balance row only, because
 *     `inventory_movements.quantity_change != 0`).
 *   - Only ever CREATE the missing delta up to exactly
 *     `PRODUCTION_CATALOG_TARGET` products. Nothing here updates, deletes,
 *     or rewrites existing rows and no table outside the catalog/media/
 *     inventory set is ever written.
 *
 * Determinism & idempotency: every generated identity is a UUIDv5 derived
 * from the seed ordinal, so a rerun regenerates the identical rows and each
 * insert carries `ON CONFLICT DO NOTHING`. An interrupted run is completed
 * on rerun (the product row is reused; its children are filled in), never
 * duplicated.
 */
import { createHash } from 'node:crypto'

/** The one number the seed converges to: exactly this many products. */
export const PRODUCTION_CATALOG_TARGET = 100

/**
 * The seed's PERMANENT namespace. Production is expected to start with at
 * least one existing store product (#001); the seed owns exactly ordinals
 * `SEED_START_ORDINAL` .. `PRODUCTION_CATALOG_TARGET - 1` (#002-#100).
 *
 * This is intentionally NOT derived from the live product count: a partial or
 * interrupted write must never shift the identity of seeded products. `#002`
 * is always ordinal 1 and `#100` is always ordinal 99, regardless of how many
 * rows landed or failed on a previous run.
 */
export const SEED_START_ORDINAL = 1
export const SEED_COUNT = PRODUCTION_CATALOG_TARGET - SEED_START_ORDINAL

/** Operator-facing label for a seed ordinal (1 → #002, 99 → #100). */
export function seedOrdinalLabel(ordinal) {
  return `#${String(ordinal + 1).padStart(3, '0')}`
}

/** The full, immutable 99-product seed namespace (ordinals 1..99). */
export function fullSeedPlan() {
  return generateSeedPlan({ productsToCreate: SEED_COUNT, startIndex: SEED_START_ORDINAL })
}

/** Internal SKU grammar — mirrors `packages/shared/src/domain/sku.ts`. */
export const SKU_SEGMENT_RE = /^[A-Z0-9]{1,8}$/
export const SKU_VARIANT_SUFFIX_RE = /^[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,8})*$/
export const SKU_RE = /^LH-[A-Z0-9]{1,8}-[0-9]{6}-[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,8})*$/

/** Values mirrored from shared/domain/identifiers.ts + sku.ts. */
export const SKU_PREFIX = 'LH'
export const SKU_SEPARATOR = '-'
export const SKU_PRODUCT_SEQUENCE_WIDTH = 6
export const SKU_DEFAULT_VARIANT_SUFFIX = 'DEF'

export const PRODUCT_STATUSES = ['draft', 'active', 'inactive', 'archived']
export const VARIANT_STATUSES = ['draft', 'active', 'inactive']

export const MAX_OPTIONS_PER_PRODUCT = 2
export const MAX_VARIANTS_PER_PRODUCT = 12

/**
 * Coverage letters A–E (§9): A simple, B size-only, C color-only,
 * D size × color, E style/design/model-only.
 */
export const COVERAGE_TO_OPTION_TYPE = {
  A: 'simple',
  B: 'size',
  C: 'color',
  D: 'both',
  E: 'design',
}

/* --------------------------------------------------------------------------
 * Deterministic helpers
 * ------------------------------------------------------------------------ */

/** Small deterministic 32-bit PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** UUIDv5 (SHA-1 namespace) — deterministic, valid for idempotent inserts. */
export function uuidv5(namespace, name) {
  const ns = namespace.replace(/-/g, '')
  const nsBytes = Buffer.from(ns, 'hex')
  const nameBytes = Buffer.from(String(name), 'utf8')
  const bytes = createHash('sha1').update(nsBytes).update(nameBytes).digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Seed namespace — a fixed, dedicated UUID (never a real deployed id). */
export const SEED_NAMESPACE = 'e718a0f4-2c6b-4f1d-9c3a-5e9b7d4a1c20'

export function seededProductId(ordinal) {
  return uuidv5(SEED_NAMESPACE, `product:${ordinal}`)
}
export function seededOptionId(ordinal, optionIndex) {
  return uuidv5(SEED_NAMESPACE, `option:${ordinal}:${optionIndex}`)
}
export function seededValueId(ordinal, optionIndex, valueIndex) {
  return uuidv5(SEED_NAMESPACE, `value:${ordinal}:${optionIndex}:${valueIndex}`)
}
export function seededVariantId(ordinal, variantIndex) {
  return uuidv5(SEED_NAMESPACE, `variant:${ordinal}:${variantIndex}`)
}

/** Pure SKU builder — mirrors shared buildSku (for plan validation/testing). */
export function buildSku({ categoryCode, productSequence, variantSuffix }) {
  if (!SKU_SEGMENT_RE.test(categoryCode)) {
    throw new Error(`Invalid SKU category code "${categoryCode}"`)
  }
  if (!SKU_VARIANT_SUFFIX_RE.test(variantSuffix)) {
    throw new Error(`Invalid SKU variant suffix "${variantSuffix}"`)
  }
  const sequence = String(productSequence).padStart(SKU_PRODUCT_SEQUENCE_WIDTH, '0')
  const sku = `${SKU_PREFIX}${SKU_SEPARATOR}${categoryCode}${SKU_SEPARATOR}${sequence}${SKU_SEPARATOR}${variantSuffix}`
  if (sku.length > 32 || !SKU_RE.test(sku)) {
    throw new Error(`SKU "${sku}" violates the Like Honey SKU standard`)
  }
  return sku
}

/**
 * Read the width/height of a PNG from its IHDR chunk. Returns null when the
 * data is not a plain PNG with a readable IHDR (schema allows null dims).
 */
export function pngDimensions(buffer) {
  try {
    const sig = buffer.subarray(0, 8)
    if (!Buffer.isBuffer(sig) && !(sig instanceof Uint8Array)) return null
    if (
      sig.length < 8 ||
      !sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return null
    }
    const type = buffer.subarray(12, 16).toString('ascii')
    if (type !== 'IHDR') return null
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    if (width === 0 || height === 0) return null
    return { width, height }
  } catch {
    return null
  }
}

/* --------------------------------------------------------------------------
 * Bilingual value dictionaries
 * ------------------------------------------------------------------------ */

export const COLORS = [
  ['WHT', 'White', 'أبيض'],
  ['BLK', 'Black', 'أسود'],
  ['NVY', 'Navy', 'كحلي'],
  ['GRY', 'Grey', 'رمادي'],
  ['PNK', 'Pink', 'وردي'],
  ['RED', 'Red', 'أحمر'],
  ['BLU', 'Blue', 'أزرق'],
  ['GRN', 'Green', 'أخضر'],
  ['YEL', 'Yellow', 'أصفر'],
  ['ORG', 'Orange', 'برتقالي'],
  ['PUR', 'Purple', 'بنفسجي'],
  ['BRN', 'Brown', 'بني'],
  ['CYN', 'Sky Blue', 'سماوي'],
]

export const DESIGNS = [
  ['SPACE', 'Space', 'الفضاء'],
  ['DINO', 'Dinosaurs', 'الديناصورات'],
  ['CITY', 'Cars & City', 'السيارات والمدينة'],
  ['PRNT', 'Animal Print', 'نقشة الحيوانات'],
  ['FLRS', 'Floral', 'الزهور'],
  ['STRS', 'Stars', 'النجوم'],
  ['OCEAN', 'Under the Sea', 'عالم البحار'],
  ['RCKT', 'Rockets', 'الصواريخ'],
  ['FRNT', 'Fruit Friends', 'أصدقاء الفواكه'],
  ['CRTN', 'Cute Animals', 'الحيوانات الكرتونية'],
  ['SAFR', 'Safari', 'حيوانات سفاري'],
  ['ARTS', 'Art & Paint', 'الرسم والألوان'],
  ['FISH', 'Fish Friends', 'الأسماك'],
  ['DOLPH', 'Dolphins', 'الدلافين'],
]

const BABY_MONTH_LABELS = {
  '0M': ['Newborn', 'مولود جديد'],
  '3M': ['3 Months', '3 أشهر'],
  '6M': ['6 Months', '6 أشهر'],
  '9M': ['9 Months', '9 أشهر'],
  '12M': ['12 Months', '12 شهرًا'],
  '18M': ['18 Months', '18 شهرًا'],
  '24M': ['24 Months', '24 شهرًا'],
}

const CLOTH_SIZE_PRESETS = [
  ['2Y', '3Y', '4Y', '5Y', '6Y'],
  ['3Y', '4Y', '5Y', '6Y', '7Y', '8Y'],
  ['5Y', '6Y', '7Y', '8Y', '9Y', '10Y', '11Y', '12Y'],
  ['2Y', '4Y', '6Y', '8Y', '10Y'],
]

const BABY_SIZE_PRESETS = [
  ['0M', '3M', '6M', '9M'],
  ['3M', '6M', '9M', '12M'],
  ['6M', '12M', '18M', '24M'],
  ['0M', '6M', '12M', '18M', '24M'],
]

const SHOE_SIZES = ['24', '25', '26', '27', '28', '29', '30', '31']

function clothSizeValues(codes) {
  return codes.map((code) => {
    const n = code.slice(0, -1)
    return { code, valueEn: `Age ${n}`, valueAr: `سن ${n}` }
  })
}
function babySizeValues(codes) {
  return codes.map((code) => {
    const [en, ar] = BABY_MONTH_LABELS[code] ?? [code, code]
    return { code, valueEn: en, valueAr: ar }
  })
}
function shoeSizeValues(codes) {
  return codes.map((code) => ({ code, valueEn: `EU ${code}`, valueAr: `مقاس ${code}` }))
}
function colorValues(codes) {
  const byCode = new Map(COLORS.map((c) => [c[0], c]))
  return codes.map((code) => {
    const [code_, valueEn, valueAr] = byCode.get(code)
    return { code: code_, valueEn, valueAr }
  })
}
function designValues(codes) {
  const byCode = new Map(DESIGNS.map((d) => [d[0], d]))
  return codes.map((code) => {
    const [code_, valueEn, valueAr] = byCode.get(code)
    return { code: code_, valueEn, valueAr }
  })
}

/**
 * Commercially plausible design themes, matched to each design-variant product
 * (keyed by its row index into SEED_ROWS). No product borrows a generic
 * DINO/STRS/FRNT-style triple that makes no sense for what it actually is.
 */
export const DESIGN_THEMES = {
  51: ['FRNT', 'CRTN', 'STRS'], // Kids Lunch Bag — fruit friends / cute animals / stars
  54: ['CRTN', 'SPACE', 'FLRS'], // Kids Pencil Bag — cute animals / space / floral
  55: ['SPACE', 'CRTN', 'CITY'], // Multi-Compartment Schoolbag — space / cute animals / cars & city
  61: ['FRNT', 'CRTN', 'FLRS'], // Kids Crayon Set (24) — fruit friends / cute animals / floral
  64: ['ARTS', 'FLRS', 'CRTN'], // Kids Art Roll — art & paint / floral / cute animals
  71: ['SAFR', 'OCEAN', 'FLRS'], // Junior Jigsaw Puzzle — safari / sea / floral scenes
  73: ['RCKT', 'SPACE', 'STRS'], // Build-Your-Own Rocket Set — rockets / space / stars
  76: ['DINO', 'SAFR', 'PRNT'], // Dinosaur Figure 6-Pack — dinos / safari / animal print
  79: ['OCEAN', 'FISH', 'DOLPH'], // Ocean Animal Play Set — all under-the-sea creatures
  81: ['SPACE', 'STRS', 'RCKT'], // Space Explorer Kit — space / stars / rockets
  98: ['STRS', 'CRTN', 'FRNT'], // Birthday Gift Box — stars / cute animals / fruit friends
}
const DEFAULT_DESIGN_THEME = ['CRTN', 'STRS', 'FLRS']

function pick(pool, rng) {
  return pool[Math.floor(rng() * pool.length)]
}

/* --------------------------------------------------------------------------
 * Catalog families — keyword matchers + bilingual copy templates
 * ------------------------------------------------------------------------ */

export const FAMILIES = {
  cloth: {
    key: 'cloth',
    enKeywords: [
      'cloth',
      'clothes',
      'dress',
      'shirt',
      'top',
      'tee',
      'sweater',
      'jacket',
      'uniform',
      'pajama',
      'pants',
      'wear',
      'sock',
      'tutu',
    ],
    arKeywords: ['ملابس', 'فساتين', 'تيشيرت', 'قميص', 'قمصان', 'بنطال', 'جاكيت', 'بلوفر', 'بيجاما'],
    descEn: (name) =>
      `${name} comes from the Like Honey kids' collection — everyday wear cut for comfort and easy care, with soft fabrics that survive school days and playground time.`,
    descAr: (name) =>
      `${name} من تشكيلة لايك هني للأطفال — قطعة يومية مصمّمة للراحة وسهولة العناية، بأقمشة ناعمة تتحمّل أيام المدرسة واللعب في الساحة.`,
    blurbEn: (name) => `${name} — a comfy kids' essential.`,
    blurbAr: (name) => `${name} — قطعة أساسية مريحة للصغار.`,
  },
  shoes: {
    key: 'shoes',
    enKeywords: ['shoe', 'shoes', 'sneaker', 'sandal', 'boots', 'boot', 'footwear', 'canvas'],
    arKeywords: ['أحذية', 'حذاء', 'صندل', 'سنيکر', 'بوت', 'حذاء مدرسي'],
    descEn: (name) =>
      `${name} keeps little feet comfortable whether it's a school morning, a park run or a family walk — flexible soles and easy everyday styling from Like Honey.`,
    descAr: (name) =>
      `${name} يحافظ على راحة أقدام الصغار في صباح المدرسة أو اللعب في الحديقة أو المشي العائلي — نعل مرن وتصميم يومي أنيق من لايك هني.`,
    blurbEn: (name) => `${name} — all-day comfort for active feet.`,
    blurbAr: (name) => `${name} — راحة طوال اليوم لأقدام نشيطة.`,
  },
  bags: {
    key: 'bags',
    enKeywords: ['bag', 'bags', 'backpack', 'schoolbag', 'sports', 'lunch', 'rucksack'],
    arKeywords: ['حقيبة', 'حقائب', 'شنطة', 'شنط', 'محفظة', 'حقيبة ظهر'],
    descEn: (name) =>
      `${name} packs everything a school day needs — roomy, light on the shoulders and built for daily use. A Like Honey favourite for school runs.`,
    descAr: (name) =>
      `${name} تتسع لكل ما يحتاجه يوم دراسي كامل — واسعة وخفيفة على الأكتاف ومصمّمة للاستخدام اليومي. مفضلة لدى عائلات لايك هني.`,
    blurbEn: (name) => `${name} — big on space, light on the shoulders.`,
    blurbAr: (name) => `${name} — واسعة في الداخل وخفيفة على الأكتاف.`,
  },
  school: {
    key: 'school',
    enKeywords: ['school', 'stationery', 'pencil', 'notebook', 'crayon', 'supplies', 'case'],
    arKeywords: ['قرطاسية', 'أدوات مدرسية', 'مقلمة', 'دفاتر', 'ألوان', 'أقلام', 'لصقات'],
    descEn: (name) =>
      `${name} is a bright, practical school essential from Like Honey — built for learning, with cheerful colours kids adore.`,
    descAr: (name) =>
      `${name} أداة مدرسية عملية ومشوّقة من لايك هني — مصمّمة للتعلم بألوان مرحة يحبها الأطفال.`,
    blurbEn: (name) => `${name} — a smart school-day companion.`,
    blurbAr: (name) => `${name} — رفيق يوم دراسي ذكي.`,
  },
  toys: {
    key: 'toys',
    enKeywords: [
      'toy',
      'toys',
      'puzzle',
      'doll',
      'plush',
      'block',
      'blocks',
      'car',
      'craft',
      'game',
    ],
    arKeywords: ['ألعاب', 'لعبة', 'دمية', 'مكعبات', 'لغز', 'سيارة لعبة'],
    descEn: (name) =>
      `${name} turns playtime into learning — safe, durable and endlessly engaging for curious kids. Hand-picked by the Like Honey team.`,
    descAr: (name) =>
      `${name} تحوّل وقت اللعب إلى وقت تعلم — آمنة ومتينة وممتعة بلا حدود للصغار الفضوليين. اختارتها بعناية عائلة لايك هني.`,
    blurbEn: (name) => `${name} — safe, durable, made for play.`,
    blurbAr: (name) => `${name} — آمنة ومتينة وصنعت للعب.`,
  },
  baby: {
    key: 'baby',
    enKeywords: ['baby', 'newborn', 'infant', 'bodysuit', 'bibi', 'blanket', 'crawl'],
    arKeywords: ['رضع', 'رضّع', 'بيبي', 'مواليد', 'مولود', 'أغراض الأطفال الرضع'],
    descEn: (name) =>
      `${name} cares for the littlest ones — gentle, soft and practical clothing and essentials from the Like Honey baby range.`,
    descAr: (name) =>
      `${name} يهتم بأصغر أفراد العائلة — ملابس وأغراض ناعمة وعملية من تشكيلة الرضع في لايك هني.`,
    blurbEn: (name) => `${name} — gentle care for new arrivals.`,
    blurbAr: (name) => `${name} — عناية لطيفة بالمواليد الجدد.`,
  },
  access: {
    key: 'access',
    enKeywords: ['accessor', 'sock', 'hat', 'cap', 'gloves', 'hair', 'belt', 'band'],
    arKeywords: ['إكسسوارات', 'جوارب', 'شرابات', 'قبعة', 'أكسسوارات شعر'],
    descEn: (name) =>
      `${name} is the finishing touch to any outfit — fun, practical accessories for kids from the Like Honey collection.`,
    descAr: (name) =>
      `${name} هي اللمسة الأخيرة لأي إطلالة — إكسسوارات عملية وممتعة للأطفال من تشكيلة لايك هني.`,
    blurbEn: (name) => `${name} — the perfect finishing touch.`,
    blurbAr: (name) => `${name} — اللمسة الأخيرة المثالية.`,
  },
  gifts: {
    key: 'gifts',
    enKeywords: ['gift', 'gifts', 'hamper', 'surprise'],
    arKeywords: ['هدايا', 'هدية', 'علبة هدية'],
    descEn: (name) =>
      `${name} is a ready-to-give favourite from Like Honey — a lovely surprise for birthdays and celebrations.`,
    descAr: (name) =>
      `${name} هدية جاهزة للإهداء من لايك هني — مفاجأة جميلة لأعياد الميلاد والمناسبات.`,
    blurbEn: (name) => `${name} — a gift they'll love.`,
    blurbAr: (name) => `${name} — هدية تسعدهم.`,
  },
}

/* --------------------------------------------------------------------------
 * The 100-row authored catalog table.
 *
 * Each row: [family, priceMinor, optionType, status, nameEn, nameAr]
 *   optionType: simple | size | color | both | design
 *   status:     draft | active | inactive | archived
 *
 * Coverage tallies (by design):
 *   simple 39 | size 19 | color 14 | both 17 | design 11  (= 100)
 *   → simple share 39% sits inside the 35–45% band, every letter ≥ 5.
 * ------------------------------------------------------------------------ */

const SEED_ROWS = [
  // --- cloth (35): simple 14, size 10, both 11 ---
  ['cloth', 5990, 'simple', 'active', "Girls' Cotton Floral Dress", 'فستان بناتي قطني بنقشة زهور'],
  ['cloth', 3490, 'simple', 'active', "Boys' Cotton Crew T-Shirt", 'تيشيرت أولاد قطن بأكمام قصيرة'],
  ['cloth', 7990, 'both', 'active', 'Kids Knit Sweater', 'بلوفر أطفال محبوك'],
  ['cloth', 4490, 'size', 'active', 'School Polo Shirt', 'قميص بولو مدرسي'],
  ['cloth', 8990, 'simple', 'active', "Girls' Denim Jacket", 'جاكيت جينز بناتي'],
  ['cloth', 5490, 'both', 'active', 'Kids Cotton Pajama Set', 'طقم بيجاما قطني للأطفال'],
  ['cloth', 3990, 'size', 'active', 'Toddler Long-Sleeve Tee', 'تيشيرت أكمام طويلة للأطفال الصغار'],
  ['cloth', 6290, 'simple', 'active', 'Kids Zip-Up Hoodie', 'هودي بسحاب للأطفال'],
  ['cloth', 4990, 'both', 'active', "Girls' Pleated Skirt", 'تنورة بناتي بليسيه'],
  ['cloth', 3790, 'size', 'active', 'Boys Cargo Pants', 'بنطال كارغو أولاد'],
  ['cloth', 5890, 'simple', 'active', 'Kids Neutral Leggings (Pack)', 'طقم ليقنز للأطفال'],
  ['cloth', 4590, 'both', 'active', "Girls' Long-Sleeve Top", 'بلوزة بناتي بأكمام طويلة'],
  ['cloth', 7190, 'simple', 'active', 'Kids Rain Jacket', 'جاكيت مطر للأطفال'],
  ['cloth', 6490, 'size', 'active', 'Kids Winter Sweatpants', 'بنطال رياضي شتوي للأطفال'],
  ['cloth', 5690, 'both', 'active', 'Kids Comic T-Shirt', 'تيشيرت أطفال برسوم كرتونية'],
  ['cloth', 4290, 'simple', 'active', 'Toddler Bodysuit 3-Pack', 'طقم سُباتات رضّع 3 قطع'],
  ['cloth', 6990, 'size', 'active', 'School Cardigan', 'كارديغان مدرسي'],
  ['cloth', 4790, 'both', 'active', "Boys' Striped Polo Shirt", 'قميص بولو مقلم للأولاد'],
  ['cloth', 8090, 'simple', 'active', "Girls' Fleece Vest", 'صدرية بناتي بفليس ناعم'],
  ['cloth', 5390, 'size', 'active', 'Kids Skinny Jeans', 'جينز سكيني للأطفال'],
  ['cloth', 4990, 'both', 'active', 'Kids Graphic Print Tee', 'تيشيرت برسوم مطبوعة للأطفال'],
  ['cloth', 3590, 'simple', 'active', 'Socks 5-Pack Toddlers', 'جوارب أطفال طقم 5'],
  ['cloth', 6590, 'size', 'active', 'Kids Chino Pants', 'بنطال تشينو للأطفال'],
  ['cloth', 7690, 'both', 'active', "Girls' Chiffon Party Dress", 'فستان بناتي شيفون للمناسبات'],
  ['cloth', 4490, 'simple', 'active', 'Cotton A-Line Dress', 'فستان قطن بقصة أيه لاين'],
  ['cloth', 6190, 'size', 'active', 'Kids Quilted Jacket', 'جاكيت مبطّن للأطفال'],
  ['cloth', 5290, 'both', 'active', "Boys' Sports Shorts", 'شورت رياضي أولاد'],
  ['cloth', 4090, 'simple', 'active', 'Kids Basic Tee 2-Pack', 'تيشيرت أساسي طقم 2'],
  ['cloth', 8290, 'size', 'active', 'Kids Wool Blend Coat', 'معطف صوف للأطفال'],
  ['cloth', 5990, 'both', 'active', 'Kids Mustard Knit Dress', 'فستان محبوك للأطفال بلون الخردل'],
  ['cloth', 3790, 'simple', 'active', 'Girls Hairband Dress', 'فستان بناتي مع عصابة شعر'],
  ['cloth', 5690, 'size', 'inactive', 'Ruffle Playsuit', 'روبر ناعم بكشكشة'],
  ['cloth', 7890, 'both', 'active', 'Kids Teddy Fleece Hoodie', 'هودي قطيفة ناعم بطبعات دبدوب'],
  ['cloth', 4290, 'simple', 'archived', 'Kids Capri Leggings', 'ليقنز كابري للأطفال'],
  ['cloth', 6490, 'simple', 'active', 'Kids Track Top Set', 'طقم رياضي علوي للأطفال'],
  // --- shoes (15): simple 6, size 5, both 4 ---
  ['shoes', 8990, 'simple', 'active', 'Kids Lightweight Sneakers', 'حذاء رياضي خفيف للأطفال'],
  ['shoes', 10990, 'size', 'active', 'Kids Leather School Shoes', 'حذاء مدرسي جلدي للأطفال'],
  ['shoes', 7490, 'both', 'active', 'Kids Velcro Sneakers', 'حذاء رياضي بفيلكرو للأطفال'],
  ['shoes', 6990, 'simple', 'active', 'Kids Slip-On Canvas Shoes', 'حذاء كانفس بدون أربطة للأطفال'],
  ['shoes', 8490, 'size', 'active', 'Kids Soccer Shoes', 'حذاء كرة قدم للأطفال'],
  ['shoes', 6490, 'both', 'active', 'Kids Sandals With Ankle Strap', 'صندل أطفال بحزام كاحل'],
  ['shoes', 7990, 'simple', 'active', 'Kids Running Shoes', 'حذاء جري للأطفال'],
  ['shoes', 9490, 'size', 'active', 'Kids Winter Boots', 'بوت شتوي للأطفال'],
  ['shoes', 5990, 'both', 'active', 'Kids Mary Jane Shoes', 'حذاء ماري جاين للبنات'],
  ['shoes', 7290, 'simple', 'active', 'Kids Water Shoes', 'حذاء ماء للأطفال'],
  ['shoes', 8290, 'size', 'active', 'Kids High-Top Sneakers', 'حذاء رياضي عالي للأطفال'],
  ['shoes', 6790, 'simple', 'active', 'Kids Espadrilles', 'حذاء إسبادري للأطفال'],
  ['shoes', 10490, 'size', 'active', 'Kids Ankle Boots', 'بوت قصير للأطفال'],
  ['shoes', 5690, 'simple', 'archived', 'Kids Flip-Flop Sandals', 'شبشب للأطفال'],
  ['shoes', 8990, 'both', 'active', 'Kids Pastel Sneakers', 'حذاء رياضي بألوان باستيل'],
  // --- bags (9): simple 2, color 4, design 3 ---
  ['bags', 7990, 'color', 'active', 'School Backpack', 'حقيبة ظهر مدرسية'],
  ['bags', 5490, 'design', 'active', 'Kids Lunch Bag', 'حقيبة غداء للأطفال'],
  ['bags', 6290, 'simple', 'active', 'Preschool Backpack', 'حقيبة ظهر لمرحلة الروضة'],
  ['bags', 8990, 'color', 'active', 'Kids Sports Backpack', 'حقيبة رياضية للأطفال'],
  ['bags', 4590, 'design', 'active', 'Kids Pencil Bag', 'شنطة أقلام للأطفال'],
  ['bags', 9990, 'design', 'active', 'Multi-Compartment Schoolbag', 'حقيبة مدرسية متعددة الجيوب'],
  ['bags', 6990, 'color', 'active', 'Kids Travel Backpack', 'حقيبة سفر للأطفال'],
  ['bags', 5990, 'simple', 'active', 'Kids Art & Toy Bag', 'حقيبة ألعاب وفنون للأطفال'],
  ['bags', 7490, 'color', 'inactive', 'Kids Messenger Bag', 'حقيبة كتف جانبية للأطفال'],
  // --- school (10): simple 4, color 4, design 2 ---
  ['school', 2990, 'color', 'active', 'Kids Pencil Case', 'مقلمة للأطفال'],
  ['school', 1990, 'simple', 'active', 'Notebook 4-Pack', 'دفاتر ملاحظات طقم 4'],
  ['school', 3990, 'design', 'active', 'Kids Crayon Set (24)', 'علبة ألوان خشبية للأطفال (24 لون)'],
  ['school', 3490, 'color', 'active', 'Kids Water Bottle With Strap', 'قنينة ماء بحزام للأطفال'],
  ['school', 2490, 'simple', 'active', 'Coloring Book Set', 'كتب تلوين للأطفال'],
  ['school', 4490, 'design', 'active', 'Kids Art Roll', 'لفافة أدوات رسم للأطفال'],
  ['school', 2290, 'color', 'active', 'Kids Lunchbox With Fork Set', 'علبة غداء مع أدوات للأطفال'],
  ['school', 1790, 'simple', 'active', 'Stickers & Craft Kit', 'طقم لصقات وإبداع للأطفال'],
  ['school', 3990, 'color', 'active', 'Kids Study Lamp Clips', 'مصباح دراسة للتثبيت للأطفال'],
  ['school', 2690, 'simple', 'archived', 'Kids Eraser & Sharpener Set', 'طقم ممحاة ومبراة للأطفال'],
  // --- toys (16): simple 8, color 3, design 5 ---
  ['toys', 5990, 'simple', 'active', 'Soft Plush Bunny', 'لعبة قطيفة على شكل أرنب'],
  ['toys', 6990, 'simple', 'active', 'Wooden Building Blocks', 'مكعبات بناء خشبية للأطفال'],
  ['toys', 4490, 'design', 'active', 'Junior Jigsaw Puzzle', 'أحجية جيغسو للأطفال'],
  ['toys', 3490, 'simple', 'active', 'Pull-Along Toy Car', 'سيارة لعبة تُسحب للأطفال'],
  ['toys', 7990, 'design', 'active', 'Build-Your-Own Rocket Set', 'طقم بناء صاروخ للأطفال'],
  ['toys', 5490, 'color', 'active', 'Stacking Cups Set', 'طقم أكواب متداخلة للأطفال'],
  ['toys', 3990, 'simple', 'active', 'Musical Rhythm Shakers', 'طقم عصي إيقاع للأطفال'],
  ['toys', 8490, 'design', 'active', 'Dinosaur Figure 6-Pack', 'طقم مجسمات ديناصور 6 قطع'],
  ['toys', 2990, 'color', 'active', 'Craft Play Dough Set', 'طقم معجون تشكيل للأطفال'],
  ['toys', 6490, 'simple', 'active', 'Baby Doll With Outfit', 'دمية مع طقم ملابس'],
  ['toys', 4990, 'design', 'active', 'Ocean Animal Play Set', 'طقم حيوانات البحر للأطفال'],
  ['toys', 3790, 'simple', 'active', 'Party Balloons 20-Pack', 'بالونات حفلات طقم 20'],
  ['toys', 7590, 'design', 'active', 'Space Explorer Kit', 'طقم مستكشف الفضاء للأطفال'],
  ['toys', 4290, 'color', 'active', 'Toy Stamp Art Set', 'طقم ختم ورسم للأطفال'],
  ['toys', 6990, 'simple', 'archived', 'Motorized Race Car', 'سيارة سباق تعمل بالبطارية'],
  ['toys', 3290, 'simple', 'active', 'Bath Time Ducks Set', 'طقم بطة الحمام للأطفال'],
  // --- baby (8): simple 2, size 4, both 2 ---
  ['baby', 7490, 'size', 'active', 'Baby Cotton Bodysuit', 'سُباتة قطنية للمواليد'],
  ['baby', 4990, 'size', 'active', 'Baby Bibs 3-Pack', 'طقم مرايل أطفال 3 قطع'],
  ['baby', 5990, 'simple', 'active', 'Baby Mushy Blanket', 'بطانية ناعمة للمواليد'],
  [
    'baby',
    3490,
    'both',
    'active',
    'Baby Scratch Mittens & Booties',
    'طقم قفازات وجوارب ناعمة للمواليد',
  ],
  ['baby', 8490, 'size', 'active', 'Baby Winter Onesie', 'بدلة شتوية ناعمة للمواليد'],
  ['baby', 6990, 'both', 'active', 'Baby Sleep Sack', 'كيس نوم مريح للمواليد'],
  ['baby', 4490, 'size', 'active', 'Baby Cotton Socks 4-Pack', 'جوارب قطنية للمواليد طقم 4'],
  ['baby', 8990, 'simple', 'archived', 'Baby Crib Mobile', 'لعبة دوّارة موسيقية لسرير الرضيع'],
  // --- access (5): simple 2, color 3 ---
  ['access', 1590, 'color', 'active', 'Socks 3-Pack', 'جوارب أطفال طقم 3'],
  ['access', 1990, 'simple', 'active', 'Kids Beanie Hat', 'قبعة صوفية للأطفال'],
  ['access', 2490, 'color', 'active', 'Kids Gloves With String', 'قفازات مربوطة بخيط للأطفال'],
  ['access', 1290, 'color', 'active', 'Kids Hair Scrunchie Set', 'طقم ربطات شعر للأطفال'],
  ['access', 1790, 'simple', 'inactive', 'Kids Belt', 'حزام أطفال'],
  // --- gifts (2): simple 1, design 1 ---
  ['gifts', 4990, 'design', 'active', 'Birthday Gift Box', 'علبة هدية عيد ميلاد'],
  ['gifts', 3490, 'simple', 'active', 'Little Surprise Gift Set', 'طقم هدية مفاجأة صغيرة'],
]

/**
 * Build ONE fully-formed product plan entry from an authored row.
 * Fully deterministic per ordinal (PRNG is seeded by ordinal only).
 */
function buildSeedProduct(ordinal, [family, priceMinor, optionType, status, nameEn, nameAr]) {
  const rng = mulberry32(ordinal * 2654435761 + 40503)

  const options = []
  let maxVariants = 1

  if (optionType === 'size' || optionType === 'both') {
    const preset = pick(
      family === 'shoes'
        ? [SHOE_SIZES]
        : family === 'baby'
          ? BABY_SIZE_PRESETS
          : CLOTH_SIZE_PRESETS,
      rng,
    )
    const codes = optionType === 'both' ? preset.slice(0, 4) : preset
    const values =
      family === 'shoes'
        ? shoeSizeValues(codes)
        : family === 'baby'
          ? babySizeValues(codes)
          : clothSizeValues(codes)
    options.push({ nameEn: 'Size', nameAr: 'المقاس', displayOrder: 0, values })
    maxVariants *= values.length
  }

  if (optionType === 'color' || optionType === 'both') {
    const palette = pick(
      [
        ['WHT', 'PNK', 'BLU', 'NVY'],
        ['GRY', 'BLK', 'RED', 'YEL'],
        ['GRN', 'ORG', 'PUR', 'CYN'],
        ['BLU', 'GRN', 'BRN', 'WHT'],
        ['PNK', 'PUR', 'WHT', 'CYN'],
      ],
      rng,
    )
    const take = optionType === 'both' ? 3 : 4
    const codes = palette.slice(0, take)
    options.push({
      nameEn: 'Color',
      nameAr: 'اللون',
      displayOrder: options.length,
      values: colorValues(codes),
    })
    maxVariants *= take
  }

  if (optionType === 'design') {
    const picks = DESIGN_THEMES[ordinal] ?? DEFAULT_DESIGN_THEME
    options.push({
      nameEn: 'Design',
      nameAr: 'التصميم',
      displayOrder: 0,
      values: designValues(picks),
    })
    maxVariants *= picks.length
  }

  if (maxVariants > MAX_VARIANTS_PER_PRODUCT) {
    throw new Error(`ordinal ${ordinal}: exceeds ${MAX_VARIANTS_PER_PRODUCT} variants`)
  }

  // Simple products get exactly the canonical default suffix `DEF`.
  const isSimple = options.length === 0
  const combos = isSimple
    ? [[]]
    : cartesian(options.map((o, optionIndex) => o.values.map((_, vi) => ({ optionIndex, vi }))))

  const variants = combos.map((combo, variantIndex) => {
    const stockBucket = variantStockBucket(rngWithSeed(ordinal, variantIndex))
    const quantityOnHand = stockQuantity(stockBucket, rngWithSeed(ordinal * 3 + variantIndex, 7))
    const acquisitionCostMinor = Math.round(
      priceMinor * (0.4 + rngWithSeed(ordinal, 11 + variantIndex)() * 0.35),
    )
    return {
      variantIndex,
      suffix: isSimple
        ? SKU_DEFAULT_VARIANT_SUFFIX
        : combo.map((c) => options[c.optionIndex].values[c.vi].code).join(SKU_SEPARATOR),
      optionLabelEn: isSimple
        ? null
        : combo.map((c) => options[c.optionIndex].values[c.vi].valueEn).join(' / '),
      optionLabelAr: isSimple
        ? null
        : combo.map((c) => options[c.optionIndex].values[c.vi].valueAr).join(' / '),
      priceMinor,
      acquisitionCostMinor,
      quantityOnHand,
      relationship: combo.map((c) => ({ optionIndex: c.optionIndex, valueIndex: c.vi })),
    }
  })

  return {
    ordinal,
    rowIndex: ordinal, // index into SEED_ROWS (matched by prior count)
    family,
    nameEn,
    nameAr,
    descEn: FAMILIES[family].descEn(nameEn),
    descAr: FAMILIES[family].descAr(nameAr),
    blurbEn: FAMILIES[family].blurbEn(nameEn),
    blurbAr: FAMILIES[family].blurbAr(nameAr),
    priceMinor,
    status,
    variantStatus: status === 'active' ? 'active' : status === 'draft' ? 'draft' : 'inactive',
    optionType,
    options,
    variants,
  }
}

function rngWithSeed(ordinal, salt) {
  return mulberry32(ordinal * 2654435761 + salt)
}

const STOCK_BUCKETS = [
  { name: 'normal', weight: 60, min: 4, max: 15 },
  { name: 'low', weight: 20, min: 1, max: 3 },
  { name: 'high', weight: 10, min: 16, max: 30 },
  { name: 'zero', weight: 10, min: 0, max: 0 },
]

function variantStockBucket(rng) {
  const roll = rng() * 100
  let acc = 0
  for (const bucket of STOCK_BUCKETS) {
    acc += bucket.weight
    if (roll < acc) return bucket
  }
  return STOCK_BUCKETS[0]
}

function stockQuantity(bucket, rng) {
  if (bucket.min === 0 && bucket.max === 0) return 0
  const value = bucket.min + Math.floor(rng() * (bucket.max - bucket.min + 1))
  return value
}

function cartesian(groups) {
  return groups.reduce(
    (acc, group) => acc.flatMap((prefix) => group.map((item) => [...prefix, item])),
    [[]],
  )
}

/**
 * Generate the delta plan: `productsToCreate` fully-formed products starting
 * at `startIndex` (0-based index into the authored 100-row table). Every
 * product is deterministic — two runs with the same inputs produce identical
 * plans, and the returned shapes are ready for `validateSeedPlan` +
 * `resolveSeedPlan`.
 */
export function generateSeedPlan({ productsToCreate, startIndex = 0 }) {
  if (!Number.isInteger(productsToCreate) || productsToCreate < 0) {
    throw new Error('productsToCreate must be a non-negative integer')
  }
  if (startIndex < 0 || startIndex > SEED_ROWS.length) {
    throw new Error(`startIndex ${startIndex} is outside the seeded catalog`)
  }
  const count = Math.min(productsToCreate, SEED_ROWS.length - startIndex)
  const products = []
  for (let i = 0; i < count; i++) {
    const ordinal = startIndex + i
    products.push(buildSeedProduct(ordinal, SEED_ROWS[ordinal]))
  }
  return { products, totalPlanned: count, startIndex }
}

/* --------------------------------------------------------------------------
 * Runtime resolution against EXISTING categories / suppliers
 * ------------------------------------------------------------------------ */

export function pickBestCategory(product, categories) {
  const family = FAMILIES[product.family]
  let best = null
  let bestScore = 0
  for (const category of categories) {
    if (category.status === 'inactive') continue
    const nameEn = (category.nameEn ?? '').toLowerCase()
    const nameAr = category.nameAr ?? ''
    let score = 0
    for (const kw of family.enKeywords) {
      if (nameEn.includes(kw)) score += kw.length
    }
    for (const kw of family.arKeywords) {
      if (nameAr.includes(kw)) score += kw.length * 2
    }
    if (score > bestScore) {
      best = category
      bestScore = score
    }
  }
  return { category: best, score: bestScore }
}

/**
 * Assign each product one EXISTING category (keyword-matched, falling back to
 * deterministic rotation among active categories) and one EXISTING supplier
 * (deterministic rotation). Both always resolve — every product is linked to
 * exactly one existing category and one existing supplier.
 */
export function resolveSeedPlan(products, categories, suppliers) {
  const activeCategories = categories.filter((c) => c.status !== 'inactive')
  const activeSuppliers = suppliers.filter((s) => s.status !== 'inactive')
  const poolCategories = activeCategories.length > 0 ? activeCategories : categories
  const poolSuppliers = activeSuppliers.length > 0 ? activeSuppliers : suppliers

  if (poolCategories.length === 0) {
    throw new Error('No existing categories available to assign products to')
  }
  if (poolSuppliers.length === 0) {
    throw new Error('No existing suppliers available to assign products to')
  }

  const resolved = []
  for (let i = 0; i < products.length; i++) {
    const product = products[i]
    const { category } = pickBestCategory(product, categories)
    const finalCategory = category ?? poolCategories[i % poolCategories.length]
    const supplier = poolSuppliers[i % poolSuppliers.length]
    resolved.push({
      ...product,
      categoryId: finalCategory.id,
      categoryCode: finalCategory.code,
      supplierId: supplier.id,
    })
  }
  return resolved
}

/* --------------------------------------------------------------------------
 * Invariant validation (pure) — run after resolve, before any write.
 * ------------------------------------------------------------------------ */

export function validateSeedPlan(products) {
  const errors = []
  const skus = new Set()
  const seenOrdinals = new Set()
  const counts = { simple: 0, size: 0, color: 0, both: 0, design: 0 }

  for (const product of products) {
    const tag = `ordinal ${product.ordinal} (${product.nameEn})`
    if (seenOrdinals.has(product.ordinal)) errors.push(`${tag}: duplicate ordinal`)
    seenOrdinals.add(product.ordinal)

    if (!PRODUCT_STATUSES.includes(product.status)) {
      errors.push(`${tag}: invalid product status "${product.status}"`)
    }
    if (!VARIANT_STATUSES.includes(product.variantStatus)) {
      errors.push(`${tag}: invalid variant status "${product.variantStatus}"`)
    }
    if (!product.nameEn || !product.nameAr) errors.push(`${tag}: missing bilingual name`)
    if (!product.blurbEn || !product.blurbAr) errors.push(`${tag}: missing bilingual blurb`)
    if (!product.descEn || !product.descAr) errors.push(`${tag}: missing bilingual description`)
    if (!/^[A-Z]{2,8}$/.test(product.categoryCode ?? '')) {
      errors.push(`${tag}: invalid category code "${product.categoryCode}"`)
    }

    counts[product.optionType] += 1

    if (product.options.length > MAX_OPTIONS_PER_PRODUCT) {
      errors.push(`${tag}: more than ${MAX_OPTIONS_PER_PRODUCT} options`)
    }
    if (product.variants.length < 1 || product.variants.length > MAX_VARIANTS_PER_PRODUCT) {
      errors.push(
        `${tag}: variant count ${product.variants.length} outside 1..${MAX_VARIANTS_PER_PRODUCT}`,
      )
    }

    for (const option of product.options) {
      if (!/^[A-Za-z]{2,40}$/.test(option.nameEn))
        errors.push(`${tag}: bad option nameEn "${option.nameEn}"`)
      if (typeof option.nameAr !== 'string' || option.nameAr.length === 0) {
        errors.push(`${tag}: bad option nameAr`)
      }
      const codes = new Set()
      for (const value of option.values) {
        if (!SKU_SEGMENT_RE.test(value.code)) {
          errors.push(`${tag}: invalid value code "${value.code}"`)
        }
        if (codes.has(value.code)) errors.push(`${tag}: duplicate value code "${value.code}"`)
        codes.add(value.code)
        if (!value.valueEn || !value.valueAr)
          errors.push(`${tag}: missing bilingual value "${value.code}"`)
      }
    }

    const family = FAMILIES[product.family]
    if (!family) errors.push(`${tag}: unknown family "${product.family}"`)

    for (const variant of product.variants) {
      if (!SKU_VARIANT_SUFFIX_RE.test(variant.suffix)) {
        errors.push(`${tag}: invalid variant suffix "${variant.suffix}"`)
      }
      if (variant.priceMinor < 0 || variant.acquisitionCostMinor < 0) {
        errors.push(`${tag}: negative pricing on ${variant.suffix}`)
      }
      if (variant.acquisitionCostMinor >= variant.priceMinor) {
        errors.push(`${tag}: acquisition cost not below retail on ${variant.suffix}`)
      }
      if (
        variant.acquisitionCostMinor < Math.round(variant.priceMinor * 0.4) ||
        variant.acquisitionCostMinor > Math.round(variant.priceMinor * 0.75)
      ) {
        errors.push(`${tag}: acquisition cost outside 40-75% band on ${variant.suffix}`)
      }
      const sku = buildSku({
        categoryCode: product.categoryCode,
        productSequence: String(product.ordinal + 1).padStart(SKU_PRODUCT_SEQUENCE_WIDTH, '0'),
        variantSuffix: variant.suffix,
      })
      if (skus.has(sku)) errors.push(`${tag}: duplicate SKU ${sku}`)
      skus.add(sku)
    }

    const bucketsValid = product.variants.every(
      (v) => Number.isInteger(v.quantityOnHand) && v.quantityOnHand >= 0,
    )
    if (!bucketsValid) errors.push(`${tag}: non-integer or negative stock`)
  }

  // Global coverage + distribution checks (§9: coverage letters A–E each ≥ 5;
  // simple share in the 35–45% band).
  for (const [letter, type] of Object.entries(COVERAGE_TO_OPTION_TYPE)) {
    if (counts[type] < 5) {
      errors.push(`coverage ${letter}: only ${counts[type]} products (need ≥ 5)`)
    }
  }
  const total = products.length
  if (total > 0) {
    const simpleShare = (counts.simple / total) * 100
    if (simpleShare < 35 || simpleShare > 45) {
      errors.push(`simple-product share ${simpleShare.toFixed(1)}% outside 35-45% band`)
    }
  }

  return errors
}

/** Rolling summary of the resolved plan's stock distribution. */
export function planStockSummary(products) {
  const totals = { normal: 0, low: 0, high: 0, zero: 0 }
  let variants = 0
  for (const product of products) {
    for (const v of product.variants) {
      variants += 1
      const bucket =
        v.quantityOnHand === 0
          ? 'zero'
          : v.quantityOnHand <= 3
            ? 'low'
            : v.quantityOnHand <= 15
              ? 'normal'
              : 'high'
      totals[bucket] += 1
    }
  }
  const share = (n) => (variants === 0 ? 0 : Math.round((n / variants) * 100))
  return {
    variants,
    ...totals,
    normalShare: share(totals.normal),
    lowShare: share(totals.low),
    highShare: share(totals.high),
    zeroShare: share(totals.zero),
  }
}

/**
 * One aggregate view over a resolved plan, driving every dry-run observability
 * report: option-type mix, status mix, exact stock-bucket counts, and the
 * retail/acquisition pricing ranges over ALL variants.
 */
export function summarizePlan(products) {
  const byOptionType = { simple: 0, size: 0, color: 0, both: 0, design: 0 }
  const byStatus = { draft: 0, active: 0, inactive: 0, archived: 0 }
  let totalVariants = 0
  let minRetail = Infinity
  let maxRetail = -Infinity
  let minAcquisition = Infinity
  let maxAcquisition = -Infinity
  let costGeRetail = 0

  for (const product of products) {
    byOptionType[product.optionType] += 1
    byStatus[product.status] += 1
    for (const variant of product.variants) {
      totalVariants += 1
      minRetail = Math.min(minRetail, variant.priceMinor)
      maxRetail = Math.max(maxRetail, variant.priceMinor)
      minAcquisition = Math.min(minAcquisition, variant.acquisitionCostMinor)
      maxAcquisition = Math.max(maxAcquisition, variant.acquisitionCostMinor)
      if (variant.acquisitionCostMinor >= variant.priceMinor) costGeRetail += 1
    }
  }

  const finite = (n) => (Number.isFinite(n) ? n : 0)
  return {
    totalProducts: products.length,
    totalVariants,
    byOptionType,
    byStatus,
    stock: planStockSummary(products),
    pricing: {
      minRetail: finite(minRetail),
      maxRetail: finite(maxRetail),
      minAcquisition: finite(minAcquisition),
      maxAcquisition: finite(maxAcquisition),
      costGeRetail,
    },
  }
}

/* --------------------------------------------------------------------------
 * Parameterized SQL statement builders
 *
 * All statements for ONE product run inside ONE Neon batch transaction.
 * `store (boolean)` controls whether the media ledger row is included (the
 * CLI inserts the media row only after the R2 upload has succeeded).
 * ------------------------------------------------------------------------ */

export function buildProductStatements({ product, objectKey, media }) {
  const productId = seededProductId(product.ordinal)
  const p = product
  const statements = []

  const productSql = `
    INSERT INTO products (id, category_id, supplier_id, name_en, name_ar, description_en, description_ar, short_blurb_en, short_blurb_ar, status)
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text, $10::product_status)
    ON CONFLICT (id) DO NOTHING`
  statements.push({
    sql: productSql,
    params: [
      productId,
      p.categoryId,
      p.supplierId,
      p.nameEn,
      p.nameAr,
      p.descEn,
      p.descAr,
      p.blurbEn,
      p.blurbAr,
      p.status,
    ],
  })

  for (const [optionIndex, option] of p.options.entries()) {
    const optionId = seededOptionId(p.ordinal, optionIndex)
    statements.push({
      sql: `
        INSERT INTO product_options (id, product_id, name_en, name_ar, display_order)
        VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::int)
        ON CONFLICT (id) DO NOTHING`,
      params: [optionId, productId, option.nameEn, option.nameAr, option.displayOrder],
    })
    for (const [valueIndex, value] of option.values.entries()) {
      const valueId = seededValueId(p.ordinal, optionIndex, valueIndex)
      statements.push({
        sql: `
          INSERT INTO product_option_values (id, option_id, value_en, value_ar, code, display_order)
          VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::int)
          ON CONFLICT (id) DO NOTHING`,
        params: [valueId, optionId, value.valueEn, value.valueAr, value.code, valueIndex],
      })
    }
  }

  for (const variant of p.variants) {
    const variantId = seededVariantId(p.ordinal, variant.variantIndex)
    statements.push({
      sql: `
        INSERT INTO product_variants (id, product_id, sku, status, price_minor, acquisition_cost_minor, option_label_en, option_label_ar)
        SELECT $1::uuid, p.id,
               'LH-' || $2::text || '-' || lpad(p.sequence::text, 6, '0') || '-' || $3::text,
               $4::variant_status, $5::int, $6::int, $7::text, $8::text
        FROM products p WHERE p.id = $1::uuid
        ON CONFLICT (id) DO NOTHING`,
      params: [
        variantId,
        p.categoryCode,
        variant.suffix,
        variant.variantStatus,
        variant.priceMinor,
        variant.acquisitionCostMinor,
        variant.optionLabelEn,
        variant.optionLabelAr,
      ],
    })

    for (const link of variant.relationship) {
      const valueId = seededValueId(p.ordinal, link.optionIndex, link.valueIndex)
      statements.push({
        sql: `
          INSERT INTO product_variant_options (variant_id, option_value_id)
          SELECT $1::uuid, $2::uuid
          FROM product_variants v WHERE v.id = $1::uuid AND v.product_id = $3::uuid
          ON CONFLICT DO NOTHING`,
        params: [variantId, valueId, productId],
      })
    }

    statements.push({
      sql: `
        INSERT INTO inventory_balances (variant_id, quantity_on_hand, quantity_reserved)
        SELECT $1::uuid, $2::int, 0 FROM product_variants v WHERE v.id = $1::uuid
        ON CONFLICT (variant_id) DO NOTHING`,
      params: [variantId, variant.quantityOnHand],
    })

    if (variant.quantityOnHand > 0) {
      statements.push({
        sql: `
          INSERT INTO inventory_movements (variant_id, movement_type, quantity_change, quantity_after, reason)
          SELECT $1::uuid, 'INITIAL_STOCK', $2::int, $3::int, $4::text
          FROM product_variants v
          WHERE v.id = $1::uuid
            AND NOT EXISTS (
              SELECT 1 FROM inventory_movements m
              WHERE m.variant_id = $1::uuid
                AND m.movement_type = 'INITIAL_STOCK'
                AND m.reason = $4::text
            )`,
        params: [
          variantId,
          variant.quantityOnHand,
          variant.quantityOnHand,
          'Initial stock from Like Honey catalog seed',
        ],
      })
    }
  }

  if (objectKey && media) {
    statements.push({
      sql: `
        INSERT INTO product_media (product_id, media_type, object_key, alt_en, alt_ar, sort_order, is_primary, width_px, height_px, size_bytes, mime_type)
        SELECT $1::uuid, 'image', $2::text, $3::text, $4::text, 0, true, $5::int, $6::int, $7::bigint, $8::text
        WHERE NOT EXISTS (SELECT 1 FROM product_media pm WHERE pm.product_id = $1::uuid)`,
      params: [
        productId,
        objectKey,
        media.altEn,
        media.altAr,
        media.widthPx ?? null,
        media.heightPx ?? null,
        media.sizeBytes,
        media.mimeType,
      ],
    })
  }

  return { statementCount: statements.length, statements }
}

/**
 * Turn a statement list into the exact array shape the Neon driver's
 * `transaction()` contract requires.
 *
 * The Neon serverless driver is strict: `transaction()` accepts either a
 * function returning an array, or an array whose elements are ALL
 * `sql.query(...)` results (NeonQueryPromise instances — a native Promise
 * fails the driver's `instanceof` check). Wrapping each statement in an
 * `async` helper silently converts the results into native Promises and the
 * driver rejects with "transaction() expects an array of queries, or a
 * function returning an array of queries".
 *
 * `query` MUST therefore be a non-async function that returns the Neon query
 * object directly (typically `(text, params) => sql.query(text, params)`).
 */
export function toTransactionQueries({ statements, query }) {
  if (!Array.isArray(statements)) throw new Error('statements must be an array')
  if (typeof query !== 'function') throw new Error('query must be a function')
  return statements.map((statement) => query(statement.sql, statement.params))
}
