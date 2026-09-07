'use client'

import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Textarea } from '@likehoney/ui'
import {
  deriveProductReadiness,
  deriveSellability,
  PRODUCT_READINESS_HINTS,
  productStockLevelFor,
  stockLevelFor,
} from '@likehoney/shared'

import {
  client,
  type MediaDoc,
  type ProductDetailDoc,
  type ProductStatus,
  type VariantDoc,
  type VariantStatus,
} from '../../../../lib/admin/client'
import { useAuth } from '../../../../lib/admin/auth'
import { useMutation, useResource } from '../../../../lib/admin/hooks'
import { useLocale, useT } from '../../../../lib/admin/i18n'
import { formatDate, formatPrice } from '../../../../lib/admin/format'
import { movementEventLabel } from '../../../../lib/admin/movements'
import {
  errorMessage,
  ErrorState,
  MoneyInput,
  ReadinessChip,
  ReservedStockReadout,
  SellabilityChip,
  StatusBadge,
  StockLevelPill,
} from '../../_components/shared'
import { AuthedImage } from '../../_components/authed-image'
import { StockMovementDialog } from '../../_components/stock-movement-dialog'

export default function AdminProductDetailPage() {
  const t = useT()
  const locale = useLocale()
  const params = useParams<{ productId: string }>()
  const productId = params.productId
  const router = useRouter()

  const {
    data: product,
    error,
    loading,
    reload,
  } = useResource(() => client.getProduct(productId), [productId], { revalidate: true })

  const [showBasicEditor, setShowBasicEditor] = useState(false)
  const [movementFor, setMovementFor] = useState<VariantDoc | null>(null)
  const [movementsFor, setMovementsFor] = useState<VariantDoc | null>(null)
  const [addVariantOpen, setAddVariantOpen] = useState(false)
  const [bulkActivateMessage, setBulkActivateMessage] = useState<string | null>(null)
  const bulkActivate = useMutation(client.bulkActivateVariants)

  // Only the FIRST load blocks the page behind a spinner. A `reload()` after
  // a mutation (bulk-activate, add option value, …) must keep the current
  // tree mounted so its local success/error message survives to be seen —
  // otherwise every "reload() right after setSuccessMessage()" pattern loses
  // the message the instant the background refetch starts.
  if (loading && product === null) {
    return (
      <div className="flex flex-col items-center gap-2 py-16">
        <Spinner />
        <span className="lh-text-caption text-ink-3">{t('common.loading')}</span>
      </div>
    )
  }

  if (error || product === null) {
    return (
      <div className="py-8">
        <ErrorState error={error} onRetry={reload} title={t('products.detail.notFound')} />
      </div>
    )
  }

  const hasOptions = product.options.length > 0
  const readiness = deriveProductReadiness(
    product.status,
    product.variants.map((v) => ({ status: v.status, quantityOnHand: v.quantityOnHand })),
  )
  // Physical stock across every option — real totals, independent of lifecycle.
  const stockLevel = productStockLevelFor(product.variants.map((v) => v.quantityOnHand))

  return (
    <div className="lh-admin-page lh-admin-page--wide">
      <div className="lh-admin-page-header">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1>{product.nameAr}</h1>
            <StatusBadge value={product.status} />
            <StockLevelPill level={stockLevel} />
            <ReadinessChip value={readiness} />
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {product.nameEn} · {t('common.code')} {String(product.sequence).padStart(4, '0')}
          </p>
          {readiness !== 'sellable' ? (
            <p className="mt-1 text-xs text-warning">
              {PRODUCT_READINESS_HINTS[readiness][locale]}
            </p>
          ) : null}
        </div>
        <div className="lh-admin-actions">
          <Button variant="secondary" onClick={() => router.push('/admin/products')}>
            {t('common.back')}
          </Button>
          <Button onClick={() => setShowBasicEditor(true)}>{t('products.detail.editBasic')}</Button>
        </div>
      </div>

      {showBasicEditor ? (
        <BasicEditor product={product} onClose={() => setShowBasicEditor(false)} onSaved={reload} />
      ) : null}
      {movementFor ? (
        <StockMovementDialog
          variantOptions={[
            {
              variantId: movementFor.id,
              sku: movementFor.sku,
              label:
                locale === 'ar'
                  ? (movementFor.optionLabelAr ?? movementFor.sku)
                  : (movementFor.optionLabelEn ?? movementFor.sku),
              quantityOnHand: movementFor.quantityOnHand,
            },
          ]}
          defaultVariantId={movementFor.id}
          onClose={() => setMovementFor(null)}
          onSaved={() => {
            setMovementFor(null)
            reload()
          }}
        />
      ) : null}
      {movementsFor ? (
        <MovementsDialog variant={movementsFor} onClose={() => setMovementsFor(null)} />
      ) : null}
      {addVariantOpen ? (
        <AddVariantDialog
          product={product}
          onClose={() => setAddVariantOpen(false)}
          onAdded={() => {
            setAddVariantOpen(false)
            reload()
          }}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <MediaCard productId={productId} />
        <BasicInfoCard product={product} />

        <Card className="flex flex-col gap-4 xl:col-span-2">
          {hasOptions ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="lh-admin-section-title">{t('products.detail.variants')}</h2>
                  <p className="lh-text-caption text-ink-3">{t('products.detail.variantsHint')}</p>
                </div>
                <Button variant="secondary" onClick={() => setAddVariantOpen(true)}>
                  {t('products.detail.newVariant')}
                </Button>
              </div>

              {(() => {
                const draftCount = product.variants.filter((v) => v.status === 'draft').length
                if (draftCount === 0) return null
                return (
                  <div className="lh-admin-callout">
                    <p className="text-sm font-semibold text-ink">
                      {t('products.detail.combosCreated', { count: draftCount })}
                    </p>
                    <p className="lh-text-caption mt-1 text-ink-3">
                      {t('products.detail.reviewCombosHint')}
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      className="mt-3"
                      loading={bulkActivate.pending}
                      onClick={async () => {
                        setBulkActivateMessage(null)
                        const res = await bulkActivate.run(productId)
                        if (res.ok) {
                          setBulkActivateMessage(
                            t('products.detail.combosActivated', {
                              count: res.data.activatedCount,
                            }),
                          )
                          reload()
                        }
                      }}
                    >
                      {t('products.detail.activateOffered')}
                    </Button>
                    {bulkActivateMessage ? (
                      <p className="mt-2 text-xs font-semibold text-success">
                        {bulkActivateMessage}
                      </p>
                    ) : null}
                  </div>
                )
              })()}

              <VariantsTable
                variants={product.variants}
                productId={product.id}
                productStatus={product.status}
                costVisible={product.costVisible}
                onUpdated={reload}
                onMovement={(variant) => setMovementFor(variant)}
                onShowMovements={(variant) => setMovementsFor(variant)}
              />
              <OptionValuesEditor product={product} onSaved={reload} />
            </>
          ) : (
            <SimpleSellingCard
              product={product}
              onUpdated={reload}
              onAdjust={() => setMovementFor(product.variants[0] ?? null)}
              onHistory={() => setMovementsFor(product.variants[0] ?? null)}
            />
          )}
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Basic info
// ---------------------------------------------------------------------------

function BasicInfoCard({ product }: { product: ProductDetailDoc }) {
  const t = useT()
  const locale = useLocale()
  const category = product.category
  const supplier = product.supplier
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="lh-admin-section-title">{t('products.detail.basicInfo')}</h2>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        {[
          {
            label: t('products.form.category'),
            value: category
              ? locale === 'ar'
                ? category.nameAr
                : category.nameEn
              : t('products.form.categoryNone'),
          },
          {
            label: t('products.form.supplier'),
            value: supplier
              ? locale === 'ar'
                ? supplier.nameAr
                : (supplier.nameEn ?? supplier.nameAr)
              : t('products.form.supplierNone'),
          },
          { label: t('products.form.descriptionAr'), value: product.descriptionAr ?? '—' },
          { label: t('products.form.descriptionEn'), value: product.descriptionEn ?? '—' },
        ].map(({ label, value }) => (
          <div key={label}>
            <dt className="lh-text-caption text-ink-3">{label}</dt>
            <dd className="mt-0.5 font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function BasicEditor({
  product,
  onClose,
  onSaved,
}: {
  product: ProductDetailDoc
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [nameAr, setNameAr] = useState(product.nameAr)
  const [nameEn, setNameEn] = useState(product.nameEn)
  const [descriptionAr, setDescriptionAr] = useState(product.descriptionAr ?? '')
  const [descriptionEn, setDescriptionEn] = useState(product.descriptionEn ?? '')
  const [supplierId, setSupplierId] = useState(product.supplier?.id ?? '')
  const [status, setStatus] = useState<ProductStatus>(product.status)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const categoryLocked = product.variants.length > 0

  const categories = useResource(() => client.listCategories({ pageSize: 100 }), [])
  const suppliers = useResource(() => client.listSuppliers({ pageSize: 100 }), [])

  const { run, pending } = useMutation(() =>
    client.updateProduct(product.id, {
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim(),
      status,
      supplierId: supplierId || null,
      descriptionAr: descriptionAr.trim() || null,
      descriptionEn: descriptionEn.trim() || null,
    }),
  )

  const submit = async () => {
    if (nameAr.trim().length === 0 || nameEn.trim().length === 0) {
      setFieldError(t('error.invalid'))
      return
    }
    const result = await run()
    if (result.ok) {
      onSaved()
      onClose()
    } else {
      setFieldError(errorMessage(result.error, t))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('products.detail.editBasic')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <Field label={t('products.form.nameAr')} required>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('products.form.nameEn')} required>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field
          label={t('products.form.category')}
          hint={categoryLocked ? t('products.detail.categoryImmutable') : undefined}
        >
          <Select value={product.category?.id ?? ''} disabled={categoryLocked}>
            <option value="">{t('products.form.categoryNone')}</option>
            {(categories.data?.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.nameAr}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('products.form.supplier')}>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t('products.form.supplierNone')}</option>
            {(suppliers.data?.data ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.nameAr}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('products.form.descriptionAr')}>
          <Textarea
            rows={3}
            value={descriptionAr}
            onChange={(e) => setDescriptionAr(e.target.value)}
          />
        </Field>
        <Field label={t('products.form.descriptionEn')}>
          <Textarea
            rows={3}
            value={descriptionEn}
            onChange={(e) => setDescriptionEn(e.target.value)}
          />
        </Field>
        <Field label={t('common.status')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)}>
            <option value="draft">{t('products.filterDraft')}</option>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
            <option value="archived">{t('products.filterArchived')}</option>
          </Select>
        </Field>

        {fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

function MediaCard({ productId }: { productId: string }) {
  const t = useT()
  const locale = useLocale()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data, error, loading, reload } = useResource(
    () => client.listMedia(productId),
    [productId],
  )
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [reordering, setReordering] = useState(false)

  // Sequential, not parallel: each file's own success/failure stays legible
  // (no interleaved progress to fake), and it never races the reorder
  // uniqueness constraint on rapid repeated uploads.
  const uploadFiles = async (files: File[]) => {
    setUploadError(null)
    setUploading(true)
    try {
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        form.append('isPrimary', 'false')
        await client.uploadMedia(productId, form)
      }
      reload()
    } catch (cause) {
      setUploadError(errorMessage(cause, t))
    } finally {
      setUploading(false)
    }
  }

  const move = async (mediaId: string, direction: -1 | 1) => {
    if (!data) return
    const index = data.findIndex((m) => m.id === mediaId)
    const swapWith = index + direction
    if (index < 0 || swapWith < 0 || swapWith >= data.length) return
    const nextOrder = data.map((m) => m.id)
    ;[nextOrder[index], nextOrder[swapWith]] = [nextOrder[swapWith]!, nextOrder[index]!]
    setReordering(true)
    try {
      await client.reorderMedia(productId, nextOrder)
      reload()
    } finally {
      setReordering(false)
    }
  }

  const busy = uploading || reordering

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="lh-admin-section-title">{t('products.detail.media')}</h2>
          <p className="lh-text-caption text-ink-3">{t('products.detail.mediaHint')}</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          aria-label={t('products.detail.addMedia')}
          disabled={busy}
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : []
            if (files.length > 0) void uploadFiles(files)
            e.target.value = ''
          }}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={uploading}>
          <ImagePlus size={16} aria-hidden="true" />
          {t('products.detail.addMedia')}
        </Button>
      </div>

      {uploadError ? (
        <p className="text-sm font-medium text-danger" role="alert">
          {uploadError}
        </p>
      ) : null}

      {loading ? (
        <span className="lh-text-caption text-ink-3">{t('common.loading')}</span>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data === null || data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="font-medium text-ink-2">{t('products.detail.mediaEmpty')}</p>
          <p className="lh-text-caption text-ink-3">{t('products.detail.mediaEmptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.map((media, index) => (
            <MediaItem
              key={media.id}
              media={media}
              locale={locale}
              onSaved={reload}
              canMoveUp={index > 0}
              canMoveDown={index < data.length - 1}
              onMove={(direction) => void move(media.id, direction)}
              moveDisabled={busy}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function MediaItem({
  media,
  locale,
  onSaved,
  canMoveUp,
  canMoveDown,
  onMove,
  moveDisabled,
}: {
  media: MediaDoc
  locale: 'ar' | 'en'
  onSaved: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: -1 | 1) => void
  moveDisabled: boolean
}) {
  const t = useT()
  const [altAr, setAltAr] = useState(media.altAr ?? '')
  const [altEn, setAltEn] = useState(media.altEn ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const saveMeta = async () => {
    setBusy('meta')
    try {
      await client.updateMedia(media.id, {
        altAr: altAr.trim() || null,
        altEn: altEn.trim() || null,
      })
    } finally {
      setBusy(null)
    }
  }

  const setPrimary = async () => {
    setBusy('primary')
    try {
      await client.updateMedia(media.id, { isPrimary: true })
      onSaved()
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('remove')
    try {
      await client.removeMedia(media.id)
      onSaved()
    } finally {
      setBusy(null)
      setConfirmingDelete(false)
    }
  }

  return (
    <figure className="flex flex-col gap-2 overflow-hidden rounded-xl border border-border">
      <div className="relative aspect-square w-full overflow-hidden bg-surface">
        <AuthedImage
          src={media.url}
          mediaType={media.mediaType}
          alt={
            locale === 'ar'
              ? (media.altAr ?? media.altEn ?? '')
              : (media.altEn ?? media.altAr ?? '')
          }
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-y-0 flex flex-col justify-center gap-1 p-1.5 opacity-95 ltr:right-1.5 rtl:left-1.5">
          <button
            type="button"
            className="lh-admin-media-move"
            onClick={() => onMove(-1)}
            disabled={!canMoveUp || moveDisabled}
            aria-label={t('products.detail.moveUp')}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lh-admin-media-move"
            onClick={() => onMove(1)}
            disabled={!canMoveDown || moveDisabled}
            aria-label={t('products.detail.moveDown')}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <figcaption className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          {media.isPrimary ? <Badge tone="honey">{t('products.detail.primary')}</Badge> : null}
          <span className="lh-text-caption text-ink-3">
            {media.sizeBytes === null ? '' : `${(media.sizeBytes / 1024).toFixed(0)} KB`}
          </span>
        </div>
        <Input
          aria-label={t('products.detail.altAr')}
          placeholder={t('products.detail.altAr')}
          value={altAr}
          onChange={(e) => setAltAr(e.target.value)}
          onBlur={() => void saveMeta()}
        />
        <Input
          aria-label={t('products.detail.altEn')}
          placeholder={t('products.detail.altEn')}
          value={altEn}
          onChange={(e) => setAltEn(e.target.value)}
          onBlur={() => void saveMeta()}
        />
        {confirmingDelete ? (
          <div className="flex flex-col gap-2 rounded-lg bg-danger-soft p-2">
            <p className="text-sm font-medium text-ink">
              {t('products.detail.confirmDeleteMedia')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => void remove()}
                loading={busy === 'remove'}
              >
                <Trash2 size={14} aria-hidden="true" />
                {t('products.detail.confirmDeleteMediaYes')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                {t('products.detail.confirmDeleteMediaCancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void setPrimary()}
              disabled={busy !== null || media.isPrimary}
            >
              {t('products.detail.setPrimary')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy !== null}
            >
              <Trash2 size={14} aria-hidden="true" />
              {t('products.detail.deleteMedia')}
            </Button>
          </div>
        )}
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/**
 * Acquisition-cost editor for one sellable variant. Gated: read needs
 * `catalog-cost:read` (the API also strips the field, so `variant.
 * acquisitionCostMinor` is simply absent otherwise), write needs
 * `catalog-cost:write`. `null` = "unknown / not configured" — kept distinct
 * from `0`, never coerced. Editing here only ever changes the CURRENT cost;
 * historical sale snapshots are immutable.
 */
function CostEditor({ variant, onSaved }: { variant: VariantDoc; onSaved: () => void }) {
  const t = useT()
  const locale = useLocale()
  const { hasPermission } = useAuth()
  const canRead = hasPermission('catalog-cost:read')
  const canWrite = hasPermission('catalog-cost:write')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<number | null>(variant.acquisitionCostMinor ?? null)
  const [saving, setSaving] = useState(false)

  if (!canRead) return null
  const current = variant.acquisitionCostMinor

  const save = () => {
    setSaving(true)
    void client
      .updateVariant(variant.id, { acquisitionCostMinor: draft })
      .then(() => {
        setEditing(false)
        onSaved()
      })
      .finally(() => setSaving(false))
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className={current == null ? 'text-ink-4 italic' : 'font-medium text-ink'}>
          {current == null ? t('products.cost.unknown') : formatPrice(current, locale)}
        </span>
        {canWrite ? (
          <button
            type="button"
            className="text-xs text-honey-deep hover:underline"
            onClick={() => {
              setDraft(current ?? null)
              setEditing(true)
            }}
          >
            {t('common.edit')}
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {draft == null ? (
        <button
          type="button"
          className="rounded border border-dashed border-border px-2 py-1 text-xs text-ink-3 hover:border-honey-deep"
          onClick={() => setDraft(0)}
        >
          {t('products.cost.enter')}
        </button>
      ) : (
        <MoneyInput valueMinor={draft} onChangeMinor={(v) => setDraft(v)} />
      )}
      {draft != null ? (
        <button
          type="button"
          className="text-xs text-ink-3 hover:text-danger"
          onClick={() => setDraft(null)}
        >
          {t('products.cost.markUnknown')}
        </button>
      ) : null}
      <Button size="sm" loading={saving} onClick={save}>
        {t('common.save')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
        {t('common.cancel')}
      </Button>
    </span>
  )
}

interface VariantController {
  variant: VariantDoc
  productStatus: ProductStatus
  costVisible: boolean
  onCostSaved: () => void
  editingPrice: boolean
  priceDraft: number
  onPriceDraftChange: (value: number) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSavePrice: () => void
  onSetStatus: (status: VariantStatus) => void
  onMovement: () => void
  onShowMovements: () => void
}

function VariantStatusSelect({
  value,
  onChange,
}: {
  value: VariantStatus
  onChange: (status: VariantStatus) => void
}) {
  const t = useT()
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as VariantStatus)}>
      <option value="draft">{t('products.filterDraft')}</option>
      <option value="active">{t('common.active')}</option>
      <option value="inactive">{t('common.inactive')}</option>
    </Select>
  )
}

function VariantsTable({
  variants,
  productId,
  productStatus,
  costVisible,
  onUpdated,
  onMovement,
  onShowMovements,
}: {
  variants: VariantDoc[]
  productId: string
  productStatus: ProductStatus
  costVisible: boolean
  onUpdated: () => void
  onMovement: (variant: VariantDoc) => void
  onShowMovements: (variant: VariantDoc) => void
}) {
  const t = useT()
  const [editingPriceFor, setEditingPriceFor] = useState<string | null>(null)
  const [priceDraft, setPriceDraft] = useState(0)

  if (variants.length === 0) {
    return <p className="lh-text-caption text-ink-3">{t('products.detail.chooseCombo')}</p>
  }

  const controllerFor = (variant: VariantDoc): VariantController => ({
    variant,
    productStatus,
    costVisible,
    onCostSaved: onUpdated,
    editingPrice: editingPriceFor === variant.id,
    priceDraft,
    onPriceDraftChange: setPriceDraft,
    onStartEdit: () => {
      setEditingPriceFor(variant.id)
      setPriceDraft(variant.priceMinor)
    },
    onCancelEdit: () => setEditingPriceFor(null),
    onSavePrice: () => {
      void client.updateVariant(variant.id, { priceMinor: priceDraft }).then(() => {
        setEditingPriceFor(null)
        onUpdated()
      })
    },
    onSetStatus: (status) => {
      void client.updateVariant(variant.id, { status }).then(onUpdated)
    },
    onMovement: () => onMovement(variant),
    onShowMovements: () => onShowMovements(variant),
  })

  return (
    <>
      {costVisible ? (
        <BulkCostControl productId={productId} variants={variants} onDone={onUpdated} />
      ) : null}

      {/* Mobile: one operational card per option — no horizontal scroll */}
      <div className="flex flex-col gap-3 md:hidden">
        {variants.map((variant) => (
          <VariantCard key={variant.id} {...controllerFor(variant)} />
        ))}
      </div>

      {/* Desktop / tablet: the full table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="lh-admin-table w-full">
          <thead>
            <tr>
              <th>{t('products.detail.optionValue')}</th>
              <th>{t('products.detail.priceLabel')}</th>
              {costVisible ? <th>{t('products.cost.label')}</th> : null}
              <th>{t('products.detail.stockLabel')}</th>
              <th>{t('inventory.stockColumn')}</th>
              <th>{t('products.detail.variantStatus')}</th>
              <th className="whitespace-nowrap">{t('products.readinessColumn')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => (
              <VariantRow key={variant.id} {...controllerFor(variant)} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** §9 — "تطبيق تكلفة واحدة على تركيبات متعددة". Convenience over per-variant
 *  updates; never a product-level cost source of truth. */
function BulkCostControl({
  productId,
  variants,
  onDone,
}: {
  productId: string
  variants: VariantDoc[]
  onDone: () => void
}) {
  const t = useT()
  const { hasPermission } = useAuth()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(0)
  const [busy, setBusy] = useState(false)
  if (!hasPermission('catalog-cost:write')) return null

  const apply = (cost: number | null) => {
    setBusy(true)
    void client
      .bulkVariantCost(productId, { acquisitionCostMinor: cost })
      .then(() => {
        setOpen(false)
        onDone()
      })
      .finally(() => setBusy(false))
  }

  if (!open) {
    return (
      <button
        type="button"
        className="mb-3 text-xs font-medium text-honey-deep hover:underline"
        onClick={() => setOpen(true)}
      >
        {t('products.cost.bulkApply')}
      </button>
    )
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted/40 p-3">
      <span className="text-xs font-semibold text-ink-2">
        {t('products.cost.bulkApplyTo', { n: variants.length })}
      </span>
      <MoneyInput valueMinor={value} onChangeMinor={setValue} />
      <Button size="sm" loading={busy} onClick={() => apply(value)}>
        {t('common.apply')}
      </Button>
      <button
        type="button"
        className="text-xs text-ink-3 hover:text-danger"
        onClick={() => apply(null)}
        disabled={busy}
      >
        {t('products.cost.bulkClear')}
      </button>
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        {t('common.cancel')}
      </Button>
    </div>
  )
}

function VariantRow({
  variant,
  productStatus,
  costVisible,
  onCostSaved,
  editingPrice,
  priceDraft,
  onPriceDraftChange,
  onStartEdit,
  onCancelEdit,
  onSavePrice,
  onSetStatus,
  onMovement,
  onShowMovements,
}: VariantController) {
  const t = useT()
  const locale = useLocale()
  const label = locale === 'ar' ? (variant.optionLabelAr ?? null) : (variant.optionLabelEn ?? null)
  const sellability = deriveSellability({
    productStatus,
    variantStatus: variant.status,
    quantityOnHand: variant.quantityOnHand,
  })
  return (
    <tr>
      <td>
        <div className="font-medium text-ink">{label ?? variant.sku}</div>
        <div className="font-mono text-[0.6875rem] text-ink-3">{variant.sku}</div>
      </td>
      <td className="px-3 py-3">
        {editingPrice ? (
          <span className="flex flex-wrap items-center gap-1">
            <MoneyInput valueMinor={priceDraft} onChangeMinor={onPriceDraftChange} />
            <Button size="sm" onClick={onSavePrice}>
              {t('products.detail.savePrice')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelEdit}>
              {t('common.cancel')}
            </Button>
          </span>
        ) : (
          <button className="font-semibold text-honey-deep hover:underline" onClick={onStartEdit}>
            {formatPrice(variant.priceMinor, locale)}
          </button>
        )}
      </td>
      {costVisible ? (
        <td className="px-3 py-3">
          <CostEditor variant={variant} onSaved={onCostSaved} />
        </td>
      ) : null}
      <td className="px-3 py-3 text-end font-semibold text-ink">
        <ReservedStockReadout onHand={variant.quantityOnHand} reserved={variant.quantityReserved} />
      </td>
      <td className="px-3 py-3">
        <StockLevelPill level={stockLevelFor(variant.quantityOnHand)} />
      </td>
      <td className="px-3 py-3">
        <VariantStatusSelect value={variant.status} onChange={onSetStatus} />
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <SellabilityChip value={sellability} />
      </td>
      <td className="px-3 py-3">
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="subtle" size="sm" onClick={onShowMovements}>
            {t('inventory.detailButton')}
          </Button>
          <Button variant="subtle" size="sm" onClick={onMovement}>
            {t('products.detail.setStock')}
          </Button>
        </span>
      </td>
    </tr>
  )
}

/** Mobile counterpart of a table row — an option combination as a compact
 *  operational card, matching the Inventory mobile cards. No "variant" jargon. */
function VariantCard({
  variant,
  productStatus,
  costVisible,
  onCostSaved,
  editingPrice,
  priceDraft,
  onPriceDraftChange,
  onStartEdit,
  onCancelEdit,
  onSavePrice,
  onSetStatus,
  onMovement,
  onShowMovements,
}: VariantController) {
  const t = useT()
  const locale = useLocale()
  const label = locale === 'ar' ? (variant.optionLabelAr ?? null) : (variant.optionLabelEn ?? null)
  const sellability = deriveSellability({
    productStatus,
    variantStatus: variant.status,
    quantityOnHand: variant.quantityOnHand,
  })
  return (
    <div
      className="lh-admin-record"
      style={{ alignItems: 'stretch', flexDirection: 'column', gap: '0.75rem' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold text-ink">{label ?? variant.sku}</span>
        {editingPrice ? null : (
          <button
            className="text-sm font-semibold text-honey-deep hover:underline"
            onClick={onStartEdit}
          >
            {formatPrice(variant.priceMinor, locale)}
          </button>
        )}
      </div>

      {editingPrice ? (
        <div className="flex flex-wrap items-center gap-1">
          <MoneyInput valueMinor={priceDraft} onChangeMinor={onPriceDraftChange} />
          <Button size="sm" onClick={onSavePrice}>
            {t('products.detail.savePrice')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancelEdit}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col">
        {costVisible ? (
          <div className="lh-admin-kv" style={{ alignItems: 'center' }}>
            <span className="lh-admin-kv-key">{t('products.cost.label')}</span>
            <span className="lh-admin-kv-val">
              <CostEditor variant={variant} onSaved={onCostSaved} />
            </span>
          </div>
        ) : null}
        <div className="lh-admin-kv">
          <span className="lh-admin-kv-key">{t('inventory.stockColumn')}</span>
          <span className="lh-admin-kv-val flex items-center gap-2">
            <ReservedStockReadout
              onHand={variant.quantityOnHand}
              reserved={variant.quantityReserved}
              unitLabel={t('inventory.unitLabel')}
            />
            <StockLevelPill level={stockLevelFor(variant.quantityOnHand)} />
          </span>
        </div>
        <div className="lh-admin-kv">
          <span className="lh-admin-kv-key">{t('products.readinessColumn')}</span>
          <span className="lh-admin-kv-val">
            <SellabilityChip value={sellability} />
          </span>
        </div>
        <div className="lh-admin-kv" style={{ alignItems: 'center' }}>
          <span className="lh-admin-kv-key">{t('products.detail.variantStatus')}</span>
          <span className="lh-admin-kv-val">
            <VariantStatusSelect value={variant.status} onChange={onSetStatus} />
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" onClick={onMovement}>
          {t('products.detail.setStock')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onShowMovements}>
          {t('inventory.detailButton')}
        </Button>
      </div>
    </div>
  )
}

/** Simple products (no options) present their hidden default variant as plain
 *  product stock + selling state — the operator never sees "default variant". */
function SimpleSellingCard({
  product,
  onUpdated,
  onAdjust,
  onHistory,
}: {
  product: ProductDetailDoc
  onUpdated: () => void
  onAdjust: () => void
  onHistory: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const variant = product.variants[0]
  if (variant === undefined) {
    return <p className="lh-text-caption text-ink-3">{t('inventory.empty')}</p>
  }
  const sellability = deriveSellability({
    productStatus: product.status,
    variantStatus: variant.status,
    quantityOnHand: variant.quantityOnHand,
  })
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="lh-admin-section-title">{t('products.detail.sellingCard')}</h2>
        <p className="lh-text-caption text-ink-3">{t('products.detail.sellingCardHint')}</p>
      </div>
      <div className="flex flex-col">
        <div className="lh-admin-kv">
          <span className="lh-admin-kv-key">{t('products.detail.priceLabel')}</span>
          <span className="lh-admin-kv-val">{formatPrice(variant.priceMinor, locale)}</span>
        </div>
        {product.costVisible ? (
          <div className="lh-admin-kv" style={{ alignItems: 'center' }}>
            <span className="lh-admin-kv-key">{t('products.cost.label')}</span>
            <span className="lh-admin-kv-val flex flex-col items-start gap-0.5">
              <CostEditor variant={variant} onSaved={onUpdated} />
              <span className="text-[11px] text-ink-4">{t('products.cost.helper')}</span>
            </span>
          </div>
        ) : null}
        <div className="lh-admin-kv">
          <span className="lh-admin-kv-key">{t('inventory.stockColumn')}</span>
          <span className="lh-admin-kv-val flex items-center gap-2">
            <ReservedStockReadout
              onHand={variant.quantityOnHand}
              reserved={variant.quantityReserved}
              unitLabel={t('inventory.unitLabel')}
            />
            <StockLevelPill level={stockLevelFor(variant.quantityOnHand)} />
          </span>
        </div>
        <div className="lh-admin-kv">
          <span className="lh-admin-kv-key">{t('products.readinessColumn')}</span>
          <span className="lh-admin-kv-val">
            <SellabilityChip value={sellability} />
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onAdjust}>
          {t('products.detail.setStock')}
        </Button>
        <Button variant="subtle" size="sm" onClick={onHistory}>
          {t('inventory.detailButton')}
        </Button>
      </div>
    </div>
  )
}

function MovementsDialog({ variant, onClose }: { variant: VariantDoc; onClose: () => void }) {
  const t = useT()
  const locale = useLocale()
  const { data, loading, error, reload } = useResource(
    () => client.getVariantInventory(variant.id),
    [variant.id],
  )

  const movements = data?.recentMovements ?? []

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('inventory.movementsFor', { sku: variant.sku })}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-3">
        <p className="lh-text-caption text-ink-3">
          {t('products.detail.stockLabel')}:{' '}
          <span className="font-semibold text-ink">{variant.quantityOnHand}</span>
        </p>
        {loading ? (
          <span className="lh-text-caption text-ink-3">{t('common.loading')}</span>
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : movements.length === 0 ? (
          <span className="lh-text-caption text-ink-3">{t('inventory.empty')}</span>
        ) : (
          <div className="flex flex-col gap-2">
            {movements.map((move) => (
              <div
                key={move.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
              >
                <p className="text-sm font-medium text-ink">{movementEventLabel(move, t)}</p>
                <span className="shrink-0 lh-text-caption text-ink-3">
                  {formatDate(move.createdAt, locale)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Option values editor
// ---------------------------------------------------------------------------

function OptionValuesEditor({
  product,
  onSaved,
}: {
  product: ProductDetailDoc
  onSaved: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [addedMessage, setAddedMessage] = useState<string | null>(null)
  // The current canonical creation-time convention (also used by
  // AddVariantDialog): suggest the first variant's price, staff-editable —
  // never silently reused, never a "random sibling" pick.
  const defaultPriceMinor = product.variants[0]?.priceMinor ?? 0

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="lh-admin-section-title">{t('products.detail.optionValueEdit')}</h3>
          <p className="lh-text-caption text-ink-3">{t('products.detail.optionValueEditHint')}</p>
        </div>
      </div>
      {addedMessage ? (
        <p className="mb-3 text-xs font-semibold text-success" role="status">
          {addedMessage}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        {product.options.map((option) => (
          <div key={option.id} className="flex flex-col gap-2">
            <p className="lh-text-caption font-semibold text-ink-2">
              {locale === 'ar' ? option.nameAr : option.nameEn}
            </p>
            <div className="flex flex-wrap items-start gap-2">
              {option.values.map((value) => (
                <OptionValueInline
                  key={value.id}
                  valueId={value.id}
                  valueAr={value.valueAr}
                  valueEn={value.valueEn}
                  onSaved={onSaved}
                />
              ))}
              {addingFor === option.id ? (
                <AddOptionValueInline
                  optionId={option.id}
                  defaultPriceMinor={defaultPriceMinor}
                  onCancel={() => setAddingFor(null)}
                  onAdded={(count) => {
                    setAddingFor(null)
                    setAddedMessage(t('products.detail.addValueSuccess', { count }))
                    onSaved()
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="lh-admin-add-value-btn"
                  onClick={() => setAddingFor(option.id)}
                >
                  {t('products.detail.addValue')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Lightweight inline "+ إضافة قيمة" form — never a separate technical
 * screen. Asks only for the two bilingual labels + a price; the server
 * derives the SKU code and generates the missing (draft) combinations.
 */
function AddOptionValueInline({
  optionId,
  defaultPriceMinor,
  onCancel,
  onAdded,
}: {
  optionId: string
  defaultPriceMinor: number
  onCancel: () => void
  onAdded: (generatedCount: number) => void
}) {
  const t = useT()
  const [valueAr, setValueAr] = useState('')
  const [valueEn, setValueEn] = useState('')
  const [priceMinor, setPriceMinor] = useState(defaultPriceMinor)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const { run, pending } = useMutation(() =>
    client.addOptionValue(optionId, {
      valueAr: valueAr.trim(),
      valueEn: valueEn.trim(),
      priceMinor,
    }),
  )

  const submit = async () => {
    if (valueAr.trim().length === 0 || valueEn.trim().length === 0) {
      setFieldError(t('error.invalid'))
      return
    }
    const result = await run()
    if (result.ok) {
      onAdded(result.data.variants.length)
    } else {
      setFieldError(errorMessage(result.error, t))
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-honey p-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-medium text-ink-3">{t('common.arabic')}</span>
          <Input
            aria-label={t('products.form.valueAr')}
            value={valueAr}
            onChange={(e) => setValueAr(e.target.value)}
            className="w-28"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-medium text-ink-3">{t('common.english')}</span>
          <Input
            aria-label={t('products.form.valueEn')}
            dir="ltr"
            value={valueEn}
            onChange={(e) => setValueEn(e.target.value)}
            className="w-28"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-medium text-ink-3">
            {t('products.detail.priceLabel')}
          </span>
          <MoneyInput valueMinor={priceMinor} onChangeMinor={setPriceMinor} />
        </label>
        <Button size="sm" onClick={submit} loading={pending}>
          {t('products.detail.addValueSubmit')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
      <p className="lh-text-caption text-ink-3">{t('products.detail.addValueHint')}</p>
      {fieldError ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {fieldError}
        </p>
      ) : null}
    </div>
  )
}

function OptionValueInline({
  valueId,
  valueAr,
  valueEn,
  onSaved,
}: {
  valueId: string
  valueAr: string
  valueEn: string
  onSaved: () => void
}) {
  const t = useT()
  const [ar, setAr] = useState(valueAr)
  const [en, setEn] = useState(valueEn)

  const save = () => {
    void client.updateOptionValue(valueId, { valueAr: ar.trim(), valueEn: en.trim() }).then(onSaved)
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
      <label className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-medium text-ink-3">{t('common.arabic')}</span>
        <Input
          aria-label={t('products.form.valueAr')}
          value={ar}
          onChange={(e) => setAr(e.target.value)}
          onBlur={save}
          className="w-36"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-medium text-ink-3">{t('common.english')}</span>
        <Input
          aria-label={t('products.form.valueEn')}
          dir="ltr"
          value={en}
          onChange={(e) => setEn(e.target.value)}
          onBlur={save}
          className="w-36"
        />
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add variant
// ---------------------------------------------------------------------------

function AddVariantDialog({
  product,
  onClose,
  onAdded,
}: {
  product: ProductDetailDoc
  onClose: () => void
  onAdded: () => void
}) {
  const t = useT()
  const [selection, setSelection] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const option of product.options) {
      const first = option.values[0]
      if (first !== undefined) initial[option.id] = first.id
    }
    return initial
  })
  const [priceMinor, setPriceMinor] = useState(product.variants[0]?.priceMinor ?? 0)
  const [status, setStatus] = useState<VariantStatus>('draft')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const { run, pending } = useMutation(() =>
    client.addVariant(product.id, {
      optionValueIds: product.options.flatMap((option) => {
        const id = selection[option.id]
        return id === undefined || id === '' ? [] : [id]
      }),
      priceMinor,
      status,
    }),
  )

  const submit = async () => {
    const ids = product.options.map((option) => selection[option.id])
    if (ids.some((id) => id === undefined || id === '')) {
      setFieldError(t('error.invalid'))
      return
    }
    const result = await run()
    if (result.ok) {
      onAdded()
    } else {
      setFieldError(errorMessage(result.error, t))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('products.detail.newVariant')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <p className="lh-text-caption text-ink-3">{t('products.detail.chooseCombo')}</p>
        {product.options.map((option) => (
          <Field key={option.id} label={option.nameAr} required>
            <Select
              value={selection[option.id] ?? ''}
              onChange={(e) =>
                setSelection((current) => ({ ...current, [option.id]: e.target.value }))
              }
            >
              {option.values.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.valueAr} — {value.valueEn}
                </option>
              ))}
            </Select>
          </Field>
        ))}
        <Field label={t('products.detail.priceLabel')} required>
          <MoneyInput valueMinor={priceMinor} onChangeMinor={setPriceMinor} />
        </Field>
        <Field label={t('products.detail.variantStatus')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as VariantStatus)}>
            <option value="draft">{t('products.filterDraft')}</option>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
          </Select>
        </Field>

        {fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending}>
            {t('common.create')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
