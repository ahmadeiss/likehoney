/**
 * Category icon library — two tiers.
 *
 * Tier 1 — CURATED grid (`CATEGORY_ICON_KEYS`): a small, user-friendly subset
 * shown as a visual grid in the Admin picker. Kept deliberately uncluttered.
 *
 * Tier 2 — SAFE REGISTRY (`CATEGORY_ICON_REGISTRY`): the full, explicitly
 * imported set of category-appropriate icons that the API accepts. The
 * "Advanced" manual input validates against this registry, so a merchant may
 * type a registry icon that is not shown in the curated grid (e.g. `camera`).
 *
 * Safe-icon-key contract (Type D — controlled identifier, never SVG/URL/HTML):
 *  - no dynamic import, no eval, no raw SVG, no HTML, no URL;
 *  - only explicitly registered names are ever accepted;
 *  - every key MUST resolve to a Lucide component that exists in the pinned
 *    `lucide-react` (see the frontend maps in `apps/web/src/lib/category-icons.ts`
 *    and the storefront discovery tile). The storefront renders a key by this
 *    exact name; a key without a renderable component would produce an empty
 *    card, so only verified-key names are registered.
 *
 * The API validates icon keys against this same registry — frontend validation
 * alone is never trusted.
 */

/** Curated subset — what the normal picker grid offers (small, uncluttered). */
export const CATEGORY_ICON_KEYS = [
  'shirt',
  'sport-shoe',
  'gift',
  'backpack',
  'baby',
  'toy-brick',
  'balloon',
  'puzzle',
  'graduation-cap',
  'school',
  'package',
  'star',
  'heart',
  'sparkles',
  'wand',
  'rainbow',
  'crown',
  'music',
] as const

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number]

/**
 * Full safe registry — every key the API accepts (curated + registry-only).
 * The "Advanced" icon input validates against this set, not just the curated
 * grid. Add icons here only after registering the Lucide component in the
 * frontend map (`apps/web/src/lib/category-icons.ts`) — a name without a
 * renderable component would produce an empty storefront card.
 */
export const CATEGORY_ICON_REGISTRY = [
  ...CATEGORY_ICON_KEYS,
  // Shopping / retail
  'shopping-bag',
  'shopping-cart',
  'shopping-basket',
  'store',
  'tag',
  'tags',
  'wallet',
  'credit-card',
  'banknote',
  'coins',
  'box',
  // Clothing & accessories
  'watch',
  'glasses',
  'handbag',
  // Kids & play
  'blocks',
  'dice',
  'rocket',
  'gamepad',
  'party-popper',
  'castle',
  // Transport
  'car',
  'car-front',
  'bus',
  'bike',
  'truck',
  'train-front',
  'plane',
  'ship',
  // School & stationery
  'book',
  'book-open',
  'notebook-pen',
  'pencil',
  'ruler',
  'eraser',
  'calculator',
  'compass',
  'globe',
  'map',
  'library',
  'paperclip',
  'key',
  'lock',
  // Art & creative
  'palette',
  'brush',
  'paintbrush',
  'paint-bucket',
  // Home & nature
  'house',
  'sofa',
  'armchair',
  'lamp',
  'lamp-desk',
  'bed',
  'leaf',
  'sprout',
  'flower',
  'flower-2',
  'sun',
  'moon',
  'cloud',
  'cloud-sun',
  // Animals
  'cat',
  'dog',
  'rabbit',
  'bird',
  'turtle',
  // Awards & celebration
  'award',
  'trophy',
  'medal',
  'gem',
  'diamond',
  // Music, media & tech
  'music-2',
  'headphones',
  'guitar',
  'piano',
  'drum',
  'mic',
  'camera',
  'video',
  'smartphone',
  // Sports
  'volleyball',
  'dumbbell',
  'goal',
  // General lifestyle
  'heart-handshake',
  'shield-check',
  'bell',
  'calendar',
  'clock',
  'timer',
  'users',
  'user-round',
] as const

export type CategoryIconRegistryKey = (typeof CATEGORY_ICON_REGISTRY)[number]

/** Exact-match check on the curated grid subset. */
export function isCategoryIconKey(value: unknown): value is CategoryIconKey {
  if (typeof value !== 'string') return false
  return (CATEGORY_ICON_KEYS as readonly string[]).includes(value)
}

/** Exact-match check on the full safe registry. */
export function isCategoryIconRegistryKey(value: unknown): value is CategoryIconRegistryKey {
  if (typeof value !== 'string') return false
  return (CATEGORY_ICON_REGISTRY as readonly string[]).includes(value)
}

/** Curated per-icon niche labels (Arabic-first). */
export interface CategoryIconMeta {
  key: CategoryIconKey
  labelAr: string
  labelEn: string
  /** Search aliases — Arabic + English synonyms for the optional search box. */
  aliasesAr: string[]
  aliasesEn: string[]
}

export const CATEGORY_ICON_META: CategoryIconMeta[] = [
  {
    key: 'shirt',
    labelAr: 'ملابس',
    labelEn: 'Clothing',
    aliasesAr: ['تيشيرت', 'قميص', 'تياب', 'بلوزة'],
    aliasesEn: ['clothing', 'shirt', 't-shirt', 'tee', 'top'],
  },
  {
    key: 'sport-shoe',
    labelAr: 'حذاء',
    labelEn: 'Shoes',
    aliasesAr: ['كوتشي', 'حذية', 'جراية', 'شنبوري'],
    aliasesEn: ['shoe', 'sneaker', 'trainer', 'keds', 'footwear'],
  },
  {
    key: 'gift',
    labelAr: 'هدية',
    labelEn: 'Gift',
    aliasesAr: ['هبايا', 'عطايا', 'فيها'],
    aliasesEn: ['gift', 'present', 'wrapped'],
  },
  {
    key: 'backpack',
    labelAr: 'حقيبة',
    labelEn: 'Bag',
    aliasesAr: ['شنطة', 'محفظة', 'جنطة', 'شنتة ظهر'],
    aliasesEn: ['bag', 'backpack', 'schoolbag', 'rucksack'],
  },
  {
    key: 'baby',
    labelAr: 'طفل',
    labelEn: 'Baby',
    aliasesAr: ['رضيع', 'بيبي', 'وليد', 'أطفال'],
    aliasesEn: ['baby', 'infant', 'newborn', 'toddler', 'kids'],
  },
  {
    key: 'toy-brick',
    labelAr: 'لعبة',
    labelEn: 'Toys',
    aliasesAr: ['دبدوب', 'دمية', 'مكعبات', 'لعب'],
    aliasesEn: ['toy', 'teddy', 'brick', 'block', 'doll'],
  },
  {
    key: 'balloon',
    labelAr: 'بالون',
    labelEn: 'Balloon',
    aliasesAr: ['عيد ميلاد', 'حفلة', 'زينة عيد'],
    aliasesEn: ['balloon', 'party', 'birthday', 'celebration'],
  },
  {
    key: 'puzzle',
    labelAr: 'ألغاز',
    labelEn: 'Puzzle',
    aliasesAr: ['لعبة ألغاز', 'كير', 'تسلية'],
    aliasesEn: ['puzzle', 'game', 'brain teaser'],
  },
  {
    key: 'graduation-cap',
    labelAr: 'قبعة',
    labelEn: 'Cap',
    aliasesAr: ['طاقية', 'تخرج', 'قبعة تخرج', 'برنيطة'],
    aliasesEn: ['cap', 'graduation', 'mortarboard', 'hat'],
  },
  {
    key: 'school',
    labelAr: 'مدرسة',
    labelEn: 'School',
    aliasesAr: ['قرطاسية', 'مكتب', 'دفاتر', 'أدوات مدرسية'],
    aliasesEn: ['school', 'stationery', 'supplies', 'notebook', 'study'],
  },
  {
    key: 'package',
    labelAr: 'طرد',
    labelEn: 'Package',
    aliasesAr: ['صندوق', 'كرتونة', 'علبة', 'شحنة'],
    aliasesEn: ['package', 'box', 'parcel', 'shipment', 'delivery'],
  },
  {
    key: 'star',
    labelAr: 'نجمة',
    labelEn: 'Star',
    aliasesAr: ['نجوم', 'نقطة'],
    aliasesEn: ['star', 'award', 'top', 'shiny'],
  },
  {
    key: 'heart',
    labelAr: 'قلب',
    labelEn: 'Heart',
    aliasesAr: ['حب', 'غلا', 'مفضّل'],
    aliasesEn: ['heart', 'love', 'favorite'],
  },
  {
    key: 'sparkles',
    labelAr: 'لمعان',
    labelEn: 'Sparkles',
    aliasesAr: ['توهج', 'بريق', 'نقط', 'سحر'],
    aliasesEn: ['sparkles', 'glitter', 'shine', 'magic', 'twinkle'],
  },
  {
    key: 'wand',
    labelAr: 'عصا سحرية',
    labelEn: 'Magic',
    aliasesAr: ['سحر', 'خيال', 'عصا', 'أحلام'],
    aliasesEn: ['wand', 'magic', 'fantasy', 'dream'],
  },
  {
    key: 'rainbow',
    labelAr: 'قوس قزح',
    labelEn: 'Rainbow',
    aliasesAr: ['ألوان', 'قوس المطر', 'فرح'],
    aliasesEn: ['rainbow', 'colors', 'joy'],
  },
  {
    key: 'crown',
    labelAr: 'تاج',
    labelEn: 'Crown',
    aliasesAr: ['ملك', 'أمير', 'أميرة', 'نجم'],
    aliasesEn: ['crown', 'prince', 'princess', 'royal'],
  },
  {
    key: 'music',
    labelAr: 'موسيقى',
    labelEn: 'Music',
    aliasesAr: ['نغمة', 'أغاني', 'غنية', 'عزف'],
    aliasesEn: ['music', 'song', 'melody', 'tune'],
  },
] as const

/**
 * Bilingual labels for registry-only icons (the curated grid keeps the richer
 * `CATEGORY_ICON_META` above). Used by the Advanced input's preview; the keys
 * themselves are the canonical identifiers.
 */
export const CATEGORY_ICON_REGISTRY_LABELS: Record<string, { labelAr: string; labelEn: string }> = {
  'shopping-bag': { labelAr: 'شنطة تسوق', labelEn: 'Shopping bag' },
  'shopping-cart': { labelAr: 'عربة تسوق', labelEn: 'Shopping cart' },
  'shopping-basket': { labelAr: 'سلة تسوق', labelEn: 'Shopping basket' },
  store: { labelAr: 'متجر', labelEn: 'Store' },
  tag: { labelAr: 'وسم', labelEn: 'Tag' },
  tags: { labelAr: 'وسوم', labelEn: 'Tags' },
  wallet: { labelAr: 'محفظة', labelEn: 'Wallet' },
  'credit-card': { labelAr: 'بطاقة ائتمان', labelEn: 'Credit card' },
  banknote: { labelAr: 'عملة ورقية', labelEn: 'Banknote' },
  coins: { labelAr: 'عملات', labelEn: 'Coins' },
  box: { labelAr: 'علبة', labelEn: 'Box' },
  watch: { labelAr: 'ساعة', labelEn: 'Watch' },
  glasses: { labelAr: 'نظارة', labelEn: 'Glasses' },
  handbag: { labelAr: 'حقيبة يد', labelEn: 'Handbag' },
  blocks: { labelAr: 'مكعبات', labelEn: 'Blocks' },
  dice: { labelAr: 'نرد', labelEn: 'Dice' },
  rocket: { labelAr: 'صاروخ', labelEn: 'Rocket' },
  gamepad: { labelAr: 'ألعاب فيديو', labelEn: 'Game' },
  'party-popper': { labelAr: 'احتفال', labelEn: 'Party' },
  castle: { labelAr: 'قلعة', labelEn: 'Castle' },
  car: { labelAr: 'سيارة', labelEn: 'Car' },
  'car-front': { labelAr: 'سيارة أمامي', labelEn: 'Car front' },
  bus: { labelAr: 'باص', labelEn: 'Bus' },
  bike: { labelAr: 'دراجة', labelEn: 'Bike' },
  truck: { labelAr: 'شاحنة', labelEn: 'Truck' },
  'train-front': { labelAr: 'قطار', labelEn: 'Train' },
  plane: { labelAr: 'طائرة', labelEn: 'Plane' },
  ship: { labelAr: 'سفينة', labelEn: 'Ship' },
  book: { labelAr: 'كتاب', labelEn: 'Book' },
  'book-open': { labelAr: 'كتاب مفتوح', labelEn: 'Open book' },
  'notebook-pen': { labelAr: 'دفتر', labelEn: 'Notebook' },
  pencil: { labelAr: 'قلم رصاص', labelEn: 'Pencil' },
  ruler: { labelAr: 'مسطرة', labelEn: 'Ruler' },
  eraser: { labelAr: 'ممحاة', labelEn: 'Eraser' },
  calculator: { labelAr: 'آلة حاسبة', labelEn: 'Calculator' },
  compass: { labelAr: 'بوصلة', labelEn: 'Compass' },
  globe: { labelAr: 'كرة أرضية', labelEn: 'Globe' },
  map: { labelAr: 'خريطة', labelEn: 'Map' },
  library: { labelAr: 'مكتبة', labelEn: 'Library' },
  paperclip: { labelAr: 'مشبك ورق', labelEn: 'Paperclip' },
  key: { labelAr: 'مفتاح', labelEn: 'Key' },
  lock: { labelAr: 'قفل', labelEn: 'Lock' },
  palette: { labelAr: 'ألوان', labelEn: 'Palette' },
  brush: { labelAr: 'فرشاة', labelEn: 'Brush' },
  paintbrush: { labelAr: 'ريشة رسم', labelEn: 'Paintbrush' },
  'paint-bucket': { labelAr: 'دهان', labelEn: 'Paint' },
  house: { labelAr: 'منزل', labelEn: 'House' },
  sofa: { labelAr: 'كنبة', labelEn: 'Sofa' },
  armchair: { labelAr: 'كرسي', labelEn: 'Armchair' },
  lamp: { labelAr: 'مصباح', labelEn: 'Lamp' },
  'lamp-desk': { labelAr: 'مصباح مكتب', labelEn: 'Desk lamp' },
  bed: { labelAr: 'سرير', labelEn: 'Bed' },
  leaf: { labelAr: 'ورقة', labelEn: 'Leaf' },
  sprout: { labelAr: 'نبتة', labelEn: 'Sprout' },
  flower: { labelAr: 'زهرة', labelEn: 'Flower' },
  'flower-2': { labelAr: 'زهرة', labelEn: 'Flower' },
  sun: { labelAr: 'شمس', labelEn: 'Sun' },
  moon: { labelAr: 'قمر', labelEn: 'Moon' },
  cloud: { labelAr: 'سحابة', labelEn: 'Cloud' },
  'cloud-sun': { labelAr: 'شمس وسحاب', labelEn: 'Cloud & sun' },
  cat: { labelAr: 'قطة', labelEn: 'Cat' },
  dog: { labelAr: 'كلب', labelEn: 'Dog' },
  rabbit: { labelAr: 'أرنب', labelEn: 'Rabbit' },
  bird: { labelAr: 'طائر', labelEn: 'Bird' },
  turtle: { labelAr: 'سلحفاة', labelEn: 'Turtle' },
  award: { labelAr: 'جائزة', labelEn: 'Award' },
  trophy: { labelAr: 'كأس', labelEn: 'Trophy' },
  medal: { labelAr: 'ميدالية', labelEn: 'Medal' },
  gem: { labelAr: 'جوهرة', labelEn: 'Gem' },
  diamond: { labelAr: 'ألماسة', labelEn: 'Diamond' },
  'music-2': { labelAr: 'موسيقى', labelEn: 'Music' },
  headphones: { labelAr: 'سماعات', labelEn: 'Headphones' },
  guitar: { labelAr: 'غيتار', labelEn: 'Guitar' },
  piano: { labelAr: 'بيانو', labelEn: 'Piano' },
  drum: { labelAr: 'طبل', labelEn: 'Drum' },
  mic: { labelAr: 'ميكروفون', labelEn: 'Microphone' },
  camera: { labelAr: 'كاميرا', labelEn: 'Camera' },
  video: { labelAr: 'فيديو', labelEn: 'Video' },
  smartphone: { labelAr: 'هاتف', labelEn: 'Phone' },
  volleyball: { labelAr: 'كرة طائرة', labelEn: 'Volleyball' },
  dumbbell: { labelAr: 'أوزان', labelEn: 'Dumbbell' },
  goal: { labelAr: 'هدف', labelEn: 'Goal' },
  'heart-handshake': { labelAr: 'تعاون', labelEn: 'Cooperation' },
  'shield-check': { labelAr: 'حماية', labelEn: 'Shield' },
  bell: { labelAr: 'جرس', labelEn: 'Bell' },
  calendar: { labelAr: 'تقويم', labelEn: 'Calendar' },
  clock: { labelAr: 'ساعة', labelEn: 'Clock' },
  timer: { labelAr: 'مؤقت', labelEn: 'Timer' },
  users: { labelAr: 'عائلة', labelEn: 'Family' },
  'user-round': { labelAr: 'شخص', labelEn: 'Person' },
}

/**
 * Bilingual label for any registry key — the richer curated meta when
 * available, otherwise the compact registry label. Falls back to `null`.
 */
export function categoryIconLabel(key: string): { labelAr: string; labelEn: string } | null {
  const curated = categoryIconMeta(key)
  if (curated !== undefined) return { labelAr: curated.labelAr, labelEn: curated.labelEn }
  return CATEGORY_ICON_REGISTRY_LABELS[key] ?? null
}

/** Look up curated metadata by key (undefined when not a curated key). */
export function categoryIconMeta(key: string): CategoryIconMeta | undefined {
  return CATEGORY_ICON_META.find((meta) => meta.key === key) as CategoryIconMeta | undefined
}

/**
 * Normalize a manually-entered icon key: trim + lowercase. Does NOT validate —
 * feed the result to `isCategoryIconRegistryKey`. Rejects empty/oversized/
 * URL-ish input by returning null.
 */
export function normalizeCategoryIconKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0 || trimmed.length > 64) return null
  // Defense: a manual icon name must be a plain ASCII identifier — never a URL,
  // path, or anything with a scheme/separator.
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(trimmed)) return null
  return trimmed
}

/**
 * Full manual-key validation pipeline: normalize, then registry-check (the
 * full safe registry, which includes the curated grid). Returns the accepted
 * canonical key or null. This runs on the backend.
 */
export function resolveCategoryIconKey(raw: string | null | undefined): string | null {
  const normalized = normalizeCategoryIconKey(raw)
  if (normalized === null) return null
  if (!isCategoryIconRegistryKey(normalized)) return null
  return normalized
}

// ---------------------------------------------------------------------------
// Category visual mode
// ---------------------------------------------------------------------------

/**
 * Persistent display mode for a category's storefront tile.
 *
 *  - `auto`:  prefer image → icon → automatic code fallback.
 *  - `image`: show the image when present, otherwise a safe fallback.
 *  - `icon`:  show the icon when present, otherwise the automatic code
 *             fallback — an uploaded image may stay stored and intact while
 *             this mode is active.
 */
export const CATEGORY_VISUAL_MODES = ['auto', 'image', 'icon'] as const

export type CategoryVisualMode = (typeof CATEGORY_VISUAL_MODES)[number]

export function isCategoryVisualMode(value: unknown): value is CategoryVisualMode {
  return (CATEGORY_VISUAL_MODES as readonly string[]).includes(value as string)
}
