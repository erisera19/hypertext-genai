import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The Gemini API key is read here, in the Vite dev server (Node side),
 * and injected into the proxied request. It is never bundled into the
 * client JavaScript, so it does not reach the browser.
 *
 * The browser calls:            POST /api/generate
 * The dev server forwards to:   POST https://generativelanguage.googleapis.com/v1beta/models/<MODEL>:generateContent?key=<KEY>
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const model = env.GEMINI_MODEL || 'gemini-flash-latest'
  const key = env.GEMINI_API_KEY || ''

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api/generate': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: () =>
            `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          configure: (proxy) => {
            proxy.on('proxyReq', () => {
              if (!key) {
                console.warn(
                  '\n[hypertext-genai] GEMINI_API_KEY is not set. ' +
                  'Copy .env.example to .env and add your key, then restart the dev server.\n'
                )
              }
            })
          },
        },
        // Annotation persistence - handled by the separate server in
        // server/index.js (run alongside Vite via `npm run dev`).
        '/api/documents': 'http://localhost:5175',
        '/api/annotations': 'http://localhost:5175',
      },
    },
  }
})
