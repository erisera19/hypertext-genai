/**
 * The server: accounts, library, annotations, the model proxy, and in a
 * deployment the built app itself.
 *
 * In development Vite serves the app on 5173 and forwards every /api/ call
 * here, so the code path under test is the one that ships. In a deployment
 * this process is the whole thing: `npm run build` then `npm start`.
 *
 * Guest use needs none of the account routes: the reader can open a document
 * and ask questions without one. What an account adds is a library of what
 * you have opened and the notes you made on it - and, once this is on a
 * public URL, it is also what stops a stranger spending the API key.
 */

import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createUser,
  findUserByEmail,
  insertDocument,
  getDocument,
  touchLibraryEntry,
  listLibrary,
  isInLibrary,
  removeLibraryEntry,
  listAnnotations,
  insertAnnotation,
  deleteAnnotation,
} from './db.js'
import {
  hashPassword,
  verifyPassword,
  startSession,
  endSession,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireUser,
} from './auth.js'
import { store, read, isStored, isValidHash, MAX_BYTES } from './files.js'
import { mountGenerate } from './generate.js'

// Hosts hand the port over in PORT; PERSISTENCE_PORT stays for local runs.
const PORT = process.env.PORT || process.env.PERSISTENCE_PORT || 5175

/*
 * Open sign-up is right for a tool anyone can try and not needed for a closed
 * study.
 * Set ALLOW_SIGNUP=false to shut the door.
 */
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false'

const app = express()

// Behind a platform's TLS terminator the app itself speaks HTTP, so the
// forwarded headers are what tell it the reader is on HTTPS. That in turn is
// what decides whether the session cookie gets its `secure` flag.
app.set('trust proxy', 1)

app.use(express.json())
app.use(attachUser)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8
const FORMATS = new Set(['pdf', 'docx', 'txt', 'md'])

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
}

const publicUser = (user) => ({ id: user.id, email: user.email })

/* ---------- accounts ---------- */

app.post('/api/auth/register', async (req, res) => {
  if (!ALLOW_SIGNUP) {
    res.status(403).json({ error: 'This copy is not accepting new accounts.' })
    return
  }

  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')

  if (!EMAIL.test(email)) {
    res.status(400).json({ error: 'Enter a valid email address.' })
    return
  }
  if (password.length < MIN_PASSWORD) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` })
    return
  }
  if (findUserByEmail(email)) {
    res.status(409).json({ error: 'An account with that email already exists.' })
    return
  }

  const user = createUser({ email, passwordHash: await hashPassword(password) })
  setSessionCookie(req, res, startSession(user.id))
  res.status(201).json({ user: publicUser(user) })
})

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')

  const user = findUserByEmail(email)
  // Same message either way, so the response does not reveal which
  // addresses have accounts.
  const wrong = () => res.status(401).json({ error: 'Email or password is incorrect.' })
  if (!user) {
    wrong()
    return
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    wrong()
    return
  }

  setSessionCookie(req, res, startSession(user.id))
  res.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', (req, res) => {
  endSession(req.sessionToken)
  clearSessionCookie(req, res)
  res.status(204).end()
})

// `signupAllowed` lets the sign-in panel hide the create-account route
// rather than offer one the server will refuse.
app.get('/api/auth/me', (req, res) => {
  res.json({
    user: req.user ? publicUser(req.user) : null,
    signupAllowed: ALLOW_SIGNUP,
  })
})

/* ---------- library ---------- */

app.get('/api/library', requireUser, (req, res) => {
  res.json({ documents: listLibrary(req.user.id) })
})

app.delete('/api/library/:hash', requireUser, (req, res) => {
  const { hash } = req.params
  if (!isValidHash(hash)) {
    res.status(400).json({ error: 'Invalid document hash' })
    return
  }
  const removed = removeLibraryEntry({ userId: req.user.id, documentHash: hash })
  res.status(removed ? 204 : 404).end()
})

/* ---------- documents ---------- */

/**
 * Uploads a document the reader just opened from disk. The body is the raw
 * file; title and format travel as query params so no multipart parser is
 * needed. Storing is what makes the library able to reopen a document
 * without asking for the file again, so this requires an account.
 */
app.post(
  '/api/documents',
  requireUser,
  // `type: () => true` parses the body whatever the Content-Type says, or
  // even with none at all - fetch sends no Content-Type for an ArrayBuffer,
  // and a '*/*' matcher rejects that, leaving the body empty.
  express.raw({ type: () => true, limit: MAX_BYTES }),
  async (req, res) => {
    const title = String(req.query.title || '').trim() || 'Untitled'
    const format = String(req.query.format || '').toLowerCase()

    if (!FORMATS.has(format)) {
      res.status(400).json({ error: `Unsupported format: ${format}` })
      return
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Empty upload' })
      return
    }

    // The hash comes from the bytes we actually received, never from the
    // client, so a stored file always matches its name.
    const hash = await store(req.body)
    insertDocument({ hash, format, byteSize: req.body.length })
    touchLibraryEntry({ userId: req.user.id, documentHash: hash, title })

    res.status(201).json({
      document: { hash, title, format },
      annotations: listAnnotations({ userId: req.user.id, documentHash: hash }),
    })
  }
)

/** Reopening from the library: records the visit and returns saved notes. */
app.post('/api/documents/:hash/open', requireUser, (req, res) => {
  const { hash } = req.params
  if (!isValidHash(hash) || !getDocument(hash) || !isStored(hash)) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  if (!isInLibrary({ userId: req.user.id, documentHash: hash })) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const entry = listLibrary(req.user.id).find((d) => d.hash === hash)
  touchLibraryEntry({ userId: req.user.id, documentHash: hash, title: entry.title })

  res.json({
    document: { hash, title: entry.title, format: entry.format },
    annotations: listAnnotations({ userId: req.user.id, documentHash: hash }),
  })
})

/**
 * The stored bytes, for re-rendering a document opened from the library.
 * Restricted to documents in the caller's own library - the hash alone is
 * not an access grant, or knowing it would be enough to read anyone's file.
 */
app.get('/api/documents/:hash/file', requireUser, async (req, res) => {
  const { hash } = req.params
  if (!isValidHash(hash) || !isStored(hash)) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  if (!isInLibrary({ userId: req.user.id, documentHash: hash })) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const doc = getDocument(hash)
  res.type(MIME[doc.format] || 'application/octet-stream')
  res.send(await read(hash))
})

/* ---------- annotations ---------- */

app.post('/api/annotations', requireUser, (req, res) => {
  const { documentHash, operationId, selection, location, response, anchor } = req.body || {}

  if (!isValidHash(documentHash) || !getDocument(documentHash)) {
    res.status(400).json({ error: 'Unknown document' })
    return
  }
  if (!isInLibrary({ userId: req.user.id, documentHash })) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  for (const [field, value] of Object.entries({ operationId, selection, response })) {
    if (!value) {
      res.status(400).json({ error: `Missing field: ${field}` })
      return
    }
  }

  const saved = insertAnnotation({
    userId: req.user.id,
    documentHash,
    operationId,
    selection,
    location,
    response,
    anchor,
  })
  res.status(201).json(saved)
})

app.delete('/api/annotations/:id', requireUser, (req, res) => {
  const deleted = deleteAnnotation({ id: Number(req.params.id), userId: req.user.id })
  res.status(deleted ? 204 : 404).end()
})

/* ---------- the model ---------- */

// Deliberately not behind requireUser: reading without an account is the
// point of the tool. See server/generate.js for what bounds it instead.
mountGenerate(app)

/* ---------- the app itself, when there is a build to serve ---------- */

/*
 * Only in a deployment. In development Vite serves the app with hot reload
 * and proxies here, so a stale `dist/` sitting on disk must not shadow it -
 * hence the explicit opt-in rather than "serve it if the folder exists".
 */
const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, '..', 'dist')
const serveApp = process.env.SERVE_APP === 'true' || process.env.NODE_ENV === 'production'

if (serveApp && existsSync(distDir)) {
  app.use(express.static(distDir, { maxAge: '1h', index: false }))

  // Everything that is not an API call is the single-page app. Written as
  // middleware rather than a wildcard route because the pattern syntax for
  // that changed between Express 4 and 5.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(join(distDir, 'index.html'))
  })
} else if (serveApp) {
  console.warn('[server] SERVE_APP is set but there is no dist/ - run `npm run build` first.')
}

app.listen(PORT, () => {
  const what = serveApp && existsSync(distDir) ? 'app + API' : 'API'
  console.log(`[server] ${what} on http://localhost:${PORT}`)
  if (!ALLOW_SIGNUP) console.log('[server] sign-up is closed (ALLOW_SIGNUP=false)')
})
