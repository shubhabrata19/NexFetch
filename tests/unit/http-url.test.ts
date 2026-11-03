import { describe, expect, it } from 'vitest'
import { parseContentDisposition } from '@main/engines/http/content-disposition'
import {
  displayUrl,
  parseHttpUrl,
  resolveHttpFilename,
  splitHttpFilename,
} from '@main/engines/http/http-url'

describe('HTTP URL handling', () => {
  it('accepts HTTP and HTTPS links and removes the fragment', () => {
    const url = parseHttpUrl('https://example.com/files/report.pdf#page=2')
    expect(url.href).toBe('https://example.com/files/report.pdf')
    expect(displayUrl(url)).toBe('https://example.com/files/report.pdf')
  })

  it('keeps query parameters out of the display URL', () => {
    const url = parseHttpUrl('https://example.com/file.zip?token=secret&user=1')
    expect(displayUrl(url)).toBe('https://example.com/file.zip')
    expect(url.searchParams.get('token')).toBe('secret')
  })

  it('rejects embedded credentials and non-HTTP schemes', () => {
    expect(() => parseHttpUrl('https://user:pass@example.com/file')).toThrow(
      /usernames or passwords/,
    )
    expect(() => parseHttpUrl('ftp://example.com/file')).toThrow(/Only HTTP/)
    expect(() => parseHttpUrl('file:///C:/secret.txt')).toThrow(/Only HTTP/)
  })

  it('parses quoted and RFC 5987 content disposition filenames', () => {
    expect(parseContentDisposition('attachment; filename="report final.pdf"')).toBe(
      'report final.pdf',
    )
    expect(parseContentDisposition("attachment; filename*=UTF-8''quarterly%20report.pdf")).toBe(
      'quarterly report.pdf',
    )
    expect(parseContentDisposition('inline')).toBeNull()
  })

  it('sanitizes traversal and derives an extension from the content type', () => {
    const resolved = resolveHttpFilename({
      url: new URL('https://example.com/download'),
      contentDispositionFilename: parseContentDisposition(
        'attachment; filename="../../quarterly report"',
      ),
      contentType: 'application/pdf',
    })
    expect(resolved.filename).toBe('quarterly report.pdf')
    expect(resolved.filenameBase).toBe('quarterly report')
    expect(resolved.extension).toBe('.pdf')
  })

  it('splits an existing filename without trusting its extension', () => {
    const resolved = splitHttpFilename('movie.MKV')
    expect(resolved.filename).toBe('movie.mkv')
    expect(resolved.filenameBase).toBe('movie')
    expect(resolved.extension).toBe('.mkv')
  })
})
