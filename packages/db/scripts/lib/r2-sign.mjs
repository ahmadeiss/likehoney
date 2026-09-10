/**
 * Minimal READ-ONLY R2 S3 client for the catalog audit (SigV4 via
 * node:crypto + fetch). Only GET requests are built here; write operations
 * remain exclusively in the CLI's own PUT/DELETE helpers and are never
 * reachable from the audit path.
 *
 * Host resolution goes through `resolveR2Host` (r2-endpoint.mjs), which
 * constructs the canonical `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
 * origin and rejects bare account ids and malformed endpoints.
 */

import { createHmac, createHash } from 'node:crypto'
import { resolveR2Host } from './r2-endpoint.mjs'

const REGION = 'auto'

function hmac(key, value) {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function encodeS3Component(value) {
  let out = encodeURIComponent(value)
  out = out.replace(/[!*'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return out
}

/**
 * Sign a GET/HEAD request and perform it. `query` is a Map or plain object of
 * already-canonical query parameters (encoded as they will appear on the wire
 * and in the signed canonical query string).
 */
export async function s3Get({
  method = 'GET',
  accountId,
  endpoint,
  accessKey,
  secretKey,
  bucket,
  path = '',
  query = {},
}) {
  const host = resolveR2Host({ accountId, endpoint })
  if (!accessKey || !secretKey) {
    throw new Error(
      'R2 credentials are required (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)',
    )
  }
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '')

  const entries = Object.entries(query)
    .map(([name, value]) => [encodeS3Component(name), encodeS3Component(String(value))])
    .sort(([a], [b]) => a.localeCompare(b))
  const canonicalQuery = entries.map(([name, value]) => `${name}=${value}`).join('&')

  const payloadHash = sha256Hex('')
  const encodedPath = path
    ? path
        .split('/')
        .map((part) => encodeS3Component(part))
        .join('/')
    : ''
  const canonicalUri = encodedPath ? `/${bucket}/${encodedPath}` : `/${bucket}/`
  const hostHeader = host
  const canonicalHeaders = `host:${hostHeader}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp)
  const regionKey = hmac(dateKey, REGION)
  const serviceKey = hmac(regionKey, 's3')
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  // The signed canonical query string is appended VERBATIM to the URL. Passing
  // the pre-encoded values through URLSearchParams would re-encode `%` (e.g.
  // `products%2F` → `products%252F`), producing a request line that differs
  // from the one the signature covers → HTTP 403 SignatureDoesNotMatch.
  const url = canonicalQuery
    ? new URL(`https://${host}${canonicalUri}?${canonicalQuery}`)
    : new URL(`https://${host}${canonicalUri}`)
  const response = await fetch(url, {
    method,
    headers: {
      Host: host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
  })
  const body = await response.text()
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `R2 ${method} ${canonicalUri} failed: HTTP ${response.status} ${s3ErrorCode(body).slice(0, 160)}`,
    )
  }
  return { status: response.status, body }
}

/** Extract the S3 `<Error><Code>…</Code></Error>` value (empty when absent). */
export function s3ErrorCode(xmlBody) {
  const match = /<Code>([\s\S]*?)<\/Code>/.exec(xmlBody ?? '')
  return match ? match[1] : ''
}

/** HEAD the bucket (connectivity + authorization probe, zero objects). */
export async function headR2Bucket(options) {
  return s3Get({ method: 'HEAD', ...options })
}

/**
 * List object keys under `prefix` (ListObjectsV2, paginated via
 * continuation-token). Returns every key; throws with a safe cause on failure.
 */
export async function listR2Objects({
  accountId,
  endpoint,
  accessKey,
  secretKey,
  bucket,
  prefix = '',
}) {
  const keys = []
  let continuationToken = undefined
  for (;;) {
    const query = { 'list-type': '2', 'max-keys': '1000' }
    if (prefix) query.prefix = prefix
    if (continuationToken) query['continuation-token'] = continuationToken
    const { body } = await s3Get({
      accountId,
      endpoint,
      accessKey,
      secretKey,
      bucket,
      query,
    })
    for (const match of body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
      if (match[1].trim().length > 0) keys.push(match[1])
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(body)
    const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(body)
    if (!truncated || !next) break
    continuationToken = next[1]
  }
  return keys
}
