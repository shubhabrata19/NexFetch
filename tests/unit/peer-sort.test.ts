import { describe, expect, it } from 'vitest'
import type { TorrentPeerEntry } from '@shared/domain/torrent'
import { cleanPeerClientName, sortPeers } from '@renderer/features/torrent/peer-sort'

const peers: TorrentPeerEntry[] = [
  {
    address: '10.0.0.10:6881',
    client: 'Client B',
    progress: 0.5,
    downloadRateBytesPerSecond: 100,
    uploadRateBytesPerSecond: 10,
    seed: false,
    flags: '',
  },
  {
    address: '10.0.0.2:6881',
    client: 'Client A',
    progress: 1,
    downloadRateBytesPerSecond: 300,
    uploadRateBytesPerSecond: 20,
    seed: true,
    flags: '',
  },
  {
    address: '10.0.0.1:6881',
    client: 'Client C',
    progress: 0.75,
    downloadRateBytesPerSecond: 200,
    uploadRateBytesPerSecond: 30,
    seed: false,
    flags: '',
  },
]

describe('peer sorting', () => {
  it('sorts addresses numerically', () => {
    expect(sortPeers(peers, 'address', 'asc').map((peer) => peer.address)).toEqual([
      '10.0.0.1:6881',
      '10.0.0.2:6881',
      '10.0.0.10:6881',
    ])
  })

  it('sorts clients alphabetically', () => {
    expect(sortPeers(peers, 'client', 'asc').map((peer) => peer.client)).toEqual([
      'Client A',
      'Client B',
      'Client C',
    ])
  })

  it('sorts numeric columns in both directions', () => {
    expect(
      sortPeers(peers, 'download', 'desc').map((peer) => peer.downloadRateBytesPerSecond),
    ).toEqual([300, 200, 100])
    expect(sortPeers(peers, 'progress', 'asc').map((peer) => peer.progress)).toEqual([0.5, 0.75, 1])
    expect(sortPeers(peers, 'upload', 'desc').map((peer) => peer.uploadRateBytesPerSecond)).toEqual(
      [30, 20, 10],
    )
  })

  it('sorts seeds first when type is ascending', () => {
    expect(sortPeers(peers, 'type', 'asc')[0]?.seed).toBe(true)
  })

  it('uses address as a stable tie breaker', () => {
    const tied = peers.map((peer) => ({ ...peer, downloadRateBytesPerSecond: 100 }))
    expect(sortPeers(tied, 'download', 'desc').map((peer) => peer.address)).toEqual([
      '10.0.0.1:6881',
      '10.0.0.2:6881',
      '10.0.0.10:6881',
    ])
  })

  it('does not mutate the source list', () => {
    const original = [...peers]
    sortPeers(peers, 'download', 'desc')
    expect(peers).toEqual(original)
  })

  it('cleans old byte-string client names', () => {
    expect(cleanPeerClientName("b'qBittorrent/5.1.4'")).toBe('qBittorrent/5.1.4')
    expect(cleanPeerClientName("b'\\xce\\xbcTorrent 3.6'")).toBe('Torrent 3.6')
    expect(cleanPeerClientName('')).toBe('Unknown')
  })
})
