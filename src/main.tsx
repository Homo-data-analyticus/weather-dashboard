import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import App from './App'
import { makeQueryClient } from './query/client'
import './index.css'

const queryClient = makeQueryClient()

async function start() {
  // `VITE_MSW=1 npm run dev` runs the app against the mock handlers, so you can
  // click through 500s, timeouts and rate limits without waiting for the real
  // API to have a bad day.
  if (import.meta.env.VITE_MSW === '1') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

start()
