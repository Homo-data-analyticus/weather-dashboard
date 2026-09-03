import { describeWeather, type Enhancements, type Forecast, type Place } from '../api/weather'
import { useEnhancements, useForecast } from '../hooks/useForecast'
import { useRelativeTime } from '../hooks/useRelativeTime'
import { ErrorState } from './ErrorState'
import { ForecastSkeleton } from './Skeletons'
import { StaleBanner } from './StaleBanner'

export function ForecastPanel({ place }: { place: Place }) {
  const query = useForecast(place)
  const { data, error, isError, isPending, isFetching, dataUpdatedAt, failureCount, refetch } = query
  // Never gated on. If this fails we render numbers without decoration.
  const extras = useEnhancements(place).data ?? null
  // Names the panel as a landmark, so it is distinguishable from the map below.
  const headingId = `forecast-heading-${place.id}`

  // First load for this place: nothing to show but structure.
  if (isPending) return <ForecastSkeleton />

  // Failed with nothing cached: the only time a full error state is right.
  if (isError && !data) {
    return (
      <ErrorState
        error={error}
        onRetry={() => refetch()}
        isRetrying={isFetching}
        attempts={failureCount}
      />
    )
  }

  if (!data) return <ForecastSkeleton />

  // The service answered, correctly, with nothing useful.
  if (data.hourly.length === 0) {
    return (
      <section className="card" aria-labelledby={headingId}>
        <h2 id={headingId}>{place.name}</h2>
        <p className="empty">
          No hourly forecast is published for this location right now. Current conditions below are
          still accurate.
        </p>
        <Current forecast={data} extras={extras} />
      </section>
    )
  }

  return (
    <>
      {isError && (
        <StaleBanner updatedAt={dataUpdatedAt} onRetry={() => refetch()} isRetrying={isFetching} />
      )}
      <section
        className={`card${isFetching ? ' card--refreshing' : ''}`}
        aria-labelledby={headingId}
      >
        <header className="card-head">
          <div>
            <h2 id={headingId}>
              {place.name}
              {place.admin1 ? `, ${place.admin1}` : ''}
            </h2>
            <p className="subtle">{place.country}</p>
          </div>
          <Freshness updatedAt={dataUpdatedAt} isFetching={isFetching} />
        </header>

        <Current forecast={data} extras={extras} />

        <ol className="hourly">
          {data.hourly.slice(0, 12).map((slot) => {
            const code = extras?.codesByHour[slot.time]
            const conditions = code == null ? null : describeWeather(code)
            return (
              <li key={slot.time} className="hour">
                <span className="hour-time">{formatHour(slot.time)}</span>
                {conditions && (
                  <span className="hour-icon" role="img" aria-label={conditions.label}>
                    {conditions.icon}
                  </span>
                )}
                <span className="hour-temp">{Math.round(slot.temperature)}°</span>
                <span className="hour-pop">{slot.precipitationProbability}%</span>
              </li>
            )
          })}
        </ol>
      </section>
    </>
  )
}

function Current({ forecast, extras }: { forecast: Forecast; extras: Enhancements | null }) {
  const conditions = extras?.currentCode == null ? null : describeWeather(extras.currentCode)

  return (
    <div className="current">
      <div className="current-main">
        {conditions && (
          <span className="current-icon" role="img" aria-label={conditions.label}>
            {conditions.icon}
          </span>
        )}
        <span className="current-temp">{Math.round(forecast.current.temperature)}°C</span>
      </div>
      <dl className="stats">
        {/* Omitted rather than shown as "--": a missing stat is quieter than a broken one. */}
        {extras?.apparentTemperature != null && (
          <div>
            <dt>Feels like</dt>
            <dd>{Math.round(extras.apparentTemperature)}°C</dd>
          </div>
        )}
        <div>
          <dt>Humidity</dt>
          <dd>{forecast.current.humidity}%</dd>
        </div>
        <div>
          <dt>Wind</dt>
          <dd>{Math.round(forecast.current.windSpeed)} km/h</dd>
        </div>
      </dl>
    </div>
  )
}

function Freshness({ updatedAt, isFetching }: { updatedAt: number; isFetching: boolean }) {
  const relative = useRelativeTime(updatedAt)
  return (
    <p className="freshness" role="status">
      {isFetching ? 'Updating…' : `Updated ${relative}`}
    </p>
  )
}

function formatHour(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric' })
}
