import { describe, expect, it } from 'vitest'
import { convertRateDraft, rateDraftFromBytes, rateDraftToBytes } from '@renderer/lib/rate-limit'
import {
  connectionProfileLabel,
  parsePeerLimit,
  peerLimitDraft,
  profilePeerLimit,
} from '@renderer/lib/torrent-limits'

describe('rate limit drafts', () => {
  it('formats byte rates into sensible units', () => {
    expect(rateDraftFromBytes(1.5 * 1024 * 1024)).toEqual({ value: '1.5', unit: 'MB' })
    expect(rateDraftFromBytes(300 * 1024)).toEqual({ value: '300', unit: 'KB' })
    expect(rateDraftFromBytes(null)).toEqual({ value: '', unit: 'MB' })
  })

  it('parses blank as inherit and zero as unlimited', () => {
    expect(rateDraftToBytes({ value: '', unit: 'MB' })).toBeNull()
    expect(rateDraftToBytes({ value: '0', unit: 'MB' })).toBe(0)
    expect(rateDraftToBytes({ value: '-1', unit: 'MB' })).toBeUndefined()
    expect(rateDraftToBytes({ value: '1.5', unit: 'MB' })).toBe(1_572_864)
  })

  it('converts between units without changing the rate', () => {
    const converted = convertRateDraft({ value: '1', unit: 'MB' }, 'KB')
    expect(converted).toEqual({ value: '1024', unit: 'KB' })
  })
})

describe('per-torrent peer limits', () => {
  it('uses the connection profile defaults', () => {
    expect(profilePeerLimit('balanced')).toBe(50)
    expect(profilePeerLimit('high')).toBe(100)
    expect(profilePeerLimit('maximum')).toBe(200)
    expect(connectionProfileLabel('high')).toBe('High')
  })

  it('parses blank as inherit and validates the range', () => {
    expect(parsePeerLimit('')).toBeNull()
    expect(parsePeerLimit('  ')).toBeNull()
    expect(parsePeerLimit('100')).toBe(100)
    expect(parsePeerLimit('0')).toBeUndefined()
    expect(parsePeerLimit('1001')).toBeUndefined()
    expect(parsePeerLimit('1.5')).toBeUndefined()
  })

  it('formats an override for the input', () => {
    expect(peerLimitDraft(100)).toBe('100')
    expect(peerLimitDraft(null)).toBe('')
    expect(peerLimitDraft(undefined)).toBe('')
  })
})
