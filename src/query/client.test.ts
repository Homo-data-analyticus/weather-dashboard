import { describe, expect, it } from 'vitest'
import { ApiError, RateLimitError, TimeoutError } from '../api/errors'
import { MAX_RETRIES, backoffMs, shouldRetry } from './client'

describe('shouldRetry', () => {
  it('gives up immediately on a client error', () => {
    expect(shouldRetry(0, new ApiError('bad', 400, '/x'))).toBe(false)
  })

  it('retries server errors up to the cap', () => {
    const error = new ApiError('boom', 500, '/x')
    expect(shouldRetry(0, error)).toBe(true)
    expect(shouldRetry(MAX_RETRIES, error)).toBe(false)
  })

  it('retries timeouts', () => {
    expect(shouldRetry(0, new TimeoutError('/x', 8000))).toBe(true)
  })

  it('retries a 429 even though it is a 4xx', () => {
    expect(shouldRetry(0, new RateLimitError('/x', 3))).toBe(true)
  })
})

describe('backoffMs', () => {
  it('grows roughly exponentially and stays jittered', () => {
    const first = backoffMs(0, new Error('x'))
    const third = backoffMs(2, new Error('x'))
    expect(first).toBeGreaterThanOrEqual(500)
    expect(first).toBeLessThanOrEqual(1000)
    expect(third).toBeGreaterThanOrEqual(2000)
    expect(third).toBeLessThanOrEqual(4000)
  })

  it('caps the ceiling so we never wait forever', () => {
    expect(backoffMs(20, new Error('x'))).toBeLessThanOrEqual(30_000)
  })

  it('obeys Retry-After instead of guessing', () => {
    expect(backoffMs(0, new RateLimitError('/x', 5))).toBe(5000)
  })
})
