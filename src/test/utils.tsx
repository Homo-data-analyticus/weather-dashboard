import type { ReactElement, ReactNode } from 'react'
import { QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeQueryClient } from '../query/client'

/**
 * Retries are off by default: a test asserting the error state should not wait
 * out three rounds of backoff first. Tests that are specifically about retrying
 * opt back in via `config`.
 */
export function renderApp(ui: ReactElement, config: QueryClientConfig = {}) {
  const client = makeQueryClient({
    ...config,
    defaultOptions: {
      ...config.defaultOptions,
      queries: {
        retry: false,
        refetchInterval: false,
        refetchOnWindowFocus: false,
        ...config.defaultOptions?.queries,
      },
    },
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  return { client, user: userEvent.setup(), ...render(ui, { wrapper }) }
}
