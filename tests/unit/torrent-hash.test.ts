import { describe, expect, it } from 'vitest'
import { parseTorrentInfoHash } from '@shared/domain/torrent-hash'

const V1_HEX = '08ada5a7a6183aae1e09d831df6748d566095a10'
const V1_BASE32 = 'BCW2LJ5GDA5K4HQJ3AY56Z2I2VTASWQQ'
const V2_HEX = 'a'.repeat(64)

describe('parseTorrentInfoHash', () => {
  it('accepts a v1 hexadecimal hash', () => {
    expect(parseTorrentInfoHash(V1_HEX)).toEqual({ infoHash: V1_HEX, version: 1 })
    expect(parseTorrentInfoHash(V1_HEX.toUpperCase())).toEqual({
      infoHash: V1_HEX,
      version: 1,
    })
  })

  it('accepts base32 v1 hashes', () => {
    expect(parseTorrentInfoHash(V1_BASE32)).toEqual({ infoHash: V1_HEX, version: 1 })
  })

  it('accepts urn prefixed v1 and v2 hashes', () => {
    expect(parseTorrentInfoHash(`urn:btih:${V1_HEX}`)).toEqual({
      infoHash: V1_HEX,
      version: 1,
    })
    expect(parseTorrentInfoHash(`urn:btmh:${V2_HEX}`)).toEqual({
      infoHash: V2_HEX,
      version: 2,
    })
    expect(parseTorrentInfoHash(`urn:btmh:1220${V2_HEX}`)).toEqual({
      infoHash: V2_HEX,
      version: 2,
    })
  })

  it('rejects magnet links and malformed values', () => {
    expect(parseTorrentInfoHash(`magnet:?xt=urn:btih:${V1_HEX}`)).toBeNull()
    expect(parseTorrentInfoHash('hello')).toBeNull()
    expect(parseTorrentInfoHash('0'.repeat(40))).toBeNull()
    expect(parseTorrentInfoHash('a'.repeat(41))).toBeNull()
  })
})
