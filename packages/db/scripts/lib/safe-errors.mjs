/**
 * Safe, cause-aware error reporting.
 *
 * Node's `fetch` rejects with a bare `TypeError: fetch failed` and buries the
 * real transport cause (ECONNRESET / ENOTFOUND / ETIMEDOUT, HTTP status, S3 or
 * Neon error codes) one or more `.cause` levels deep. Every boundary of the
 * production catalog tool that can fail over the network routes its errors
 * through these helpers so the DIAGNOSABLE cause is surfaced without ever
 * leaking credentials, connection strings, tokens or keys.
 */

const URL_WITH_CREDENTIALS_RE = /(postgres(?:ql)?:\/\/)[^\s/@]+@/gi
const PASSWORD_PARAM_RE = /(password=)([^&\s"]+)/gi

/** Replace every known secret occurrence (and credential-shaped patterns). */
export function redactSecrets(text, secrets = []) {
  let out = String(text)
  for (const secret of secrets) {
    if (secret && String(secret).length >= 4) {
      out = out.split(String(secret)).join('***')
    }
  }
  out = out.replace(URL_WITH_CREDENTIALS_RE, '$1***:***@')
  out = out.replace(PASSWORD_PARAM_RE, '$1***')
  return out
}

/**
 * Walk the `err.cause` chain (deduplicated, cycles-safe) and return one
 * descriptor per level: constructor name, redacted message, and the typed
 * tags (code / HTTP status / errno / syscall) we want in logs.
 */
export function findErrorCauses(error) {
  const levels = []
  const seen = new Set()
  let cursor = error
  while (cursor && typeof cursor === 'object' && !seen.has(cursor)) {
    seen.add(cursor)
    const tags = []
    if (cursor.code !== undefined && cursor.code !== null) tags.push(`code=${cursor.code}`)
    if (typeof cursor.status === 'number') tags.push(`HTTP ${cursor.status}`)
    if (cursor.response != null && typeof cursor.response.status === 'number') {
      tags.push(`HTTP ${cursor.response.status}`)
    }
    if (cursor.errno !== undefined && cursor.errno !== null) tags.push(`errno=${cursor.errno}`)
    if (cursor.syscall) tags.push(`syscall=${cursor.syscall}`)
    const name = cursor.name ?? (cursor.constructor ? cursor.constructor.name : 'Error')
    levels.push({ name, message: cursor.message, tags })
    cursor = cursor.cause
  }
  return levels
}

/**
 * Human line per cause level. `secrets` (connection strings, keys) are
 * redacted from every message. Output is safe to print and to persist.
 */
export function safeCauseReport(error, secrets = []) {
  return findErrorCauses(error).map((level) => {
    const base = `${level.name}: ${redactSecrets(level.message, secrets)}`
    return level.tags.length > 0 ? `${base} (${level.tags.join(', ')})` : base
  })
}

/** True when the chain smells like a transport-layer fetch failure. */
export function isFetchFailure(error) {
  const scan = [error]
  const seen = new Set()
  while (scan.length > 0) {
    const cursor = scan.shift()
    if (!cursor || typeof cursor !== 'object' || seen.has(cursor)) continue
    seen.add(cursor)
    if (/fetch failed/i.test(String(cursor.message ?? ''))) return true
    if (
      /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR/.test(
        String(cursor.code ?? ''),
      )
    )
      return true
    if (cursor.cause) scan.push(cursor.cause)
  }
  return false
}

/** Extract the first safe transport code (e.g. ENOTFOUND) or HTTP status. */
export function firstDiagnosticCode(error) {
  for (const level of findErrorCauses(error)) {
    const codeTag = level.tags.find((tag) => /^code=[A-Z_]+$/.test(tag))
    if (codeTag) return codeTag.slice('code='.length)
    const statusTag = level.tags.find((tag) => /^HTTP \d/.test(tag))
    if (statusTag) return statusTag
  }
  return undefined
}
