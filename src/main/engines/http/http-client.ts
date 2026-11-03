import { DomainError } from '@shared/domain/errors'
import { parseHttpUrl } from './http-url'

export interface HttpRequestOptions {
  method: 'HEAD' | 'GET'
  url: string
  signal: AbortSignal
  headers?: Record<string, string>
  timeoutMs?: number
  maxRedirects?: number
}

export interface HttpRequestResult {
  response: Response
  finalUrl: URL
  redirects: number
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Performs an HTTP request with a bounded, explicitly validated redirect
 * chain. Query strings stay out of logs and error messages.
 */
export async function requestFollowingRedirects(
  options: HttpRequestOptions,
): Promise<HttpRequestResult> {
  if (options.signal.aborted) {
    throw new DomainError('CANCELLED', 'The request was cancelled.')
  }

  const timeoutSignal =
    options.timeoutMs && options.timeoutMs > 0 ? AbortSignal.timeout(options.timeoutMs) : null
  const signal = timeoutSignal ? AbortSignal.any([options.signal, timeoutSignal]) : options.signal
  const maxRedirects = options.maxRedirects ?? 5

  let currentUrl = parseHttpUrl(options.url)
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let response: Response
    try {
      response = await fetch(currentUrl.href, {
        method: options.method,
        redirect: 'manual',
        signal,
        headers: {
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          'User-Agent': 'NexFetch/0.4',
          ...options.headers,
        },
      })
    } catch (error) {
      if (options.signal.aborted) {
        throw new DomainError('CANCELLED', 'The request was cancelled.')
      }
      if (isAbortError(error)) {
        throw new DomainError(
          'NETWORK_ERROR',
          'The server took too long to respond. Try again.',
          true,
        )
      }
      throw new DomainError(
        'NETWORK_ERROR',
        'The server could not be reached. Check the link and your connection.',
        true,
      )
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location')
      if (!location) {
        return { response, finalUrl: currentUrl, redirects }
      }
      if (redirects >= maxRedirects) {
        await cancelBody(response)
        throw new DomainError('NETWORK_ERROR', 'The link redirected too many times.')
      }

      await cancelBody(response)
      try {
        currentUrl = parseHttpUrl(new URL(location, currentUrl).href)
      } catch (error) {
        if (error instanceof DomainError) throw error
        throw new DomainError('INVALID_URL', 'The link redirected to an invalid address.')
      }
      continue
    }

    return { response, finalUrl: currentUrl, redirects }
  }

  throw new DomainError('NETWORK_ERROR', 'The link redirected too many times.')
}

export async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // A response that is already closed does not need cleanup.
  }
}

export function mapHttpStatus(status: number, retryAfter: string | null): DomainError {
  if (status === 401 || status === 403) {
    return new DomainError(
      'ACCESS_RESTRICTED',
      'The server refused access to this file. NexFetch does not bypass sign-ins or paywalls.',
    )
  }
  if (status === 404 || status === 410) {
    return new DomainError('NOT_FOUND', 'The file was not found at this address.')
  }
  if (status === 429) {
    const retryHint = retryAfter ? ` Try again in ${retryAfter} seconds.` : ''
    return new DomainError(
      'NETWORK_ERROR',
      `The server is rate limiting requests.${retryHint}`,
      true,
    )
  }
  if (status >= 500) {
    return new DomainError(
      'NETWORK_ERROR',
      'The server returned an error. Try again in a moment.',
      true,
    )
  }
  return new DomainError('NETWORK_ERROR', `The server returned HTTP ${status}.`, status >= 500)
}
