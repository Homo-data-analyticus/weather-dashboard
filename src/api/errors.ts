/**
 * One error type per thing that can actually go wrong, because the UI needs to
 * say different things and the retry policy needs to make different decisions.
 */

export class ApiError extends Error {
  readonly status: number
  readonly url: string
  /** Explanation from the response body, when the service bothered to send one. */
  readonly reason?: string

  constructor(message: string, status: number, url: string, reason?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.url = url
    this.reason = reason
  }

  /** 4xx (except 429) means we sent something wrong. Retrying won't fix it. */
  get isClient() {
    return this.status >= 400 && this.status < 500 && this.status !== 429
  }
}

export class RateLimitError extends ApiError {
  /** Seconds to wait, parsed from Retry-After. Undefined if not sent. */
  readonly retryAfter?: number

  constructor(url: string, retryAfter?: number) {
    super('Rate limited by the weather service', 429, url)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

export class TimeoutError extends Error {
  readonly url: string
  readonly ms: number

  constructor(url: string, ms: number) {
    super(`Request timed out after ${ms}ms`)
    this.name = 'TimeoutError'
    this.url = url
    this.ms = ms
  }
}

/**
 * HTTP 200, `content-type: application/json`, and a body that isn't JSON.
 * Not hypothetical: Open-Meteo answers exactly this way when one of its
 * upstream variables is down. Whose fault it is matters — this is retryable.
 */
export class ParseError extends Error {
  readonly url: string
  readonly snippet: string

  constructor(url: string, snippet: string) {
    super('Response was not valid JSON')
    this.name = 'ParseError'
    this.url = url
    this.snippet = snippet
  }
}

/**
 * HTTP 200 with a perfectly valid JSON body that says the request failed:
 * `{"error": true, "reason": "The service is overloaded"}`. Open-Meteo really
 * does this. `response.ok` is true, JSON.parse succeeds, and the data is
 * garbage, so the check has to be explicit or it silently reaches the UI.
 */
export class UpstreamError extends Error {
  readonly url: string
  readonly reason: string
  constructor(url: string, reason: string) {
    super(reason)
    this.name = 'UpstreamError'
    this.url = url
    this.reason = reason
  }
}
export class NetworkError extends Error {
  readonly url: string

  constructor(url: string, cause?: unknown) {
    super('Could not reach the weather service', { cause })
    this.name = 'NetworkError'
    this.url = url
  }
}

/** Human-facing copy. Kept next to the error types so they can't drift apart. */
export function describeError(error: unknown): {
  title: string
  detail: string
  retryable: boolean
} {
  if (error instanceof RateLimitError) {
    return {
      title: 'Too many requests',
      detail: error.retryAfter
        ? `Open-Meteo is rate limiting us. Try again in about ${error.retryAfter}s.`
        : 'Open-Meteo is rate limiting us. Give it a moment.',
      retryable: true,
    }
  }
  if (error instanceof TimeoutError) {
    return {
      title: 'The request took too long',
      detail: `No response after ${Math.round(error.ms / 1000)}s. The service may be slow right now.`,
      retryable: true,
    }
  }
  if (error instanceof NetworkError) {
    return {
      title: "Can't reach the weather service",
      detail: 'Check your connection â€” the request never left the building.',
      retryable: true,
    }
  }
  if (error instanceof UpstreamError) {
    return {
      title: 'The weather service is busy',
      detail: `It answered 200 OK but reported: "${error.reason}". Worth another try in a moment.`,
      retryable: true,
    }
  }
  if (error instanceof ParseError) {
    return {
      title: 'The weather service sent something unreadable',
      detail: `It answered 200 OK with a body that isn't JSON: "${error.snippet}"`,
      retryable: true,
    }
  }
  if (error instanceof ApiError) {
    return error.isClient
      ? {
          title: 'That location did not work',
          detail: `The service rejected the request (HTTP ${error.status}). Retrying won't help â€” try a different search.`,
          retryable: false,
        }
      : {
          title: 'The weather service is having problems',
          detail: error.reason
            ? `It returned HTTP ${error.status}: "${error.reason}". This is on their end, not yours.`
            : `It returned HTTP ${error.status}. This is on their end, not yours.`,
          retryable: true,
        }
  }
  return {
    title: 'Something went wrong',
    detail: error instanceof Error ? error.message : 'Unknown error.',
    retryable: true,
  }
}
