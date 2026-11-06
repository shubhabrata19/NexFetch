import { describe, expect, it } from 'vitest'
import {
  MAX_MAGNET_LENGTH,
  MAX_MAGNET_TRACKERS,
  isMagnetUri,
  parseTorrentSource,
} from '@shared/domain/torrent-magnet'

const V1_HEX = '08ada5a7a6183aae1e09d831df6748d566095a10'
const V1_BASE32 = 'BCW2LJ5GDA5K4HQJ3AY56Z2I2VTASWQQ'
const V2_HEX = 'a'.repeat(64)

function magnet(params: Array<[string, string]>): string {
  const query = new URLSearchParams()
  for (const [key, value] of params) query.append(key, value)
  return `magnet:?${query.toString()}`
}

describe('parseTorrentSource', () => {
  it('parses a v1 magnet link with display name and trackers', () => {
    expect(
      parseTorrentSource(
        magnet([
          ['xt', `urn:btih:${V1_HEX}`],
          ['dn', 'Big Buck Bunny (2008)'],
          ['tr', 'https://tracker.example.com/announce'],
          ['tr', 'udp://tracker.example.net:80'],
        ]),
      ),
    ).toEqual({
      kind: 'magnet',
      infoHash: V1_HEX,
      version: 1,
      displayName: 'Big Buck Bunny (2008)',
      trackers: ['https://tracker.example.com/announce', 'udp://tracker.example.net:80'],
    })
  })

  it('parses base32 v1 and multihash v2 magnet hashes', () => {
    expect(parseTorrentSource(magnet([['xt', `urn:btih:${V1_BASE32}`]]))).toMatchObject({
      infoHash: V1_HEX,
      version: 1,
      kind: 'magnet',
    })
    expect(parseTorrentSource(magnet([['xt', `urn:btmh:1220${V2_HEX}`]]))).toMatchObject({
      infoHash: V2_HEX,
      version: 2,
      kind: 'magnet',
    })
  })

  it('uses the first valid xt value when several are present', () => {
    const source = magnet([
      ['xt', 'urn:btih:not-a-hash'],
      ['xt', `urn:btih:${V1_HEX}`],
    ])
    expect(parseTorrentSource(source)).toMatchObject({ infoHash: V1_HEX, version: 1 })
  })

  it('rejects magnets without a usable info hash', () => {
    expect(parseTorrentSource(magnet([['dn', 'No hash']]))).toBeNull()
    expect(parseTorrentSource(magnet([['xt', 'urn:btih:abc']]))).toBeNull()
    expect(parseTorrentSource(magnet([['xt', `urn:btih:${'0'.repeat(40)}`]]))).toBeNull()
    expect(parseTorrentSource('magnet:not a url')).toBeNull()
  })

  it('accepts plain hashes as before and reports the hash kind', () => {
    expect(parseTorrentSource(V1_HEX)).toEqual({
      kind: 'hash',
      infoHash: V1_HEX,
      version: 1,
      displayName: null,
      trackers: [],
    })
  })

  it('normalizes display names and strips control characters', () => {
    expect(
      parseTorrentSource(
        magnet([
          ['xt', `urn:btih:${V1_HEX}`],
          ['dn', '  Big\u0000  Bunny  '],
        ]),
      )?.displayName,
    ).toBe('Big Bunny')
    expect(
      parseTorrentSource(
        magnet([
          ['xt', `urn:btih:${V1_HEX}`],
          ['dn', 'x'.repeat(300)],
        ]),
      )?.displayName,
    ).toHaveLength(200)
  })

  it('keeps only supported tracker schemes, deduplicates, and caps the list', () => {
    const trackers = Array.from(
      { length: MAX_MAGNET_TRACKERS + 5 },
      (_value, index) => `https://tracker${index}.example.com/announce`,
    )
    const parsed = parseTorrentSource(
      magnet([
        ['xt', `urn:btih:${V1_HEX}`],
        ['tr', 'wss://unsupported.example.com'],
        ['tr', 'not a url'],
        ['tr', trackers[0] as string],
        ['tr', trackers[0] as string],
        ...trackers.map((tracker): [string, string] => ['tr', tracker]),
      ]),
    )
    expect(parsed?.trackers).toHaveLength(MAX_MAGNET_TRACKERS)
    expect(parsed?.trackers[0]).toBe(trackers[0])
    expect(parsed?.trackers).not.toContain('wss://unsupported.example.com')
  })

  it('rejects excessively long input', () => {
    expect(
      parseTorrentSource(`magnet:?xt=urn:btih:${V1_HEX}&dn=${'a'.repeat(MAX_MAGNET_LENGTH)}`),
    ).toBeNull()
  })

  it('identifies magnet input', () => {
    expect(isMagnetUri(`MAGNET:?xt=urn:btih:${V1_HEX}`)).toBe(true)
    expect(isMagnetUri(V1_HEX)).toBe(false)
  })
})
