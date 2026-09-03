import { describeError } from '../api/errors'

/**
 * A useful error state answers three questions: what broke, whose fault it is,
 * and what I can do now. "Something went wrong" answers none of them.
 */
export function ErrorState({
  error,
  onRetry,
  isRetrying,
  attempts,
}: {
  error: unknown
  onRetry: () => void
  isRetrying?: boolean
  attempts?: number
}) {
  const { title, detail, retryable } = describeError(error)

  return (
    <section className="card card--error" role="alert">
      <h2 className="error-title">{title}</h2>
      <p className="error-detail">{detail}</p>
      {attempts != null && attempts > 1 && (
        <p className="error-meta">Gave up after {attempts} attempts with backoff.</p>
      )}
      {retryable ? (
        <button className="button" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? 'Retrying…' : 'Try again'}
        </button>
      ) : (
        <p className="error-meta">Search for a different location above.</p>
      )}
    </section>
  )
}
