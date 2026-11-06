import { parseTorrentInfoHash } from './torrent-hash'

/** Maximum accepted magnet URI length before parsing is refused. */
export const MAX_MAGNET_LENGTH = 8192
/** Maximum number of trackers carried from a magnet URI into a metadata lookup. */
export const MAX_MAGNET_TRACKERS = 20
const MAX_TRACKER_LENGTH = 2048
const MAX_DISPLAY_NAME_LENGTH = 200

// Control characters must be removed from untrusted magnet display names.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g
const REPEATED_WHITESPACE = /\s+/g
const TRACKER_SCHEMES = new Set(['http:', 'https:', 'udp:'])

export interface ParsedTorrentSource {
  kind: 'hash' | 'magnet'
  /** Canonical lowercase hexadecimal representation. */
  infoHash: string
  version: 1 | 2
  /** Magnet display name (dn=). Display-only; never used as a path. */
  displayName: string | null
  /** Magnet trackers (tr=). The helper applies the deep network safety checks. */
  trackers: string[]
}

function cleanDisplayName(value: string | null): string | null {
  if (value === null) return null
  const cleaned = value.replace(CONTROL_CHARACTERS, ' ').replace(REPEATED_WHITESPACE, ' ').trim()
  if (cleaned.length === 0) return null
  return Array.from(cleaned).slice(0, MAX_DISPLAY_NAME_LENGTH).join('')
}

function cleanTrackers(values: string[]): string[] {
  const trackers: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const tracker = value.trim()
    if (tracker.length === 0 || tracker.length > MAX_TRACKER_LENGTH) continue
    if (seen.has(tracker)) continue
    try {
      const url = new URL(tracker)
      if (!TRACKER_SCHEMES.has(url.protocol)) continue
    } catch {
      continue
    }
    seen.add(tracker)
    trackers.push(tracker)
    if (trackers.length >= MAX_MAGNET_TRACKERS) break
  }

  return trackers
}

/**
 * Parses either a raw info hash (v1 hex/base32 or v2 hex) or a magnet URI.
 * Magnet URIs are parsed locally; the info hash is the only value forwarded to
 * the torrent helper. Trackers are scheme-filtered here and fully validated
 * (including private/local host rejection) inside the helper.
 */
export function parseTorrentSource(input: string): ParsedTorrentSource | null {
  const trimmed = input.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_MAGNET_LENGTH) return null

  if (!/^magnet:/i.test(trimmed)) {
    const parsed = parseTorrentInfoHash(trimmed)
    return parsed
      ? {
          kind: 'hash',
          infoHash: parsed.infoHash,
          version: parsed.version,
          displayName: null,
          trackers: [],
        }
      : null
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'magnet:') return null

  let hash: { infoHash: string; version: 1 | 2 } | null = null
  for (const xt of url.searchParams.getAll('xt')) {
    hash = parseTorrentInfoHash(xt)
    if (hash) break
  }
  if (!hash) return null

  return {
    kind: 'magnet',
    infoHash: hash.infoHash,
    version: hash.version,
    displayName: cleanDisplayName(url.searchParams.get('dn')),
    trackers: cleanTrackers(url.searchParams.getAll('tr')),
  }
}

export function isMagnetUri(input: string): boolean {
  return /^magnet:/i.test(input.trim())
}
