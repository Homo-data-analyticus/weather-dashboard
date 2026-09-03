import { requestConfig } from './config'
import {
  ApiError,
  NetworkError,
  ParseError,
  RateLimitError,
  TimeoutError,
  UpstreamError,
} from './errors'

/**
 * fetch + a timeout + error normalization.
 *
 * Deliberately does NOT retry: retry policy lives in TanStack Query, which
 * already knows about attempt counts, backoff, and whether anyone is still
 * looking at the screen. Two retry layers stacked on each other is how you get
 * a "one" click that fires nine requests.
 */
export async function fetchJson<T>(
  url: string,
  { signal, timeoutMs = requestConfig.timeoutMs }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  // Caller (TanStack Query) cancels -> we cancel. Written by hand rather than
  // with AbortSignal.any so it behaves the same in jsdom as in the browser.
  const onCallerAbort = () => controller.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (response.status === 429) {
      const header = response.headers.get('retry-after')
      const retryAfter = header ? Number(header) : undefined
      throw new RateLimitError(url, Number.isFinite(retryAfter) ? retryAfter : undefined)
    }
    if (!response.ok) {
      // Open-Meteo puts a human-readable `reason` in the body of its 4xx/5xx
      // responses. Discarding it turns a fixable error into a mystery.
      throw new ApiError(
        `Request failed with ${response.status}`,
        response.status,
        url,
        await readReason(response),
      )
    }

    // Read as text first: a 200 with a non-JSON body has to be distinguishable
    // from a network failure, and response.json() collapses the two.
    const body = await response.text()

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new ParseError(url, body.slice(0, 120))
    }

    // Open-Meteo reports overload and bad parameters in the body, not the
    // status line. A 200 is not the same thing as a success.
    if (isErrorEnvelope(parsed)) {
      throw new UpstreamError(url, parsed.reason ?? 'The service reported an error')
    }

    return parsed as T
  } catch (error) {
    if (timedOut) throw new TimeoutError(url, timeoutMs)
    // A caller-initiated abort is not a failure — let Query swallow it.
    if (signal?.aborted) throw error
    if (
      error instanceof ApiError ||
      error instanceof TimeoutError ||
      error instanceof ParseError ||
      error instanceof UpstreamError
    )
      throw error
    throw new NetworkError(url, error)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}

function isErrorEnvelope(value: unknown): value is { error: true; reason?: string } {
  return typeof value === 'object' && value !== null && (value as { error?: unknown }).error === true
}

async function readReason(response: Response): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await response.text()) as { reason?: unknown }
    return typeof parsed.reason === 'string' ? parsed.reason : undefined
  } catch {
    return undefined
  }
}
