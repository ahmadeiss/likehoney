/**
 * Password hashing (PBKDF2-SHA256 via the Web Crypto API).
 *
 * Chosen for Cloudflare Workers compatibility: it uses the platform-native
 * `crypto.subtle` implementation, requires no native add-ons, and works
 * identically in `wrangler dev` and on the deployed edge. The stored value is
 * a self-describing string so iteration count and salt can evolve without a
 * schema change:
 *
 *   pbkdf2$<iterations>$<saltB64>$<hashB64>
 *
 * Salts are 16 random bytes per staff member; the hash is 32 bytes (SHA-256
 *  output). Verification is constant-time via timingSafeEqual.
 *
 *  Iteration count: Cloudflare Workers' PBKDF2 implementation caps iterations
 *  at 100000 and throws `NotSupportedError` above that. New hashes are minted
 *  at exactly 100000. Verification still reads each stored hash's own iteration
 *  count (the format is self-describing), so a higher-count hash created on
 *  another runtime fails closed as a handled ServiceError with a clear message
 *  instead of an unhandled platform exception — and should be rotated via the
 *  production reset script.
 */
import { ServiceError } from '@likehoney/shared'

const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BYTES = 32
const PREFIX = 'pbkdf2'

const encoder = new TextEncoder()

const subtle = () => crypto.subtle

function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]!)
  return btoa(binary)
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

function isNotSupportedError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'NotSupportedError'
  )
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await subtle().importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  let bits: ArrayBuffer
  try {
    bits = await subtle().deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
      keyMaterial,
      KEY_BYTES * 8,
    )
  } catch (err) {
    // Cloudflare Workers refuses PBKDF2 iteration counts above 100000. A stored
    // hash minted on a different runtime may exceed that; surface it as the same
    // handled, machine-coded ServiceError instead of an unhandled 500.
    if (isNotSupportedError(err)) {
      throw new ServiceError(
        500,
        'invalid_password_hash',
        'stored password hash uses a PBKDF2 iteration count not supported by this runtime',
      )
    }
    throw err
  }
  return new Uint8Array(bits)
}

/** Hashes a password for storage. Never returns the raw password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, PBKDF2_ITERATIONS)
  return `${PREFIX}$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`
}

/** Verifies a candidate password against a stored hash. Throws on malformed stores. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new ServiceError(500, 'invalid_password_hash', 'stored password hash is malformed')
  }
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new ServiceError(500, 'invalid_password_hash', 'stored password hash is malformed')
  }
  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = b64ToBytes(parts[2]!)
    expected = b64ToBytes(parts[3]!)
  } catch {
    throw new ServiceError(500, 'invalid_password_hash', 'stored password hash is malformed')
  }
  const actual = await derive(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}
