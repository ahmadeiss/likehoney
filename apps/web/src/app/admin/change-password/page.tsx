'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { AlertCircle, KeyRound, Save } from 'lucide-react'

import { Button, Field, Input, Spinner } from '@likehoney/ui'

import { ApiError } from '../../../lib/admin/client'
import { useAuth } from '../../../lib/admin/auth'
import { useT } from '../../../lib/admin/i18n'

const PASSWORD_MIN = 8

/**
 * Forced password change for accounts with `must_change_password = true`.
 * Submitting revokes the current session (server-side in the change call) and
 * transparently re-establishes a fresh session with the new password.
 */
export default function ChangePasswordPage() {
  const t = useT()
  const router = useRouter()
  const { status, me, completePasswordChange } = useAuth()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const minMet = next.length >= PASSWORD_MIN
  const newRequired = next.length > 0
  const confirmRequired = confirm.length > 0
  const confirmOk = confirm === next
  const currentRequired = current.length > 0
  const canSubmit = currentRequired && newRequired && minMet && confirmOk && !submitting

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!currentRequired) {
      setError(t('password.currentWrong'))
      return
    }
    if (!newRequired) {
      setError(t('password.newRequired'))
      return
    }
    if (!minMet) {
      setError(t('password.minLength'))
      return
    }
    if (!confirmRequired || !confirmOk) {
      setError(t('password.mismatch'))
      return
    }
    if (next === current) {
      setError(t('password.newMismatchCurrent'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await completePasswordChange(current, next)
      router.replace('/admin')
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setError(t('password.currentWrong'))
      } else {
        setError(t('password.changedError'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Only reachable when a session requires a change; otherwise go to admin/
  // (or sign-in if the session is gone).
  const authed = status === 'authenticated'
  useEffect(() => {
    if (authed && !me?.staff.mustChangePassword) router.replace('/admin')
    if (!authed) router.replace('/admin/login')
  }, [authed, me, router])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-honey-soft text-honey-deep">
          <KeyRound size={22} aria-hidden="true" />
        </div>
        <div>
          <p className="text-lg font-bold text-ink">{t('password.title')}</p>
          <p className="mt-1 lh-text-caption text-ink-3">{t('password.subtitle')}</p>
        </div>
      </div>

      <form
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-sm"
        onSubmit={handleSubmit}
        noValidate
      >
        <Field label={t('password.current')} htmlFor="pw-current">
          <Input
            id="pw-current"
            name="currentPassword"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            placeholder={t('password.currentPlaceholder')}
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value)
              if (error !== null) setError(null)
            }}
          />
        </Field>

        <Field label={t('password.new')} htmlFor="pw-new">
          <Input
            id="pw-new"
            name="newPassword"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={next}
            aria-invalid={error !== null}
            onChange={(event) => {
              setNext(event.target.value)
              if (error !== null) setError(null)
            }}
          />
        </Field>

        <Field label={t('password.confirm')} htmlFor="pw-confirm">
          <Input
            id="pw-confirm"
            name="confirmPassword"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={confirm}
            aria-invalid={error !== null}
            onChange={(event) => {
              setConfirm(event.target.value)
              if (error !== null) setError(null)
            }}
          />
        </Field>

        {error !== null ? (
          <p className="flex items-center gap-1.5 lh-text-caption text-danger" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={!canSubmit} aria-disabled={!canSubmit}>
          {submitting ? (
            <>
              <Spinner size="sm" aria-hidden="true" />
              {t('password.submitting')}
            </>
          ) : (
            <>
              <Save size={16} aria-hidden="true" />
              {t('password.submit')}
            </>
          )}
        </Button>
      </form>
    </div>
  )
}
