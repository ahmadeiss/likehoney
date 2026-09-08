'use client'

import { Image as ImageIcon, ImagePlus, Tags, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

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
    reload()
  }, [reload])

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

      {loading ? (
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
          {data ? <Pagination meta={data.meta} onPage={setPage} /> : null}
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

        <CategoryImagePicker
          currentUrl={isEdit ? initialState.imageUrl : null}
          pendingFile={pendingFile}
          removeRequested={removeRequested}
          busy={busy}
          name={isEdit ? (locale === 'ar' ? initialState.nameAr : initialState.nameEn) : ''}
          onPick={(file) => {
            setPendingFile(file)
            setRemoveRequested(false)
          }}
          onRemoveRequest={() => {
            setPendingFile(null)
            setRemoveRequested(true)
          }}
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
 * Category display-image picker. Shows the current/admin-preview image (or a
 * pending-file preview), and lets the operator pick a replacement or arm a
 * removal. All mutations apply on Save — nothing is uploaded here.
 */
function CategoryImagePicker({
  currentUrl,
  pendingFile,
  removeRequested,
  busy,
  name,
  onPick,
  onRemoveRequest,
}: {
  currentUrl: string | null
  pendingFile: File | null
  removeRequested: boolean
  busy: boolean
  name: string
  onPick: (file: File | null) => void
  onRemoveRequest: () => void
}) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const pick = () => fileRef.current?.click()

  // Request the confirmation banner (nothing is armed yet).
  const requestRemove = () => setConfirming(true)

  // Banner "remove": armed now — Save will remove the image.
  const confirmRemove = () => {
    setConfirming(false)
    onRemoveRequest()
  }

  // Banner "cancel": close the confirmation without arming.
  const cancelBanner = () => setConfirming(false)

  // Picking a new file replaces any armed removal and builds its preview URL.
  // Object URLs are created on a user event (never in an effect) and revoked
  // when superseded.
  const handlePick = (file: File | null) => {
    if (objectUrlRef.current !== null) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    if (file !== null) {
      objectUrlRef.current = URL.createObjectURL(file)
    }
    setPreviewUrl(objectUrlRef.current)
    onPick(file)
  }

  return (
    <Field label={t('categories.image')} hint={t('categories.imageHint')}>
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
                handlePick(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
            <Button variant="secondary" size="sm" onClick={pick} disabled={busy}>
              <ImagePlus size={14} aria-hidden="true" />
              {pendingFile !== null || currentUrl !== null
                ? t('categories.imageChange')
                : t('categories.imageUpload')}
            </Button>
            {pendingFile !== null && !removeRequested ? (
              <Button variant="ghost" size="sm" onClick={() => handlePick(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
            ) : null}
            {currentUrl !== null && pendingFile === null && !removeRequested ? (
              <Button
                variant="danger"
                size="sm"
                onClick={requestRemove}
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
              <Button variant="danger" size="sm" onClick={confirmRemove}>
                {t('common.remove')}
              </Button>
              <Button variant="ghost" size="sm" onClick={cancelBanner}>
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
    </Field>
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
