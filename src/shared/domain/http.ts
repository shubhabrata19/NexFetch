export interface HttpChecksum {
  algorithm: 'sha256'
  /** Lowercase or uppercase hexadecimal SHA-256 digest. */
  expectedHex: string
}

export interface HttpPreview {
  /** Host and path only. The full URL stays in the preview token. */
  displayUrl: string
  host: string
  /** Suggested filename including extension. */
  filename: string
  contentType: string | null
  contentLength: number | null
  acceptRanges: boolean
  etag: string | null
  lastModified: string | null
  resumable: boolean
}

export interface HttpPreviewEnvelope extends HttpPreview {
  engineId: 'http'
  previewToken: string
  expiresAt: string
}

export type HttpSelection = {
  checksum?: HttpChecksum
}

export interface HttpResolvedSelection {
  /** Full URL used for the transfer. */
  url: string
  displayUrl: string
  host: string
  filename: string
  filenameBase: string
  extension: string
  contentType: string | null
  contentLength: number | null
  acceptRanges: boolean
  etag: string | null
  lastModified: string | null
  checksum: HttpChecksum | null
}
