import { describe, expect, it } from 'vitest'
import type { GridCell, TemperatureGrid } from '../api/weather'
import { bilinearAt, sampleAt, toGridIndex, upsampleField } from './field'

/** A 3x3 grid centred on (0,0) spanning ±1° in both directions. */
function makeGrid(values: Array<number | null>, size = 3): TemperatureGrid {
  const cells: GridCell[] = values.map((temperature, i) => ({
    row: Math.floor(i / size),
    col: i % size,
    latitude: 1 - Math.floor(i / size),
    longitude: -1 + (i % size),
    temperature,
  }))
  const readings = values.filter((v): v is number => v != null)
  return {
    size,
    spanLat: 1,
    spanLon: 1,
    center: { latitude: 0, longitude: 0 },
    cells,
    min: readings.length ? Math.min(...readings) : null,
    max: readings.length ? Math.max(...readings) : null,
  }
}

// A simple west-to-east gradient: 10, 20, 30 on every row.
const gradient = makeGrid([10, 20, 30, 10, 20, 30, 10, 20, 30])

describe('toGridIndex', () => {
  it('puts the centre of the box at the centre of the grid', () => {
    expect(toGridIndex(gradient, 0, 0)).toEqual({ row: 1, col: 1 })
  })

  it('puts the north-west corner at row 0, col 0', () => {
    expect(toGridIndex(gradient, 1, -1)).toEqual({ row: 0, col: 0 })
  })
})

describe('bilinearAt', () => {
  it('returns the sample exactly at a sample position', () => {
    expect(bilinearAt(gradient, 0, 0)).toBe(10)
    expect(bilinearAt(gradient, 1, 2)).toBe(30)
  })

  it('interpolates halfway between two samples', () => {
    expect(bilinearAt(gradient, 0, 0.5)).toBe(15)
    expect(bilinearAt(gradient, 0, 1.5)).toBe(25)
  })

  it('interpolates in both axes at once', () => {
    const corner = makeGrid([0, 10, 10, 10, 20, 20, 10, 20, 20])
    // Dead centre of the four-cell neighbourhood at the north-west corner.
    expect(bilinearAt(corner, 0.5, 0.5)).toBe(10)
  })

  it('clamps outside the grid rather than extrapolating', () => {
    // The blur needs to sample past the edge; inventing a colder value out
    // there would put weather on the map that was never requested.
    expect(bilinearAt(gradient, -3, -3)).toBe(10)
    expect(bilinearAt(gradient, 99, 99)).toBe(30)
  })

  it('re-weights around a missing corner instead of punching a hole', () => {
    const holed = makeGrid([null, 20, 30, 10, 20, 30, 10, 20, 30])
    // The three present corners still describe this neighbourhood; a naive
    // implementation would return null and leave a gap mid-field.
    const value = bilinearAt(holed, 0.5, 0.5)
    expect(value).not.toBeNull()
    expect(value).toBeGreaterThan(10)
    expect(value).toBeLessThan(30)
  })

  it('returns null only when the whole neighbourhood is missing', () => {
    const empty = makeGrid(Array(9).fill(null))
    expect(bilinearAt(empty, 0.5, 0.5)).toBeNull()
  })
})

describe('sampleAt', () => {
  it('reads the field at a real coordinate', () => {
    expect(sampleAt(gradient, 0, 0)).toBe(20)
    expect(sampleAt(gradient, 0, -0.5)).toBe(15)
  })

  it('refuses to invent a reading outside the sampled box', () => {
    // Clamping here would label a place with weather from somewhere else.
    expect(sampleAt(gradient, 0, 5)).toBeNull()
    expect(sampleAt(gradient, 40, 0)).toBeNull()
  })
})

describe('upsampleField', () => {
  it('tiles the box at the requested factor, plus a ring for the blur', () => {
    const cells = upsampleField(gradient, 4)
    // (3-1)*4 = 8 across, plus one bleed cell on each side.
    expect(cells).toHaveLength(10 * 10)
    expect(cells.some((c) => c.i === -1)).toBe(true)
    expect(cells.some((c) => c.i === 8)).toBe(true)
  })

  it('produces a monotonic ramp across a monotonic field', () => {
    const row = upsampleField(gradient, 4)
      .filter((c) => c.j === 3 && c.i >= 0 && c.i < 8)
      .sort((a, b) => a.i - b.i)
      .map((c) => c.temperature!)

    for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThan(row[i - 1])
    expect(row[0]).toBeGreaterThanOrEqual(10)
    expect(row[row.length - 1]).toBeLessThanOrEqual(30)
  })

  it('never exceeds the range of the samples it came from', () => {
    // Interpolation must not overshoot: a smoothed map that reports 31°C where
    // nothing above 30 was measured is lying about the data.
    for (const cell of upsampleField(gradient, 4)) {
      expect(cell.temperature).toBeGreaterThanOrEqual(10)
      expect(cell.temperature).toBeLessThanOrEqual(30)
    }
  })
})
