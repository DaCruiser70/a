// HMAC helpers keyed by AUTH_SIGNING_SECRET. Web Crypto only, so this runs in both
// the Node runtime (API routes) and the edge runtime (middleware).

const encoder = new TextEncoder()

let keyPromise: Promise<CryptoKey> | null = null

function getSecretBytes(): Uint8Array<ArrayBuffer> {
  const hex = process.env.AUTH_SIGNING_SECRET
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('AUTH_SIGNING_SECRET must be a 64-character hex string (32 bytes)')
  }
  return hexToBytes(hex)!
}

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'raw',
      getSecretBytes(),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    )
    // A failed import must not be cached
    keyPromise.catch(() => { keyPromise = null })
  }
  return keyPromise
}

// The domain separates uses of the one secret, so a MAC made for one purpose never verifies for another
function domainMessage(domain: string, data: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${domain}\u0000${data}`)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export async function hmacHex(domain: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await getKey(), domainMessage(domain, data))
  return bytesToHex(new Uint8Array(sig))
}

// Constant-time check of a hex MAC produced by hmacHex
export async function hmacVerifyHex(domain: string, data: string, signatureHex: string): Promise<boolean> {
  const sig = hexToBytes(signatureHex)
  if (!sig || sig.length !== 32) return false
  return crypto.subtle.verify('HMAC', await getKey(), sig, domainMessage(domain, data))
}
