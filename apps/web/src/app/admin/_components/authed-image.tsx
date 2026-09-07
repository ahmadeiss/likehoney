'use client'

import { useEffect, useState, type ReactElement } from 'react'

import { getCurrentStaffId } from '../../../lib/admin/identity-store'

/**
 * The Admin media-stream route is permission-gated (`catalog:read`) — a
 * plain `<img src>` has no way to attach the `X-Staff-Id` dev-identity
 * header (or, in a real deployment, would rely on the session cookie, which
 * IS sent automatically; the dev header is the gap this component closes).
 * Fetches the object as an authenticated blob and renders it via an object
 * URL instead, so the Admin media rail actually shows what it just
 * uploaded. The public storefront never needs this — its stream route is
 * unauthenticated by design.
 */
export function AuthedImage({
  src,
  alt,
  className,
  mediaType = 'image',
}: {
  src: string
  alt: string
  className?: string
  /** `video` renders a native, header-free `<video>` sourced from the same
   *  fetched blob — a `<video src>` can't attach the auth header either. */
  mediaType?: 'image' | 'video'
}): ReactElement {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false)

    const path = toSameOriginPath(src)
    const headers = new Headers()
    const staffId = getCurrentStaffId()
    if (staffId !== null) headers.set('X-Staff-Id', staffId)

    fetch(path, { headers, credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        created = URL.createObjectURL(blob)
        setObjectUrl(created)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [src])

  if (failed) {
    return <div className={className} aria-label={alt} role="img" />
  }

  if (!objectUrl) return <div className={className} />

  if (mediaType === 'video') {
    return <video src={objectUrl} controls className={className} />
  }

  // eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL, not eligible for next/image optimization
  return <img src={objectUrl} alt={alt} className={className} />
}

/** Strips the backend's own absolute origin so the request flows through the
 *  same-origin Next rewrite instead of hitting the Worker cross-origin. */
function toSameOriginPath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}
