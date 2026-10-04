/**
 * Client for the accounts/library/annotations API.
 *
 * The session lives in an httpOnly cookie, so there is no token to keep or
 * attach here - the browser sends it, and this module never sees it.
 *
 * `NotSignedIn` is thrown for a 401 so callers can tell "you are a guest"
 * apart from "the server is broken". Guest mode is a supported way to use
 * the app, not an error state.
 */

export class NotSignedIn extends Error {
  constructor() {
    super('Not signed in')
    this.name = 'NotSignedIn'
  }
}

async function request(path, { method = 'GET', body, raw, query } = {}) {
  const url = query ? `${path}?${new URLSearchParams(query)}` : path

  // An ArrayBuffer body gets no Content-Type from fetch, and express.raw()
  // parses nothing without one - the upload would arrive empty. Say so.
  const headers = raw
    ? { 'Content-Type': 'application/octet-stream' }
    : body
      ? { 'Content-Type': 'application/json' }
      : undefined

  const res = await fetch(url, {
    method,
    headers,
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  })

  if (res.status === 401) throw new NotSignedIn()
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload.error || `Request failed (${res.status})`)
  }
  if (res.status === 204) return null
  return res.json()
}

/* ---------- accounts ---------- */

export async function currentUser() {
  const { user } = await request('/api/auth/me')
  return user
}

export async function register({ email, password }) {
  const { user } = await request('/api/auth/register', { method: 'POST', body: { email, password } })
  return user
}

export async function login({ email, password }) {
  const { user } = await request('/api/auth/login', { method: 'POST', body: { email, password } })
  return user
}

export async function logout() {
  await request('/api/auth/logout', { method: 'POST' })
}

/* ---------- library ---------- */

export async function fetchLibrary() {
  const { documents } = await request('/api/library')
  return documents
}

export async function removeFromLibrary(hash) {
  await request(`/api/library/${hash}`, { method: 'DELETE' })
}

/* ---------- documents ---------- */

/** Uploads the bytes of a document opened from disk. */
export function uploadDocument({ arrayBuffer, title, format }) {
  return request('/api/documents', {
    method: 'POST',
    raw: arrayBuffer,
    query: { title, format },
  })
}

/** Records a reopen from the library and returns its saved annotations. */
export function openStoredDocument(hash) {
  return request(`/api/documents/${hash}/open`, { method: 'POST' })
}

export async function fetchDocumentBytes(hash) {
  const res = await fetch(`/api/documents/${hash}/file`)
  if (res.status === 401) throw new NotSignedIn()
  if (!res.ok) throw new Error(`Could not load that document (${res.status})`)
  return res.arrayBuffer()
}

/* ---------- annotations ---------- */

export function saveAnnotation({
  documentHash,
  operationId,
  selection,
  location,
  response,
  anchor,
}) {
  return request('/api/annotations', {
    method: 'POST',
    body: { documentHash, operationId, selection, location, response, anchor },
  })
}

export function deleteSavedAnnotation(id) {
  return request(`/api/annotations/${id}`, { method: 'DELETE' })
}
