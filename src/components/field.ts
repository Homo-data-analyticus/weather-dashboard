import type { TemperatureGrid } from '../api/weather'

/**
 * Sampling and upsampling for the temperature field.
 *
 * The API gives 9x9 readings. Drawn as 81 rectangles that reads as a mosaic,
 * which is a claim about the weather that is not true: temperature does not
 * step at cell boundaries. Bilinear interpolation between the samples is both
 * better looking and closer to the physics.
 *
 * The interpolated surface is for *display*. Every number the UI states — the
 * hover readout, the legend bounds — still comes from a real sample.
 */

/** Fractional position of a coordinate in grid-index space (0 .. size-1). */
export function toGridIndex(
  grid: TemperatureGrid,
  latitude: number,
  longitude: number,
): { row: number; col: number } {
  const latMax = grid.center.latitude + grid.spanLat
  const latMin = grid.center.latitude - grid.spanLat
  const lonMin = grid.center.longitude - grid.spanLon
  const lonMax = grid.center.longitude + grid.spanLon
  const last = grid.size - 1

  return {
    row: ((latMax - latitude) / (latMax - latMin)) * last,
    col: ((longitude - lonMin) / (lonMax - lonMin)) * last,
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function readCell(grid: TemperatureGrid, row: number, col: number): number | null {
  const r = clamp(row, 0, grid.size - 1)
  const c = clamp(col, 0, grid.size - 1)
  return grid.cells[r * grid.size + c]?.temperature ?? null
}

/**
 * Bilinear sample at a fractional grid position, clamped at the edges so the
 * field can be evaluated slightly outside the box (which the blur needs).
 *
 * Nulls are contagious in the wrong way if handled naively: one missing corner
 * would punch a hole through a region that is otherwise fully sampled. Instead
 * the present corners are re-weighted among themselves, and only an entirely
 * missing neighbourhood returns null.
 */
export function bilinearAt(grid: TemperatureGrid, row: number, col: number): number | null {
  const r0 = Math.floor(clamp(row, 0, grid.size - 1))
  const c0 = Math.floor(clamp(col, 0, grid.size - 1))
  const r1 = Math.min(r0 + 1, grid.size - 1)
  const c1 = Math.min(c0 + 1, grid.size - 1)

  const fr = clamp(row, 0, grid.size - 1) - r0
  const fc = clamp(col, 0, grid.size - 1) - c0

  const corners = [
    { value: readCell(grid, r0, c0), weight: (1 - fr) * (1 - fc) },
    { value: readCell(grid, r0, c1), weight: (1 - fr) * fc },
    { value: readCell(grid, r1, c0), weight: fr * (1 - fc) },
    { value: readCell(grid, r1, c1), weight: fr * fc },
  ]

  let sum = 0
  let weight = 0
  for (const corner of corners) {
    if (corner.value == null || corner.weight === 0) continue
    sum += corner.value * corner.weight
    weight += corner.weight
  }
  return weight === 0 ? null : sum / weight
}

/** Bilinear sample at a real-world coordinate. */
export function sampleAt(
  grid: TemperatureGrid,
  latitude: number,
  longitude: number,
): number | null {
  const { row, col } = toGridIndex(grid, latitude, longitude)
  // Outside the sampled box there is nothing to interpolate from, and clamping
  // would invent a reading for a place the request never covered.
  if (row < 0 || col < 0 || row > grid.size - 1 || col > grid.size - 1) return null
  return bilinearAt(grid, row, col)
}

export interface FieldCell {
  /** Column and row in the upsampled lattice; may be -1 or N for the bleed. */
  i: number
  j: number
  temperature: number | null
}

/**
 * The upsampled lattice used for drawing.
 *
 * `factor` cells are produced per gap between samples, so a 9x9 grid at
 * factor 4 becomes 32x32 cells that tile the plot exactly. One extra ring of
 * cells is generated outside the box so the blur has material to work with at
 * the edges instead of fading into transparency.
 */
export function upsampleField(grid: TemperatureGrid, factor: number): FieldCell[] {
  const n = (grid.size - 1) * factor
  const cells: FieldCell[] = []

  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      cells.push({
        i,
        j,
        // Cell centres, in grid-index units.
        temperature: bilinearAt(grid, (j + 0.5) / factor, (i + 0.5) / factor),
      })
    }
  }
  return cells
}
