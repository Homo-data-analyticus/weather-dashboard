import { feature } from 'topojson-client'
import type { Feature, Geometry } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'

/** A coastline segment plus the bounding box used to reject it cheaply. */
export interface CoastLine {
  points: Array<[number, number]>
  lonMin: number
  lonMax: number
  latMin: number
  latMax: number
}

export interface ViewBox {
  lonMin: number
  lonMax: number
  latMin: number
  latMax: number
}

let cache: Promise<CoastLine[]> | null = null

/**
 * Loads the bundled Natural Earth coastline.
 *
 * A dynamic import so the 1.3 MB of geometry lands in its own chunk and never
 * touches the initial page load — the map is an enhancement, and so is its
 * basemap. The promise is memoized, so a second map mount reuses the decode.
 */
export function loadCoastlines(): Promise<CoastLine[]> {
  cache ??= import('../assets/coastline-10m.topo.json').then((module) => {
    const topo = module.default as unknown as Topology<{ coastline: GeometryCollection }>
    const collection = feature(topo, topo.objects.coastline)
    return collection.features.flatMap(toLines)
  })
  return cache
}

/** Test seam: lets a test start from a clean decode. */
export function resetCoastlineCache() {
  cache = null
}

function toLines(f: Feature<Geometry>): CoastLine[] {
  const geometry = f.geometry
  if (!geometry) return []

  const rings: Array<Array<[number, number]>> =
    geometry.type === 'LineString'
      ? [geometry.coordinates as Array<[number, number]>]
      : geometry.type === 'MultiLineString'
        ? (geometry.coordinates as Array<Array<[number, number]>>)
        : []

  return rings.filter((points) => points.length > 1).map(measure)
}

function measure(points: Array<[number, number]>): CoastLine {
  let lonMin = Infinity
  let lonMax = -Infinity
  let latMin = Infinity
  let latMax = -Infinity
  for (const [lon, lat] of points) {
    if (lon < lonMin) lonMin = lon
    if (lon > lonMax) lonMax = lon
    if (lat < latMin) latMin = lat
    if (lat > latMax) latMax = lat
  }
  return { points, lonMin, lonMax, latMin, latMax }
}

/**
 * SVG path data for every coastline crossing the view, in plot coordinates.
 *
 * The map is equirectangular, so longitude and latitude map linearly onto x
 * and y — the same transform the temperature cells use. That is the whole
 * reason this needs no projection library: a projected basemap and an
 * unprojected data layer would not line up.
 */
export function visibleCoastPaths(
  lines: readonly CoastLine[],
  view: ViewBox,
  project: (lon: number, lat: number) => [number, number],
): string[] {
  const paths: string[] = []

  // A view that runs past ±180 sees geometry stored on the other side of the
  // antimeridian, so those lines are also considered shifted a full turn.
  const shifts = [0]
  if (view.lonMin < -180) shifts.push(-360)
  if (view.lonMax > 180) shifts.push(360)

  for (const line of lines) {
    // Cheap rejection first, but a bounding box is only a hint: one arc can run
    // the length of a continent, so its box covers land it never touches.
    if (line.latMax < view.latMin || line.latMin > view.latMax) continue

    for (const shift of shifts) {
      if (line.lonMax + shift < view.lonMin || line.lonMin + shift > view.lonMax) continue
      paths.push(...clipToView(line.points, shift, view, project))
    }
  }
  return paths
}

/**
 * Walks the line and emits only the runs of segments that actually reach the
 * view, as separate subpaths.
 *
 * This is what makes an inland city draw nothing at all: the Gulf coast is a
 * single arc whose bounding box reaches Kansas, and without a per-segment test
 * every inland map would serialize thousands of points for the clip to throw
 * away.
 */
function clipToView(
  points: Array<[number, number]>,
  shift: number,
  view: ViewBox,
  project: (lon: number, lat: number) => [number, number],
): string[] {
  const paths: string[] = []
  let current = ''

  const flush = () => {
    if (current) paths.push(current)
    current = ''
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]

    // A jump of more than half the globe is the antimeridian seam, not a real
    // segment. Lifting the pen there avoids a line straight across the map.
    if (Math.abs(b[0] - a[0]) > 180 || !touchesView(a, b, shift, view)) {
      flush()
      continue
    }

    if (!current) current = moveTo(project(a[0] + shift, a[1]))
    current += lineTo(project(b[0] + shift, b[1]))
  }

  flush()
  return paths
}

function touchesView(
  a: [number, number],
  b: [number, number],
  shift: number,
  view: ViewBox,
): boolean {
  const lonMin = Math.min(a[0], b[0]) + shift
  const lonMax = Math.max(a[0], b[0]) + shift
  const latMin = Math.min(a[1], b[1])
  const latMax = Math.max(a[1], b[1])
  return !(
    lonMax < view.lonMin ||
    lonMin > view.lonMax ||
    latMax < view.latMin ||
    latMin > view.latMax
  )
}

const moveTo = ([x, y]: [number, number]) => `M${round(x)} ${round(y)}`
const lineTo = ([x, y]: [number, number]) => `L${round(x)} ${round(y)}`

/** Two decimals in a 100-unit viewBox is well under a screen pixel. */
const round = (n: number) => Math.round(n * 100) / 100
