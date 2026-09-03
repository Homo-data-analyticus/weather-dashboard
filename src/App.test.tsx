import { HttpResponse, delay, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { act, screen, waitForElementToBeRemoved, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import App from './App'
import { requestConfig } from './api/config'
import { FORECAST_URL } from './api/weather'
import {
  badRequest,
  emptyResults,
  enhancementsDown,
  gridDown,
  gridEmpty,
  gridPointsFrom,
  isGridRequest,
  flaky,
  hangs,
  isEnhancementRequest,
  nonJsonBody,
  overloaded,
  rateLimited,
  rateLimitedThenSucceeds,
  serverError,
  succeedsThenFails,
} from './mocks/handlers'
import { enhancementsFixture, forecastFixture, gridFixture } from './mocks/fixtures'
import { server } from './mocks/server'
import { backoffMs, shouldRetry } from './query/client'
import { TEMPERATURE_RAMP } from './components/temperatureScale'
import { renderApp } from './test/utils'

afterEach(() => {
  requestConfig.timeoutMs = 8_000
})

async function search(user: UserEvent, term = 'Boston') {
  await user.type(screen.getByRole('searchbox'), term)
}

async function pickBoston(user: UserEvent) {
  await search(user)
  const [first] = await screen.findAllByRole('button', { name: /Boston/ }, { timeout: 3000 })
  await user.click(first)
}

describe('search', () => {
  it('shows a skeleton while searching, then the matches', async () => {
    const { user } = renderApp(<App />)
    await search(user)

    expect(await screen.findByTestId('results-skeleton')).toBeInTheDocument()
    expect(await screen.findByText('Massachusetts, United States')).toBeInTheDocument()
  })

  it('tells the user nothing matched instead of showing an empty list', async () => {
    server.use(emptyResults)
    const { user } = renderApp(<App />)
    await search(user, 'Nowhereville')

    expect(await screen.findByText(/No places match/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('forecast: happy path', () => {
  it('replaces the skeleton with current conditions and the hourly strip', async () => {
    // A slow-but-successful response, so the skeleton is actually observable
    // rather than a race against an instant mock.
    server.use(
      http.get(FORECAST_URL, async ({ request }) => {
        if (isEnhancementRequest(request)) return HttpResponse.json(enhancementsFixture())
        await delay(80)
        return HttpResponse.json(forecastFixture())
      }),
    )
    const { user } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByTestId('forecast-skeleton')).toBeInTheDocument()
    await waitForElementToBeRemoved(() => screen.queryByTestId('forecast-skeleton'))

    expect(screen.getByRole('heading', { name: 'Boston, Massachusetts' })).toBeInTheDocument()
    expect(screen.getByText('21°C')).toBeInTheDocument()
    expect(screen.getByText('20°C')).toBeInTheDocument() // feels like, from the enhancement query
    expect(screen.getByText('63%')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('handles a location with no hourly data without breaking the page', async () => {
    server.use(
      http.get(FORECAST_URL, ({ request }) => {
        if (isEnhancementRequest(request)) return HttpResponse.json(enhancementsFixture())
        const empty = forecastFixture()
        empty.hourly = { time: [], temperature_2m: [], precipitation_probability: [] }
        return HttpResponse.json(empty)
      }),
    )
    const { user } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByText(/No hourly forecast is published/)).toBeInTheDocument()
    // Current conditions are still real data, so they stay.
    expect(screen.getByText('21°C')).toBeInTheDocument()
  })
})

describe('forecast: failures', () => {
  it('blames the server, not the user, on a 500 — and offers a retry', async () => {
    server.use(serverError())
    const { user } = renderApp(<App />)
    await pickBoston(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The weather service is having problems')
    expect(alert).toHaveTextContent('HTTP 500')
    expect(alert).toHaveTextContent('upstream exploded')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('reports a timeout as a timeout', async () => {
    requestConfig.timeoutMs = 40
    server.use(hangs())
    const { user } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByText('The request took too long')).toBeInTheDocument()
  })

  it('does not offer a retry for an error retrying cannot fix', async () => {
    server.use(badRequest())
    const { user } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByText('That location did not work')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByText(/Search for a different location/)).toBeInTheDocument()
  })

  it('recovers on its own when the failure is transient', async () => {
    server.use(flaky(2))
    const { user } = renderApp(<App />, {
      defaultOptions: { queries: { retry: shouldRetry, retryDelay: () => 5 } },
    })
    await pickBoston(user)

    // Two 503s happen invisibly behind the skeleton; the user only sees success.
    expect(await screen.findByText('21°C', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('names rate limiting as rate limiting, with the wait the server asked for', async () => {
    server.use(rateLimited(FORECAST_URL, 7))
    const { user } = renderApp(<App />)
    await pickBoston(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Too many requests')
    // The number comes off the Retry-After header, not out of thin air.
    expect(alert).toHaveTextContent('about 7s')
    // A 429 is a 4xx, but it is the one 4xx worth retrying.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('waits exactly as long as Retry-After says, then recovers', async () => {
    server.use(rateLimitedThenSucceeds(7))

    // Record what the backoff policy decides, but do not actually sleep for it:
    // the assertion is about the number, and a 7s test is a test nobody runs.
    const waits: number[] = []
    const { user } = renderApp(<App />, {
      defaultOptions: {
        queries: {
          retry: shouldRetry,
          retryDelay: (attempt, error) => {
            waits.push(backoffMs(attempt, error))
            return 5
          },
        },
      },
    })
    await pickBoston(user)

    // The user never sees the 429 -- it resolves behind the skeleton.
    expect(await screen.findByText('21°C')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Retry-After: 7 wins outright, instead of the ~750ms jittered first step.
    expect(waits).toEqual([7000])
  })

  it('gives up after the retry budget and says how many attempts it made', async () => {
    server.use(serverError())
    const { user } = renderApp(<App />, {
      defaultOptions: { queries: { retry: shouldRetry, retryDelay: () => 5 } },
    })
    await pickBoston(user)

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'Gave up after 4 attempts',
    )
  })
})

describe('forecast: partial degradation', () => {
  it('keeps the numbers when only the enhancement request fails', async () => {
    // The live failure this design exists for: weather_code and
    // apparent_temperature error while temperature and wind serve fine.
    server.use(enhancementsDown)
    const { user } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByText('21°C')).toBeInTheDocument()
    expect(screen.getByText('63%')).toBeInTheDocument()
    expect(screen.getByText('15 km/h')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)

    // Decoration is gone, and nothing pretends otherwise.
    const panel = screen.getByRole('region', { name: 'Boston, Massachusetts' })
    expect(within(panel).queryAllByRole('img')).toHaveLength(0)
    expect(screen.queryByText('Feels like')).not.toBeInTheDocument()

    // Crucially: no error state and no stale banner. Nothing to act on.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Couldn't refresh/)).not.toBeInTheDocument()
  })

  it('shows icons and feels-like when both requests succeed', async () => {
    const { user } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByText('21°C')).toBeInTheDocument()
    expect(screen.getByText('Feels like')).toBeInTheDocument()

    // Scoped to the forecast panel: the map below is also an img-role element.
    const panel = screen.getByRole('region', { name: 'Boston, Massachusetts' })
    expect(within(panel).getAllByRole('img', { name: 'Overcast' }).length).toBeGreaterThan(0)
    // Four hourly icons plus the current one; one hour has a null code.
    expect(within(panel).getAllByRole('img')).toHaveLength(5)
  })
})

describe('forecast: a 200 that is not a success', () => {
  it('treats an error envelope as an error instead of rendering garbage', async () => {
    // Captured live: HTTP 200, valid JSON, {error: true, reason: "..."}.
    // Without an explicit check this parses fine and blows up in the renderer.
    server.use(overloaded())
    const { user } = renderApp(<App />)
    await pickBoston(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The weather service is busy')
    expect(alert).toHaveTextContent('The service is overloaded')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('distinguishes an unparseable body from a network failure', async () => {
    server.use(nonJsonBody())
    const { user } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByText('The weather service sent something unreadable')).toBeInTheDocument()
    expect(screen.queryByText("Can't reach the weather service")).not.toBeInTheDocument()
  })
})

describe('forecast: stale data', () => {
  it('keeps showing the old forecast when a background refresh fails', async () => {
    server.use(succeedsThenFails())
    const { user, client } = renderApp(<App />)
    await pickBoston(user)
    expect(await screen.findByText('21°C')).toBeInTheDocument()

    await act(async () => {
      await client.refetchQueries({ queryKey: ['forecast'] })
    })

    expect(await screen.findByText(/Couldn't refresh/)).toBeInTheDocument()
    // The whole point: the data survived the failed refresh.
    expect(screen.getByText('21°C')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('temperature map', () => {
  it('replaces its skeleton with a scaled grid, legend and pin', async () => {
    // Slow the grid response so the skeleton is observable rather than a race
    // against an instant mock.
    server.use(
      http.get(FORECAST_URL, async ({ request }) => {
        if (!isGridRequest(request)) return undefined
        await delay(80)
        return HttpResponse.json(gridFixture(gridPointsFrom(request)))
      }),
    )
    const { user, container } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByTestId('map-skeleton')).toBeInTheDocument()
    await waitForElementToBeRemoved(() => screen.queryByTestId('map-skeleton'))

    // The fixture ramps 18..26°C, so those are the legend's ends.
    const map = screen.getByRole('img', { name: /Temperature grid around Boston/ })
    expect(map).toHaveAccessibleName(/from 18 to 26 degrees Celsius/)
    expect(screen.getByText('18°')).toBeInTheDocument()
    expect(screen.getByText('26°')).toBeInTheDocument()

    // 9x9 sampled points, one cell each, plus the city pin.
    expect(container.querySelectorAll('.map-cell')).toHaveLength(81)
    expect(container.querySelector('.map-pin')).toBeInTheDocument()
  })

  it('reports the reading under the cursor', async () => {
    const { user, container } = renderApp(<App />)
    await pickBoston(user)
    await screen.findByRole('img', { name: /Temperature grid around Boston/ })

    expect(screen.getByText('Hover a cell for its reading.')).toBeInTheDocument()

    const cells = container.querySelectorAll('.map-cell')
    await user.hover(cells[0])

    // North-west corner: highest latitude, lowest longitude of the box.
    expect(await screen.findByText(/°C at .+° N, .+° W$/)).toBeInTheDocument()
  })

  it('paints warmer cells with a darker step than cooler ones', async () => {
    const { user, container } = renderApp(<App />)
    await pickBoston(user)
    await screen.findByRole('img', { name: /Temperature grid around Boston/ })

    // Fixture temperature is 18 + (i % 9), so cell 0 is the coolest in its run
    // and cell 8 the warmest. Identity is carried by position on one hue ramp.
    const cells = container.querySelectorAll('.map-cell')
    const coolest = cells[0].getAttribute('fill')
    const warmest = cells[8].getAttribute('fill')
    expect(coolest).not.toBe(warmest)
    expect(TEMPERATURE_RAMP.indexOf(warmest as never)).toBeGreaterThan(
      TEMPERATURE_RAMP.indexOf(coolest as never),
    )
  })

  it('fails quietly when the grid request fails, and keeps the forecast', async () => {
    server.use(gridDown)
    const { user } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByText(/temperature map is unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    // The forecast is the page's job and it is unaffected. No alert, no banner.
    expect(screen.getByText('21°C')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Couldn't refresh/)).not.toBeInTheDocument()
  })

  it('says so when the grid answers with no readings at all', async () => {
    server.use(gridEmpty)
    const { user } = renderApp(<App />)
    await pickBoston(user)

    expect(await screen.findByText(/no readings for this area/i)).toBeInTheDocument()
    // An empty grid is not an error; nothing offers a retry for it.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('21°C')).toBeInTheDocument()
  })
})
