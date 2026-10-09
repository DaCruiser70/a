import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { ENCRYPTED_PERSONAL_FIELDS, type EncryptedPersonalField } from './personal-fields'

const ALGORITHM = 'aes-256-gcm'
const KEY_HEX   = process.env.ENCRYPTION_KEY! // 64-char hex = 32 bytes

function getKey() {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(KEY_HEX, 'hex')
}

export function encrypt(plaintext: string): string {
  const iv     = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  // Format: iv(24):tag(32):ciphertext(hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  const iv      = Buffer.from(ivHex, 'hex')
  const tag     = Buffer.from(tagHex, 'hex')
  const enc     = Buffer.from(encHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(tag)
  return decipher.update(enc).toString('utf8') + decipher.final('utf8')
}

// Matches the encrypt() output format: iv(24 hex):tag(32 hex):ciphertext(hex)
const ENCRYPTED_FORMAT = /^[0-9a-f]{24}:[0-9a-f]{32}:(?:[0-9a-f]{2})+$/

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && ENCRYPTED_FORMAT.test(value)
}

export type DecryptedRow<T> = {
  [K in keyof T]: K extends EncryptedPersonalField ? T[K] | null : T[K]
}

// Encrypts the ENCRYPTED_PERSONAL_FIELDS present on the row. Null, undefined and empty values are left alone.
export function encryptFields<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row }
  for (const field of ENCRYPTED_PERSONAL_FIELDS) {
    const value = out[field]
    if (typeof value === 'string' && value !== '') out[field] = encrypt(value)
  }
  return out as T
}

// Decrypts the ENCRYPTED_PERSONAL_FIELDS present on the row. Values not in the encrypted
// format (rows not yet migrated) are returned unchanged. A field that fails to decrypt
// becomes null; only the field name is logged, never the value.
export function decryptFields<T extends Record<string, unknown>>(row: T): DecryptedRow<T> {
  const out: Record<string, unknown> = { ...row }
  for (const field of ENCRYPTED_PERSONAL_FIELDS) {
    const value = out[field]
    if (!isEncrypted(value)) continue
    try {
      out[field] = decrypt(value)
    } catch {
      console.error(`decryptFields: failed to decrypt field "${field}"`)
      out[field] = null
    }
  }
  return out as DecryptedRow<T>
}
