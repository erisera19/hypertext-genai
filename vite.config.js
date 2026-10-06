import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Development only. Vite serves the app and forwards every /api/ call to the
 * server in `server/`, which owns all of them - accounts, documents, and the
 * model proxy that attaches the API key.
 */

const SERVER = `http://localhost:${process.env.PERSISTENCE_PORT || 5175}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/generate': SERVER,
      '/api/auth': SERVER,
      '/api/library': SERVER,
      '/api/documents': SERVER,
      '/api/annotations': SERVER,
    },
  },
})
