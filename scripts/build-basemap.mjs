/**
 * Builds the bundled coastline basemap from Natural Earth.
 *
 * Run with `npm run build:basemap`. The output is committed, so a normal
 * install never touches the network — this exists to make the asset
 * reproducible and to document exactly what was done to it.
 *
 * Resolution matters more than it looks: the map renders a box roughly 250 km
 * tall, and Natural Earth's 110m data (the size everyone reaches for first)
 * generalizes detail at tens of kilometres, which erases whole bays at this
 * zoom. 10m is the coarsest resolution that still looks like the coast.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { quantize } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, simplify, quantile } from 'topojson-simplify'

const COASTLINE_SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson'
const PLACES_SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson'

/**
 * 1e5 steps across 360° is ~0.0036° (~400 m at the equator). The plot is about
 * 800 m per screen pixel at this zoom, so the quantization grid lands under
 * half a pixel — invisible, and far cheaper than storing full precision.
 */
const QUANTIZATION = 1e5

/**
 * `quantile(topo, p)` returns a weight threshold that *falls* as p rises, so a
 * larger p keeps more points. Measured on this dataset:
 *
 *   p 0.1 ->  49k points, 0.61 MB
 *   p 0.2 ->  89k points, 0.95 MB
 *   p 0.3 -> 129k points, 1.28 MB   <- here
 *   p 0.45 -> 190k points, 1.73 MB
 *   full   -> 411k points, 12.3 MB
 *
 * Full 10m resolution is ~1 km between vertices, which is genuinely below one
 * screen pixel at this zoom — but 12 MB is not a basemap, it is a download.
 * 0.3 keeps coastlines recognizably themselves at the cost of some angularity
 * on the tightest inlets. Going finer would mean tiling the world and fetching
 * only the viewport, which is a different (and much larger) piece of work.
 */
const RETAIN = 0.3

const here = dirname(fileURLToPath(import.meta.url))
const COASTLINE_OUT = resolve(here, '../src/assets/coastline-10m.topo.json')
const PLACES_OUT = resolve(here, '../src/assets/places-10m.json')

console.log(`Fetching ${COASTLINE_SOURCE}`)
const response = await fetch(COASTLINE_SOURCE)
if (!response.ok) throw new Error(`Natural Earth returned ${response.status}`)
const geojson = await response.json()
const rawBytes = Buffer.byteLength(JSON.stringify(geojson))

// Strip per-feature properties: this layer is drawn as one anonymous stroke,
// and the scalerank/featurecla fields are pure weight in the bundle.
geojson.features = geojson.features.map((f) => ({ type: f.type, geometry: f.geometry }))

// Order matters: presimplify dequantizes, so quantization has to come last or
// the output carries full float coordinates and ends up bigger than the input.
let topo = topology({ coastline: geojson })
topo = presimplify(topo)
topo = simplify(topo, quantile(topo, RETAIN))
topo = quantize(topo, QUANTIZATION)

// The transform carries everything the decoder needs; bbox is dead weight.
delete topo.bbox

mkdirSync(dirname(COASTLINE_OUT), { recursive: true })
const out = JSON.stringify(topo)
writeFileSync(COASTLINE_OUT, out)

const points = topo.arcs.reduce((n, a) => n + a.length, 0)
console.log(`GeoJSON in:   ${(rawBytes / 1e6).toFixed(2)} MB`)
console.log(`TopoJSON out: ${(out.length / 1e6).toFixed(2)} MB`)
console.log(`Arcs: ${topo.arcs.length}, points: ${points}`)
console.log(`Wrote ${COASTLINE_OUT}`)

// --- populated places -----------------------------------------------------

/**
 * Labels are the reference the reader actually uses: "north of Providence"
 * means something, "41.8 N" does not. Natural Earth's populated places carry a
 * `scalerank` (0 = world city, 10 = small town) which is exactly the priority
 * order a label layer needs when it has to drop some.
 *
 * Stored as flat tuples rather than GeoJSON: the same 7342 places are 4.9 MB of
 * features and about a fifteenth of that as [name, lon, lat, rank].
 */
console.log(`Fetching ${PLACES_SOURCE}`)
const placesResponse = await fetch(PLACES_SOURCE)
if (!placesResponse.ok) throw new Error(`Natural Earth returned ${placesResponse.status}`)
const placesGeo = await placesResponse.json()

const places = placesGeo.features
  .map((f) => {
    const [lon, lat] = f.geometry.coordinates
    const { name, scalerank } = f.properties
    // 3 decimals is ~110 m: a label dot does not need better.
    return [name, round3(lon), round3(lat), scalerank]
  })
  .filter(([name]) => typeof name === 'string' && name.length > 0)
  // Most important first, so the renderer can stop at the first N that fit.
  .sort((a, b) => a[3] - b[3])

const placesOut = JSON.stringify(places)
writeFileSync(PLACES_OUT, placesOut)
console.log(`Places in:  ${(JSON.stringify(placesGeo).length / 1e6).toFixed(2)} MB`)
console.log(`Places out: ${(placesOut.length / 1e6).toFixed(2)} MB (${places.length} places)`)
console.log(`Wrote ${PLACES_OUT}`)

function round3(n) {
  return Math.round(n * 1e3) / 1e3
}
