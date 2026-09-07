'use client'

import {
  ArrowRight,
  Baby,
  Backpack,
  Footprints,
  Gift,
  PackageSearch,
  School,
  Search,
  Shirt,
  ShoppingBag,
  Sparkles,
  Star,
  ToyBrick,
  Truck,
} from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'

import {
  Badge,
  Button,
  Card,
  Checkbox,
  Cluster,
  Container,
  Divider,
  EmptyState,
  Field,
  Grid,
  IconButton,
  Inline,
  Input,
  Radio,
  Section,
  Skeleton,
  Spinner,
  Stack,
  Switch,
  Textarea,
} from '@likehoney/ui'
import { cx } from '@likehoney/ui'

import { labCopy, type LabLang } from './lab-copy'

interface StorefrontLabProps {
  lang: LabLang
}

const t = labCopy.storefront
const pick = (value: { ar: string; en: string }, lang: LabLang) =>
  lang === 'ar' ? value.ar : value.en

const palette: Array<{ label: string; cssVar: string }> = [
  { label: 'canvas', cssVar: 'var(--lh-color-canvas)' },
  { label: 'surface', cssVar: 'var(--lh-color-surface)' },
  { label: 'surface-raised', cssVar: 'var(--lh-color-surface-raised)' },
  { label: 'surface-muted', cssVar: 'var(--lh-color-surface-muted)' },
  { label: 'honey-soft', cssVar: 'var(--lh-color-honey-soft)' },
  { label: 'border', cssVar: 'var(--lh-color-border)' },
  { label: 'border-strong', cssVar: 'var(--lh-color-border-strong)' },
  { label: 'ink-4', cssVar: 'var(--lh-color-ink-4)' },
  { label: 'ink-3', cssVar: 'var(--lh-color-ink-3)' },
  { label: 'ink-2', cssVar: 'var(--lh-color-ink-2)' },
  { label: 'ink', cssVar: 'var(--lh-color-ink)' },
  { label: 'honey', cssVar: 'var(--lh-color-honey)' },
  { label: 'honey-strong', cssVar: 'var(--lh-color-honey-strong)' },
  { label: 'honey-deep', cssVar: 'var(--lh-color-honey-deep)' },
  { label: 'success', cssVar: 'var(--lh-color-success)' },
  { label: 'danger', cssVar: 'var(--lh-color-danger)' },
  { label: 'warning', cssVar: 'var(--lh-color-warning)' },
  { label: 'info', cssVar: 'var(--lh-color-info)' },
]

const products: Array<{
  name: string
  en: string
  price: string
  oldPrice?: string
  badge: { ar: string; en: string }
  tone: 'honey' | 'info' | 'success'
  icon: typeof Backpack
}> = [
  {
    name: 'حقيبة مدرسية وردية',
    en: 'Pink school backpack',
    price: '₪120',
    oldPrice: '₪145',
    badge: { ar: 'الأكثر مبيعاً', en: 'Best seller' },
    tone: 'honey',
    icon: Backpack,
  },
  {
    name: 'حذاء رياضي للأطفال',
    en: 'Kids’ sports sneakers',
    price: '₪95',
    oldPrice: undefined,
    badge: { ar: 'جديد', en: 'New' },
    tone: 'info',
    icon: Footprints,
  },
  {
    name: 'لعبة تعليمية خشبية',
    en: 'Wooden learning toy',
    price: '₪85',
    oldPrice: '₪100',
    badge: { ar: 'خامات آمنة', en: 'Kid-safe materials' },
    tone: 'success',
    icon: ToyBrick,
  },
  {
    name: 'طقم رضّع قطني',
    en: 'Baby essentials set',
    price: '₪140',
    oldPrice: undefined,
    badge: { ar: 'مستلزمات الرضّع', en: 'Baby basics' },
    tone: 'success',
    icon: Baby,
  },
] as const

const categoryMeta: Array<{
  key: keyof typeof t.categories
  icon: typeof Backpack
}> = [
  { key: 'clothing', icon: Shirt },
  { key: 'shoes', icon: Footprints },
  { key: 'bags', icon: Backpack },
  { key: 'school', icon: School },
  { key: 'toys', icon: ToyBrick },
  { key: 'accessories', icon: Sparkles },
  { key: 'baby', icon: Baby },
  { key: 'gifts', icon: Gift },
] as const

export function StorefrontLab({ lang }: StorefrontLabProps) {
  const [note, setNote] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done'>('idle')

  const simulateSave = () => {
    if (saveState !== 'idle') return
    setSaveState('saving')
    window.setTimeout(() => setSaveState('done'), 1400)
    window.setTimeout(() => setSaveState('idle'), 2400)
  }

  return (
    <>
      {/* ------------------------------------------------ header */}
      <header className="border-b border-border">
        <Container className="flex items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-3">
            <Image
              src="/brand/logo/like-honey-brand.png"
              alt="Like Honey"
              width={1536}
              height={1024}
              className="h-10 w-auto object-contain"
            />
          </div>
          <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
            {(['navHome', 'navShop', 'navStory', 'navContact'] as const).map((key) => (
              <a
                key={key}
                href="#"
                onClick={(event) => event.preventDefault()}
                className="lh-focus text-sm font-medium text-ink-2 transition-colors hover:text-ink"
              >
                {pick(t[key], lang)}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <IconButton variant="plain" size="sm" label="بحث" className="md:hidden">
              <Search size={16} aria-hidden="true" />
            </IconButton>
            <Button size="sm">{pick(t.ctaShop, lang)}</Button>
          </div>
        </Container>
      </header>

      {/* ------------------------------------------------ hero */}
      <Section size="md">
        <Container>
          <div className={cx('grid items-center gap-10', 'lg:grid-cols-[1.05fr_0.95fr]')}>
            <Stack gap={5} align="start">
              <Inline gap={2} wrap>
                <Badge tone="honey" dot>
                  {pick(t.heroEyebrow, lang)}
                </Badge>
              </Inline>
              <h1 className="lh-text-display">{pick(t.heroTitle, lang)}</h1>
              <p className="lh-text-body max-w-xl text-ink-2">{pick(t.heroBody, lang)}</p>
              <Cluster gap={3}>
                <Button size="lg">
                  {pick(t.heroPrimary, lang)}
                  <ArrowRight size={18} className="rtl:rotate-180" aria-hidden="true" />
                </Button>
                <Button variant="secondary" size="lg">
                  {pick(t.heroSecondary, lang)}
                </Button>
              </Cluster>
              <Inline gap={3} wrap>
                <Inline gap={1}>
                  <Truck size={16} className="text-honey-deep" aria-hidden="true" />
                  <span className="text-sm text-ink-2">{pick(t.badgeFreeShip, lang)}</span>
                </Inline>
                <Inline gap={1}>
                  <Star size={16} className="text-honey-deep" aria-hidden="true" />
                  <span className="text-sm text-ink-2">{pick(t.badgeGuarantee, lang)}</span>
                </Inline>
              </Inline>
            </Stack>

            <div className="relative">
              <Card flush className="lh-card--accent overflow-hidden rounded-feature shadow-lg">
                <Image
                  src="/brand/bee/bee-shopping.png"
                  alt="ماسكوت نحلة لايك هاني في مشهد تسوق — عنصر قصة للعلامة"
                  width={1536}
                  height={1024}
                  priority
                  className="h-72 w-full object-cover sm:h-96"
                  sizes="(max-width: 1024px) 100vw, 640px"
                />
                <span className="absolute start-4 top-4 inline-flex items-center gap-2 rounded-full bg-surface/90 px-3 py-1 text-xs font-semibold text-ink-2 backdrop-blur-sm">
                  <Sparkles size={12} className="text-honey-deep" aria-hidden="true" />
                  Like Honey — ماسكوت العلامة
                </span>
              </Card>
              <div className="absolute -bottom-5 start-6 rounded-content border border-border bg-surface px-4 py-3 shadow-md">
                <div className={cx('flex items-center gap-3')}>
                  <span className="text-ink-2 text-2xl leading-none">★</span>
                  <div>
                    <div className="lh-text-label">4.9 / 5</div>
                    <div className="lh-text-caption">1,284 − تقييم</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------ feature banner */}
      <Section size="md">
        <Container>
          <Card
            flush
            className="relative overflow-hidden rounded-feature border-0 bg-honey-deep"
            style={{
              backgroundImage:
                'repeating-linear-gradient(60deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 46px), repeating-linear-gradient(-60deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 46px)',
            }}
          >
            <div className="relative flex flex-col items-center justify-center gap-5 px-6 py-12 text-center sm:px-12 sm:py-16">
              <p className="lh-text-eyebrow mb-1 text-honey-soft">
                {pick(
                  { ar: 'تشكيلة المدارس — موسم ٢٠٢٦', en: 'Back-to-school — 2026 season' },
                  lang,
                )}
              </p>
              <h2 className="lh-text-heading text-surface-raised">
                {pick(
                  {
                    ar: 'كل ما يحتاجه طفلك ليوم مدرسي رائع',
                    en: 'Everything your child needs for a great school day',
                  },
                  lang,
                )}
              </h2>
              <p className="mx-auto max-w-md text-surface-muted/90">
                {pick(
                  {
                    ar: 'حقائب، مقلمات، ملابس وجوارب من خامات آمنة وسهلة العناية — اختيارات مرتبة لبداية ناجحة.',
                    en: 'Bags, supplies, clothing and socks in safe, easy-care fabrics — ready for a great start.',
                  },
                  lang,
                )}
              </p>
              <Button size="lg" className="mt-2">
                {pick({ ar: 'تسوّقي التشكيلة', en: 'Shop the collection' }, lang)}
              </Button>
            </div>
          </Card>
        </Container>
      </Section>

      {/* ------------------------------------------------ categories */}
      <Section size="md">
        <Container>
          <Stack gap={6}>
            <div className="flex items-end justify-between gap-3">
              <h2 className="lh-text-heading">{pick(t.sectionCategories, lang)}</h2>
            </div>
            <ul role="list" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {categoryMeta.map((category) => {
                const Icon = category.icon
                return (
                  <li
                    key={category.key}
                    className="rounded-content border border-border bg-surface p-4 transition-colors hover:bg-surface-muted/60"
                  >
                    <Icon
                      size={22}
                      strokeWidth={1.5}
                      className="text-honey-deep"
                      aria-hidden="true"
                    />
                    <div className="mt-3 lh-text-label">
                      {pick(t.categories[category.key], lang)}
                    </div>
                    {lang === 'ar' ? (
                      <div className="lh-text-caption">{t.categories[category.key].en}</div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Stack>
        </Container>
      </Section>

      {/* ------------------------------------------------ story band */}
      <Section size="md">
        <Container>
          <Card flush className="grid overflow-hidden md:grid-cols-[0.9fr_1.1fr]">
            <div className="relative aspect-[3/2] md:aspect-auto">
              <Image
                src="/brand/bee/bee-flying.png"
                alt="ماسكوت نحلة لايك هاني يطير — عنصر قصة العلامة"
                width={1536}
                height={1024}
                className="h-full w-full object-cover"
                sizes="(min-width: 768px) 45vw, 100vw"
              />
            </div>
            <div className="flex flex-col justify-center gap-3 p-6 sm:p-10">
              <p className="lh-text-eyebrow">{pick(t.navStory, lang)}</p>
              <h2 className="lh-text-heading">
                {pick(
                  {
                    ar: 'نخبة مقيمة لكل ما يجعل أيّام أطفالكم أجمل',
                    en: 'A curation devoted to brighter days for your kids',
                  },
                  lang,
                )}
              </h2>
              <p className="lh-text-body max-w-md text-ink-2">
                {pick(
                  {
                    ar: 'نختار ملابس، أحذية، حقائب وألعاباً من موردين موثوقين — خامات مريحة وآمنة، تصاميم مرحة وعصرية، وتفاصيل صغيرة تجعل التسوق للأطفال تجربة استثنائية.',
                    en: 'We source clothing, shoes, bags and toys from trusted suppliers — comfortable, safe materials, playful modern designs, and the small details that make shopping for kids exceptional.',
                  },
                  lang,
                )}
              </p>
            </div>
          </Card>
        </Container>
      </Section>

      {/* ------------------------------------------------ palette */}
      <Section size="md">
        <Container>
          <Stack gap={6}>
            <Stack gap={1}>
              <p className="lh-text-eyebrow">Tokens</p>
              <h2 className="lh-text-heading">{pick(t.sectionPalette, lang)}</h2>
            </Stack>
            <Grid fluid minWidth={140} gap={4}>
              {palette.map((swatch) => (
                <div key={swatch.cssVar}>
                  <div
                    className="h-16 rounded-content border border-border"
                    style={{ backgroundColor: swatch.cssVar }}
                  />
                  <div className="mt-2">
                    <div className="lh-text-label text-sm">{swatch.label}</div>
                    <div className="lh-text-caption">{swatch.cssVar}</div>
                  </div>
                </div>
              ))}
            </Grid>
          </Stack>
        </Container>
      </Section>

      {/* ------------------------------------------------ typography */}
      <Section size="md">
        <Container>
          <Stack gap={6}>
            <p className="lh-text-eyebrow">Typography</p>
            <Stack gap={4}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
                <span className="lh-text-display">عالم أجمل لطفلك</span>
                <span className="lh-text-caption">display · Cairo Variable 800</span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
                <span className="lh-text-heading">تشكيلة مدرسية جديدة كل موسم</span>
                <span className="lh-text-caption">heading · 800</span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
                <span className="lh-text-title">حقيبة مدرسية وردية</span>
                <span className="lh-text-caption">title · 700</span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
                <p className="lh-text-body max-w-xl">
                  أقمشة قطنية ناعمة وخياطة متينة — تصاميم يحبها الصغار ويطمئن إليها الأهل.
                </p>
                <span className="lh-text-caption">body · 400/1.65</span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
                <span className="lh-text-label">اسم المنتج — Product name</span>
                <span className="lh-text-caption">label · 600</span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
                <span className="lh-text-metric">
                  <span dir="ltr">₪120</span>
                </span>
                <span className="lh-text-caption">metric · tabular</span>
              </div>
            </Stack>
          </Stack>
        </Container>
      </Section>

      {/* ------------------------------------------------ buttons */}
      <Section size="md">
        <Container>
          <Stack gap={5}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="lh-text-heading">{pick(t.sectionButtons, lang)}</h2>
              <IconButton variant="soft" label="يضيف إلى السلة" onClick={simulateSave}>
                <ShoppingBag size={18} aria-hidden="true" />
              </IconButton>
            </div>

            <Stack gap={3}>
              <div className="lh-text-label opacity-80">Variants</div>
              <Cluster gap={3}>
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="subtle">Subtle</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
              </Cluster>
            </Stack>

            <Stack gap={3}>
              <div className="lh-text-label opacity-80">Sizes & states</div>
              <Cluster gap={3}>
                <Button size="sm">Small</Button>
                <Button>Medium</Button>
                <Button size="lg">Large</Button>
                <Button disabled>Disabled</Button>
                <Button
                  loading={saveState === 'saving'}
                  onClick={simulateSave}
                  aria-describedby="save-result"
                >
                  {saveState === 'done'
                    ? pick({ ar: 'تم الحفظ ✓', en: 'Saved ✓' }, lang)
                    : pick({ ar: 'حفظ', en: 'Save' }, lang)}
                </Button>
              </Cluster>
              <p id="save-result" className="lh-text-caption">
                {saveState === 'saving'
                  ? pick(t.loading, lang)
                  : 'تحكم تفاعلي — Interactive control'}
              </p>
            </Stack>
          </Stack>
        </Container>
      </Section>

      {/* ------------------------------------------------ forms */}
      <Section size="md">
        <Container>
          <Stack gap={6}>
            <h2 className="lh-text-heading">{pick(t.sectionForms, lang)}</h2>
            <Grid columns={2} gap={6}>
              <Stack gap={4}>
                <Field
                  label={pick({ ar: 'الاسم الكامل', en: 'Full name' }, lang)}
                  htmlFor="lab-name"
                  required
                >
                  <Input
                    id="lab-name"
                    placeholder={pick({ ar: 'مثال: سارة عودة', en: 'e.g. Sara Awad' }, lang)}
                  />
                </Field>
                <Field
                  label={pick({ ar: 'العنوان', en: 'Address' }, lang)}
                  htmlFor="lab-address"
                  error={pick(
                    {
                      ar: 'الرجاء إدخال عنوان صحيح',
                      en: 'Please enter a valid address',
                    },
                    lang,
                  )}
                >
                  <Input
                    id="lab-address"
                    invalid
                    placeholder={pick(
                      {
                        ar: 'المدينة، الحي، الشارع',
                        en: 'City, neighbourhood, street',
                      },
                      lang,
                    )}
                  />
                </Field>
                <Field
                  label={pick({ ar: 'ملاحظات الطلب', en: 'Order notes' }, lang)}
                  htmlFor="lab-note"
                  hint={pick(
                    {
                      ar: 'اختيارية — اذكري أي تفاصيل إضافية.',
                      en: 'Optional — add any extra details.',
                    },
                    lang,
                  )}
                >
                  <Textarea
                    id="lab-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={pick(
                      {
                        ar: 'مثال: تغليف هدية مع بطاقة…',
                        en: 'e.g. gift wrap with a card…',
                      },
                      lang,
                    )}
                  />
                </Field>
              </Stack>

              <Stack gap={5}>
                <Stack gap={3}>
                  <div className="lh-text-label opacity-80">Checkboxes</div>
                  <Checkbox label={pick({ ar: 'توصيل سريع', en: 'Express delivery' }, lang)} />
                  <Checkbox
                    label={pick({ ar: 'تغليف هدية', en: 'Gift wrapping' }, lang)}
                    defaultChecked
                  />
                  <Checkbox
                    label={pick({ ar: 'إشعارات الطلب', en: 'Order notifications' }, lang)}
                    disabled
                  />
                </Stack>
                <Divider />
                <Stack gap={3}>
                  <div className="lh-text-label opacity-80">Radio</div>
                  <Radio
                    name="delivery-method"
                    label={pick({ ar: 'استلام من المتجر', en: 'Pick up in store' }, lang)}
                    defaultChecked
                  />
                  <Radio
                    name="delivery-method"
                    label={pick({ ar: 'توصيل للمنزل', en: 'Home delivery' }, lang)}
                  />
                  <Radio
                    name="delivery-method"
                    label={pick({ ar: 'شحن لخارج الضفة', en: 'Ship elsewhere' }, lang)}
                  />
                </Stack>
                <Divider />
                <Stack gap={3}>
                  <div className="lh-text-label opacity-80">Switches</div>
                  <Switch
                    label={pick({ ar: 'اشتراك شهري مفعّل', en: 'Monthly subscription on' }, lang)}
                    defaultChecked
                  />
                  <Switch
                    label={pick({ ar: 'السماح بالإعلانات', en: 'Allow promotions' }, lang)}
                    defaultChecked
                  />
                  <Switch
                    label={pick({ ar: 'ميزة معطلة', en: 'Disabled feature' }, lang)}
                    disabled
                  />
                </Stack>
              </Stack>
            </Grid>
          </Stack>
        </Container>
      </Section>

      {/* ------------------------------------------------ products */}
      <Section size="md">
        <Container>
          <Stack gap={6}>
            <div className="flex items-end justify-between gap-3">
              <h2 className="lh-text-heading">{pick(t.sectionProducts, lang)}</h2>
              <Button variant="ghost" size="sm">
                {pick({ ar: 'عرض الكل', en: 'View all' }, lang)}
              </Button>
            </div>
            <p className="lh-text-caption -mt-2">{pick(t.productsSyntheticNote, lang)}</p>
            <Grid fluid minWidth={268} gap={5}>
              {products.map((product) => {
                const ProductIcon = product.icon
                return (
                  <Card key={product.name} flush className="flex flex-col">
                    <div className="relative flex aspect-[3/2] items-center justify-center bg-surface-muted/60">
                      <div className="flex flex-col items-center gap-2 px-4 text-center">
                        <ProductIcon
                          size={44}
                          strokeWidth={1.25}
                          className="text-honey-deep/80"
                          aria-hidden="true"
                        />
                        <span className="lh-text-caption">{pick(t.photoPlaceholder, lang)}</span>
                      </div>
                      {product.badge ? (
                        <Badge tone={product.tone} className="absolute start-3 top-3">
                          {pick(product.badge, lang)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="lh-text-title">
                          {pick({ ar: product.name, en: product.en }, lang)}
                        </h3>
                        <div className="text-end">
                          <div className="lh-text-metric">
                            <span dir="ltr">{product.price}</span>
                          </div>
                          {product.oldPrice ? (
                            <div className="lh-text-caption line-through opacity-70">
                              <span dir="ltr">{product.oldPrice}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {lang === 'ar' ? <p className="lh-text-caption">{product.en}</p> : null}
                      <div className="mt-auto pt-2">
                        <Button block variant="subtle">
                          {pick(t.addToCart, lang)}
                        </Button>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </Grid>
          </Stack>
        </Container>
      </Section>

      {/* ------------------------------------------------ states */}
      <Section size="md">
        <Container>
          <Stack gap={6}>
            <h2 className="lh-text-heading">{pick(t.sectionStates, lang)}</h2>
            <Grid columns={2} gap={5}>
              <Card pad={5}>
                <Stack gap={3}>
                  <div className="flex items-center justify-between">
                    <Skeleton width="40%" height="1.25rem" />
                    <Skeleton width="3.5rem" height="1.25rem" />
                  </div>
                  <Skeleton height="1rem" />
                  <Skeleton height="1rem" width="85%" />
                  <Skeleton height="1rem" width="70%" />
                  <div className="flex items-center justify-between pt-1">
                    <Skeleton width="5rem" height="2.25rem" radius="0.375rem" />
                    <Inline gap={1}>
                      <Spinner aria-hidden="true" />
                      <span className="lh-text-caption">{pick(t.loading, lang)}</span>
                    </Inline>
                  </div>
                </Stack>
              </Card>
              <Card pad={5}>
                <EmptyState
                  icon={<PackageSearch size={28} />}
                  title={pick(t.emptyTitle, lang)}
                  text={pick(t.emptyText, lang)}
                  action={
                    <Button variant="secondary" size="sm">
                      {pick({ ar: 'إعادة البحث', en: 'Search again' }, lang)}
                    </Button>
                  }
                />
              </Card>
            </Grid>
          </Stack>
        </Container>
      </Section>

      {/* ------------------------------------------------ footer */}
      <Container>
        <Divider />
        <div className="py-10 text-center">
          <p className="lh-text-caption">{pick(t.footer, lang)}</p>
        </div>
      </Container>
    </>
  )
}
