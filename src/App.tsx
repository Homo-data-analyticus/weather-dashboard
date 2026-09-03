import { useState } from 'react'
import type { Place } from './api/weather'
import { ErrorState } from './components/ErrorState'
import { ForecastPanel } from './components/ForecastPanel'
import { WeatherMap } from './components/WeatherMap'
import { ResultsSkeleton } from './components/Skeletons'
import { useDebounced } from './hooks/useDebounced'
import { usePlaceSearch } from './hooks/useForecast'

export default function App() {
  const [query, setQuery] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const debounced = useDebounced(query)
  const search = usePlaceSearch(debounced)

  const showResults = debounced.trim().length >= 2 && !place

  return (
    <main className="app">
      <h1>Weather</h1>

      <label className="search">
        <span className="visually-hidden">Search for a city</span>
        <input
          type="search"
          placeholder="Search for a city…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPlace(null)
          }}
          autoComplete="off"
        />
      </label>

      {showResults && (
        <>
          {search.isPending && <ResultsSkeleton />}

          {search.isError && (
            <ErrorState error={search.error} onRetry={() => search.refetch()} isRetrying={search.isFetching} />
          )}

          {search.data?.length === 0 && (
            <p className="empty" role="status">
              No places match “{debounced}”. Try a different spelling.
            </p>
          )}

          {search.data && search.data.length > 0 && (
            <ul className="results">
              {search.data.map((candidate) => (
                <li key={candidate.id}>
                  <button className="result" onClick={() => setPlace(candidate)}>
                    <strong>{candidate.name}</strong>
                    <span className="subtle">
                      {[candidate.admin1, candidate.country].filter(Boolean).join(', ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {place && (
        <>
          <ForecastPanel place={place} />
          <WeatherMap place={place} />
        </>
      )}

      {!place && !showResults && (
        <p className="empty">Search for a city to see current conditions and the next 12 hours.</p>
      )}
    </main>
  )
}
