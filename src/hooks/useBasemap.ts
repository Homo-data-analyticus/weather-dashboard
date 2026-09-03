import { useEffect, useState } from 'react'
import { loadCoastlines, type CoastLine } from '../components/basemap'
import { loadPlaces, type Landmark } from '../components/places'

/**
 * The coastline, once it has loaded. Null until then, and null forever if the
 * chunk fails to load — the map draws its data layer either way.
 */
export function useCoastlines(): readonly CoastLine[] | null {
  const [lines, setLines] = useState<readonly CoastLine[] | null>(null)

  useEffect(() => {
    let live = true
    loadCoastlines()
      .then((loaded) => live && setLines(loaded))
      // A missing basemap is a missing outline, not a broken page. There is
      // nothing for the reader to do about it, so nothing is shown.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  return lines
}

/**
 * Populated places, on the same terms as the coastline: lazily imported, and
 * absent rather than error-reported if the chunk never arrives.
 */
export function usePlaces(): readonly Landmark[] | null {
  const [places, setPlaces] = useState<readonly Landmark[] | null>(null)

  useEffect(() => {
    let live = true
    loadPlaces()
      .then((loaded) => live && setPlaces(loaded))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  return places
}
