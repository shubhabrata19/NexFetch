import { TORRENT_PROFILE_PEER_LIMITS } from '@shared/ipc/contracts'
import type { TorrentConnectionProfile } from '@shared/ipc/contracts'

export function connectionProfileLabel(profile: TorrentConnectionProfile): string {
  return profile === 'balanced' ? 'Balanced' : profile === 'maximum' ? 'Maximum' : 'High'
}

export function profilePeerLimit(profile: TorrentConnectionProfile): number {
  return TORRENT_PROFILE_PEER_LIMITS[profile]
}

export function peerLimitDraft(value: number | null | undefined): string {
  return value !== null && value !== undefined && value > 0 ? String(value) : ''
}

export function parsePeerLimit(value: string): number | null | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const number = Number(trimmed)
  if (!Number.isInteger(number) || number < 1 || number > 1000) return undefined
  return number
}
