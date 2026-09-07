'use client'

import { ArrowRight, BadgeCheck, MessageSquareText } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState, type ReactElement, type ReactNode } from 'react'

import { Button } from '@likehoney/ui'
import {
  REVIEW_STATUS_LABELS,
  REVIEW_VERIFIED_SOURCE_LABELS,
  localizedLabel,
} from '@likehoney/shared'

import { client, type AdminReviewDetail } from '../../../../lib/admin/client'
import { useAuth } from '../../../../lib/admin/auth'
import { useResource } from '../../../../lib/admin/hooks'
import { useLocale, useT } from '../../../../lib/admin/i18n'
import { formatPhone, formatStoreDateTime } from '../../../../lib/admin/format'
import {
  AdminEmpty,
  AdminPage,
  Chip,
  ErrorState,
  Flash,
  PageHeader,
  Panel,
  RowSkeleton,
  errorMessage,
} from '../../_components/shared'
import { Stars } from '../page'

const STATUS_TONE: Record<'pending' | 'approved' | 'rejected', 'pending' | 'done' | 'danger'> = {
  pending: 'pending',
  approved: 'done',
  rejected: 'danger',
}

/** Restrained mint/positive verified marker — not a marketing badge (§9). */
function VerifiedTag({ label }: { label: string }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
      <BadgeCheck size={13} aria-hidden="true" />
      {label}
    </span>
  )
}

export default function AdminReviewDetailPage(): ReactElement {
  const { reviewId } = useParams<{ reviewId: string }>()
  const t = useT()
  const locale = useLocale()
  const { hasPermission } = useAuth()
  const canModerate = hasPermission('reviews:moderate')

  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [flash, setFlash] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const { data, error, loading, reload } = useResource<AdminReviewDetail | null>(
    () => (canModerate ? client.getReview(reviewId) : Promise.resolve(null)),
    [reviewId, canModerate],
  )

  if (!canModerate) {
    return (
      <AdminPage>
        <PageHeader title={t('reviews.detail.title')} />
        <Panel>
          <AdminEmpty
            icon={<MessageSquareText size={22} aria-hidden="true" />}
            title={t('error.forbidden')}
            text={t('reviews.forbidden')}
          />
        </Panel>
      </AdminPage>
    )
  }

  const moderate = async (action: 'approve' | 'reject') => {
    if (busy) return
    setBusy(action)
    setFlash(null)
    try {
      const trimmed = note.trim()
      await (action === 'approve'
        ? client.approveReview(reviewId, trimmed || undefined)
        : client.rejectReview(reviewId, trimmed || undefined))
      setFlash({
        tone: 'ok',
        text: action === 'approve' ? t('reviews.action.approved') : t('reviews.action.rejected'),
      })
      setNote('')
      reload()
    } catch (e) {
      setFlash({ tone: 'error', text: errorMessage(e, t) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <AdminPage>
      <Link href="/admin/reviews" className="lh-admin-link mb-3 inline-flex">
        <ArrowRight size={14} className="rotate-180 rtl:rotate-0" aria-hidden="true" />
        {t('reviews.back')}
      </Link>

      {loading && !data ? (
        <Panel flush>
          <RowSkeleton rows={6} />
        </Panel>
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="flex flex-col gap-5">
          <PageHeader
            title={data.displayName}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <Stars value={data.rating} />
                <span className="text-xs font-semibold text-ink-3">{data.rating} / 5</span>
                <Chip tone={STATUS_TONE[data.status]}>
                  {localizedLabel(REVIEW_STATUS_LABELS, data.status, locale)}
                </Chip>
                {data.verifiedPurchase ? <VerifiedTag label={t('reviews.verified.yes')} /> : null}
              </span>
            }
          />

          {flash ? <Flash tone={flash.tone}>{flash.text}</Flash> : null}

          {/* Review text — the primary thing to read; shown verbatim, never editable */}
          <section className="lh-admin-section">
            <h2 className="lh-admin-section-title mb-2">{t('reviews.detail.review')}</h2>
            <Panel>
              <p
                className="whitespace-pre-wrap rounded-lg bg-surface-muted p-3.5 text-[15px] leading-relaxed text-ink"
                dir="auto"
              >
                {data.reviewText}
              </p>
            </Panel>
          </section>

          {/* Facts to decide safely */}
          <section className="lh-admin-section">
            <h2 className="lh-admin-section-title mb-2">{t('reviews.detail.title')}</h2>
            <Panel>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label={t('reviews.detail.verified')}>
                  {data.verifiedPurchase ? (
                    <VerifiedTag label={t('reviews.verified.yes')} />
                  ) : (
                    <span className="text-ink-3">{t('reviews.verified.no')}</span>
                  )}
                </Field>
                <Field label={t('reviews.detail.verifiedSource')}>
                  {data.verifiedSource
                    ? localizedLabel(REVIEW_VERIFIED_SOURCE_LABELS, data.verifiedSource, locale)
                    : t('reviews.detail.none')}
                </Field>
                <Field label={t('reviews.detail.submittedPhone')}>
                  {data.submittedPhone ? (
                    <span dir="ltr" className="font-mono">
                      {formatPhone(data.submittedPhone, { intl: true })}
                    </span>
                  ) : (
                    <span className="text-ink-4">{t('reviews.detail.none')}</span>
                  )}
                </Field>
                <Field label={t('reviews.detail.submittedReference')}>
                  {data.submittedReference ? (
                    <span className="font-mono">{data.submittedReference}</span>
                  ) : (
                    <span className="text-ink-4">{t('reviews.detail.none')}</span>
                  )}
                </Field>
                <Field label={t('reviews.detail.linkedCustomer')}>
                  {data.linkedCustomerId ? (
                    <Link
                      href={`/admin/customers/${data.linkedCustomerId}`}
                      className="lh-admin-link"
                    >
                      {t('reviews.detail.viewCustomer')}
                    </Link>
                  ) : (
                    <span className="text-ink-4">{t('reviews.detail.none')}</span>
                  )}
                </Field>
                <Field label={t('reviews.detail.submitted')}>
                  {formatStoreDateTime(data.createdAt, locale)}
                </Field>
                {data.moderatedAt ? (
                  <Field label={t('reviews.detail.moderatedAt')}>
                    {formatStoreDateTime(data.moderatedAt, locale)}
                  </Field>
                ) : null}
                {data.moderationNote ? (
                  <Field label={t('reviews.detail.note')}>
                    <span dir="auto">{data.moderationNote}</span>
                  </Field>
                ) : null}
              </dl>
            </Panel>
          </section>

          {/* Moderation actions — approve is the primary; text is never editable */}
          <section className="lh-admin-section">
            <h2 className="lh-admin-section-title mb-2">{t('common.actions')}</h2>
            <Panel>
              <label className="block text-xs font-semibold text-ink-3" htmlFor="review-note">
                {t('reviews.detail.note')}
              </label>
              <textarea
                id="review-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={t('reviews.detail.notePlaceholder')}
                className="mt-1.5 w-full rounded-lg border border-border bg-surface p-2.5 text-sm text-ink outline-none focus:border-border-strong"
                dir="auto"
              />
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    loading={busy === 'approve'}
                    disabled={busy !== null || data.status === 'approved'}
                    onClick={() => moderate('approve')}
                  >
                    {t('reviews.action.approve')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === 'reject'}
                    disabled={busy !== null || data.status === 'rejected'}
                    onClick={() => moderate('reject')}
                  >
                    {t('reviews.action.reject')}
                  </Button>
                </div>
                <ul className="flex-1 space-y-1 text-[11px] leading-relaxed text-ink-4">
                  <li>· {t('reviews.action.hintApprove')}</li>
                  <li>· {t('reviews.action.hintReject')}</li>
                </ul>
              </div>
            </Panel>
          </section>
        </div>
      )}
    </AdminPage>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  )
}
