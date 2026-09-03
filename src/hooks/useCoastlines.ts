import { useEffect, useState } from 'react'
import { loadCoastlines, type CoastLine } from '../components/basemap'

/**
 * The basemap, once it has loaded. Null until then, and null forever if the
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
