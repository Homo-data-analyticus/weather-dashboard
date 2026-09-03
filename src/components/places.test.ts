import { beforeAll, describe, expect, it } from 'vitest'
import type { ViewBox } from './basemap'
import { layoutLabels, loadPlaces, type Landmark } from './places'

const view: ViewBox = { lonMin: -10, lonMax: 10, latMin: -10, latMax: 10 }
// 1 unit per degree, y flipped, so plot coordinates read as coordinates.
const project = (lon: number, lat: number): [number, number] => [lon - view.lonMin, view.latMax - lat]

const at = (name: string, lon: number, lat: number, rank: number): Landmark => ({
  name,
  longitude: lon,
  latitude: lat,
  rank,
})

// 1 unit per character plus padding, in the same degree-ish units as the view.
const spread = { width: (n: string) => n.length + 2, height: 2, limit: 10 }

describe('loadPlaces', () => {
  let places: Landmark[]
  beforeAll(async () => {
    places = await loadPlaces()
  })

  it('decodes the bundled tuples', () => {
    expect(places.length).toBeGreaterThan(5000)
    expect(places[0]).toMatchObject({ name: expect.any(String), rank: expect.any(Number) })
  })

  it('arrives sorted most important first, so callers can stop early', () => {
    for (let i = 1; i < places.length; i++) {
      expect(places[i].rank).toBeGreaterThanOrEqual(places[i - 1].rank)
    }
  })

  it('memoizes the decode', async () => {
    expect(await loadPlaces()).toBe(places)
  })
})

describe('layoutLabels', () => {
  it('drops places outside the view', () => {
    const placed = layoutLabels([at('Inside', 0, 0, 1), at('Far away', 90, 45, 1)], view, project, spread)
    expect(placed.map((p) => p.name)).toEqual(['Inside'])
  })

  it('keeps the more important of two labels that would collide', () => {
    // Same spot, different rank. The input is priority-ordered, so the first
    // wins and the second is dropped rather than drawn on top of it.
    const placed = layoutLabels([at('Big', 0, 0, 1), at('Small', 0.1, 0.1, 9)], view, project, spread)
    expect(placed.map((p) => p.name)).toEqual(['Big'])
  })

  it('keeps both when they are far enough apart', () => {
    const placed = layoutLabels([at('West', -8, 0, 1), at('East', 8, 0, 2)], view, project, spread)
    expect(placed.map((p) => p.name)).toEqual(['West', 'East'])
  })

  it('never places a label over reserved space', () => {
    // The pinned city already occupies the centre.
    const placed = layoutLabels([at('Shadowed', 0, 0, 1)], view, project, {
      ...spread,
      reserved: [{ x: 9, y: 9, width: 4, height: 4 }],
    })
    expect(placed).toEqual([])
  })

  it('drops a label whose text would run off the edge', () => {
    // Clipped mid-word looks like a bug even when the geography is right.
    const placed = layoutLabels([at('Edgewater', 9.9, 0, 1)], view, project, {
      ...spread,
      bounds: { width: 20, height: 20 },
    })
    expect(placed).toEqual([])
  })

  it('keeps a label that fits inside the bounds', () => {
    const placed = layoutLabels([at('Middle', 0, 0, 1)], view, project, {
      ...spread,
      bounds: { width: 20, height: 20 },
    })
    expect(placed.map((p) => p.name)).toEqual(['Middle'])
  })

  it('measures each label by its own name, not a fixed box', () => {
    // A long name and a short one at the same spacing: only the long one
    // collides with its neighbour.
    const short = layoutLabels([at('Ab', 0, 0, 1), at('Cd', 4, 0, 2)], view, project, spread)
    const long = layoutLabels(
      [at('Abcdefghijklmno', 0, 0, 1), at('Cd', 4, 0, 2)],
      view,
      project,
      spread,
    )
    expect(short).toHaveLength(2)
    expect(long).toHaveLength(1)
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => at(`P${i}`, -9 + i, 0, i))
    expect(layoutLabels(many, view, project, { ...spread, limit: 3 })).toHaveLength(3)
  })

  it('projects each label to its own position', () => {
    const [placed] = layoutLabels([at('Origin', 0, 0, 1)], view, project, spread)
    expect([placed.x, placed.y]).toEqual([10, 10])
  })
})
