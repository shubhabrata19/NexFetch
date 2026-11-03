/**
 * Extracts a filename from Content-Disposition without trusting the value.
 * Supports the RFC 5987 filename* form and the common quoted form.
 */
export function parseContentDisposition(value: string | null | undefined): string | null {
  if (!value) return null

  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(value)
  if (extended?.[2]) {
    const encoded = extended[2].trim().replace(/^"|"$/g, '')
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }

  const quoted = /filename\s*=\s*"((?:\\.|[^"])*)"/i.exec(value)
  if (quoted?.[1]) {
    return quoted[1].replace(/\\(["\\])/g, '$1')
  }

  const plain = /filename\s*=\s*([^;]+)/i.exec(value)
  if (plain?.[1]) {
    return plain[1].trim().replace(/^"|"$/g, '')
  }

  return null
}
