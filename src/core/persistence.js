/**
 * Client for the persistence API (server/index.js, proxied at /api/* by
 * Vite - see vite.config.js). Annotation persistence is a stretch feature:
 * if the persistence server is down, the reading/prompting flow underneath
 * it must keep working, so every function here can fail and callers decide
 * whether that is worth surfacing.
 */

import { getReaderId } from './readerId'

async function asJson(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  if (res.status === 204) return null
  return res.json()
}

/**
 * Registers/updates the document and returns previously saved annotations
 * for this reader, newest first.
 */
export async function lookupDocument({ hash, title, format }) {
  const res = await fetch('/api/documents/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash, title, format, readerId: getReaderId() }),
  })
  const { annotations } = await asJson(res)
  return annotations
}

export async function saveAnnotation({ documentHash, operationId, selection, location, response }) {
  const res = await fetch('/api/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentHash,
      readerId: getReaderId(),
      operationId,
      selection,
      location,
      response,
    }),
  })
  return asJson(res)
}

export async function deleteSavedAnnotation(id) {
  const res = await fetch(`/api/annotations/${id}?readerId=${encodeURIComponent(getReaderId())}`, {
    method: 'DELETE',
  })
  await asJson(res)
}
