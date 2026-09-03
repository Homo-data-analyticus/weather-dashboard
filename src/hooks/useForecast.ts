import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  fetchEnhancements,
  fetchForecast,
  fetchTemperatureGrid,
  searchPlaces,
  type Place,
} from '../api/weather'

export const queryKeys = {
  places: (query: string) => ['places', query] as const,
  forecast: (place: Place) => ['forecast', place.latitude, place.longitude] as const,
  enhancements: (place: Place) => ['enhancements', place.latitude, place.longitude] as const,
  grid: (place: Place) => ['grid', place.latitude, place.longitude] as const,
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

/**
 * The regional temperature grid behind the map. Same contract as the
 * enhancement query: its own retry budget, and nothing blocks on it.
 */
export function useTemperatureGrid(place: Place | null) {
  return useQuery({
    queryKey: place ? queryKeys.grid(place) : ['grid', 'none'],
    queryFn: ({ signal }) => fetchTemperatureGrid(place!, { signal }),
    enabled: place != null,
    retry: 1,
    // 81 coordinates is a heavy request by this API's accounting. Ten minutes
    // of cache is the difference between a map and a rate-limit problem.
    staleTime: 10 * 60_000,
    refetchInterval: false,
  })
}
