/**
 * Skeletons mirror the real layout's box sizes so nothing jumps when data
 * lands. A centered spinner would be less code and a worse experience.
 */
export function ForecastSkeleton() {
  return (
    <section className="card" aria-busy="true" aria-label="Loading forecast" data-testid="forecast-skeleton">
      <div className="skeleton skeleton--title" />
      <div className="current">
        <div className="skeleton skeleton--temp" />
        <div className="stats">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton skeleton--stat" />
          ))}
        </div>
      </div>
      <div className="hourly">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton skeleton--hour" />
        ))}
      </div>
    </section>
  )
}

export function ResultsSkeleton() {
  return (
    <ul className="results" aria-busy="true" aria-label="Searching" data-testid="results-skeleton">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i}>
          <div className="skeleton skeleton--row" />
        </li>
      ))}
    </ul>
  )
}
