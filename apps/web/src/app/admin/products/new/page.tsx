'use client'

import { Check, Trash2, Truck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button, Field, Input, Radio, Select, Textarea } from '@likehoney/ui'

import { client, type ProductStatus } from '../../../../lib/admin/client'
import { useMutation, useResource } from '../../../../lib/admin/hooks'
import { useLocale, useT } from '../../../../lib/admin/i18n'
import { formatPrice } from '../../../../lib/admin/format'
import { AdminPage, errorMessage, MoneyInput, PageHeader, Panel } from '../../_components/shared'

interface DraftValue {
  code: string
  valueEn: string
  valueAr: string
}

interface DraftOption {
  nameEn: string
  nameAr: string
  values: DraftValue[]
}

function FormSection({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="lh-admin-form-section">
      <div>
        <h2 className="lh-admin-form-section-title">{title}</h2>
        {hint ? <p className="lh-admin-form-section-hint">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function AdminNewProductPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()

  const categories = useResource(
    () => client.listCategories({ pageSize: 100, status: 'active' }),
    [],
  )
  const suppliers = useResource(() => client.listSuppliers({ pageSize: 100, status: 'active' }), [])

  const [nameAr, setNameAr] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [descriptionAr, setDescriptionAr] = useState('')
  const [descriptionEn, setDescriptionEn] = useState('')
  const [shortBlurbAr, setShortBlurbAr] = useState('')
  const [shortBlurbEn, setShortBlurbEn] = useState('')
  const [status, setStatus] = useState<ProductStatus>('draft')
  const [mode, setMode] = useState<'simple' | 'options'>('simple')
  const [priceMinor, setPriceMinor] = useState(0)
  const [options, setOptions] = useState<DraftOption[]>([
    { nameEn: '', nameAr: '', values: [{ code: '', valueEn: '', valueAr: '' }] },
  ])
  const [fieldError, setFieldError] = useState<string | null>(null)

  const { run, pending } = useMutation(() =>
    client.createProduct({
      categoryId: categoryId.length > 0 ? categoryId : undefined,
      supplierId: supplierId.length > 0 ? supplierId : undefined,
      nameEn: nameEn.trim(),
      nameAr: nameAr.trim(),
      descriptionEn: descriptionEn.trim() || undefined,
      descriptionAr: descriptionAr.trim() || undefined,
      shortBlurbEn: shortBlurbEn.trim() || undefined,
      shortBlurbAr: shortBlurbAr.trim() || undefined,
      status,
      pricing:
        mode === 'simple'
          ? { mode: 'simple', priceMinor }
          : {
              mode: 'options',
              priceMinor,
              options: options.map((option, index) => ({
                nameEn: option.nameEn.trim(),
                nameAr: option.nameAr.trim(),
                displayOrder: index,
                values: option.values
                  .filter((value) => value.code.trim().length > 0)
                  .map((value) => ({
                    code: value.code.trim().toUpperCase(),
                    valueEn: value.valueEn.trim(),
                    valueAr: value.valueAr.trim(),
                  })),
              })),
            },
    }),
  )

  // Count combinations without allocating an exponentially large matrix on
  // every keystroke. The server remains responsible for materializing variants.
  const comboCount =
    options.length === 0
      ? 0
      : options.reduce(
          (count, option) =>
            count * option.values.filter((value) => value.code.trim().length > 0).length,
          1,
        )

  const submit = async () => {
    if (nameAr.trim().length === 0) return setFieldError(t('products.form.nameArRequired'))
    if (nameEn.trim().length === 0) return setFieldError(t('products.form.nameEnRequired'))
    if (priceMinor < 0) return setFieldError(t('products.form.priceInvalid'))
    if (mode === 'options') {
      if (options.length === 0) return setFieldError(t('products.form.optionsAtLeast'))
      for (const option of options) {
        if (option.nameAr.trim().length === 0 || option.nameEn.trim().length === 0) {
          return setFieldError(t('products.form.optionNameRequired'))
        }
        for (const value of option.values) {
          if (!/^[A-Z0-9]{1,8}$/.test(value.code.trim().toUpperCase())) {
            return setFieldError(t('products.form.optionCodeInvalid'))
          }
          if (!value.valueAr.trim() || !value.valueEn.trim()) {
            return setFieldError(t('products.form.optionValueRequired'))
          }
        }
      }
    }
    const result = await run()
    if (result.ok) router.push(`/admin/products/${result.data.id}`)
    else setFieldError(errorMessage(result.error, t))
  }

  const addOption = () =>
    setOptions((c) => [
      ...c,
      { nameEn: '', nameAr: '', values: [{ code: '', valueEn: '', valueAr: '' }] },
    ])
  const updateOption = (index: number, patch: Partial<Pick<DraftOption, 'nameEn' | 'nameAr'>>) =>
    setOptions((c) => c.map((o, i) => (i === index ? { ...o, ...patch } : o)))
  const removeOption = (index: number) => setOptions((c) => c.filter((_, i) => i !== index))
  const updateValue = (oi: number, vi: number, patch: Partial<DraftValue>) =>
    setOptions((c) =>
      c.map((o, i) =>
        i === oi
          ? { ...o, values: o.values.map((v, j) => (j === vi ? { ...v, ...patch } : v)) }
          : o,
      ),
    )
  const addValue = (oi: number) =>
    setOptions((c) =>
      c.map((o, i) =>
        i === oi ? { ...o, values: [...o.values, { code: '', valueEn: '', valueAr: '' }] } : o,
      ),
    )
  const removeValue = (oi: number, vi: number) =>
    setOptions((c) =>
      c.map((o, i) => (i === oi ? { ...o, values: o.values.filter((_, j) => j !== vi) } : o)),
    )

  const optionsReady =
    mode === 'simple' ||
    (options.length > 0 &&
      options.every(
        (option) =>
          option.nameAr.trim().length > 0 &&
          option.nameEn.trim().length > 0 &&
          option.values.length > 0 &&
          option.values.every(
            (value) =>
              value.code.trim().length > 0 &&
              value.valueAr.trim().length > 0 &&
              value.valueEn.trim().length > 0,
          ),
      ))

  const steps = [
    {
      key: 'basic',
      label: t('products.form.sectionBasic'),
      done: nameAr.trim().length > 0 && nameEn.trim().length > 0,
    },
    { key: 'commerce', label: t('products.form.sectionCommerce'), done: true },
    { key: 'blurb', label: t('products.form.sectionBlurb'), done: true },
    { key: 'status', label: t('products.form.sectionStatus'), done: true },
    { key: 'pricing', label: t('products.form.sectionPricing'), done: priceMinor > 0 },
    { key: 'options', label: t('products.form.sectionOptions'), done: optionsReady },
  ]

  const selectedCategory = categories.data?.data.find((c) => c.id === categoryId)
  const selectedSupplier = suppliers.data?.data.find((s) => s.id === supplierId)

  return (
    <AdminPage width="form">
      <PageHeader
        title={t('products.new')}
        actions={
          <Button variant="ghost" onClick={() => router.push('/admin/products')}>
            {t('common.back')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_19rem]">
        <Panel>
          <FormSection
            title={t('products.form.sectionBasic')}
            hint={t('products.form.sectionBasicHint')}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('products.form.nameAr')} required>
                <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
              </Field>
              <Field label={t('products.form.nameEn')} required>
                <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title={t('products.form.sectionType')}
            hint={t('products.form.sectionTypeHint')}
          >
            <div className="flex flex-col gap-2">
              <Radio
                name="pricing-mode"
                checked={mode === 'simple'}
                onChange={() => setMode('simple')}
                label={t('products.form.simple')}
              />
              <Radio
                name="pricing-mode"
                checked={mode === 'options'}
                onChange={() => setMode('options')}
                label={t('products.form.options')}
              />
              {mode === 'options' ? (
                <p className="text-xs text-ink-3">{t('products.form.optionsHint')}</p>
              ) : null}
            </div>
          </FormSection>

          <FormSection
            title={t('products.form.sectionCommerce')}
            hint={t('products.form.sectionCommerceHint')}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('products.form.category')}>
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
            </div>
          </FormSection>

          <FormSection title={t('products.form.sectionBlurb')}>
            <div className="flex flex-col gap-4">
              <Field label={t('products.form.descriptionAr')}>
                <Textarea
                  rows={3}
                  value={descriptionAr}
                  onChange={(e) => setDescriptionAr(e.target.value)}
                />
              </Field>
              <Field label={t('products.form.descriptionEn')}>
                <Textarea
                  dir="ltr"
                  rows={3}
                  value={descriptionEn}
                  onChange={(e) => setDescriptionEn(e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('products.form.blurbAr')}>
                  <Input value={shortBlurbAr} onChange={(e) => setShortBlurbAr(e.target.value)} />
                </Field>
                <Field label={t('products.form.blurbEn')}>
                  <Input
                    dir="ltr"
                    value={shortBlurbEn}
                    onChange={(e) => setShortBlurbEn(e.target.value)}
                  />
                </Field>
              </div>
            </div>
          </FormSection>

          <FormSection title={t('products.form.sectionStatus')}>
            <div className="max-w-xs">
              <Field label={t('products.form.status')}>
                <Select value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)}>
                  <option value="draft">{t('products.filterDraft')}</option>
                  <option value="active">{t('common.active')}</option>
                  <option value="inactive">{t('common.inactive')}</option>
                  <option value="archived">{t('products.filterArchived')}</option>
                </Select>
              </Field>
            </div>
          </FormSection>

          <FormSection
            title={
              mode === 'options'
                ? `${t('products.form.sectionPricing')} · ${t('products.form.sectionOptions')}`
                : t('products.form.sectionPricing')
            }
            hint={mode === 'options' ? t('products.form.basePriceHint') : undefined}
          >
            <div className="sm:max-w-xs">
              <Field
                htmlFor="product-price"
                label={mode === 'options' ? t('products.form.basePrice') : t('products.form.price')}
              >
                <MoneyInput
                  id="product-price"
                  valueMinor={priceMinor}
                  onChangeMinor={setPriceMinor}
                />
              </Field>
            </div>

            {mode === 'options' ? (
              <div className="mt-4 flex flex-col gap-3">
                {options.map((option, optionIndex) => (
                  <div key={optionIndex} className="rounded-lg border border-border p-4">
                    <div className="flex items-end gap-2">
                      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                        <Field label={t('products.form.optionNameAr')}>
                          <Input
                            value={option.nameAr}
                            onChange={(e) => updateOption(optionIndex, { nameAr: e.target.value })}
                          />
                        </Field>
                        <Field label={t('products.form.optionNameEn')}>
                          <Input
                            dir="ltr"
                            value={option.nameEn}
                            onChange={(e) => updateOption(optionIndex, { nameEn: e.target.value })}
                          />
                        </Field>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('products.form.removeOption')}
                        onClick={() => removeOption(optionIndex)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </Button>
                    </div>

                    <div className="mt-3 flex flex-col gap-2">
                      {option.values.map((value, valueIndex) => (
                        <div key={valueIndex} className="flex flex-wrap items-center gap-2">
                          <Input
                            aria-label={t('products.form.valueCode')}
                            dir="ltr"
                            placeholder={t('products.form.valueCode')}
                            className="w-20 font-mono"
                            value={value.code}
                            onChange={(e) =>
                              updateValue(optionIndex, valueIndex, {
                                code: e.target.value.toUpperCase(),
                              })
                            }
                          />
                          <Input
                            aria-label={t('products.form.valueAr')}
                            placeholder={t('products.form.valueAr')}
                            className="min-w-36 flex-1"
                            value={value.valueAr}
                            onChange={(e) =>
                              updateValue(optionIndex, valueIndex, { valueAr: e.target.value })
                            }
                          />
                          <Input
                            aria-label={t('products.form.valueEn')}
                            dir="ltr"
                            placeholder={t('products.form.valueEn')}
                            className="min-w-36 flex-1"
                            value={value.valueEn}
                            onChange={(e) =>
                              updateValue(optionIndex, valueIndex, { valueEn: e.target.value })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('common.remove')}
                            onClick={() => removeValue(optionIndex, valueIndex)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="subtle"
                        size="sm"
                        className="self-start"
                        onClick={() => addValue(optionIndex)}
                      >
                        {t('products.form.addValue')} +
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="secondary" size="sm" onClick={addOption}>
                    {t('products.form.addOption')} +
                  </Button>
                  <span className="text-xs text-ink-3">
                    {t('products.form.comboCount', { count: comboCount })}
                  </span>
                </div>
              </div>
            ) : null}
          </FormSection>
        </Panel>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-24 xl:self-start">
          <Panel>
            <h2 className="lh-admin-section-title mb-3">{t('products.form.progressTitle')}</h2>
            <ol className="lh-admin-progress">
              {steps.map((step, index) => (
                <li
                  key={step.key}
                  className={`lh-admin-progress-step${step.done ? ' lh-admin-progress-step--done' : ''}`}
                >
                  <span className="lh-admin-progress-dot">
                    {step.done ? <Check size={13} aria-hidden="true" /> : index + 1}
                  </span>
                  {step.label}
                </li>
              ))}
            </ol>
          </Panel>

          <Panel>
            <h2 className="lh-admin-section-title mb-3">{t('products.form.reviewTitle')}</h2>
            <div className="flex flex-col">
              <div className="lh-admin-kv">
                <span className="lh-admin-kv-key">{t('common.name')}</span>
                <span className="lh-admin-kv-val">
                  {nameAr.trim() || t('products.form.railNoName')}
                </span>
              </div>
              <div className="lh-admin-kv">
                <span className="lh-admin-kv-key">{t('products.form.category')}</span>
                <span className="lh-admin-kv-val">
                  {selectedCategory ? selectedCategory.nameAr : t('products.form.categoryNone')}
                </span>
              </div>
              {selectedSupplier ? (
                <div className="lh-admin-kv">
                  <span className="lh-admin-kv-key">
                    <Truck size={12} aria-hidden="true" className="inline" />{' '}
                    {t('products.form.supplier')}
                  </span>
                  <span className="lh-admin-kv-val">{selectedSupplier.nameAr}</span>
                </div>
              ) : null}
              <div className="lh-admin-kv">
                <span className="lh-admin-kv-key">{t('products.form.price')}</span>
                <span className="lh-admin-kv-val text-honey-deep">
                  {formatPrice(priceMinor, locale)}
                </span>
              </div>
              <div className="lh-admin-kv">
                <span className="lh-admin-kv-key">{t('products.form.pricing')}</span>
                <span className="lh-admin-kv-val">
                  {mode === 'simple'
                    ? t('products.form.simple')
                    : `${t('products.form.sectionOptions')} · ${comboCount}`}
                </span>
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-3">{t('products.form.variantPreviewHint')}</p>
          </Panel>

          {fieldError ? (
            <div className="lh-admin-flash lh-admin-flash--error" role="alert">
              {fieldError}
            </div>
          ) : null}

          <Button size="lg" onClick={submit} loading={pending} block>
            {pending ? t('products.form.creating') : t('products.form.create')}
          </Button>
          <p className="text-xs text-ink-3">{t('products.form.submitHint')}</p>
        </aside>
      </div>
    </AdminPage>
  )
}
