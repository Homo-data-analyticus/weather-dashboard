import { QueryClient, type QueryClientConfig } from '@tanstack/react-query'
import { ApiError, RateLimitError } from '../api/errors'

export const MAX_RETRIES = 3

/** Full jitter: spreads a thundering herd instead of re-synchronising it. */
export function backoffMs(attemptIndex: number, error: unknown): number {
  if (error instanceof RateLimitError && error.retryAfter) {
    // The server told us how long to wait. Believe it.
    return Math.min(error.retryAfter * 1000, 60_000)
  }
  const ceiling = Math.min(1000 * 2 ** attemptIndex, 30_000)
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2))
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  // A 400 or a 404 will be a 400 or a 404 the next three times too.
  if (error instanceof ApiError && error.isClient) return false
  return failureCount < MAX_RETRIES
}

export function makeQueryClient(overrides: QueryClientConfig = {}) {
  return new QueryClient({
    ...overrides,
    defaultOptions: {
      ...overrides.defaultOptions,
      queries: {
        // Data is "fresh" for a minute; after that a mount or a window focus
        // triggers a background refetch while the stale data stays on screen.
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        refetchInterval: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
        retryDelay: backoffMs,
        ...overrides.defaultOptions?.queries,
      },
    },
  })
}
