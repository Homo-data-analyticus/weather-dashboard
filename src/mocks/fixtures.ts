/** Shaped exactly like Open-Meteo's wire format, nulls and all. */

export const bostonGeocode = {
  results: [
    {
      id: 4930956,
      name: 'Boston',
      country: 'United States',
      admin1: 'Massachusetts',
      latitude: 42.35843,
      longitude: -71.05977,
      timezone: 'America/New_York',
    },
    {
      id: 2655603,
      name: 'Boston',
      country: 'United Kingdom',
      admin1: 'England',
      latitude: 52.97633,
      longitude: -0.02664,
      timezone: 'Europe/London',
    },
  ],
}

/** No `results` key at all -- this is what "no matches" really looks like. */
export const noGeocodeResults = {}

/** Starts before `current.time`, exactly as forecast_days=2 really does. */
export const HOURS = [
  '2026-09-02T12:00',
  '2026-09-02T13:00',
  '2026-09-02T14:00',
  '2026-09-02T15:00',
  '2026-09-02T16:00',
  '2026-09-02T17:00',
  '2026-09-02T18:00',
]

/** The essential request: temperature, humidity, wind, precipitation. */
export function forecastFixture(overrides: { temperature?: number } = {}) {
  return {
    latitude: 42.35,
    longitude: -71.06,
    timezone: 'America/New_York',
    current: {
      time: '2026-09-02T14:00',
      temperature_2m: overrides.temperature ?? 21.4,
      relative_humidity_2m: 63,
      wind_speed_10m: 14.8,
    },
    hourly: {
      time: [...HOURS],
      temperature_2m: [19.0, 20.2, 21.4, 22.0, 21.7, 20.3, 18.9],
      // A real null in the middle: the normalizer has to survive it.
      precipitation_probability: [0, 2, 5, 12, null, 40, 65],
    },
  }
}

/** The enhancement request: "feels like" and weather codes. */
export function enhancementsFixture() {
  return {
    current: { time: '2026-09-02T14:00', apparent_temperature: 20.1, weather_code: 3 },
    hourly: {
      time: [...HOURS],
      // One null, so "no icon for this hour" is exercised.
      weather_code: [1, 1, 3, 2, 61, null, 80],
    },
  }
}

/** HTTP 200, valid JSON, and a failure anyway. Open-Meteo's overload response. */
export const overloadedEnvelope = { error: true, reason: 'The service is overloaded' }

/**
 * One bulk-request entry per coordinate, in request order. `warmSpot` puts a
 * deterministic hot cell in the grid so the color scale has something to prove.
 */
export function gridFixture(points: Array<{ latitude: number; longitude: number }>) {
  return points.map((p, i) => ({
    latitude: p.latitude,
    longitude: p.longitude,
    current: { time: '2026-09-02T14:00', interval: 900, temperature_2m: 18 + (i % 9) },
  }))
}

/** A grid where every point answers, but none of them with a usable number. */
export function gridWithNoReadings(points: Array<{ latitude: number; longitude: number }>) {
  return points.map((p) => ({ latitude: p.latitude, longitude: p.longitude, current: {} }))
}
