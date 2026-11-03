export interface ParsedTorrentInfoHash {
  /** Canonical lowercase hexadecimal representation. */
  infoHash: string
  version: 1 | 2
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function decodeBase32(value: string): string | null {
  const normalized = value.toUpperCase().replace(/=+$/, '')
  if (normalized.length !== 32) return null

  let bits = 0
  let accumulator = 0
  const bytes: number[] = []

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index === -1) return null
    accumulator = (accumulator << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >>> bits) & 0xff)
    }
  }

  if (bytes.length !== 20) return null
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Accepts the tamper-evident forms the UI supports:
 *  - 40 hex characters (BitTorrent v1)
 *  - 32 base32 characters (BitTorrent v1)
 *  - 64 hex characters (BitTorrent v2)
 *  - optional urn:btih: / urn:btmh: prefixes
 *
 * Magnet links are intentionally not accepted here. The UI resolves an info
 * hash through DHT and never exposes magnet input.
 */
export function parseTorrentInfoHash(input: string): ParsedTorrentInfoHash | null {
  let value = input.trim()
  if (value.length === 0) return null

  if (/^magnet:/i.test(value)) return null

  value = value.replace(/^urn:btih:/i, '').replace(/^urn:btmh:/i, '')

  if (/^[0-9a-fA-F]{40}$/.test(value)) {
    const infoHash = value.toLowerCase()
    if (/^0+$/.test(infoHash)) return null
    return { infoHash, version: 1 }
  }

  if (/^[A-Za-z2-7]{32}$/.test(value)) {
    const infoHash = decodeBase32(value)
    if (!infoHash || /^0+$/.test(infoHash)) return null
    return { infoHash, version: 1 }
  }

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    const infoHash = value.toLowerCase()
    if (/^0+$/.test(infoHash)) return null
    return { infoHash, version: 2 }
  }

  // Multihash-prefixed v2 form: urn:btmh:1220<64 hex>.
  const multihash = value.match(/^1220([0-9a-fA-F]{64})$/i)
  if (multihash?.[1]) {
    const infoHash = multihash[1].toLowerCase()
    if (/^0+$/.test(infoHash)) return null
    return { infoHash, version: 2 }
  }

  return null
}
