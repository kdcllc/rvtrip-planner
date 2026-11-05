// Password hashing with Node's built-in scrypt only (no third-party hashing dependency).
// Stored format (single self-describing string, fits nvarchar(255)):
//   scrypt$<N>$<r>$<p>$<salt base64>$<digest base64>
// Parameters live in the string, so they can be raised later without breaking existing users.
// This module never logs a password, digest or salt.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'scrypt'
const SCRYPT_N = 2 ** 17 // OWASP minimum for scrypt (N=2^17, r=8, p=1)
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16

type ScryptParams = { N: number; r: number; p: number }

function deriveKey(password: string, salt: Buffer, keyLength: number, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      keyLength,
      // Default maxmem (32 MiB) is exactly 128*N*r for N=2^15; raise it so N=2^17 does not throw.
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r },
      (err, derived) => (err ? reject(err) : resolve(derived)),
    )
  })
}

/** Hashes a password with a fresh random 16-byte salt; returns the self-describing string. */
export async function hash(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const digest = await deriveKey(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return [ALGORITHM, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), digest.toString('base64')].join('$')
}

type Parsed = { params: ScryptParams; salt: Buffer; digest: Buffer }

function parse(stored: string): Parsed | null {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return null
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null
  const salt = Buffer.from(parts[4], 'base64')
  const digest = Buffer.from(parts[5], 'base64')
  if (salt.length === 0 || digest.length === 0) return null
  return { params: { N, r, p }, salt, digest }
}

/** Verifies a password against a stored string; constant-time digest comparison. */
export async function verify(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (!parsed) return false
  const candidate = await deriveKey(password, parsed.salt, parsed.digest.length, parsed.params)
  return timingSafeEqual(candidate, parsed.digest)
}

let dummyHash: Promise<string> | undefined

/** Burns the same scrypt cost as a real verification (for unknown accounts); always false. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hash('dummy-password-for-timing-equalisation')
  await verify(password, await dummyHash)
  return false
}
