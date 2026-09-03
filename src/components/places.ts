import type { ViewBox } from './basemap'

/** [name, longitude, latitude, scalerank] — the shape the build script emits. */
type PlaceTuple = [string, number, number, number]

export interface Landmark {
  name: string
  longitude: number
  latitude: number
  /** Natural Earth scalerank: 0 is a world city, 10 a small town. */
  rank: number
}

let cache: Promise<Landmark[]> | null = null

/**
 * Populated places, lazily imported like the coastline.
 *
 * Already sorted most-important-first by the build script, so anything that
 * needs "the N biggest" can stop early instead of sorting 7342 entries.
 */
export function loadPlaces(): Promise<Landmark[]> {
  cache ??= import('../assets/places-10m.json').then((module) =>
    (module.default as unknown as PlaceTuple[]).map(([name, longitude, latitude, rank]) => ({
      name,
      longitude,
      latitude,
      rank,
    })),
  )
  return cache
}

/** Test seam: lets a test start from a clean decode. */
export function resetPlacesCache() {
  cache = null
}

export interface LabelBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedLabel extends Landmark {
  /** Anchor point — the dot, at the place's own position. */
  x: number
  y: number
  box: LabelBox
}

export interface LabelOptions {
  /** Plot-space width of a label, given its text. */
  width: (name: string) => number
  /** Plot-space height of a label. */
  height: number
  /** Labels to place at most. */
  limit: number
  /** Space already spoken for — the pinned city, typically. */
  reserved?: LabelBox[]
  /** Plot extent. A label must fit inside it, or it gets clipped mid-word. */
  bounds?: { width: number; height: number }
}

/** The box a label occupies: a little left of the dot, the text to its right. */
function boxFor(x: number, y: number, width: number, height: number): LabelBox {
  return { x: x - height / 4, y: y - height / 2, width, height }
}

const overlaps = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Chooses which places to label and where.
 *
 * Three jobs, all of them about restraint:
 *
 * 1. *Priority.* Everything inside the box cannot be drawn, so the most
 *    important places win. Natural Earth's scalerank is that priority, and the
 *    data arrives pre-sorted by it.
 * 2. *Collision.* Overlapping labels are worse than missing ones — two
 *    half-readable names help nobody. A greedy pass keeps the first label to
 *    claim a piece of space and drops any later one that would touch it.
 *    Greedy-by-priority means a dropped label is always less important than the
 *    one that displaced it, which is what a reader expects.
 * 3. *Bounds.* A label whose text runs past the edge of the plot gets clipped
 *    mid-word, which looks like a bug even when the geography is right. Better
 *    to drop it and label the next place in.
 *
 * Widths are measured per name rather than assumed: "Bridgeport 25°" needs
 * more than twice the room of "Ely 9°", and a single fixed box either lets
 * long names collide or spaces short ones out for nothing.
 */
export function layoutLabels(
  places: readonly Landmark[],
  view: ViewBox,
  project: (lon: number, lat: number) => [number, number],
  options: LabelOptions,
): PlacedLabel[] {
  const { width, height, limit, reserved = [], bounds } = options

  const taken: LabelBox[] = [...reserved]
  const placed: PlacedLabel[] = []

  for (const place of places) {
    if (placed.length >= limit) break
    if (
      place.longitude < view.lonMin ||
      place.longitude > view.lonMax ||
      place.latitude < view.latMin ||
      place.latitude > view.latMax
    ) {
      continue
    }

    const [x, y] = project(place.longitude, place.latitude)
    const box = boxFor(x, y, width(place.name), height)

    if (bounds && !fitsInside(box, bounds)) continue
    if (taken.some((t) => overlaps(box, t))) continue

    taken.push(box)
    placed.push({ ...place, x, y, box })
  }

  return placed
}

function fitsInside(box: LabelBox, bounds: { width: number; height: number }): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= bounds.width &&
    box.y + box.height <= bounds.height
  )
}
