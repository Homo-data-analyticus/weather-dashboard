import { describe, expect, it } from 'vitest'
import {
  NO_READING,
  TEMPERATURE_RAMP,
  colorForTemperature,
  rampFor,
} from './temperatureScale'

describe('rampFor', () => {
  it('flips the anchor in dark mode so the low end recedes into the surface', () => {
    const light = rampFor(false)
    const dark = rampFor(true)
    expect(light[0]).toBe(TEMPERATURE_RAMP[0])
    expect(dark[0]).toBe(TEMPERATURE_RAMP[TEMPERATURE_RAMP.length - 1])
    expect(dark).toHaveLength(light.length)
  })
})

describe('colorForTemperature', () => {
  const ramp = rampFor(false)

  it('maps the bounds to the ends of the ramp', () => {
    expect(colorForTemperature(10, 10, 30, ramp)).toBe(ramp[0])
    expect(colorForTemperature(30, 10, 30, ramp)).toBe(ramp[ramp.length - 1])
  })

  it('is monotonic: warmer never gets a lighter step', () => {
    const indices = [10, 14, 18, 22, 26, 30].map((t) =>
      ramp.indexOf(colorForTemperature(t, 10, 30, ramp)),
    )
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1])
    }
  })

  it('uses a gap color for a missing reading, never a ramp step', () => {
    const color = colorForTemperature(null, 10, 30, ramp)
    expect(color).toBe(NO_READING)
    expect(ramp).not.toContain(color)
  })

  it('takes the midpoint when every point is the same temperature', () => {
    // No magnitude to encode. Dividing by a zero span would paint the whole
    // map an extreme, implying variation that is not there.
    expect(colorForTemperature(20, 20, 20, ramp)).toBe(ramp[Math.floor(ramp.length / 2)])
  })

  it('has no bounds to scale against before the grid loads', () => {
    expect(colorForTemperature(20, null, null, ramp)).toBe(NO_READING)
  })
})
