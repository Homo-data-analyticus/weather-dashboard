import { useId, useState } from 'react'
import type { GridCell, Place, TemperatureGrid } from '../api/weather'
import { useCoastlines } from '../hooks/useCoastlines'
import { useTemperatureGrid } from '../hooks/useForecast'
import { visibleCoastPaths } from './basemap'
import { usePrefersDark } from '../hooks/usePrefersDark'
import { colorForTemperature, rampFor } from './temperatureScale'

/** Plot height in viewBox units; width follows the grid's own aspect. */
const VB_H = 100
/** Gutters for the edge coordinate labels, in the same units. */
const PAD_L = 17
const PAD_B = 11

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
            Current readings sampled on a grid, {'±'}
            {data?.spanLat ?? 1.2}
            {'°'} north to south
          </p>
        </div>
      </header>

      {isPending && <MapSkeleton />}

      {/* The map is a visualization of the forecast, not the forecast. When it
          fails the page is still doing its job, so this is a quiet inline note
          with a retry -- not an alert, and never a red box. */}
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
  const ramp = rampFor(isDark)
  const coastlines = useCoastlines()

  // Longitude was sampled wider than latitude so that the plotted box comes out
  // landscape at true scale; recover that aspect for the viewBox.
  const shrink = Math.max(0.15, Math.cos((grid.center.latitude * Math.PI) / 180))
  const aspect = (grid.spanLon * shrink) / grid.spanLat
  const VB_W = VB_H * aspect

  const cellW = VB_W / (grid.size - 1)
  const cellH = VB_H / (grid.size - 1)
  // Points sit at cell centers, so the lattice runs half a cell past each edge.
  const x = (col: number) => col * cellW - cellW / 2
  const y = (row: number) => row * cellH - cellH / 2

  const noReadings = grid.min == null || grid.max == null

  if (noReadings) {
    return (
      <p className="map-unavailable">
        The grid came back with no readings for this area. The forecast above is unaffected.
      </p>
    )
  }

  const latMax = grid.center.latitude + grid.spanLat
  const latMin = grid.center.latitude - grid.spanLat
  const lonMin = grid.center.longitude - grid.spanLon
  const lonMax = grid.center.longitude + grid.spanLon

  // x and y are linear in longitude and latitude: the plot box spans exactly
  // the sampled extent, so the basemap and the cells share one transform.
  const project = (lon: number, lat: number): [number, number] => [
    ((lon - lonMin) / (lonMax - lonMin)) * VB_W,
    ((latMax - lat) / (latMax - latMin)) * VB_H,
  ]
  const coastPaths = coastlines
    ? visibleCoastPaths(coastlines, { lonMin, lonMax, latMin, latMax }, project)
    : []

  return (
    <figure className="map-figure">
      <svg
        className="map-svg"
        viewBox={`0 0 ${VB_W + PAD_L} ${VB_H + PAD_B}`}
        role="img"
        aria-label={`Temperature grid around ${place.name}, ranging from ${Math.round(
          grid.min!,
        )} to ${Math.round(grid.max!)} degrees Celsius`}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={VB_W} height={VB_H} />
          </clipPath>
        </defs>

        <g transform={`translate(${PAD_L} 0)`}>
          <g clipPath={`url(#${clipId})`}>
            {grid.cells.map((cell) => (
              <rect
                key={`${cell.row}-${cell.col}`}
                x={x(cell.col)}
                y={y(cell.row)}
                width={cellW}
                height={cellH}
                fill={colorForTemperature(cell.temperature, grid.min, grid.max, ramp)}
                className="map-cell"
                onMouseEnter={() => setHovered(cell)}
              />
            ))}

            {/* Coastlines sit above the field: they are reference, and the
                reader needs to see which cells are over water. Each is drawn
                twice -- a surface-coloured casing under a thin ink stroke --
                so it stays legible over any step of the ramp. */}
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

            {/* The ring is drawn after every cell, not as a style on the
                hovered one: a stroke sits on the shared edge, so the cells
                painted later would cover half of it. */}
            {hovered && (
              <rect
                className="map-cell-ring"
                x={x(hovered.col)}
                y={y(hovered.row)}
                width={cellW}
                height={cellH}
              />
            )}
          </g>

          <rect x={0} y={0} width={VB_W} height={VB_H} className="map-frame" />

          {/* The city itself: a ringed dot so it reads on any ramp step. */}
          <g className="map-pin" transform={`translate(${VB_W / 2} ${VB_H / 2})`}>
            <circle r={3.6} className="map-pin-halo" />
            <circle r={1.8} className="map-pin-dot" />
          </g>
        </g>

        {/* Edge labels rather than a graticule over the field: the box extent
            is the geographic reference, and it does not compete with the data. */}
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
            : 'Hover a cell for its reading.'}
        </p>
      </figcaption>
    </figure>
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
