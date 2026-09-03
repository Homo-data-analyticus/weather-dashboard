import { useEffect, useState } from 'react'

const QUERY = '(prefers-color-scheme: dark)'

/**
 * The sequential ramp's anchor flips between modes: the low end has to recede
 * toward whichever surface it sits on. That decision is made in JS (the ramp is
 * data, not CSS), so the mode has to be readable from JS too.
 */
export function usePrefersDark(): boolean {
  const [isDark, setIsDark] = useState(() => read())

  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const onChange = (event: MediaQueryListEvent) => setIsDark(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isDark
}

// jsdom has no matchMedia unless a test provides one, so never assume it.
function read(): boolean {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(QUERY).matches
    : false
}
