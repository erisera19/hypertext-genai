
 // Starts the real server for a test, against a throwaway database.


import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** A port unlikely to collide with a dev server or another test file. */
function freePort() {
  return 5300 + Math.floor(Math.random() * 600)
}

export async function startServer(env = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'glossonomy-test-'))
  const port = freePort()

  const child = spawn('node', ['server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      NODE_ENV: 'test',
      // Deliberately absent, so nothing here can reach Google.
      GEMINI_API_KEY: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const logs = []
  child.stdout.on('data', (d) => logs.push(String(d)))
  child.stderr.on('data', (d) => logs.push(String(d)))

  const base = `http://127.0.0.1:${port}`

  // Poll rather than parse the banner: the port is open when it answers.
  const deadline = Date.now() + 15_000
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (${child.exitCode}):\n${logs.join('')}`)
    }
    try {
      await fetch(`${base}/api/auth/me`)
      break
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`server did not start in time:\n${logs.join('')}`)
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  return {
    base,
    dataDir,
    logs,
    async stop() {
      child.kill('SIGTERM')
      await new Promise((r) => child.once('exit', r))
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

/**
 * A browser-ish client: one per account, holding its own session cookie, so a
 * test can act as two different people against the same server.
 */
export function client(base) {
  let cookie = null

  async function request(path, { method = 'GET', body, raw, query, headers = {} } = {}) {
    const url = query ? `${base}${path}?${new URLSearchParams(query)}` : `${base}${path}`

    const res = await fetch(url, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    })

    const setCookie = res.headers.getSetCookie?.()[0] || res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]

    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      // Not every response is JSON - 204s and file bodies are not.
    }

    return { status: res.status, headers: res.headers, body: json, text }
  }

  return {
    request,
    get cookie() {
      return cookie
    },
    register: (email, password) =>
      request('/api/auth/register', { method: 'POST', body: { email, password } }),
    login: (email, password) =>
      request('/api/auth/login', { method: 'POST', body: { email, password } }),
    upload: (bytes, { title, format }) =>
      request('/api/documents', { method: 'POST', raw: bytes, query: { title, format } }),
  }
}
