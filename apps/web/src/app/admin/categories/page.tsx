'use client'

import {
  ChevronDown as ChevronDownIcon,
  Image as ImageIcon,
  ImagePlus,
  Search as SearchIcon,
  Tags,
  Trash2,
} from 'lucide-react'
import { useCallback, useRef, useState, type RefObject } from 'react'

import {
  CATEGORY_ICON_META,
  categoryIconLabel,
  isCategoryIconRegistryKey,
  normalizeCategoryIconKey,
  resolveCategoryIconKey,
  type CategoryVisualMode,
} from '@likehoney/shared'
import { categoryIconComponent, CATEGORY_ICON_COMPONENTS } from '../../../lib/category-icons'
import { Button, Dialog, Field, Input, Select, Textarea } from '@likehoney/ui'

import {
  client,
  type CategoryCreateInput,
  type CategoryDoc,
  type CategoryUpdateInput,
  type EntityStatus,
} from '../../../lib/admin/client'
import {
  buildCategoryCreatePayload,
  buildCategoryUpdatePayload,
  type CategoryField,
  type CategoryFormErrorCode,
  type CategoryFormErrors,
  type CategoryFormValues,
} from '../../../lib/admin/category-form'
import { useMutation, useResource } from '../../../lib/admin/hooks'
import { useLocale, useT, type DictKey } from '../../../lib/admin/i18n'
import { formatCount } from '../../../lib/admin/format'
import { AuthedImage } from '../_components/authed-image'
import {
  AdminEmpty,
  AdminPage,
  DEFAULT_PAGE_SIZE,
  ErrorState,
  Flash,
  PageHeader,
  Pagination,
  Panel,
  RowSkeleton,
  StatusBadge,
  errorMessage,
} from '../_components/shared'

type EditorState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; category: CategoryDoc }

export default function AdminCategoriesPage() {
  const t = useT()
  const locale = useLocale()
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' })
  const [deleting, setDeleting] = useState<CategoryDoc | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const { data, error, loading, reload } = useResource(
    () => client.listCategories({ page, pageSize: DEFAULT_PAGE_SIZE }),
    [page],
  )

  // Product counts per category — a handful of tiny head requests for the
  // visible page only.
  const counts = useResource(async () => {
    const list = data?.data ?? []
    const pairs = await Promise.all(
      list.map(async (category) => {
        try {
          const p = await client.listProducts({ categoryId: category.id, pageSize: 1 })
          return [category.id, p.meta.total] as const
        } catch {
          return [category.id, null] as const
        }
      }),
    )
    return new Map(pairs)
  }, [data])

  const closeEditor = () => setEditor({ mode: 'closed' })
  const onSaved = useCallback(() => {
    closeEditor()
    setFlash(t('common.saved'))
    reload()
  }, [reload, t])

  const categories = data?.data ?? []

  return (
    <AdminPage>
      <PageHeader
        title={t('categories.title')}
        description={t('categories.description')}
        actions={
          <Button onClick={() => setEditor({ mode: 'create' })}>{t('categories.new')}</Button>
        }
      />

      {flash ? <Flash tone="ok">{flash}</Flash> : null}

      {deleting ? (
        <DeleteCategoryDialog
          category={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            setFlash(t('categories.deleteSuccess'))
            reload()
          }}
        />
      ) : null}

      {editor.mode !== 'closed' ? (
        <CategoryEditor
          initialState={editor.mode === 'edit' ? editor.category : undefined}
          onSave={onSaved}
          onClose={closeEditor}
        />
      ) : null}

      {loading && !data ? (
        <Panel flush>
          <RowSkeleton rows={4} />
        </Panel>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : categories.length === 0 ? (
        <Panel>
          <AdminEmpty
            icon={<Tags size={22} aria-hidden="true" />}
            title={t('categories.empty')}
            text={t('categories.emptyHint')}
            action={
              <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                {t('categories.new')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <Panel flush>
            <table className="lh-admin-table">
              <thead>
                <tr>
                  <th>{t('categories.listColumn')}</th>
                  <th className="lh-admin-td-num">{t('categories.productCount')}</th>
                  <th>{t('common.status')}</th>
                  <th aria-label={t('common.actions')} />
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const count = counts.data?.get(category.id)
                  return (
                    <tr key={category.id}>
                      <td>
                        <div className="lh-admin-cell-title">{category.nameAr}</div>
                        {category.nameEn ? (
                          <div className="lh-admin-cell-sub">{category.nameEn}</div>
                        ) : null}
                      </td>
                      <td className="lh-admin-td-num text-ink-2">
                        {count === undefined || count === null
                          ? '—'
                          : t('categories.count', { n: formatCount(count, locale) })}
                      </td>
                      <td>
                        <StatusBadge value={category.status} />
                      </td>
                      <td className="text-end">
                        <div className="lh-admin-inline-actions justify-end">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditor({ mode: 'edit', category })}
                          >
                            {t('common.edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleting(category)}>
                            {t('common.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>
          {data ? <Pagination meta={data.meta} pending={loading} onPage={setPage} /> : null}
        </>
      )}
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Editor / delete (logic unchanged)
// ---------------------------------------------------------------------------

const CATEGORY_FIELD_ERROR: Record<
  CategoryField,
  Partial<Record<CategoryFormErrorCode, DictKey>>
> = {
  nameAr: { required: 'categories.errorNameArRequired' },
  nameEn: { required: 'categories.errorNameEnRequired' },
  code: { required: 'categories.errorCodeRequired', codeFormat: 'categories.errorCodeFormat' },
  slug: { slugFormat: 'categories.errorSlugFormat' },
}

const CATEGORY_FIELD_ORDER: readonly CategoryField[] = ['nameAr', 'nameEn', 'code', 'slug']

function categoryFieldMessageKey(errors: CategoryFormErrors): DictKey | null {
  for (const field of CATEGORY_FIELD_ORDER) {
    const code = errors[field]
    if (code !== undefined) return CATEGORY_FIELD_ERROR[field][code] ?? null
  }
  return null
}

function CategoryEditor({
  initialState,
  onSave,
  onClose,
}: {
  initialState?: CategoryDoc
  onSave: () => void
  onClose: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const isEdit = initialState !== undefined
  const [nameAr, setNameAr] = useState(initialState?.nameAr ?? '')
  const [nameEn, setNameEn] = useState(initialState?.nameEn ?? '')
  const [code, setCode] = useState(initialState?.code ?? '')
  const [slug, setSlug] = useState(initialState?.slug ?? '')
  const [descriptionAr, setDescriptionAr] = useState(initialState?.descriptionAr ?? '')
  const [descriptionEn, setDescriptionEn] = useState(initialState?.descriptionEn ?? '')
  const [status, setStatus] = useState<EntityStatus>(initialState?.status ?? 'active')
  const [iconKey, setIconKey] = useState(initialState?.iconKey ?? '')
  const [visualMode, setVisualMode] = useState<CategoryVisualMode>(
    initialState?.visualMode ?? 'auto',
  )
  const [advanced, setAdvanced] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  // Category image — CREATE holds a pending File (created category first, then
  // uploaded); EDIT applies upload/replace/remove on Save. The storefront falls
  // back to the icon whenever no image is present.
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [removeRequested, setRemoveRequested] = useState(false)
  const [persistingImage, setPersistingImage] = useState(false)

  const { run, pending } = useMutation((input: CategoryCreateInput | CategoryUpdateInput) => {
    if (isEdit) return client.updateCategory(initialState.id, input as CategoryUpdateInput)
    return client.createCategory(input as CategoryCreateInput)
  })

  const busy = pending || persistingImage

  /** Runs one image mutation without throwing; returns a localized error or null. */
  const applyImageOp = async (op: () => Promise<unknown>): Promise<string | null> => {
    setPersistingImage(true)
    try {
      await op()
      return null
    } catch (cause) {
      return errorMessage(cause, t)
    } finally {
      setPersistingImage(false)
    }
  }

  const submit = async () => {
    const values: CategoryFormValues = {
      nameAr,
      nameEn,
      code,
      slug,
      descriptionAr,
      descriptionEn,
      status,
      iconKey,
      visualMode,
    }
    const { payload, errors } = isEdit
      ? buildCategoryUpdatePayload(values)
      : buildCategoryCreatePayload(values)
    if (payload === undefined) {
      const key = categoryFieldMessageKey(errors)
      setFieldError(key !== null ? t(key) : t('error.invalid'))
      return
    }
    const result = await run(payload)
    if (!result.ok) {
      setFieldError(errorMessage(result.error, t))
      return
    }

    // Category row exists (created or updated) — now apply the pending image op.
    const categoryId = result.data.id
    if (pendingFile !== null) {
      const form = new FormData()
      form.append('file', pendingFile)
      const imageError = await applyImageOp(() => client.uploadCategoryImage(categoryId, form))
      if (imageError !== null) {
        setFieldError(imageError)
        return
      }
    } else if (isEdit && removeRequested) {
      const imageError = await applyImageOp(() => client.removeCategoryImage(categoryId))
      if (imageError !== null) {
        setFieldError(imageError)
        return
      }
    }

    onSave()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? t('categories.edit') : t('categories.new')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('categories.nameAr')} required>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </Field>
          <Field label={t('categories.nameEn')} required>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
        </div>
        {!isEdit ? (
          <Field label={t('categories.code')} required>
            <Input
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="font-mono"
            />
          </Field>
        ) : null}
        <Field label={t('common.status')} hint={t('categories.statusHint')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as EntityStatus)}>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
          </Select>
        </Field>

        <CategoryVisualPicker
          currentUrl={isEdit ? initialState.imageUrl : null}
          pendingFile={pendingFile}
          removeRequested={removeRequested}
          busy={busy}
          name={isEdit ? (locale === 'ar' ? initialState.nameAr : initialState.nameEn) : ''}
          iconKey={iconKey}
          visualMode={visualMode}
          onVisualModeChange={setVisualMode}
          onPickFile={(file) => {
            setPendingFile(file)
            setRemoveRequested(false)
            // Choosing an image immediately targets the image display mode.
            if (file !== null) setVisualMode('image')
          }}
          onRemoveRequest={() => {
            setPendingFile(null)
            setRemoveRequested(true)
          }}
          onIconChange={setIconKey}
        />

        <div className="rounded-md border border-dashed border-border p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-sm font-medium text-ink-2"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
          >
            {t('categories.advanced')}
            <span className="text-xs text-ink-3">
              {advanced ? t('common.hide') : t('common.show')}
            </span>
          </button>
          {advanced ? (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-ink-3">{t('categories.advancedHint')}</p>
              <Field
                label={t('categories.slug')}
                hint={isEdit ? t('categories.slugKeepOnEdit') : t('categories.slugAuto')}
              >
                <Input
                  dir="ltr"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label={t('categories.descriptionAr')}>
                <Textarea
                  rows={2}
                  value={descriptionAr}
                  onChange={(e) => setDescriptionAr(e.target.value)}
                />
              </Field>
              <Field label={t('categories.descriptionEn')}>
                <Textarea
                  rows={2}
                  value={descriptionEn}
                  onChange={(e) => setDescriptionEn(e.target.value)}
                />
              </Field>
            </div>
          ) : null}
        </div>

        {fieldError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {fieldError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {busy ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * Category visual picker. A segmented control sets the PERSISTED display mode —
 * `صورة` (image), `أيقونة` (icon), `تلقائي` (auto) — and each panel edits that
 * source. The mode is real (never decorative):
 *
 *  - صورة (image):    show the image when present.
 *  - أيقونة (icon):   show the icon even when an image is stored.
 *  - تلقائي (auto):   image → icon → automatic code fallback.
 *
 * Switching modes is NON-destructive: the uploaded image and saved icon always
 * survive. Removing the image is an explicit, destructive action that clears the
 * DB reference and deletes the owned R2 object, letting the storefront fall back
 * to the icon. All mutations apply on Save — nothing is uploaded or persisted
 * here.
 */
function CategoryVisualPicker({
  currentUrl,
  pendingFile,
  removeRequested,
  busy,
  name,
  iconKey,
  visualMode,
  onVisualModeChange,
  onPickFile,
  onRemoveRequest,
  onIconChange,
}: {
  currentUrl: string | null
  pendingFile: File | null
  removeRequested: boolean
  busy: boolean
  name: string
  iconKey: string
  visualMode: CategoryVisualMode
  onVisualModeChange: (mode: CategoryVisualMode) => void
  onPickFile: (file: File | null) => void
  onRemoveRequest: () => void
  onIconChange: (key: string) => void
}) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const hasImage = pendingFile !== null || (currentUrl !== null && !removeRequested)

  const pick = () => fileRef.current?.click()

  // Request the confirmation banner (nothing is armed yet).
  const requestRemove = () => setConfirming(true)

  // Banner "remove": armed now — Save will permanently remove the image.
  const confirmRemove = () => {
    setConfirming(false)
    onRemoveRequest()
  }

  // Banner "cancel": close the confirmation without arming.
  const cancelBanner = () => setConfirming(false)

  // Picking a new file replaces any armed removal, builds its preview URL, and
  // targets image mode. Object URLs are created on a user event (never in an
  // effect) and revoked when superseded.
  const handlePick = (file: File | null) => {
    if (objectUrlRef.current !== null) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    if (file !== null) objectUrlRef.current = URL.createObjectURL(file)
    setPreviewUrl(objectUrlRef.current)
    onPickFile(file)
  }

  // `auto` with both image + icon: mention that the image wins while the icon is
  // preserved for later.
  const autoPriority =
    visualMode === 'auto' && hasImage && iconKey !== '' ? t('categories.iconPriorityHint') : null

  return (
    <Field label={t('categories.visual')} hint={t('categories.visualTypeHint')}>
      <div className="flex flex-col gap-3">
        <div className="lh-segmented" role="group" aria-label={t('categories.visual')}>
          <button
            type="button"
            className={
              visualMode === 'image' ? 'lh-segmented__item is-active' : 'lh-segmented__item'
            }
            aria-pressed={visualMode === 'image'}
            onClick={() => {
              onVisualModeChange('image')
              if (!hasImage) pick()
            }}
          >
            {t('categories.visualImage')}
          </button>
          <button
            type="button"
            className={
              visualMode === 'icon' ? 'lh-segmented__item is-active' : 'lh-segmented__item'
            }
            aria-pressed={visualMode === 'icon'}
            onClick={() => onVisualModeChange('icon')}
          >
            {t('categories.visualIcon')}
          </button>
          <button
            type="button"
            className={
              visualMode === 'auto' ? 'lh-segmented__item is-active' : 'lh-segmented__item'
            }
            aria-pressed={visualMode === 'auto'}
            onClick={() => onVisualModeChange('auto')}
          >
            {t('categories.visualAuto')}
          </button>
        </div>

        {visualMode === 'image' ? (
          <CategoryImagePanel
            currentUrl={currentUrl}
            pendingFile={pendingFile}
            removeRequested={removeRequested}
            busy={busy}
            name={name}
            confirming={confirming}
            onPick={handlePick}
            onRequestRemove={requestRemove}
            onConfirmRemove={confirmRemove}
            onCancelBanner={cancelBanner}
            fileRef={fileRef}
            previewUrl={previewUrl}
          />
        ) : null}

        {visualMode === 'icon' ? (
          <CategoryIconPanel busy={busy} iconKey={iconKey} onIconChange={onIconChange} />
        ) : null}

        {visualMode === 'auto' ? (
          <div className="lh-auto-panel">
            <p className="text-sm text-ink-2">{t('categories.visualAutoDesc')}</p>
            {autoPriority ? <p className="text-xs text-ink-3">{autoPriority}</p> : null}
          </div>
        ) : null}
      </div>
    </Field>
  )
}

/** Image panel: current/admin-preview image, upload/change/remove, confirm. */
function CategoryImagePanel({
  currentUrl,
  pendingFile,
  removeRequested,
  busy,
  name,
  confirming,
  onPick,
  onRequestRemove,
  onConfirmRemove,
  onCancelBanner,
  fileRef,
  previewUrl,
}: {
  currentUrl: string | null
  pendingFile: File | null
  removeRequested: boolean
  busy: boolean
  name: string
  confirming: boolean
  onPick: (file: File | null) => void
  onRequestRemove: () => void
  onConfirmRemove: () => void
  onCancelBanner: () => void
  fileRef: RefObject<HTMLInputElement | null>
  previewUrl: string | null
}) {
  const t = useT()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div
          className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface"
          aria-hidden="true"
        >
          {pendingFile !== null && previewUrl !== null && !removeRequested ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={previewUrl} alt="" className="size-full object-cover" />
          ) : currentUrl === null || removeRequested ? (
            <div className="flex flex-col items-center gap-1 text-ink-3">
              <ImageIcon size={22} aria-hidden="true" />
              <span className="lh-text-caption">{t('categories.imageEmpty')}</span>
            </div>
          ) : (
            <AuthedImage src={currentUrl} alt={name} className="size-full object-cover" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            aria-label={t('categories.imageUpload')}
            disabled={busy}
            onChange={(e) => {
              onPick(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <ImagePlus size={14} aria-hidden="true" />
            {pendingFile !== null || currentUrl !== null
              ? t('categories.imageChange')
              : t('categories.imageUpload')}
          </Button>
          {pendingFile !== null && !removeRequested ? (
            <Button variant="ghost" size="sm" onClick={() => onPick(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
          ) : null}
          {currentUrl !== null && pendingFile === null && !removeRequested ? (
            <Button
              variant="danger"
              size="sm"
              onClick={onRequestRemove}
              disabled={busy}
              aria-label={t('categories.imageRemove')}
            >
              <Trash2 size={14} aria-hidden="true" />
              {t('categories.imageRemove')}
            </Button>
          ) : null}
        </div>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-lg bg-danger-soft p-2">
          <p className="text-sm font-medium text-ink">{t('categories.imageConfirmRemove')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="danger" size="sm" onClick={onConfirmRemove}>
              {t('common.remove')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelBanner}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : removeRequested ? (
        <p className="text-sm font-medium text-danger" role="alert">
          {t('categories.imageConfirmRemove')}
        </p>
      ) : null}
    </div>
  )
}

/** Icon panel: searchable curated grid + clear action. */
function CategoryIconPanel({
  busy,
  iconKey,
  onIconChange,
}: {
  busy: boolean
  iconKey: string
  onIconChange: (key: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const icons = CATEGORY_ICON_META.filter((meta) => {
    if (q.length === 0) return true
    const haystack = [meta.labelAr, meta.labelEn, ...meta.aliasesAr, ...meta.aliasesEn]
      .map((word) => word.toLowerCase())
      .join(' ')
    return haystack.includes(q)
  })

  return (
    <div className="flex flex-col gap-3">
      <label className="relative block">
        <span className="sr-only">{t('categories.iconSearch')}</span>
        <SearchIcon
          size={14}
          className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
        <Input
          type="search"
          dir="auto"
          className="ps-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('categories.iconSearchPlaceholder')}
          disabled={busy}
        />
      </label>

      {icons.length === 0 ? (
        <p className="text-sm text-ink-3">{t('categories.iconSearchEmpty')}</p>
      ) : (
        <div className="lh-icon-grid">
          {icons.map((meta) => {
            const Icon = categoryIconComponent(meta.key)
            if (Icon === undefined) return null
            const selected = iconKey === meta.key
            return (
              <button
                key={meta.key}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={() => onIconChange(meta.key)}
                className={selected ? 'lh-icon-option is-selected' : 'lh-icon-option'}
              >
                <Icon
                  size={22}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="lh-icon-option__icon"
                />
                <span className="lh-icon-option__label">
                  {locale === 'ar' ? meta.labelAr : meta.labelEn}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {iconKey !== '' ? (
          <Button variant="ghost" size="sm" onClick={() => onIconChange('')} disabled={busy}>
            {t('categories.iconClear')}
          </Button>
        ) : (
          <span className="text-xs text-ink-3">{t('categories.iconEmpty')}</span>
        )}
      </div>

      <IconAdvancedSection busy={busy} onIconChange={onIconChange} />
    </div>
  )
}

/** Advanced: manual icon name with live validation + preview. */
function IconAdvancedSection({
  busy,
  onIconChange,
}: {
  busy: boolean
  onIconChange: (key: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const normalized = normalizeCategoryIconKey(draft)
  const invalid = draft.trim().length > 0 && normalized === null
  const notFound = normalized !== null && !isCategoryIconRegistryKey(normalized)
  const verified = normalized !== null && isCategoryIconRegistryKey(normalized)
  const Icon = verified && normalized !== null ? CATEGORY_ICON_COMPONENTS[normalized] : undefined
  const label = verified && normalized !== null ? categoryIconLabel(normalized) : undefined

  const commitDraft = (value: string) => {
    setDraft(value)
    const key = resolveCategoryIconKey(value)
    if (key !== null) onIconChange(key)
  }

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-ink-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {t('categories.advanced')}
        <ChevronDownIcon
          size={14}
          aria-hidden="true"
          className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <Field
            label={t('categories.iconKeyName')}
            hint={
              <>
                {t('categories.iconKeyHint')}{' '}
                <span dir="ltr">({t('categories.iconKeyExample')})</span>
              </>
            }
            error={
              invalid || notFound
                ? t('categories.iconKeyInvalid')
                : verified
                  ? t('categories.iconKeyVerified')
                  : undefined
            }
          >
            <Input
              dir="ltr"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => commitDraft(e.target.value)}
              placeholder="camera"
              disabled={busy}
              aria-live="polite"
            />
          </Field>

          {verified && Icon !== undefined ? (
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-surface ring-1 ring-border">
                <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="text-sm text-ink-2">
                {locale === 'ar' ? (label?.labelAr ?? normalized) : (label?.labelEn ?? normalized)}
              </span>
            </div>
          ) : null}

          <p className="text-xs text-ink-3">
            {t('categories.iconKeyHint')}{' '}
            <span className="lh-text-caption">{t('categories.iconKeyExample')}</span>
          </p>
        </div>
      ) : null}
    </div>
  )
}

function DeleteCategoryDialog({
  category,
  onClose,
  onDeleted,
}: {
  category: CategoryDoc
  onClose: () => void
  onDeleted: () => void
}) {
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const { run, pending } = useMutation(() => client.removeCategory(category.id))

  const confirm = async () => {
    const result = await run()
    if (result.ok) onDeleted()
    else setError(t('categories.confirmDelete'))
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('common.confirmDeleteTitle')}
      closeLabel={t('common.close')}
    >
      <p className="text-sm text-ink-2">{t('categories.confirmDelete')}</p>
      {error ? (
        <p className="mt-3 text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" loading={pending} onClick={confirm}>
          {t('common.delete')}
        </Button>
      </div>
    </Dialog>
  )
}
