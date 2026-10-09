// personal_info columns stored AES-256-GCM encrypted at rest.
// Encrypt with encryptFields() before every write; decrypt with decryptFields() server-side only.
export const ENCRYPTED_PERSONAL_FIELDS = [
  'date_of_birth',
  'phone',
  'street',
  'city',
  'postal_code',
  'emergency_name',
  'emergency_phone',
] as const

export type EncryptedPersonalField = typeof ENCRYPTED_PERSONAL_FIELDS[number]
