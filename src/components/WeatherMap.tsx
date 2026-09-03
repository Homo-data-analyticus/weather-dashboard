import { useId, useMemo, useState } from 'react'
import type { GridCell, Place, TemperatureGrid } from '../api/weather'
import { useCoastlines, usePlaces } from '../hooks/useBasemap'
import { useTemperatureGrid } from '../hooks/useForecast'
import { usePrefersDark } from '../hooks/usePrefersDark'
import { visibleCoastPaths } from './basemap'
import { sampleAt, upsampleField } from './field'
import { layoutLabels } from './places'
import { colorForTemperature, rampFor } from './temperatureScale'

/** Plot height in viewBox units; width follows the grid's own aspect. */
const VB_H = 100
/** Gutters for the edge coordinate labels, in the same units. */
const PAD_L = 17
const PAD_B = 11
/**
 * Interpolated cells per gap between samples. 4 turns the 9x9 request into a
 * 32x32 lattice — past that the blur is doing the work anyway and the DOM grows
 * for nothing.
 */
const UPSAMPLE = 4
/** At most this many place labels. More is clutter, not reference. */
const LABEL_LIMIT = 7
/** Label metrics in viewBox units, matching the font sizes in the stylesheet. */
const LABEL_HEIGHT = 5
/**
 * Approximate advance width per character at the label's font size. Measuring
 * text properly means laying it out in the DOM; for collision boxes an
 * over-estimate is the safe error, since it only ever drops a label.
 */
const LABEL_CHAR = 2
/** The dot, the gap, and the " 25°" the temperature adds. */
const LABEL_PADDING = 9

export function WeatherMap({ place }: { place: Place }) {
  const { data, isPending, isError, isFetching, refetch } = useTemperatureGrid(place)
  const isDark = usePrefersDark()

  return (
    <section className="card map-card" aria-labelledby={`map-heading-${place.id}`}>
      <header className="card-head">
        <div>
          <h2 id={`map-heading-${place.id}`} className="map-title">
            Temperature around {place.name}
          </h2>
          <p className="subtle">
            Sampled on a grid {'±'}
            {data?.spanLat ?? 1.2}
            {'°'} north to south, smoothed between readings
          </p>
        </div>
      </header>

      {isPending && <MapSkeleton />}

      {/* The map is a visualization of the forecast, not the forecast. When it
          fails the page is still doing its job, so this is a quiet inline note
          with a retry — not an alert, and never a red box. */}
      {isError && (
        <p className="map-unavailable">
          The temperature map is unavailable right now.{' '}
          <button className="link-button" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Retrying…' : 'Retry'}
          </button>
        </p>
      )}

      {data && <GridPlot grid={data} place={place} isDark={isDark} />}
    </section>
  )
}

function GridPlot({
  grid,
  place,
  isDark,
}: {
  grid: TemperatureGrid
  place: Place
  isDark: boolean
}) {
  const [hovered, setHovered] = useState<GridCell | null>(null)
  const clipId = useId()
  const blurId = useId()
  const ramp = rampFor(isDark)
  const coastlines = useCoastlines()
  const places = usePlaces()

  // Longitude was sampled wider than latitude so the plotted box comes out
  // landscape at true scale; recover that aspect for the viewBox.
  const shrink = Math.max(0.15, Math.cos((grid.center.latitude * Math.PI) / 180))
  const aspect = (grid.spanLon * shrink) / grid.spanLat
  const VB_W = VB_H * aspect

  const noReadings = grid.min == null || grid.max == null

  const latMax = grid.center.latitude + grid.spanLat
  const latMin = grid.center.latitude - grid.spanLat
  const lonMin = grid.center.longitude - grid.spanLon
  const lonMax = grid.center.longitude + grid.spanLon

  // x and y are linear in longitude and latitude: the plot box spans exactly
  // the sampled extent, so every layer shares one transform.
  const project = (lon: number, lat: number): [number, number] => [
    ((lon - lonMin) / (lonMax - lonMin)) * VB_W,
    ((latMax - lat) / (latMax - latMin)) * VB_H,
  ]

  // ~1100 rects that do not depend on the pointer, so the surface is built once
  // per grid and reused across every hover render.
  const field = useMemo(() => {
    if (noReadings) return null
    const n = (grid.size - 1) * UPSAMPLE
    const w = VB_W / n
    const h = VB_H / n
    return (
      <g className="map-field" filter={`url(#${blurId})`} data-testid="map-field">
        {upsampleField(grid, UPSAMPLE).map((cell) => (
          <rect
            key={`${cell.j}-${cell.i}`}
            x={cell.i * w}
            y={cell.j * h}
            // A hairline of overlap: abutting rects otherwise leave seams that
            // the blur then smears into a visible lattice.
            width={w + 0.05}
            height={h + 0.05}
            fill={colorForTemperature(cell.temperature, grid.min, grid.max, ramp)}
          />
        ))}
      </g>
    )
  }, [grid, ramp, VB_W, blurId, noReadings])

  if (noReadings) {
    return (
      <p className="map-unavailable">
        The grid came back with no readings for this area. The forecast above is unaffected.
      </p>
    )
  }

  const coastPaths = coastlines
    ? visibleCoastPaths(coastlines, { lonMin, lonMax, latMin, latMax }, project)
    : []

  const [pinX, pinY] = project(place.longitude, place.latitude)
  const labelWidth = (name: string) => name.length * LABEL_CHAR + LABEL_PADDING
  const labels = places
    ? layoutLabels(places, { lonMin, lonMax, latMin, latMax }, project, {
        width: labelWidth,
        height: LABEL_HEIGHT,
        limit: LABEL_LIMIT,
        bounds: { width: VB_W, height: VB_H },
        // The searched city already has a label at the pin, in a larger face;
        // nothing else may sit on top of it.
        reserved: [
          {
            x: pinX - LABEL_HEIGHT / 4,
            y: pinY - LABEL_HEIGHT / 2,
            width: labelWidth(place.name) * 1.2,
            height: LABEL_HEIGHT * 1.2,
          },
        ],
      })
    : []

  const cellW = VB_W / (grid.size - 1)
  const cellH = VB_H / (grid.size - 1)
  const hitX = (col: number) => col * cellW - cellW / 2
  const hitY = (row: number) => row * cellH - cellH / 2

  return (
    <figure className="map-figure">
      <svg
        className="map-svg"
        viewBox={`0 0 ${VB_W + PAD_L} ${VB_H + PAD_B}`}
        role="img"
        aria-label={`Temperature around ${place.name}, ranging from ${Math.round(
          grid.min!,
        )} to ${Math.round(grid.max!)} degrees Celsius`}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={VB_W} height={VB_H} />
          </clipPath>
          {/* Softens what is left of the lattice after interpolation. Kept
              below one interpolated cell, so it smooths seams without
              inventing structure the samples do not support. */}
          <filter id={blurId} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={VB_W / ((grid.size - 1) * UPSAMPLE) / 1.6} />
          </filter>
        </defs>

        <g transform={`translate(${PAD_L} 0)`}>
          <g clipPath={`url(#${clipId})`}>
            {field}

            {/* Coastlines sit above the field: they are reference, and the
                reader needs to see what is over water. Each is drawn twice — a
                surface-coloured casing under a thin ink stroke — so it stays
                legible over any step of the ramp. */}
            {coastPaths.length > 0 && (
              <g className="map-coast" data-testid="map-coastlines">
                {coastPaths.map((d, i) => (
                  <path key={`casing-${i}`} className="map-coast-casing" d={d} />
                ))}
                {coastPaths.map((d, i) => (
                  <path key={`line-${i}`} className="map-coast-line" d={d} />
                ))}
              </g>
            )}

            {labels.length > 0 && (
              <g className="map-labels" data-testid="map-labels">
                {labels.map((label) => (
                  <PlaceLabel
                    key={`${label.name}-${label.x}`}
                    x={label.x}
                    y={label.y}
                    name={label.name}
                    temperature={sampleAt(grid, label.latitude, label.longitude)}
                  />
                ))}
              </g>
            )}

            {/* Hit targets are the real 9x9 samples, not the interpolated
                lattice: the readout must report a measurement, never a pixel
                the renderer invented. */}
            <g className="map-hits">
              {grid.cells.map((cell) => (
                <rect
                  key={`${cell.row}-${cell.col}`}
                  x={hitX(cell.col)}
                  y={hitY(cell.row)}
                  width={cellW}
                  height={cellH}
                  className="map-hit"
                  onMouseEnter={() => setHovered(cell)}
                />
              ))}
            </g>

            {hovered && (
              <rect
                className="map-cell-ring"
                x={hitX(hovered.col)}
                y={hitY(hovered.row)}
                width={cellW}
                height={cellH}
              />
            )}
          </g>

          <rect x={0} y={0} width={VB_W} height={VB_H} className="map-frame" />

          {/* The searched city, labelled: the one reference point the reader
              definitely came here for. */}
          <g className="map-pin" transform={`translate(${pinX} ${pinY})`}>
            <circle r={3.4} className="map-pin-halo" />
            <circle r={1.7} className="map-pin-dot" />
            <text className="map-pin-label-casing" x={5} y={1.7}>
              {place.name}
            </text>
            <text className="map-pin-label" x={5} y={1.7}>
              {place.name}
            </text>
          </g>
        </g>

        {/* Edge labels rather than a graticule over the field: the box extent
            is geographic reference that does not compete with the data. */}
        <g className="map-axis">
          <text x={PAD_L - 3} y={3.5} textAnchor="end">
            {formatCoord(latMax, 'N', 'S')}
          </text>
          <text x={PAD_L - 3} y={VB_H} textAnchor="end">
            {formatCoord(latMin, 'N', 'S')}
          </text>
          <text x={PAD_L} y={VB_H + PAD_B - 2} textAnchor="start">
            {formatCoord(lonMin, 'E', 'W')}
          </text>
          <text x={PAD_L + VB_W} y={VB_H + PAD_B - 2} textAnchor="end">
            {formatCoord(lonMax, 'E', 'W')}
          </text>
        </g>
      </svg>

      <figcaption className="map-caption">
        <Legend min={grid.min!} max={grid.max!} ramp={ramp} />
        <p className="map-readout" role="status">
          {hovered
            ? `${formatTemp(hovered.temperature)} at ${formatCoord(hovered.latitude, 'N', 'S')}, ${formatCoord(
                hovered.longitude,
                'E',
                'W',
              )}`
            : 'Hover the map for a sampled reading.'}
        </p>
      </figcaption>
    </figure>
  )
}

/**
 * A place name with its interpolated temperature, stroked twice so it stays
 * readable over any part of the field.
 */
function PlaceLabel({
  x,
  y,
  name,
  temperature,
}: {
  x: number
  y: number
  name: string
  temperature: number | null
}) {
  const text = temperature == null ? name : `${name} ${Math.round(temperature)}°`
  return (
    <g className="map-label" transform={`translate(${x} ${y})`}>
      <circle r={0.9} className="map-label-dot" />
      <text className="map-label-casing" x={2.4} y={1.2}>
        {text}
      </text>
      <text className="map-label-text" x={2.4} y={1.2}>
        {text}
      </text>
    </g>
  )
}

function Legend({ min, max, ramp }: { min: number; max: number; ramp: readonly string[] }) {
  return (
    <div className="map-legend">
      <span className="map-legend-end">{Math.round(min)}°</span>
      <span className="map-legend-ramp" aria-hidden="true">
        {ramp.map((color) => (
          <span key={color} style={{ background: color }} />
        ))}
      </span>
      <span className="map-legend-end">{Math.round(max)}°</span>
      <span className="map-legend-label">cooler to warmer (°C)</span>
    </div>
  )
}

function MapSkeleton() {
  return (
    <div className="map-figure" aria-busy="true" aria-label="Loading temperature map">
      <div className="skeleton map-skeleton" data-testid="map-skeleton" />
    </div>
  )
}

const formatTemp = (t: number | null) => (t == null ? 'No reading' : `${Math.round(t)}°C`)

function formatCoord(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`
}
