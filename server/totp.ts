import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** RFC 6238 TOTP：30 秒一个码，6 位，HMAC-SHA1，兼容 Google Authenticator / 微软验证器等 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

function codeAt(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', secret).update(msg).digest()
  const offset = hmac[hmac.length - 1]! & 0xf
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!
  return String(bin % 1_000_000).padStart(6, '0')
}

/** 允许前后各偏一个周期，容忍手机时间略有误差 */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): boolean {
  const clean = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  const secret = base32Decode(secretB32)
  const counter = Math.floor(now / 1000 / 30)
  for (let d = -1; d <= 1; d++) {
    const expected = Buffer.from(codeAt(secret, counter + d))
    if (timingSafeEqual(expected, Buffer.from(clean))) return true
  }
  return false
}

export function totpUri(secret: string, account: string, issuer = 'Ginkgo Notes'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
