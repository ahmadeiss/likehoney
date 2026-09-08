/**
 * Media storage abstraction (FK-401c).
 *
 * Object storage is reached only from the worker. The interface is
 * provider-neutral; the R2 implementation streams object bodies through the
 * Worker rather than exposing signed URLs.
 */
import { ServiceError } from '@likehoney/shared'

export interface MediaObject {
  body: ReadableStream | null
  contentType: string | null
  etag: string | null
  /** The FULL object size, regardless of whether this read was ranged. */
  totalSizeBytes: number
  /**
   * Present only when `getObject` was called with a `range` and R2 honored
   * it. `end` is inclusive (HTTP `Content-Range` convention) — `body` streams
   * exactly this window, never the whole object.
   */
  range?: { start: number; end: number }
}

export interface MediaPut {
  key: string
  contentType: string
  sizeBytes: number
}

export interface MediaStorage {
  putObject(key: string, data: ArrayBuffer, contentType: string): Promise<MediaPut>
  /**
   * `range`: the incoming request's raw `Range` header value (e.g.
   * `bytes=0-1023`), forwarded to R2 as-is — R2 parses standard HTTP Range
   * syntax itself (single range only; no need to hand-parse it here). Omit
   * for a normal full-body read.
   */
  getObject(key: string, range?: string): Promise<MediaObject | null>
  deleteObject(key: string): Promise<void>
}

/** R2-backed storage. `bucket` must never be unbound for media endpoints. */
export function createR2MediaStorage(bucket: R2Bucket): MediaStorage {
  return {
    async putObject(key, data, contentType) {
      await bucket.put(key, data, { httpMetadata: { contentType } })
      return { key, contentType, sizeBytes: data.byteLength }
    },

    async getObject(key, range) {
      if (range === undefined) {
        const object = await bucket.get(key)
        if (!object) return null
        return {
          body: object.body,
          contentType: object.httpMetadata?.contentType ?? null,
          etag: object.httpEtag ?? null,
          totalSizeBytes: object.size,
        }
      }

      // A ranged read: R2 streams only the requested bytes (never the whole
      // object — essential for a 100 MB video). The R2 API's own docs don't
      // guarantee `size` reflects the FULL object on a ranged get, so the
      // authoritative total size comes from a separate lightweight `head()`
      // — one small metadata call, made only for ranged requests, never for
      // the common full-body case.
      const [head, object] = await Promise.all([
        bucket.head(key),
        bucket.get(key, { range: new Headers({ Range: range }) }),
      ])
      if (!object || !head) return null

      const servedRange =
        object.range && 'offset' in object.range && typeof object.range.offset === 'number'
          ? {
              start: object.range.offset,
              end: object.range.offset + (object.range.length ?? object.size) - 1,
            }
          : undefined

      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType ?? null,
        etag: object.httpEtag ?? null,
        totalSizeBytes: head.size,
        range: servedRange,
      }
    },

    async deleteObject(key) {
      await bucket.delete(key)
    },
  }
}

/**
 * Builds the HTTP response for a media GET — shared by the authenticated and
 * public stream routes so Range/ETag/Cache-Control semantics can never drift
 * between them. Immutable long-lived caching is safe here specifically
 * because every replacement upload mints a brand-new UUID object key (never
 * overwrites); a 404 is never cached as if it were a success.
 */
export async function buildMediaResponse(
  storage: MediaStorage,
  key: string,
  rangeHeader: string | undefined,
): Promise<Response> {
  const object = await storage.getObject(key, rangeHeader)
  if (object === null) {
    return new Response(null, { status: 404 })
  }

  const headers = new Headers()
  headers.set('Content-Type', object.contentType ?? 'application/octet-stream')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('Accept-Ranges', 'bytes')
  if (object.etag) headers.set('ETag', object.etag)

  if (object.range) {
    headers.set('Content-Length', String(object.range.end - object.range.start + 1))
    headers.set(
      'Content-Range',
      `bytes ${object.range.start}-${object.range.end}/${object.totalSizeBytes}`,
    )
    return new Response(object.body, { status: 206, headers })
  }

  headers.set('Content-Length', String(object.totalSizeBytes))
  return new Response(object.body, { headers })
}

/** Resolves the configured storage or throws a 503 so media routes fail loudly. */
export function getMediaStorage(bucket: R2Bucket | undefined): MediaStorage {
  if (!bucket) {
    throw new ServiceError(503, 'media_unconfigured', 'media storage is not configured')
  }
  return createR2MediaStorage(bucket)
}

/** Derives the object key for a product image from secure UUIDs only. */
export function buildMediaObjectKey(productId: string, fileName: string): string {
  const ext = safeExtension(fileName)
  return `products/${productId}/${crypto.randomUUID()}${ext}`
}

/** Derives the object key for a category display image from secure UUIDs only. */
export function buildCategoryObjectKey(categoryId: string, fileName: string): string {
  const ext = safeExtension(fileName)
  return `categories/${categoryId}/${crypto.randomUUID()}${ext}`
}

function safeExtension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName)
  return match ? `.${match[1]!.toLowerCase()}` : ''
}

/**
 * Keys are UUID-prefixed and never user-supplied paths; enforce a narrow
 * shape. Shared by the product-media routes and the category-image route so
 * every stream entry point accepts the same safe key vocabulary.
 */
export function isSafeObjectKey(key: string): boolean {
  return (
    (key.startsWith('products/') || key.startsWith('categories/')) &&
    /^[a-z0-9/._-]+$/i.test(key) &&
    key.length <= 512
  )
}

/**
 * Streaming URL for an object. Keys are opaque and unguessable (UUID prefixes).
 *
 * Two routes serve media:
 *  - `/api/v1/media/stream`   (authenticated — used by the Admin media rail)
 *  - `/api/v1/public/media/stream` (unauthenticated — served to storefront
 *    customers). Public catalog documents MUST use this one, otherwise the
 *    storefront gets a 401.
 *
 * Always a SAME-ORIGIN-RELATIVE path — never prefixed with an origin. Both
 * the Admin app and the public storefront reach the API exclusively through
 * their own Next.js same-origin rewrite (`/api/v1/...`); the Worker's own
 * request URL (what `origin` would otherwise be built from) is a different
 * origin the browser never talks to directly. A relative path is also what
 * lets a future custom media domain/CDN replace the origin later without
 * touching a single component (§17) — and it's what `next/image` requires
 * unless every possible Worker host is separately allowlisted, which an
 * absolute URL would otherwise demand.
 */
export function mediaStreamUrl(
  _origin: string,
  key: string,
  opts: { public?: boolean } = {},
): string {
  const query = encodeURIComponent(key)
  const base = opts.public ? '/api/v1/public/media/stream' : '/api/v1/media/stream'
  return `${base}?key=${query}`
}
