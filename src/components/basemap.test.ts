import { beforeAll, describe, expect, it } from 'vitest'
import { loadCoastlines, visibleCoastPaths, type CoastLine, type ViewBox } from './basemap'

/** The identity-ish projector: 1 unit per degree, y flipped, so the numbers
 *  in a path are readable as coordinates. */
const projectorFor = (view: ViewBox) => (lon: number, lat: number): [number, number] =>
  [lon - view.lonMin, view.latMax - lat]

const boxAround = (lat: number, lon: number, pad = 1.5): ViewBox => ({
  latMin: lat - pad,
  latMax: lat + pad,
  lonMin: lon - pad,
  lonMax: lon + pad,
})

describe('loadCoastlines', () => {
  let lines: readonly CoastLine[]
  beforeAll(async () => {
    lines = await loadCoastlines()
  })

  it('decodes the bundled topology into measured line segments', () => {
    expect(lines.length).toBeGreaterThan(1000)
    for (const line of lines.slice(0, 50)) {
      expect(line.points.length).toBeGreaterThan(1)
      expect(line.lonMin).toBeLessThanOrEqual(line.lonMax)
      expect(line.latMin).toBeLessThanOrEqual(line.latMax)
    }
  })

  it('memoizes the decode instead of parsing 1.3 MB twice', async () => {
    expect(await loadCoastlines()).toBe(lines)
  })

  it('stays inside legal coordinates', () => {
    for (const line of lines) {
      expect(line.lonMin).toBeGreaterThanOrEqual(-180.001)
      expect(line.lonMax).toBeLessThanOrEqual(180.001)
      expect(line.latMin).toBeGreaterThanOrEqual(-90.001)
      expect(line.latMax).toBeLessThanOrEqual(90.001)
    }
  })
})

describe('visibleCoastPaths', () => {
  let lines: readonly CoastLine[]
  beforeAll(async () => {
    lines = await loadCoastlines()
  })

  it('finds coast where there is coast', () => {
    // Boston harbour.
    const view = boxAround(42.36, -71.06)
    const paths = visibleCoastPaths(lines, view, projectorFor(view))
    expect(paths.length).toBeGreaterThan(0)
    expect(paths[0]).toMatch(/^M-?[\d.]+ -?[\d.]+/)
  })

  it('finds none in the middle of an ocean', () => {
    // Point Nemo, the most remote spot in the Pacific.
    const view = boxAround(-48.88, -123.39)
    expect(visibleCoastPaths(lines, view, projectorFor(view))).toEqual([])
  })

  it('finds none in the middle of a continent', () => {
    // Central Kazakhstan: inland, so an empty basemap is the correct answer,
    // not a bug.
    const view = boxAround(48.0, 67.0, 1)
    expect(visibleCoastPaths(lines, view, projectorFor(view))).toEqual([])
  })

  it('draws coast across the antimeridian', () => {
    // Taveuni, Fiji sits at 179.9E; the 180th meridian runs through the group,
    // so this view runs past +180 and has to pick up geometry stored near -180.
    const view = { latMin: -17.5, latMax: -16.0, lonMin: 179.0, lonMax: 181.5 }
    const paths = visibleCoastPaths(lines, view, projectorFor(view))
    expect(paths.length).toBeGreaterThan(0)
  })

  it('never turns an antimeridian wrap into a line across the map', () => {
    const view = { latMin: -1, latMax: 1, lonMin: -2, lonMax: 2 }
    const seam: CoastLine = {
      points: [
        [-179.9, 0.5],
        [179.9, 0.5],
      ],
      lonMin: -179.9,
      lonMax: 179.9,
      latMin: 0.5,
      latMax: 0.5,
    }
    // The bounding box spans the globe and so overlaps the view, but the only
    // segment is a 360° wrap. Drawing it would put a line straight across.
    expect(visibleCoastPaths([seam], view, projectorFor(view))).toEqual([])
  })

  it('rejects a long arc whose bounding box covers the view but whose line does not', () => {
    // This is the inland case: one arc can run the length of a continent, so
    // its box reaches far from any coast. Kansas is not on the Gulf.
    const view = boxAround(37.5, -95, 1)
    const detour: CoastLine = {
      points: [
        [-100, 30],
        [-100, 45],
        [-90, 45],
      ],
      lonMin: -100,
      lonMax: -90,
      latMin: 30,
      latMax: 45,
    }
    expect(visibleCoastPaths([detour], view, projectorFor(view))).toEqual([])
  })

  it('emits a separate subpath per run that enters the view', () => {
    const view = { latMin: -1, latMax: 1, lonMin: -1, lonMax: 1 }
    const inAndOut: CoastLine = {
      points: [
        [-0.5, 0],
        [0, 0],
        [0, 40],
        [0.5, 40],
        [0.5, 0],
      ],
      lonMin: -0.5,
      lonMax: 0.5,
      latMin: 0,
      latMax: 40,
    }
    const paths = visibleCoastPaths([inAndOut], view, projectorFor(view))
    // It enters, leaves northwards, and comes back: two strokes, not one line
    // dragged through the gap.
    expect(paths).toHaveLength(2)
    for (const d of paths) expect(d.startsWith('M')).toBe(true)
  })

  it('rejects lines outside the view by latitude alone', () => {
    const view = boxAround(0, 0, 1)
    const arctic: CoastLine = {
      points: [
        [0, 80],
        [0.5, 80.1],
      ],
      lonMin: 0,
      lonMax: 0.5,
      latMin: 80,
      latMax: 80.1,
    }
    expect(visibleCoastPaths([arctic], view, projectorFor(view))).toEqual([])
  })
})
