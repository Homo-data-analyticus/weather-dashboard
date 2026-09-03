import { describe, expect, it } from 'vitest'
import { server } from '../mocks/server'
import { FORECAST_URL } from './weather'
import { badRequest, hangs, nonJsonBody, overloaded, rateLimited, serverError } from '../mocks/handlers'
import { ApiError, ParseError, RateLimitError, TimeoutError, UpstreamError } from './errors'
import { fetchJson } from './http'

describe('fetchJson', () => {
  it('rejects with TimeoutError when the server never answers', async () => {
    server.use(hangs())
    await expect(fetchJson(FORECAST_URL, { timeoutMs: 40 })).rejects.toBeInstanceOf(TimeoutError)
  })

  it('maps 5xx to a retryable ApiError', async () => {
    server.use(serverError())
    const error: any = await fetchJson(FORECAST_URL).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
    expect(error.isClient).toBe(false)
    // The body explained itself; that explanation has to survive the throw.
    expect(error.reason).toBe('upstream exploded')
  })

  it('maps 4xx to a non-retryable ApiError', async () => {
    server.use(badRequest())
    const error: any = await fetchJson(FORECAST_URL).catch((e) => e)
    expect(error.isClient).toBe(true)
  })

  it('reads Retry-After off a 429', async () => {
    server.use(rateLimited(FORECAST_URL, 7))
    const error: any = await fetchJson(FORECAST_URL).catch((e) => e)
    expect(error).toBeInstanceOf(RateLimitError)
    expect(error.retryAfter).toBe(7)
  })

  it('rejects a 200 whose body is not JSON, instead of pretending it succeeded', async () => {
    server.use(nonJsonBody())
    const error: any = await fetchJson(FORECAST_URL).catch((e) => e)
    expect(error).toBeInstanceOf(ParseError)
    expect(error.snippet).toContain('timeoutReached')
  })

  it('rejects a 200 whose JSON body says the request failed', async () => {
    server.use(overloaded())
    const error: any = await fetchJson(FORECAST_URL).catch((e) => e)
    expect(error).toBeInstanceOf(UpstreamError)
    expect(error.reason).toBe('The service is overloaded')
  })

  it('propagates caller cancellation without dressing it up as a failure', async () => {
    server.use(hangs())
    const controller = new AbortController()
    const promise = fetchJson(FORECAST_URL, { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })
})
