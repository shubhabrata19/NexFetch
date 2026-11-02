import { describe, expect, it } from 'vitest'
import { addConflictSuffix, sanitizeFilenameBase } from '@shared/security/filename'

describe('filename sanitization', () => {
  it('removes path separators and reserved characters', () => {
    expect(sanitizeFilenameBase('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j')
  })

  it('trims trailing dots and spaces', () => {
    expect(sanitizeFilenameBase('  hello...   ')).toBe('hello')
  })

  it('protects Windows reserved names', () => {
    expect(sanitizeFilenameBase('CON')).toBe('_CON')
    expect(sanitizeFilenameBase('con.txt')).toBe('_con.txt')
    expect(sanitizeFilenameBase('LPT1')).toBe('_LPT1')
  })

  it('falls back for empty or dot-only names', () => {
    expect(sanitizeFilenameBase('')).toBe('download')
    expect(sanitizeFilenameBase('...')).toBe('download')
    expect(sanitizeFilenameBase('   ')).toBe('download')
  })

  it('removes control characters', () => {
    expect(sanitizeFilenameBase('hello\u0000\u001fworld')).toBe('hello world')
  })

  it('limits very long names without splitting surrogate pairs', () => {
    const result = sanitizeFilenameBase('😀'.repeat(200))
    expect(Array.from(result)).toHaveLength(120)
  })

  it('preserves normal Unicode text', () => {
    expect(sanitizeFilenameBase('日本語 — café')).toBe('日本語 — café')
  })

  it('adds conflict suffixes only after the first collision', () => {
    expect(addConflictSuffix('video', 0)).toBe('video')
    expect(addConflictSuffix('video', 1)).toBe('video (1)')
    expect(addConflictSuffix('video', 2)).toBe('video (2)')
  })
})
