import { HttpResponse, delay, http } from 'msw'
import { ENHANCEMENT_CURRENT, FORECAST_URL, GEOCODE_URL } from '../api/weather'
import {
  bostonGeocode,
  enhancementsFixture,
  forecastFixture,
  gridFixture,
  gridWithNoReadings,
  noGeocodeResults,
  overloadedEnvelope,
} from './fixtures'

/**
 * Both queries hit /v1/forecast and differ only in the variables they ask for.
 * The mock routes on that because the real API does, which is the point:
 * handlers describe the service, not the component.
 */
export function isEnhancementRequest(request: Request) {
  return new URL(request.url).searchParams.get('current') === ENHANCEMENT_CURRENT
}

/** The map's bulk request: many coordinates in one call, comma-separated. */
export function isGridRequest(request: Request) {
  return (new URL(request.url).searchParams.get('latitude') ?? '').includes(',')
}

/** The coordinates a grid request asked for, in order. */
export function gridPointsFrom(request: Request) {
  const params = new URL(request.url).searchParams
  const lats = (params.get('latitude') ?? '').split(',')
  const lons = (params.get('longitude') ?? '').split(',')
  return lats.map((lat, i) => ({ latitude: Number(lat), longitude: Number(lons[i]) }))
}

/** The happy path. Everything else in this file is an override on top of it. */
export const handlers = [
  http.get(GEOCODE_URL, ({ request }) => {
    const name = new URL(request.url).searchParams.get('name') ?? ''
    if (!name.toLowerCase().startsWith('bos')) return HttpResponse.json(noGeocodeResults)
    return HttpResponse.json(bostonGeocode)
  }),
  http.get(FORECAST_URL, ({ request }) => {
    if (isGridRequest(request)) return HttpResponse.json(gridFixture(gridPointsFrom(request)))
    if (isEnhancementRequest(request)) return HttpResponse.json(enhancementsFixture())
    return HttpResponse.json(forecastFixture())
  }),
]

/**
 * Scenario handlers break the *essential* request only. Returning undefined for
 * the enhancement request lets it fall through to the default handler, so a
 * test about a broken forecast is not secretly also a test about broken icons.
 */
function essentialOnly(resolver: () => Response | Promise<Response>) {
  return ({ request }: { request: Request }) =>
    isEnhancementRequest(request) || isGridRequest(request) ? undefined : resolver()
}

// --- scenario overrides, one per UI state worth asserting -----------------

export const emptyResults = http.get(GEOCODE_URL, () => HttpResponse.json(noGeocodeResults))

export const serverError = (url: string = FORECAST_URL) =>
  http.get(
    url,
    essentialOnly(
      () => HttpResponse.json({ error: true, reason: 'upstream exploded' }, { status: 500 }),
    ),
  )

export const rateLimited = (url: string = FORECAST_URL, retryAfter = 2) =>
  http.get(
    url,
    essentialOnly(
      () =>
        new HttpResponse('slow down', {
          status: 429,
          headers: { 'retry-after': String(retryAfter) },
        }),
    ),
  )

export const badRequest = (url: string = FORECAST_URL) =>
  http.get(url, essentialOnly(() => new HttpResponse('bad latitude', { status: 400 })))

/** Never responds. Lets the client's own timeout be the thing under test. */
export const hangs = (url: string = FORECAST_URL) =>
  http.get(
    url,
    essentialOnly(async () => {
      await delay('infinite')
      return HttpResponse.json({}) as Response
    }),
  )

/**
 * 200 OK, valid JSON, and a failure. Captured from the live API while building
 * this, which is the whole argument for network-level mocking: you can only
 * mock what you have actually seen on the wire.
 */
export const overloaded = (url: string = FORECAST_URL) =>
  http.get(url, essentialOnly(() => HttpResponse.json(overloadedEnvelope) as Response))

/** 200 OK, content-type says JSON, body is a plain-text error string. */
export const nonJsonBody = (url: string = FORECAST_URL) =>
  http.get(
    url,
    essentialOnly(
      () =>
        new HttpResponse('Unexpected error while streaming data: timeoutReached', {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
    ),
  )

/** The real partial outage: decoration is down, the numbers are fine. */
export const enhancementsDown = http.get(FORECAST_URL, ({ request }) => {
  if (!isEnhancementRequest(request)) return HttpResponse.json(forecastFixture())
  return new HttpResponse('Unexpected error while streaming data: timeoutReached', {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
})

/** 429s once with a Retry-After, then succeeds. */
export const rateLimitedThenSucceeds = (retryAfter = 7, url: string = FORECAST_URL) => {
  let calls = 0
  return http.get(
    url,
    essentialOnly(() => {
      calls += 1
      if (calls === 1) {
        return new HttpResponse('slow down', {
          status: 429,
          headers: { 'retry-after': String(retryAfter) },
        })
      }
      return HttpResponse.json(forecastFixture()) as Response
    }),
  )
}

/** Fails `times` times, then succeeds -- the shape retry-with-backoff exists for. */
export const flaky = (times: number, url: string = FORECAST_URL) => {
  let calls = 0
  return http.get(
    url,
    essentialOnly(() => {
      calls += 1
      if (calls <= times) return new HttpResponse('transient', { status: 503 })
      return HttpResponse.json(forecastFixture()) as Response
    }),
  )
}

/** Succeeds once with a marker temperature, then 500s on every refetch. */
export const succeedsThenFails = (url: string = FORECAST_URL) => {
  let calls = 0
  return http.get(
    url,
    essentialOnly(() => {
      calls += 1
      if (calls === 1) return HttpResponse.json(forecastFixture({ temperature: 21.4 })) as Response
      return new HttpResponse('upstream exploded', { status: 500 })
    }),
  )
}

/** The map's request fails; the forecast underneath it does not. */
export const gridDown = http.get(FORECAST_URL, ({ request }) => {
  if (!isGridRequest(request)) return undefined
  return HttpResponse.json({ error: true, reason: 'The service is overloaded' }, { status: 503 })
})

/** Every coordinate answers, none with a number. */
export const gridEmpty = http.get(FORECAST_URL, ({ request }) => {
  if (!isGridRequest(request)) return undefined
  return HttpResponse.json(gridWithNoReadings(gridPointsFrom(request)))
})

/**
 * The bulk endpoint answering like a single-coordinate one: an object, not an
 * array. Silently rendering this would produce an empty map with no explanation.
 */
export const gridReturnsObject = http.get(FORECAST_URL, ({ request }) => {
  if (!isGridRequest(request)) return undefined
  return HttpResponse.json(forecastFixture())
})
