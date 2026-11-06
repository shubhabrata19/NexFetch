import type { TorrentPeerEntry } from '@shared/domain/torrent'

export type PeerSortKey = 'address' | 'client' | 'progress' | 'download' | 'upload' | 'type'
export type PeerSortDirection = 'asc' | 'desc'

export function cleanPeerClientName(value: string): string {
  let text = value
  if (text.startsWith("b'") && text.endsWith("'")) text = text.slice(2, -1)
  text = text.replace(/\\x[0-9a-fA-F]{2}/g, '')
  text = [...text].filter((character) => character >= ' ' && character !== '\x7f').join('')
  return text.trim() || 'Unknown'
}

function compareAddress(a: TorrentPeerEntry, b: TorrentPeerEntry): number {
  return a.address.localeCompare(b.address, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function comparePeers(a: TorrentPeerEntry, b: TorrentPeerEntry, key: PeerSortKey): number {
  switch (key) {
    case 'address':
      return compareAddress(a, b)
    case 'client':
      return cleanPeerClientName(a.client).localeCompare(cleanPeerClientName(b.client), undefined, {
        sensitivity: 'base',
      })
    case 'progress':
      return a.progress - b.progress
    case 'download':
      return a.downloadRateBytesPerSecond - b.downloadRateBytesPerSecond
    case 'upload':
      return a.uploadRateBytesPerSecond - b.uploadRateBytesPerSecond
    case 'type':
      return a.seed === b.seed ? 0 : a.seed ? -1 : 1
  }
}

export function sortPeers(
  peers: TorrentPeerEntry[],
  key: PeerSortKey,
  direction: PeerSortDirection,
): TorrentPeerEntry[] {
  const sorted = [...peers].sort((a, b) => {
    const result = comparePeers(a, b, key)
    if (result !== 0) return direction === 'asc' ? result : -result
    return compareAddress(a, b)
  })
  return sorted
}
