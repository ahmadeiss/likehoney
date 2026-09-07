'use client'

import { Tags } from 'lucide-react'
import { useCallback, useState } from 'react'

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

  const { run, pending } = useMutation((input: CategoryCreateInput | CategoryUpdateInput) => {
    if (isEdit) return client.updateCategory(initialState.id, input as CategoryUpdateInput)
    return client.createCategory(input as CategoryCreateInput)
  })

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
    if (result.ok) onSave()
    else setFieldError(errorMessage(result.error, t))
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
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending}>
            {pending ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </Dialog>
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
