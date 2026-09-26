/**
 * Persistence API.
 *
 * A small standalone server, separate from the Vite dev server that handles
 * the Gemini proxy. Run together via `npm run dev` (see package.json); Vite
 * forwards /api/documents and /api/annotations here (see vite.config.js).
 */

import express from 'express'
import { upsertDocument, listAnnotations, insertAnnotation, deleteAnnotation } from './db.js'

const PORT = process.env.PERSISTENCE_PORT || 5175

const app = express()
app.use(express.json())

function requireFields(body, fields, res) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      res.status(400).json({ error: `Missing field: ${field}` })
      return false
    }
  }
  return true
}

app.post('/api/documents/lookup', (req, res) => {
  const { hash, title, format, readerId } = req.body || {}
  if (!requireFields(req.body || {}, ['hash', 'title', 'format', 'readerId'], res)) return

  upsertDocument({ hash, title, format })
  const annotations = listAnnotations({ documentHash: hash, readerId })
  res.json({ annotations })
})

app.post('/api/annotations', (req, res) => {
  const { documentHash, readerId, operationId, selection, location, response } = req.body || {}
  if (
    !requireFields(
      req.body || {},
      ['documentHash', 'readerId', 'operationId', 'selection', 'response'],
      res
    )
  )
    return

  const saved = insertAnnotation({
    documentHash,
    readerId,
    operationId,
    selection,
    location,
    response,
  })
  res.status(201).json(saved)
})

app.delete('/api/annotations/:id', (req, res) => {
  const { readerId } = req.query
  if (!readerId) {
    res.status(400).json({ error: 'Missing query param: readerId' })
    return
  }
  const deleted = deleteAnnotation({ id: Number(req.params.id), readerId: String(readerId) })
  res.status(deleted ? 204 : 404).end()
})

app.listen(PORT, () => {
  console.log(`[persistence] listening on http://localhost:${PORT}`)
})
