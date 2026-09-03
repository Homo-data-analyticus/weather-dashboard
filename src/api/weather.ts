import { fetchJson } from './http'

export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

export interface Place {
  id: number
  name: string
  country: string
  admin1?: string
  latitude: number
  longitude: number
  timezone: string
}

export interface HourlySlot {
  time: string
  temperature: number
  precipitationProbability: number
}

export interface Forecast {
  timezone: string
  current: {
    time: string
    temperature: number
    humidity: number
    windSpeed: number
  }
  hourly: HourlySlot[]
}

/**
 * "Feels like" and weather icons. Split out of the main forecast on purpose.
 *
 * Open-Meteo fails per *variable*, not per request: while writing this,
 * `weather_code` and `apparent_temperature` were both erroring for minutes at
 * a time while `temperature_2m`, `relative_humidity_2m` and `wind_speed_10m`
 * served fine. One request asking for all five is all-or-nothing, so a broken
 * icon takes down the temperature. Two requests cost one extra call per city
 * (debounced, cached for a minute) and keep the numbers on screen when the
 * decoration is down.
 */
export interface Enhancements {
  apparentTemperature: number | null
  currentCode: number | null
  codesByHour: Record<string, number>
}

// --- wire shapes (what Open-Meteo actually sends) -------------------------

interface GeocodeResponse {
  // Absent entirely when there are no matches, not an empty array. This is
  // exactly the sort of thing network-level mocks let you reproduce faithfully.
  results?: Array<{
    id: number
    name: string
    country: string
    admin1?: string
    latitude: number
    longitude: number
    timezone: string
  }>
}

interface ForecastResponse {
  timezone: string
  current: {
    time: string
    temperature_2m: number
    relative_humidity_2m: number
    wind_speed_10m: number
  }
  hourly: {
    time: string[]
    temperature_2m: number[]
    precipitation_probability: Array<number | null>
  }
}

interface EnhancementsResponse {
  current: { apparent_temperature: number | null; weather_code: number | null }
  hourly: { time: string[]; weather_code: Array<number | null> }
}

// --- calls ----------------------------------------------------------------

export async function searchPlaces(
  query: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Place[]> {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`
  const data = await fetchJson<GeocodeResponse>(url, opts)
  return data.results ?? []
}

/** The variables the dashboard is useless without. */
export const ESSENTIAL_CURRENT = 'temperature_2m,relative_humidity_2m,wind_speed_10m'
/** The variables it merely looks nicer with. */
export const ENHANCEMENT_CURRENT = 'apparent_temperature,weather_code'

export async function fetchForecast(
  place: Pick<Place, 'latitude' | 'longitude'>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: ESSENTIAL_CURRENT,
    hourly: 'temperature_2m,precipitation_probability',
    forecast_days: '2',
    timezone: 'auto',
  })
  return normalizeForecast(await fetchJson<ForecastResponse>(`${FORECAST_URL}?${params}`, opts))
}

/** Best-effort. Every caller must render sensibly when this rejects. */
export async function fetchEnhancements(
  place: Pick<Place, 'latitude' | 'longitude'>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Enhancements> {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: ENHANCEMENT_CURRENT,
    hourly: 'weather_code',
    forecast_days: '2',
    timezone: 'auto',
  })
  const raw = await fetchJson<EnhancementsResponse>(`${FORECAST_URL}?${params}`, opts)

  const codesByHour: Record<string, number> = {}
  raw.hourly.time.forEach((time, i) => {
    const code = raw.hourly.weather_code[i]
    if (code != null) codesByHour[time] = code
  })

  return {
    apparentTemperature: raw.current?.apparent_temperature ?? null,
    currentCode: raw.current?.weather_code ?? null,
    codesByHour,
  }
}

/**
 * Open-Meteo returns hourly data column-wise (parallel arrays). Every component
 * wants it row-wise, so transpose once here rather than indexing three arrays
 * in JSX. Also where nulls get defaulted, so the render path stays boring.
 */
export function normalizeForecast(raw: ForecastResponse): Forecast {
  const { time, temperature_2m, precipitation_probability } = raw.hourly
  const hourly = time
    .map((t, i) => ({
      time: t,
      temperature: temperature_2m[i],
      precipitationProbability: precipitation_probability[i] ?? 0,
    }))
    // forecast_days=2 starts at local midnight, so the first rows are already
    // in the past. Drop them, or "the next 12 hours" shows this morning.
    // Times are local wall-clock strings in a fixed format, so a string
    // comparison is a correct chronological one -- and avoids inventing a
    // timezone the API already resolved for us.
    .filter((slot) => slot.time >= raw.current.time)

  return {
    timezone: raw.timezone,
    current: {
      time: raw.current.time,
      temperature: raw.current.temperature_2m,
      humidity: raw.current.relative_humidity_2m,
      windSpeed: raw.current.wind_speed_10m,
    },
    hourly,
  }
}

/** WMO weather interpretation codes, collapsed to the buckets we render. */
export function describeWeather(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: '☀️' }
  if (code <= 2) return { label: 'Partly cloudy', icon: '⛅' }
  if (code === 3) return { label: 'Overcast', icon: '☁️' }
  if (code <= 48) return { label: 'Fog', icon: '🌫️' }
  if (code <= 57) return { label: 'Drizzle', icon: '🌦️' }
  if (code <= 67) return { label: 'Rain', icon: '🌧️' }
  if (code <= 77) return { label: 'Snow', icon: '🌨️' }
  if (code <= 82) return { label: 'Showers', icon: '🌧️' }
  if (code <= 86) return { label: 'Snow showers', icon: '🌨️' }
  return { label: 'Thunderstorm', icon: '⛈️' }
}
