'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { AlertCircle, KeyRound, LogIn, ShieldCheck } from 'lucide-react'

import { Button, Field, Input, Spinner } from '@likehoney/ui'

import { ApiError, client, type DevStaffOption } from '../../../lib/admin/client'
import { useAuth } from '../../../lib/admin/auth'
import { useIdentity } from '../../../lib/admin/identity'
import { useT } from '../../../lib/admin/i18n'

/**
 * Sign-in for the Admin area — server-session-first. A successful login sets an
 * HttpOnly session cookie; the shell then serves the operational screens. All
 * validation errors are client-side; any server failure is deliberately non-
 * revealing (invalid credentials / inactive account are indistinguishable), so
 * the UI shows one generic message.
 */
export default function LoginPage() {
  const t = useT()
  const router = useRouter()
  const { status, login } = useAuth()
  const { setStaffId } = useIdentity()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Development-only fallback: pick a dev staff member to bypass login locally.
  const isDev = process.env.NODE_ENV !== 'production'
  const [devOptions, setDevOptions] = useState<DevStaffOption[]>([])
  const [devId, setDevId] = useState('')
  const [devLoading, setDevLoading] = useState(isDev)

  useEffect(() => {
    if (!isDev) return
    let cancelled = false
    client
      .listDevStaffOptions()
      .then((options) => {
        if (cancelled) return
        setDevOptions(options)
        if (options.length > 0) setDevId(options[0]!.id)
      })
      .catch(() => {
        if (!cancelled) setDevOptions([])
      })
      .finally(() => {
        if (!cancelled) setDevLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isDev])

  const identifierValid = identifier.trim().length > 0
  const passwordValid = password.length > 0
  const canSubmit = identifierValid && passwordValid && !submitting

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) {
      if (!identifierValid) {
        setError(t('auth.identifierRequired'))
      } else if (!passwordValid) {
        setError(t('auth.passwordRequired'))
      }
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await login(identifier.trim(), password)
      router.replace('/admin')
    } catch (cause) {
      if (cause instanceof ApiError) {
        // 401 covers both invalid credentials and inactive accounts; the server
        // deliberately does not distinguish them.
        setError(cause.status === 401 ? t('auth.invalidCredentials') : t('auth.genericError'))
      } else {
        setError(t('auth.genericError'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const devEnter = () => {
    if (!devId) return
    setStaffId(devId)
    router.replace('/admin')
  }

  // Already signed in: skip the form.
  const authed = status === 'authenticated'
  useEffect(() => {
    if (authed) router.replace('/admin')
  }, [authed, router])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-honey-soft text-honey-deep">
          <KeyRound size={22} aria-hidden="true" />
        </div>
        <div>
          <p className="text-lg font-bold text-ink">{t('auth.brand')}</p>
          <p className="mt-1 lh-text-caption text-ink-3">{t('auth.subtitle')}</p>
        </div>
      </div>

      <form
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-sm"
        onSubmit={handleSubmit}
        noValidate
      >
        <Field label={t('auth.identifier')} htmlFor="login-identifier">
          <Input
            id="login-identifier"
            name="identifier"
            dir="ltr"
            autoComplete="username"
            placeholder={t('auth.identifierPlaceholder')}
            value={identifier}
            aria-invalid={error !== null}
            onChange={(event) => {
              setIdentifier(event.target.value)
              if (error !== null) setError(null)
            }}
          />
        </Field>

        <Field label={t('auth.password')} htmlFor="login-password">
          <Input
            id="login-password"
            name="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            aria-invalid={error !== null}
            onChange={(event) => {
              setPassword(event.target.value)
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
              {t('auth.signingIn')}
            </>
          ) : (
            <>
              <LogIn size={16} aria-hidden="true" />
              {t('auth.signIn')}
            </>
          )}
        </Button>
      </form>

      {isDev ? (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-honey-deep" aria-hidden="true" />
            <p className="lh-text-caption font-medium text-ink-2">{t('auth.devNote')}</p>
          </div>
          {devLoading ? (
            <p className="lh-text-caption text-ink-3">{t('shell.session.checking')}</p>
          ) : devOptions.length > 0 ? (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field
                  label={t('auth.devAccount')}
                  htmlFor="dev-identity-id"
                  hint={t('auth.devHint')}
                >
                  <select
                    id="dev-identity-id"
                    className="lh-input w-full"
                    value={devId}
                    onChange={(event) => setDevId(event.target.value)}
                  >
                    {devOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.nameEn} — {option.nameAr}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Button variant="secondary" onClick={devEnter}>
                {t('shell.identity.apply')}
              </Button>
            </div>
          ) : (
            <p className="lh-text-caption text-ink-3">{t('auth.genericError')}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
