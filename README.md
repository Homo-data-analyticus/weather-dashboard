# Weather dashboard

A small React dashboard on [Open-Meteo](https://open-meteo.com/) — free, no API key,
real rate limits, and, as it turned out, real failures on the afternoon it was built.

The happy path is about forty lines. The rest is the part that matters: loading
skeletons, retry with backoff, stale data, graceful degradation, and error states
that tell you what actually broke.

```bash
npm install
npm run dev          # against the real API
npm run dev:mock     # against MSW, so you can click through 500s and timeouts
npm test
```

## The states, and where they live

| State | Trigger | Code |
| --- | --- | --- |
| Skeleton | `isPending` on first load | [`Skeletons.tsx`](src/components/Skeletons.tsx) |
| Empty | geocoder returns no `results` key | [`App.tsx`](src/App.tsx) |
| Empty (partial) | forecast has no hourly rows | [`ForecastPanel.tsx`](src/components/ForecastPanel.tsx) |
| Degraded | enhancement request failed | [`ForecastPanel.tsx`](src/components/ForecastPanel.tsx) |
| Error, no cache | `isError && !data` | [`ErrorState.tsx`](src/components/ErrorState.tsx) |
| Stale + failed refresh | `isError && data` | [`StaleBanner.tsx`](src/components/StaleBanner.tsx) |
| Refreshing | `isFetching` with data on screen | dimmed card + "Updating…" |
| Map loading | grid query pending | [`WeatherMap.tsx`](src/components/WeatherMap.tsx) |
| Map failed | grid query rejected | quiet inline note + retry, never an alert |
| Map empty | grid returned no readings | [`WeatherMap.tsx`](src/components/WeatherMap.tsx) |

## Five decisions worth stealing

**One error type per thing that can go wrong.** `TimeoutError`, `NetworkError`,
`RateLimitError`, `ParseError`, `UpstreamError`, `ApiError` — see
[`errors.ts`](src/api/errors.ts). The retry policy branches on them
(`ApiError.isClient` → don't bother retrying a 400) and so does the copy. A single
`catch (e)` can only ever produce "Something went wrong."

**A 200 is not a success.** Open-Meteo signals failure three different ways, all
observed live while building this:

1. a normal status code (`503`) with `{"error": true, "reason": "..."}` in the body;
2. **HTTP 200** with that same JSON error envelope;
3. **HTTP 200**, `content-type: application/json`, and a plain-text body reading
   `Unexpected error while streaming data: timeoutReached`.

`response.ok` catches only the first. [`http.ts`](src/api/http.ts) reads the body as
text, parses it deliberately, and checks for the envelope — so (2) becomes an
`UpstreamError` and (3) a `ParseError` instead of a `TypeError` in the renderer. It
also lifts `reason` off error responses, so the UI can say *"HTTP 503: The service is
overloaded"* rather than just "something failed."

**Retry lives in exactly one layer.** `http.ts` does fetch, timeout, and error
normalization, and deliberately does *not* retry. Retry, backoff, and the attempt
budget are TanStack Query's job in [`query/client.ts`](src/query/client.ts). Two retry
layers stacked on each other turn one click into nine requests.

**Backoff is jittered, and `Retry-After` wins.** `backoffMs` uses full jitter
(`ceiling/2 + random(ceiling/2)`) so a wave of failed clients doesn't come back in
lockstep — but if the server sent a `Retry-After`, that number is used verbatim.
Guessing when the server already told you is rude to a service you depend on.

**A failed refresh does not delete good data.** When a background refetch fails,
TanStack Query keeps the last successful `data` and flips `status` to `error`. The
panel checks `isError && data` and renders the old forecast under a banner saying how
old it is. Throwing away a five-minute-old forecast to show a red box helps nobody.

## Why there are two forecast requests

Open-Meteo fails per *variable*, not per request. During development,
`weather_code` and `apparent_temperature` returned errors for minutes at a time while
`temperature_2m`, `relative_humidity_2m` and `wind_speed_10m` served fine from the
same endpoint. One request asking for all five is all-or-nothing: a broken icon takes
down the temperature.

So the app splits by *how much the user needs it*, not by endpoint:

- **essential** — temperature, humidity, wind, precipitation probability. Failure here
  is a real error state.
- **enhancement** — "feels like" and weather codes (icons). Its own query, its own
  retry budget (`retry: 1`), and nothing renders behind it. When it fails the numbers
  stay, the icons and the "Feels like" stat simply aren't there, and no error is shown
  because there is nothing for the user to do.

The cost is one extra request per city, debounced and cached for a minute. The benefit
is a dashboard that still works during a partial outage — which is not a hypothetical
here.

## The temperature map

A flat map of current temperature around the selected city: a 9x9 grid of sample
points, shaded by temperature, with the city pinned at the centre.

**It is one request, not 81.** Open-Meteo accepts comma-separated `latitude` and
`longitude` and answers with an array in request order, so the whole grid costs a
single call (~200 ms, ~33 KB, a 1.6 KB URL). Coordinates are rounded to four
decimals — ~11 m, far finer than the model resolution — to keep that URL short.

**The projection is equidistant cylindrical with the standard parallel at the map's
centre.** A degree of longitude narrows with `cos(latitude)`, so a square degree box
is only square at the equator. `lonSpanFor()` derives the longitude span from the
latitude span instead, which keeps the map scale-true at any latitude rather than
silently stretching Norway. The plotted aspect falls out of that.

**Cells are placed from the coordinates we asked for, not the ones echoed back.** The
API snaps every point to its model grid (37.0 comes back as 36.9909), so trusting the
response would render a subtly ragged lattice.

**It fails like the enhancement query, because that is what it is.** Own query, own
retry budget, nothing waits on it. A failed grid is a one-line note with a retry —
not an alert and not a red box, because the forecast above it is still correct and
there is nothing the reader must act on.

### About the color

Temperature is a **magnitude**, so the scale is sequential: one hue, light to dark,
never a rainbow. The hue is the design system's orange rather than its default
sequential blue, because "darker blue = hotter" fights an association every reader
already has.

The ramp is the documented blue ramp's exact OKLCH *lightness* skeleton re-hued to
orange, so lightness stays monotonic across the ramp — the check that actually applies
to a sequential scale, and one this repo verifies in
[`temperatureScale.test.ts`](src/components/temperatureScale.test.ts) rather than
eyeballing.

Two consequences worth knowing:

- **The anchor flips in dark mode.** A sequential ramp's low end has to recede toward
  the surface it sits on, so cool is pale on white and dark on black. The map therefore
  inverts between themes; the legend is always on screen, labelled with both bounds, so
  which end is which is never left to memory.
- **A degenerate range takes the ramp's midpoint.** If every point reads the same
  temperature there is no magnitude to encode, and dividing by a zero span would paint
  the whole map an extreme — implying variation that is not there.

Missing readings get a neutral gap color that is deliberately not a ramp step, so
"no data" can never be misread as "cold".

## Why MSW instead of stubbing fetch

`vi.mock('fetch')` asserts that your component calls a function you wrote. MSW asserts
that your app makes the right HTTP request and handles the real response.

Concretely, in this project:

- `onUnhandledRequest: 'error'` in [`setup.ts`](src/test/setup.ts) means a typo in a
  query param fails a test. A fetch stub returns the fixture regardless.
- Handlers route on `?current=` to tell the essential request from the enhancement one
  — exactly the discrimination the real API makes. `essentialOnly()` returns
  `undefined` for the other request so it falls through to the healthy default,
  keeping "the forecast is broken" tests from silently also being "the icons are
  broken" tests.
- The timeout test uses `delay('infinite')` and lets the client's *own*
  `AbortController` fire. Stubbing fetch would test a fake timeout instead of the real
  one.
- `flaky(2)` returns 503 twice then succeeds — stateful across requests, which is the
  entire shape retry-with-backoff exists for. Hard to express as a stub, trivial as a
  handler.
- The `overloaded` and `nonJsonBody` handlers are transcriptions of responses captured
  from the live API. You can only mock what you have actually seen on the wire, and
  hand-written stubs encode what you *assume* an API returns.
- `noGeocodeResults` is `{}`, because that is what Open-Meteo really sends when nothing
  matches — not `{ results: [] }`.
- The grid handlers read the request's own coordinate list and answer one entry per
  point, so the geometry the app sends is the geometry the mock replies to. A stub
  returning a fixed array would pass even if the app requested the wrong box.
- The same handlers run in the browser (`npm run dev:mock`), so the states you assert
  in tests are states you can look at.

## Test map

`src/App.test.tsx` walks the UI states end to end; the rest are unit tests.

- search: skeleton → results, and the no-matches copy
- forecast: skeleton → data; empty hourly; 500 with its reason; timeout; non-retryable 400
- degradation: enhancement request down → numbers stay, icons and "Feels like" vanish,
  no alert
- 200-that-isn't: error envelope, and unparseable body distinguished from a network failure
- retry: recovers silently from two 503s; gives up after the budget and says how many
- rate limiting: 429 named as such with the server's own wait time, and `Retry-After`
  shown to win over the jittered default backoff
- stale: refresh fails, old data and banner both survive
- map: skeleton → grid, legend and pin; hover reports the cell's reading and
  coordinates; warmer cells take a darker ramp step; a failed grid degrades quietly
  while the forecast stands; an all-null grid says so
- `grid.test.ts`: row-major geometry, centring, pole and antimeridian bounds, URL
  length, longitude span vs latitude, and the bulk endpoint answering with an object
  instead of an array
- `temperatureScale.test.ts`: dark-mode anchor flip, monotonic steps, the gap color,
  and the degenerate-range midpoint
- `http.test.ts`: timeout, 4xx/5xx mapping, `reason` extraction, `Retry-After`, cancellation
- `client.test.ts`: retry predicate and backoff bounds
- `weather.test.ts`: column→row transposition, null handling, dropping past hours

## Known-unfinished

- No cache persistence, so stale data doesn't survive a reload.
  `@tanstack/query-sync-storage-persister` is the next step.
- Geolocation, a °C/°F toggle, and a multi-day view are not built.
- The map has no coastlines or borders — it is a bare field with a coordinate frame.
  Real geography would mean shipping a TopoJSON basemap, which is a size and licensing
  decision, not a rendering one.
- The map samples current temperature only; there is no time scrubber.
- The 429 path is covered by unit and UI tests against MSW, but was never observed
  live; Open-Meteo never rate-limited us hard enough to see it in the wild.
