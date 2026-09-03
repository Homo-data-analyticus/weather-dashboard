/**
 * Sequential color scale for the temperature grid.
 *
 * One hue, light to dark — never a rainbow. The hue is the design system's
 * orange rather than its default sequential blue, because on a weather map
 * "darker blue = hotter" fights an association every reader already has.
 *
 * The steps are the documented blue ramp's exact OKLCH lightness skeleton
 * re-hued to orange, so lightness stays monotonic across the ramp (the check
 * that actually applies to a sequential scale) while the hue carries warmth.
 */
export const TEMPERATURE_RAMP = [
  '#ffd5c6', // 100 — coolest
  '#ffbfa8', // 150
  '#ffa98a', // 200
  '#ff9067', // 250
  '#ff743d', // 300
  '#f65d13', // 350
  '#e15000', // 400
  '#cb4700', // 450
  '#b53e00', // 500
  '#9f3600', // 550
  '#8a2d00', // 600
  '#762500', // 650
  '#621d00', // 700 — warmest
] as const

/** Shown when a sample point returned no reading. Never a ramp color. */
export const NO_READING = 'var(--map-gap)'

/**
 * In dark mode the ramp's anchor flips: the low end has to recede toward the
 * surface, so the dark steps sit at the cool end instead of the warm one.
 */
export function rampFor(isDark: boolean): readonly string[] {
  return isDark ? [...TEMPERATURE_RAMP].reverse() : TEMPERATURE_RAMP
}

/**
 * Map a reading onto a ramp step.
 *
 * A degenerate range (every point identical, or a single sample) has no
 * magnitude to encode, so it takes the ramp's midpoint rather than dividing by
 * zero and painting the whole map the extreme color.
 */
export function colorForTemperature(
  temperature: number | null,
  min: number | null,
  max: number | null,
  ramp: readonly string[],
): string {
  if (temperature == null || min == null || max == null) return NO_READING

  const span = max - min
  if (span < 0.01) return ramp[Math.floor(ramp.length / 2)]

  const t = (temperature - min) / span
  const index = Math.round(t * (ramp.length - 1))
  return ramp[Math.min(ramp.length - 1, Math.max(0, index))]
}
