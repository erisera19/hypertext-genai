
 // Schema and queries.


import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'


const here = dirname(fileURLToPath(import.meta.url))
export const dataDir = process.env.DATA_DIR || join(here, '..', 'data')
mkdirSync(dataDir, { recursive: true })


export const db = new DatabaseSync(join(dataDir, 'app.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    hash TEXT PRIMARY KEY,
    format TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  -- One row per (user, document): the user's own "recently opened" shelf.
  -- Title lives here, not on documents, because it comes from the filename
  -- the uploader happened to use.
  CREATE TABLE IF NOT EXISTS library (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_hash TEXT NOT NULL REFERENCES documents(hash),
    title TEXT NOT NULL,
    first_opened_at TEXT NOT NULL,
    last_opened_at TEXT NOT NULL,
    PRIMARY KEY (user_id, document_hash)
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_hash TEXT NOT NULL REFERENCES documents(hash),
    operation_id TEXT NOT NULL,
    selection TEXT NOT NULL,
    location TEXT,
    response TEXT NOT NULL,
    -- JSON describing where to redraw the highlight, e.g.
    -- {"kind":"pdf","segments":[{"page":3,"start":120,"end":260}]}
    -- Null when the format has no anchor support yet.
    anchor TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_annotations_user_doc
    ON annotations(user_id, document_hash);
  CREATE INDEX IF NOT EXISTS idx_library_user
    ON library(user_id, last_opened_at DESC);
`)

const now = () => new Date().toISOString()

/* ---------- users ---------- */

export function createUser({ email, passwordHash }) {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)`)
    .run(email, passwordHash, now())
  return { id: Number(lastInsertRowid), email }
}

export function findUserByEmail(email) {
  return db.prepare(`SELECT id, email, password_hash FROM users WHERE email = ?`).get(email) || null
}

/* ---------- sessions ---------- */

export function createSession({ token, userId, expiresAt }) {
  db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(token, userId, now(), expiresAt)
}

/**
 * The user a session token belongs to, or null if it is unknown or expired.
 * Expiry is enforced here rather than by a sweeper job, so a stale token
 * stops working the moment it is used.
 */
export function findUserBySession(token) {
  const row = db
    .prepare(
      `SELECT u.id, u.email, s.expires_at AS expiresAt
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token)
  if (!row) return null
  if (new Date(row.expiresAt) < new Date()) {
    deleteSession(token)
    return null
  }
  return { id: row.id, email: row.email }
}

export function deleteSession(token) {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token)
}

/* ---------- documents and library ---------- */

export function insertDocument({ hash, format, byteSize }) {
  db.prepare(
    `INSERT INTO documents (hash, format, byte_size, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(hash) DO NOTHING`
  ).run(hash, format, byteSize, now())
}

export function getDocument(hash) {
  return db.prepare(`SELECT hash, format, byte_size AS byteSize FROM documents WHERE hash = ?`).get(hash) || null
}

/** Records (or re-records) that this user has opened this document. */
export function touchLibraryEntry({ userId, documentHash, title }) {
  const stamp = now()
  db.prepare(
    `INSERT INTO library (user_id, document_hash, title, first_opened_at, last_opened_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, document_hash)
     DO UPDATE SET last_opened_at = excluded.last_opened_at, title = excluded.title`
  ).run(userId, documentHash, title, stamp, stamp)
}

export function listLibrary(userId) {
  return db
    .prepare(
      `SELECT l.document_hash AS hash, l.title, d.format, d.byte_size AS byteSize,
              l.last_opened_at AS lastOpenedAt,
              (SELECT COUNT(*) FROM annotations a
                WHERE a.user_id = l.user_id AND a.document_hash = l.document_hash) AS noteCount
       FROM library l JOIN documents d ON d.hash = l.document_hash
       WHERE l.user_id = ?
       ORDER BY l.last_opened_at DESC`
    )
    .all(userId)
}

export function isInLibrary({ userId, documentHash }) {
  return !!db
    .prepare(`SELECT 1 FROM library WHERE user_id = ? AND document_hash = ?`)
    .get(userId, documentHash)
}

export function removeLibraryEntry({ userId, documentHash }) {
  db.prepare(`DELETE FROM annotations WHERE user_id = ? AND document_hash = ?`)
    .run(userId, documentHash)
  const { changes } = db
    .prepare(`DELETE FROM library WHERE user_id = ? AND document_hash = ?`)
    .run(userId, documentHash)
  return changes > 0
}

/* ---------- annotations ---------- */

export function listAnnotations({ userId, documentHash }) {
  return db
    .prepare(
      `SELECT id, operation_id AS operationId, selection, location, response, anchor,
              created_at AS createdAt
       FROM annotations
       WHERE user_id = ? AND document_hash = ?
       ORDER BY id DESC`
    )
    .all(userId, documentHash)
    .map((row) => ({ ...row, anchor: row.anchor ? JSON.parse(row.anchor) : null }))
}

export function insertAnnotation({
  userId,
  documentHash,
  operationId,
  selection,
  location,
  response,
  anchor,
}) {
  const createdAt = now()
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO annotations
         (user_id, document_hash, operation_id, selection, location, response, anchor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      documentHash,
      operationId,
      selection,
      location ?? null,
      response,
      anchor ? JSON.stringify(anchor) : null,
      createdAt
    )
  return { id: Number(lastInsertRowid), createdAt }
}

export function deleteAnnotation({ id, userId }) {
  const { changes } = db
    .prepare(`DELETE FROM annotations WHERE id = ? AND user_id = ?`)
    .run(id, userId)
  return changes > 0
}
