export type ErrorCode =
  | 'INVALID_URL'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_SOURCE'
  | 'DEPENDENCY_MISSING'
  | 'ACCESS_RESTRICTED'
  | 'VIDEO_UNAVAILABLE'
  | 'FORMAT_UNAVAILABLE'
  | 'EXTRACTOR_ERROR'
  | 'PREVIEW_EXPIRED'
  | 'VERIFICATION_FAILED'
  | 'NETWORK_ERROR'
  | 'DISK_FULL'
  | 'PERMISSION_DENIED'
  | 'PROCESSING_FAILED'
  | 'FINALIZE_FAILED'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN'

export interface AppError {
  code: ErrorCode
  message: string
  retryable: boolean
  diagnosticId: string
}

export class DomainError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean

  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.retryable = retryable
  }
}
