const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

// Control characters must be removed from filenames even though they are unusual in source.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g
const RESERVED_CHARACTERS = /[<>:"/\\|?*]/g
const TRAILING_DOTS_AND_SPACES = /[. ]+$/g
const REPEATED_WHITESPACE = /\s+/g

/**
 * Produces a display-safe, cross-platform file base name. It deliberately does
 * not include an extension; the caller appends the verified output extension.
 */
export function sanitizeFilenameBase(input: string, fallback = 'download'): string {
  const normalized = input.normalize('NFKC')
  let name = normalized
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(RESERVED_CHARACTERS, ' ')
    .replace(REPEATED_WHITESPACE, ' ')
    .trim()
    .replace(TRAILING_DOTS_AND_SPACES, '')

  if (name.length === 0 || name === '.' || name === '..') {
    name = fallback
  }

  if (WINDOWS_RESERVED_NAMES.test(name)) {
    name = `_${name}`
  }

  const codePoints = Array.from(name)
  if (codePoints.length > 120) {
    name = codePoints.slice(0, 120).join('').trim().replace(TRAILING_DOTS_AND_SPACES, '')
  }

  return name.length > 0 ? name : fallback
}

export function addConflictSuffix(base: string, index: number): string {
  return index <= 0 ? base : `${base} (${index})`
}
