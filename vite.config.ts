import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The coastline basemap is ~1.28 MB (364 kB gzipped) and is deliberately
    // its own lazily imported chunk: it never touches the initial load, which
    // stays around 77 kB gzipped. Raised past that one chunk so a real
    // regression in the app bundle still trips the warning.
    chunkSizeWarningLimit: 1400,
  },
})
