import { describe, expect, it } from 'vitest'
import { forecastFixture } from '../mocks/fixtures'
import { describeWeather, normalizeForecast } from './weather'

describe('normalizeForecast', () => {
  it('transposes the parallel hourly arrays into rows', () => {
    const forecast = normalizeForecast(forecastFixture() as never)
    expect(forecast.hourly).toHaveLength(5)
    expect(forecast.hourly[0]).toEqual({
      time: '2026-09-02T14:00',
      temperature: 21.4,
      precipitationProbability: 5,
    })
  })

  it('drops hours that are already in the past', () => {
    const forecast = normalizeForecast(forecastFixture() as never)
    // The fixture starts at 12:00 but current.time is 14:00.
    expect(forecast.hourly.map((h) => h.time)).not.toContain('2026-09-02T13:00')
    expect(forecast.hourly[0].time).toBe('2026-09-02T14:00')
  })

  it('defaults a null precipitation probability to 0', () => {
    const forecast = normalizeForecast(forecastFixture() as never)
    expect(forecast.hourly[2].precipitationProbability).toBe(0)
  })
})

describe('describeWeather', () => {
  it.each([
    [0, 'Clear'],
    [3, 'Overcast'],
    [63, 'Rain'],
    [95, 'Thunderstorm'],
  ])('maps WMO code %i to %s', (code, label) => {
    expect(describeWeather(code).label).toBe(label)
  })
})
