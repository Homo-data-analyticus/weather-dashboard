import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchEnhancements, fetchForecast, searchPlaces, type Place } from '../api/weather'

export const queryKeys = {
  places: (query: string) => ['places', query] as const,
  forecast: (place: Place) => ['forecast', place.latitude, place.longitude] as const,
  enhancements: (place: Place) => ['enhancements', place.latitude, place.longitude] as const,
}

export function usePlaceSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.places(query),
    queryFn: ({ signal }) => searchPlaces(query, { signal }),
    enabled: query.trim().length >= 2,
    // Place names do not move. Cache them hard to stay inside the rate limit.
    staleTime: 60 * 60_000,
    refetchInterval: false,
  })
}

export function useForecast(place: Place | null) {
  return useQuery({
    queryKey: place ? queryKeys.forecast(place) : ['forecast', 'none'],
    queryFn: ({ signal }) => fetchForecast(place!, { signal }),
    enabled: place != null,
    // Switching cities keeps the old city's numbers on screen (dimmed) instead
    // of flashing skeletons for data we are about to replace.
    placeholderData: keepPreviousData,
  })
}

/**
 * Its own query so its failure is its own problem: separate cache entry,
 * separate retry budget, and nothing in the UI waits on it.
 */
export function useEnhancements(place: Place | null) {
  return useQuery({
    queryKey: place ? queryKeys.enhancements(place) : ['enhancements', 'none'],
    queryFn: ({ signal }) => fetchEnhancements(place!, { signal }),
    enabled: place != null,
    // Decorative data is not worth hammering a struggling endpoint for.
    retry: 1,
    staleTime: 10 * 60_000,
  })
}
