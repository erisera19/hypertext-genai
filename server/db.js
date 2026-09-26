/**
 * Persistence store for annotations.
 *
 * A "document" is identified by the SHA-256 hash of its file bytes (computed
 * client-side), not by filename - so re-uploading the same file, even under
 * a different name, matches the same saved record. A "reader" is an opaque
 * random ID the client generates once and keeps in localStorage; there are
 * no accounts. Annotations are scoped to (document hash, reader id) so two
 * people opening the same paper do not see each other's notes.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
mkdirSync(dataDir, { recursive: true })

// Built into Node (18.x+ needs --experimental-sqlite; stable from Node 22.5+)
// - avoids native-module compilation, which better-sqlite3 requires and which
// fails to build against newer V8/Node versions.
export const db = new DatabaseSync(join(dataDir, 'app.db'))
db.exec('PRAGMA journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    hash TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    format TEXT NOT NULL,
    first_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_hash TEXT NOT NULL REFERENCES documents(hash),
    reader_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    selection TEXT NOT NULL,
    location TEXT,
    response TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_annotations_doc_reader
    ON annotations(document_hash, reader_id);
`)

export function upsertDocument({ hash, title, format }) {
  db.prepare(
    `INSERT INTO documents (hash, title, format, first_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET title = excluded.title`
  ).run(hash, title, format, new Date().toISOString())
}

export function listAnnotations({ documentHash, readerId }) {
  return db
    .prepare(
      `SELECT id, operation_id AS operationId, selection, location, response, created_at AS createdAt
       FROM annotations
       WHERE document_hash = ? AND reader_id = ?
       ORDER BY id DESC`
    )
    .all(documentHash, readerId)
}

export function insertAnnotation({
  documentHash,
  readerId,
  operationId,
  selection,
  location,
  response,
}) {
  const createdAt = new Date().toISOString()
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO annotations
         (document_hash, reader_id, operation_id, selection, location, response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(documentHash, readerId, operationId, selection, location ?? null, response, createdAt)
  return { id: lastInsertRowid, createdAt }
}

export function deleteAnnotation({ id, readerId }) {
  const { changes } = db
    .prepare(`DELETE FROM annotations WHERE id = ? AND reader_id = ?`)
    .run(id, readerId)
  return changes > 0
}
