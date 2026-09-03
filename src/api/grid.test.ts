import { describe, expect, it } from 'vitest'
import { server } from '../mocks/server'
import { gridEmpty, gridReturnsObject } from '../mocks/handlers'
import {
  GRID_SIZE,
  buildGridPoints,
  fetchTemperatureGrid,
  lonSpanFor,
} from './weather'

const BOSTON = { latitude: 42.35843, longitude: -71.05977 }

describe('buildGridPoints', () => {
  it('lays out size x size points row-major from the north-west corner', () => {
    const points = buildGridPoints(BOSTON, 3, 1, 1)
    expect(points).toHaveLength(9)
    expect(points[0]).toMatchObject({ row: 0, col: 0 })

    // Row 0 is the northern edge, so it holds the highest latitude.
    const lats = points.map((p) => p.latitude)
    expect(Math.max(...lats)).toBe(points[0].latitude)
    // 4 decimals: coordinates are rounded to keep the bulk URL short.
    expect(points[0].latitude).toBeCloseTo(BOSTON.latitude + 1, 4)
    expect(points[8].latitude).toBeCloseTo(BOSTON.latitude - 1, 4)
  })

  it('centres the box on the place', () => {
    const points = buildGridPoints(BOSTON, 5, 1, 1)
    const middle = points[Math.floor(points.length / 2)]
    expect(middle.latitude).toBeCloseTo(BOSTON.latitude, 4)
    expect(middle.longitude).toBeCloseTo(BOSTON.longitude, 4)
  })

  it('keeps coordinates legal near the poles and the antimeridian', () => {
    const points = buildGridPoints({ latitude: 89.5, longitude: 179.5 }, 5, 2, 2)
    for (const p of points) {
      expect(p.latitude).toBeLessThanOrEqual(90)
      expect(p.latitude).toBeGreaterThanOrEqual(-90)
      // Longitude wraps rather than running off to 181.
      expect(p.longitude).toBeLessThanOrEqual(180)
      expect(p.longitude).toBeGreaterThanOrEqual(-180)
    }
  })

  it('rounds coordinates so 81 of them still fit in one URL', () => {
    const points = buildGridPoints(BOSTON, GRID_SIZE)
    const url = new URLSearchParams({
      latitude: points.map((p) => p.latitude).join(','),
      longitude: points.map((p) => p.longitude).join(','),
    })
    expect(points).toHaveLength(81)
    expect(url.toString().length).toBeLessThan(2000)
  })
})

describe('lonSpanFor', () => {
  it('widens the longitude span as latitude increases', () => {
    // A degree of longitude is narrower nearer the poles, so more are needed
    // to cover the same ground and keep the map scale-true.
    expect(lonSpanFor(60, 1)).toBeGreaterThan(lonSpanFor(0, 1))
    expect(lonSpanFor(0, 1)).toBeCloseTo(1.5, 2)
  })

  it('does not run away at the pole', () => {
    expect(lonSpanFor(90, 1)).toBeLessThanOrEqual(60)
    expect(Number.isFinite(lonSpanFor(90, 1))).toBe(true)
  })
})

describe('fetchTemperatureGrid', () => {
  it('pairs each response entry with the point that was requested', async () => {
    const grid = await fetchTemperatureGrid(BOSTON)
    expect(grid.cells).toHaveLength(81)
    expect(grid.min).not.toBeNull()
    expect(grid.max).toBeGreaterThan(grid.min!)

    // Our own geometry wins over the coordinates the API echoes back, since it
    // snaps them to its model grid and the lattice would render ragged.
    const expected = buildGridPoints(BOSTON)
    expect(grid.cells.map((c) => c.latitude)).toEqual(expected.map((p) => p.latitude))
  })

  it('reports no bounds when every point comes back without a reading', async () => {
    server.use(gridEmpty)
    const grid = await fetchTemperatureGrid(BOSTON)
    expect(grid.cells.every((c) => c.temperature === null)).toBe(true)
    expect(grid.min).toBeNull()
    expect(grid.max).toBeNull()
  })

  it('rejects when the bulk endpoint answers like a single-coordinate one', async () => {
    // An object instead of an array means the request collapsed to one point.
    // Rendering that silently would be an empty map with no explanation.
    server.use(gridReturnsObject)
    await expect(fetchTemperatureGrid(BOSTON)).rejects.toThrow(/one result per coordinate/)
  })
})
