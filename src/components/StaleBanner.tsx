import { useRelativeTime } from '../hooks/useRelativeTime'

/**
 * The case people forget: we already have data, the refresh failed, and
 * throwing away a five-minute-old forecast to show a red box helps nobody.
 * Keep the data, mark it as old, be honest about the failure.
 */
export function StaleBanner({
  updatedAt,
  onRetry,
  isRetrying,
}: {
  updatedAt: number
  onRetry: () => void
  isRetrying: boolean
}) {
  const relative = useRelativeTime(updatedAt)

  return (
    <div className="banner banner--stale" role="status">
      <span>
        Couldn't refresh — showing data from <strong>{relative}</strong>.
      </span>
      <button className="button button--ghost" onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  )
}
